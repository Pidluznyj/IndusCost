/**
 * Inteligência Fiscal 360° — processador incremental (fora do ciclo HTTP).
 *
 * Fluxo de uma execução (`runFiscal360Processing`):
 *  1. Descoberta por watermark (`updatedAt`, sobreposição de 10 min) + comparação de hash com o fato
 *     persistido → só entidades realmente alteradas viram job.
 *  2. Jobs de entidade (documento, título AP, guia) → fatos; marcam as partições afetadas
 *     (antiga E nova: mudança de competência invalida as duas).
 *  3. Jobs de partição (empresa × competência) → conciliação + snapshot publicados numa transação.
 *  4. Job de projeção (singleton) → cenários persistidos.
 * Nada aqui roda no startup nem em requisição GET.
 */
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  FISCAL360_JOB_TYPES,
  FISCAL360_REFORM_KEY,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_TAX_PARAMS_KEY,
  FISCAL360_UNKNOWN_COMPANY,
  addFiscal360Months,
  fiscal360PartitionKey,
  isFiscal360Month,
  resolveFiscal360GroupCnpj,
} from "./fiscal360Constants.js";
import { buildFiscal360ApTitleFact, type FiscalApTitleFactDraft } from "./fiscal360ApClassifier.js";
import { buildFiscal360DocumentFact, fiscal360DocumentHashInput } from "./fiscal360DocumentFact.js";
import {
  buildFiscal360Forecast,
  FISCAL360_FORECAST_VERSION,
  FISCAL360_SYSTEM_SCENARIOS,
  sanitizeForecastAssumptions,
  type ForecastTaxParameter,
} from "./fiscal360Forecast.js";
import { buildFiscal360Partition } from "./fiscal360Partition.js";
import {
  buildFiscal360ApPaymentFact,
  buildFiscal360GuidePaymentFact,
  fiscal360GuideCompetence,
  fiscal360PaymentPartitions,
  type FiscalApEvidence,
  type FiscalPaymentFactDraft,
} from "./fiscal360PaymentFact.js";
import {
  claimFiscal360Jobs,
  completeFiscal360Job,
  enqueueFiscal360Jobs,
  extendFiscal360Lease,
  failFiscal360Job,
  FISCAL360_LOCK_NAMESPACE,
  fiscal360Hash,
  fiscal360XactLock,
  forecastJob,
  partitionJob,
  readFiscal360Checkpoint,
  writeFiscal360Checkpoint,
  type Fiscal360ClaimedJob,
  type Fiscal360JobInput,
} from "./fiscal360Queue.server.js";
import {
  loadFiscal360ApDecisions,
  loadFiscal360ApRules,
  loadFiscal360ApSources,
  loadFiscal360DocumentSources,
  loadFiscal360GuideLinks,
  loadFiscal360GuideSources,
  loadFiscal360TreasuryEvidence,
  num,
  resolveFiscal360ClaimWinner,
} from "./fiscal360Sources.server.js";

type Tx = Prisma.TransactionClient;
type Partition = { companyCnpj: string; month: string };

const TX_OPTIONS = { maxWait: 30_000, timeout: 120_000 } as const;
const DISCOVERY_OVERLAP_MS = 10 * 60_000;
const HANDLED_MAP_LIMIT = 5000;

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

function uniquePartitions(parts: Partition[]): Partition[] {
  const map = new Map<string, Partition>();
  for (const p of parts) {
    if (!p.companyCnpj || !isFiscal360Month(p.month)) continue;
    map.set(fiscal360PartitionKey(p.companyCnpj, p.month), p);
  }
  return [...map.values()];
}

function partitionJobs(parts: Partition[], runId?: string | null): Fiscal360JobInput[] {
  return uniquePartitions(parts).map((p) => partitionJob(p.companyCnpj, p.month, { runId: runId ?? null }));
}

// ————————————————————————————————————————————— Qualidade de dados

type IssueDraft = {
  issueType: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  entityType: string;
  entityId: string;
  companyCnpj?: string | null;
  competenceMonth?: string | null;
  taxType?: string | null;
  message: string;
  details?: Record<string, unknown> | null;
};

/** Substitui o conjunto de pendências ABERTAS de um escopo: as não reemitidas são resolvidas (histórico preservado). */
export async function syncFiscal360Issues(tx: Tx, scopeKey: string, issues: IssueDraft[], ruleVersion: string): Promise<void> {
  const now = new Date();
  const keys = issues.map((i) => `${scopeKey}|${i.issueType}|${i.entityId}`);
  await tx.fiscalDataQualityIssue.updateMany({
    where: { scopeKey, status: { in: ["OPEN", "ACKNOWLEDGED"] }, ...(keys.length ? { dedupeKey: { notIn: keys } } : {}) },
    data: { status: "RESOLVED", resolvedAt: now },
  });
  for (let i = 0; i < issues.length; i += 1) {
    const issue = issues[i]!;
    const data = {
      scopeKey,
      issueType: issue.issueType,
      severity: issue.severity,
      entityType: issue.entityType,
      entityId: issue.entityId,
      companyCnpj: issue.companyCnpj ?? null,
      competenceMonth: issue.competenceMonth ?? null,
      taxType: issue.taxType ?? null,
      message: issue.message,
      details: (issue.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      lastDetectedAt: now,
      ruleVersion,
    };
    const existing = await tx.fiscalDataQualityIssue.findUnique({ where: { dedupeKey: keys[i]! }, select: { status: true } });
    if (!existing) {
      await tx.fiscalDataQualityIssue.create({ data: { ...data, dedupeKey: keys[i]!, status: "OPEN", firstDetectedAt: now } });
    } else {
      await tx.fiscalDataQualityIssue.update({
        where: { dedupeKey: keys[i]! },
        // Reconhecida continua reconhecida; resolvida que voltou reabre.
        data: { ...data, status: existing.status === "ACKNOWLEDGED" ? "ACKNOWLEDGED" : "OPEN", resolvedAt: null },
      });
    }
  }
}

const DOC_FLAG_ISSUES: Record<string, { severity: IssueDraft["severity"]; message: string }> = {
  XML_NOT_PARSED: { severity: "WARNING", message: "NF-e sem resumo fiscal persistido (XML não processado)." },
  XML_MISSING: { severity: "WARNING", message: "NF-e sem XML: tributos documentais indisponíveis." },
  XML_PARTIAL: { severity: "WARNING", message: "XML parcial: tributos podem estar incompletos." },
  NO_HEADER_TAXES: { severity: "INFO", message: "NF-e autorizada sem tributos destacados no cabeçalho." },
  COMPANY_UNKNOWN: { severity: "WARNING", message: "Emitente não identificado como empresa do grupo." },
  NO_COMPETENCE_DATE: { severity: "WARNING", message: "Documento sem data de emissão/processamento." },
  BONIFICATION_IN_OFFICIAL_BILLING: { severity: "WARNING", message: "Natureza de bonificação/brinde contada como faturamento oficial — revisar classificação Nomus." },
  INTERCOMPANY_RECIPIENT_NOT_RESOLVED: { severity: "INFO", message: "NF intercompany sem CNPJ de destinatário do grupo no XML." },
};

const PAYMENT_FLAG_ISSUES: Record<string, { severity: IssueDraft["severity"]; message: string }> = {
  GUIDE_COMPANY_UNKNOWN: { severity: "WARNING", message: "Guia sem empresa identificável (período sem empresa, sem AP)." },
  AP_COMPANY_UNKNOWN: { severity: "WARNING", message: "Título tributário com empresa pagadora não identificada." },
  DUPLICATE_AP_LINK: { severity: "CRITICAL", message: "Título AP vinculado a mais de uma guia." },
  AP_COMPANY_DIFFERS_FROM_PERIOD: { severity: "WARNING", message: "Empresa do AP difere da empresa do período de apuração." },
  GUIDE_PAID_DIFFERS_FROM_AP: { severity: "WARNING", message: "Valor pago informado na guia difere da baixa do AP." },
  NO_CASH_DATE: { severity: "INFO", message: "Pagamento sem data de caixa (Nomus não envia data de baixa; sem conciliação bancária)." },
  SETTLED_WITHOUT_CASH: { severity: "WARNING", message: "Título baixado sem numerário — verificar compensação; não contado como pago." },
  AP_CANCELLED: { severity: "WARNING", message: "Guia vinculada a título AP cancelado." },
  AP_REMOVED_AT_SOURCE: { severity: "WARNING", message: "Guia vinculada a título AP removido na origem." },
  PARTIAL_BANK_MATCH: { severity: "INFO", message: "Conciliação bancária cobre só parte do valor pago — pagamento não é tratado como comprovado." },
};

// ————————————————————————————————————————————— Documento

export async function materializeFiscal360Document(
  tx: Tx,
  nomusNfeId: string,
  opts: { force?: boolean } = {}
): Promise<{ changed: boolean; created: boolean; partitions: Partition[] }> {
  await fiscal360XactLock(tx, FISCAL360_LOCK_NAMESPACE.entity, `DOC:${nomusNfeId}`);
  const existing = await tx.fiscalDocumentFact.findUnique({
    where: { nomusNfeId },
    select: { id: true, sourceHash: true, ruleVersion: true, companyCnpj: true, competenceMonth: true, version: true },
  });
  const [source] = await loadFiscal360DocumentSources(tx, [nomusNfeId]);
  if (!source) {
    if (!existing) return { changed: false, created: false, partitions: [] };
    await tx.fiscalDocumentFact.delete({ where: { id: existing.id } });
    await syncFiscal360Issues(tx, `DOC:${nomusNfeId}`, [], FISCAL360_RULE_VERSIONS.document);
    return { changed: true, created: false, partitions: [{ companyCnpj: existing.companyCnpj, month: existing.competenceMonth }] };
  }
  const sourceHash = fiscal360Hash(fiscal360DocumentHashInput(source));
  if (!opts.force && existing && existing.sourceHash === sourceHash && existing.ruleVersion === FISCAL360_RULE_VERSIONS.document) {
    return { changed: false, created: false, partitions: [] };
  }
  const draft = buildFiscal360DocumentFact(source);
  const { taxes, issueDate, ...fact } = draft;
  const data = {
    ...fact,
    issueDate: dateOrNull(issueDate),
    sourceHash,
    materializedAt: new Date(),
  };
  const saved = existing
    ? await tx.fiscalDocumentFact.update({ where: { id: existing.id }, data: { ...data, version: existing.version + 1 } })
    : await tx.fiscalDocumentFact.create({ data });
  await tx.fiscalDocumentTaxFact.deleteMany({ where: { documentFactId: saved.id } });
  if (taxes.length) {
    await tx.fiscalDocumentTaxFact.createMany({
      data: taxes.map((t) => ({
        documentFactId: saved.id,
        nomusNfeId,
        companyCnpj: draft.companyCnpj,
        competenceMonth: draft.competenceMonth,
        taxType: t.taxType,
        effect: t.effect,
        baseAmount: t.baseAmount,
        amount: t.amount,
        fiscalStatus: draft.fiscalStatus,
        operationClass: draft.operationClass,
        sourcePath: t.sourcePath,
      })),
    });
  }
  await syncFiscal360Issues(
    tx,
    `DOC:${nomusNfeId}`,
    draft.qualityFlags
      .filter((f) => DOC_FLAG_ISSUES[f])
      .map((f) => ({
        issueType: f,
        severity: DOC_FLAG_ISSUES[f]!.severity,
        entityType: "NOMUS_NFE",
        entityId: nomusNfeId,
        companyCnpj: draft.companyCnpj,
        competenceMonth: draft.competenceMonth,
        message: `${DOC_FLAG_ISSUES[f]!.message} NF ${draft.numero ?? draft.nomusExternalId}.`,
        details: { externalId: draft.nomusExternalId, numero: draft.numero },
      })),
    FISCAL360_RULE_VERSIONS.document
  );
  const partitions: Partition[] = [{ companyCnpj: draft.companyCnpj, month: draft.competenceMonth }];
  if (existing) partitions.push({ companyCnpj: existing.companyCnpj, month: existing.competenceMonth });
  return { changed: true, created: !existing, partitions };
}

// ————————————————————————————————————————————— Título AP

function apEvidenceFromFact(f: {
  apExternalId: number;
  companyCnpj: string;
  amountOriginal: unknown;
  amountPaid: unknown;
  balance: unknown;
  effectiveStatus: string;
  dueDate: Date | string | null;
  apPaymentDate: Date | string | null;
  treasuryPaidDate: Date | string | null;
  treasuryMatchCount: number;
  treasuryMatchedAmount?: unknown;
  classificationEvidence?: unknown;
  settledWithoutCash?: boolean;
}): FiscalApEvidence {
  const iso = (v: Date | string | null) => (v == null ? null : (typeof v === "string" ? v : v.toISOString()).slice(0, 10));
  const evidence = (f.classificationEvidence ?? {}) as Record<string, unknown>;
  return {
    apExternalId: f.apExternalId,
    companyCnpj: f.companyCnpj,
    amountOriginal: num(f.amountOriginal),
    amountPaid: num(f.amountPaid),
    balance: num(f.balance),
    effectiveStatus: f.effectiveStatus,
    settledWithoutCash: f.settledWithoutCash ?? evidence.settledWithoutCash === true,
    dueDate: iso(f.dueDate),
    apPaymentDate: iso(f.apPaymentDate),
    treasuryPaidDate: iso(f.treasuryPaidDate),
    treasuryMatchCount: f.treasuryMatchCount,
    treasuryMatchedAmount: f.treasuryMatchedAmount == null ? null : num(f.treasuryMatchedAmount),
  };
}

async function upsertPaymentFact(
  tx: Tx,
  draft: FiscalPaymentFactDraft,
  sourceHash: string
): Promise<{ changed: boolean; partitions: Partition[] }> {
  const existing = await tx.fiscalPaymentFact.findUnique({
    where: { anchorKey: draft.anchorKey },
    select: { id: true, sourceHash: true, ruleVersion: true, companyCnpj: true, competenceMonth: true, paidMonth: true, version: true, countsInPaidTotals: true, reviewReason: true },
  });
  if (existing && existing.sourceHash === sourceHash && existing.ruleVersion === draft.ruleVersion) {
    return { changed: false, partitions: [] };
  }
  const { periodStart, periodEnd, dueDate, paidAt, ...rest } = draft;
  // A revisão de duplicidade é decidida na partição (não na materialização do fato): ao rematerializar,
  // preservar countsInPaidTotals/reviewReason já decididos, exceto quando o próprio fato nasce em revisão.
  const keepReview = existing && !draft.reviewReason;
  const data = {
    ...rest,
    ...(keepReview ? { countsInPaidTotals: existing.countsInPaidTotals, reviewReason: existing.reviewReason } : {}),
    periodStart: dateOrNull(periodStart),
    periodEnd: dateOrNull(periodEnd),
    dueDate: dateOrNull(dueDate),
    paidAt: dateOrNull(paidAt),
    sourceHash,
    materializedAt: new Date(),
  };
  if (existing) {
    await tx.fiscalPaymentFact.update({ where: { id: existing.id }, data: { ...data, version: existing.version + 1 } });
  } else {
    await tx.fiscalPaymentFact.create({ data });
  }
  return {
    changed: true,
    partitions: [...fiscal360PaymentPartitions(draft), ...fiscal360PaymentPartitions(existing ?? null)],
  };
}

async function deletePaymentFact(tx: Tx, anchorKey: string): Promise<Partition[]> {
  const existing = await tx.fiscalPaymentFact.findUnique({
    where: { anchorKey },
    select: { id: true, companyCnpj: true, competenceMonth: true, paidMonth: true },
  });
  if (!existing) return [];
  await tx.fiscalPaymentFact.delete({ where: { id: existing.id } });
  await syncFiscal360Issues(tx, `PAY:${anchorKey}`, [], FISCAL360_RULE_VERSIONS.payment);
  return fiscal360PaymentPartitions(existing);
}

function paymentIssues(draft: FiscalPaymentFactDraft): IssueDraft[] {
  return draft.flags
    .filter((f) => PAYMENT_FLAG_ISSUES[f])
    .map((f) => ({
      issueType: f,
      severity: PAYMENT_FLAG_ISSUES[f]!.severity,
      entityType: draft.anchorType === "GUIDE" ? "FISCAL_GUIDE" : "AP_TITLE",
      entityId: draft.anchorType === "GUIDE" ? draft.guideId! : String(draft.apExternalId),
      companyCnpj: draft.companyCnpj,
      competenceMonth: draft.competenceMonth,
      taxType: draft.taxType,
      message: PAYMENT_FLAG_ISSUES[f]!.message,
      details: { anchorKey: draft.anchorKey },
    }));
}

export async function materializeFiscal360ApTitle(
  tx: Tx,
  apExternalId: number,
  ctx: { rules: Awaited<ReturnType<typeof loadFiscal360ApRules>> }
): Promise<{ changed: boolean; partitions: Partition[]; followUps: Fiscal360JobInput[] }> {
  await fiscal360XactLock(tx, FISCAL360_LOCK_NAMESPACE.entity, `AP:${apExternalId}`);
  const followUps: Fiscal360JobInput[] = [];
  const existing = await tx.fiscalApTitleFact.findUnique({ where: { apExternalId } });
  const [source] = await loadFiscal360ApSources(tx, [apExternalId]);
  const oldPartitions: Partition[] = existing
    ? [
        { companyCnpj: existing.companyCnpj, month: existing.competenceMonth },
        ...(existing.intercompanyCounterpartyCnpj ? [{ companyCnpj: existing.intercompanyCounterpartyCnpj, month: existing.competenceMonth }] : []),
      ]
    : [];
  if (!source) {
    if (!existing) return { changed: false, partitions: [], followUps };
    await tx.fiscalApTitleFact.delete({ where: { id: existing.id } });
    const partitions = [...oldPartitions, ...(await deletePaymentFact(tx, `AP:${apExternalId}`))];
    await syncFiscal360Issues(tx, `AP:${apExternalId}`, [], FISCAL360_RULE_VERSIONS.apClassifier);
    return { changed: true, partitions, followUps };
  }
  const [treasury, decisions, links] = await Promise.all([
    loadFiscal360TreasuryEvidence(tx, [apExternalId]),
    loadFiscal360ApDecisions(tx, [apExternalId]),
    loadFiscal360GuideLinks(tx, { apExternalIds: [apExternalId] }),
  ]);
  const winner = resolveFiscal360ClaimWinner(links, apExternalId);
  const ruleVersion = `${FISCAL360_RULE_VERSIONS.apClassifier}|rules:${ctx.rules.version}`;
  const decision = decisions.get(apExternalId) ?? null;
  const hashInput = [
    source.payloadHash,
    source.sourcePresenceStatus,
    treasury.get(apExternalId) ?? null,
    winner ? [winner.guideId, winner.source, winner.taxType] : null,
    decision,
    ruleVersion,
  ];
  const sourceHash = fiscal360Hash(hashInput);
  if (existing && existing.sourceHash === sourceHash && existing.ruleVersion === ruleVersion) {
    // O fato do título não mudou, mas a obrigação ancorada nele depende de estado externo (guia que o
    // segurava e foi liberada por outro job). Só pula se a obrigação já estiver consistente.
    const wantsAnchor = existing.classificationStatus === "TAX" && !winner && existing.effectiveStatus !== "REMOVED_AT_SOURCE";
    const [anchored, holder] = await Promise.all([
      tx.fiscalPaymentFact.findUnique({ where: { anchorKey: `AP:${apExternalId}` }, select: { id: true } }),
      tx.fiscalPaymentFact.findFirst({ where: { apExternalId, anchorType: "GUIDE" }, select: { id: true } }),
    ]);
    const consistent = wantsAnchor ? Boolean(anchored) || Boolean(holder) : !anchored;
    if (consistent) return { changed: false, partitions: [], followUps };
  }
  const draft: FiscalApTitleFactDraft = buildFiscal360ApTitleFact(source, {
    guideClaim: winner ? { guideId: winner.guideId, taxType: winner.taxType, source: winner.source } : null,
    decision,
    rules: ctx.rules.rules,
    treasury: treasury.get(apExternalId) ?? null,
  });
  const c = draft.classification;
  const data = {
    apId: draft.apId,
    companyCnpj: draft.companyCnpj,
    companyName: draft.companyName,
    personName: draft.personName,
    personCnpj: draft.personCnpj,
    description: draft.description,
    nomusClassification: draft.nomusClassification,
    documentNumber: draft.documentNumber,
    dueDate: dateOrNull(draft.dueDate),
    competenceDate: dateOrNull(draft.competenceDate),
    competenceMonth: draft.competenceMonth,
    amountOriginal: draft.amountOriginal,
    amountPaid: draft.amountPaid,
    balance: draft.balance,
    effectiveStatus: draft.effectiveStatus,
    apPaymentDate: dateOrNull(draft.apPaymentDate),
    treasuryPaidDate: dateOrNull(draft.treasuryPaidDate),
    treasuryMatchedAmount: draft.treasuryMatchedAmount,
    treasuryMatchCount: draft.treasuryMatchCount,
    classificationStatus: c.classificationStatus,
    taxType: c.taxType,
    suggestedTaxType: c.suggestedTaxType,
    revenueCode: c.revenueCode,
    classificationConfidence: c.confidence,
    classificationRule: c.rule,
    classificationEvidence: { ...c.evidence, settledWithoutCash: draft.settledWithoutCash } as Prisma.InputJsonValue,
    classifierVersion: FISCAL360_RULE_VERSIONS.apClassifier,
    manualDecisionId: c.manualDecisionId,
    claimedByGuideId: draft.claimedByGuideId,
    isIntercompany: draft.isIntercompany,
    intercompanyCounterpartyCnpj: draft.intercompanyCounterpartyCnpj,
    sourceHash,
    ruleVersion,
    materializedAt: new Date(),
  };
  if (existing) {
    await tx.fiscalApTitleFact.update({ where: { id: existing.id }, data: { ...data, version: existing.version + 1 } });
    // Trilha das reclassificações automáticas (mudança de status/tributo).
    if (existing.classificationStatus !== c.classificationStatus || existing.taxType !== c.taxType) {
      await tx.fiscalSettlementAuditLog.create({
        data: {
          entityType: "Fiscal360ApClassification",
          entityId: String(apExternalId),
          action: "AUTO_RECLASSIFY",
          beforeJson: { status: existing.classificationStatus, taxType: existing.taxType, rule: existing.classificationRule, ruleVersion: existing.ruleVersion },
          afterJson: { status: c.classificationStatus, taxType: c.taxType, rule: c.rule, ruleVersion },
          userName: "fiscal360-processor",
        },
      });
    }
  } else {
    await tx.fiscalApTitleFact.create({ data: { apExternalId, ...data } });
  }

  const partitions: Partition[] = [
    ...oldPartitions,
    { companyCnpj: draft.companyCnpj, month: draft.competenceMonth },
    ...(draft.intercompanyCounterpartyCnpj ? [{ companyCnpj: draft.intercompanyCounterpartyCnpj, month: draft.competenceMonth }] : []),
  ];

  // Obrigação ancorada no próprio título: só TAX (confiança alta), sem guia e presente na origem.
  const anchorKey = `AP:${apExternalId}`;
  const issues: IssueDraft[] = [];
  if (c.classificationStatus === "PENDING") {
    issues.push({
      issueType: "AP_PENDING_CLASSIFICATION",
      severity: "WARNING",
      entityType: "AP_TITLE",
      entityId: String(apExternalId),
      companyCnpj: draft.companyCnpj,
      competenceMonth: draft.competenceMonth,
      taxType: c.suggestedTaxType,
      message: `Título AP ${apExternalId} com indício tributário sem confiança suficiente (${c.rule}).`,
      details: { suggestedTaxType: c.suggestedTaxType, confidence: c.confidence },
    });
  }
  if (winner) {
    partitions.push(...(await deletePaymentFact(tx, anchorKey)));
    // A guia usa este título como evidência (valor pago/datas): rematerializa.
    followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: winner.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment });
  } else if (c.classificationStatus === "TAX" && c.taxType && draft.effectiveStatus !== "REMOVED_AT_SOURCE") {
    // Uma guia antiga ainda pode segurar o título (vínculo desfeito, guia não rematerializada): libera primeiro.
    const holder = await tx.fiscalPaymentFact.findFirst({ where: { apExternalId, anchorType: "GUIDE" }, select: { guideId: true } });
    if (holder?.guideId) {
      followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: holder.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment });
    } else {
      const payment = buildFiscal360ApPaymentFact({
        ...apEvidenceFromFact({ ...draft, apExternalId, settledWithoutCash: draft.settledWithoutCash }),
        taxType: c.taxType,
        revenueCode: c.revenueCode,
        competenceMonth: draft.competenceMonth,
        documentNumber: draft.documentNumber,
      });
      const res = await upsertPaymentFact(tx, payment, fiscal360Hash([sourceHash, payment]));
      partitions.push(...res.partitions);
      issues.push(...paymentIssues(payment));
    }
  } else {
    partitions.push(...(await deletePaymentFact(tx, anchorKey)));
  }
  await syncFiscal360Issues(tx, `AP:${apExternalId}`, issues, ruleVersion);
  return { changed: true, partitions, followUps };
}

// ————————————————————————————————————————————— Guia

export async function materializeFiscal360Guide(
  tx: Tx,
  guideId: string,
  ctx: { rules: Awaited<ReturnType<typeof loadFiscal360ApRules>> }
): Promise<{ changed: boolean; partitions: Partition[]; followUps: Fiscal360JobInput[] }> {
  await fiscal360XactLock(tx, FISCAL360_LOCK_NAMESPACE.entity, `GUIDE:${guideId}`);
  const anchorKey = `GUIDE:${guideId}`;
  const followUps: Fiscal360JobInput[] = [];
  const previous = await tx.fiscalPaymentFact.findUnique({ where: { anchorKey }, select: { apExternalId: true } });
  const [guide] = await loadFiscal360GuideSources(tx, [guideId]);
  if (!guide) {
    const partitions = await deletePaymentFact(tx, anchorKey);
    if (previous?.apExternalId != null) {
      followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(previous.apExternalId), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier });
    }
    return { changed: partitions.length > 0, partitions, followUps };
  }
  const ownLinks = await loadFiscal360GuideLinks(tx, { guideIds: [guideId] });
  const own = ownLinks.find((l) => l.guideId === guideId) ?? null;
  let apEvidence: FiscalApEvidence | null = null;
  let apClaimLost = false;
  const partitions: Partition[] = [];
  if (own && guide.status !== "CANCELLED") {
    const competing = await loadFiscal360GuideLinks(tx, { apExternalIds: [own.apExternalId] });
    const winner = resolveFiscal360ClaimWinner(competing, own.apExternalId);
    apClaimLost = winner != null && winner.guideId !== guideId;
    for (const other of competing) {
      if (other.guideId !== guideId) {
        followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: other.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment });
      }
    }
    let apFact = await tx.fiscalApTitleFact.findUnique({ where: { apExternalId: own.apExternalId } });
    if (!apFact) {
      const res = await materializeFiscal360ApTitle(tx, own.apExternalId, ctx);
      partitions.push(...res.partitions);
      apFact = await tx.fiscalApTitleFact.findUnique({ where: { apExternalId: own.apExternalId } });
    } else if (!apClaimLost && apFact.claimedByGuideId !== guideId) {
      followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(own.apExternalId), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier });
    }
    if (apFact) apEvidence = apEvidenceFromFact(apFact);
  }
  const companyDecision = await tx.fiscalReconciliationDecision.findFirst({
    where: { active: true, decisionType: "ASSIGN_GUIDE_COMPANY", guideId },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const decisionCnpj = (() => {
    const p = (companyDecision?.payload ?? {}) as Record<string, unknown>;
    return typeof p.companyCnpj === "string" ? resolveFiscal360GroupCnpj({ cnpj: p.companyCnpj }) : null;
  })();
  const draft = buildFiscal360GuidePaymentFact(guide, {
    ap: apEvidence,
    apLinkSource: own?.source ?? "NONE",
    apClaimLost,
    companyDecisionCnpj: decisionCnpj,
  });
  // O título passa a ser evidência desta guia: remove a obrigação ancorada no título (sem dupla contagem)
  // e solta o título de outra guia que o segurava (vencedor mudou) — a outra guia é rematerializada.
  if (draft.apExternalId != null) {
    partitions.push(...(await deletePaymentFact(tx, `AP:${draft.apExternalId}`)));
    const holders = await tx.fiscalPaymentFact.findMany({
      where: { apExternalId: draft.apExternalId, anchorType: "GUIDE", NOT: { guideId } },
      select: { id: true, guideId: true, companyCnpj: true, competenceMonth: true, paidMonth: true },
    });
    for (const h of holders) {
      await tx.fiscalPaymentFact.update({ where: { id: h.id }, data: { apExternalId: null, sourceHash: "released" } });
      partitions.push(...fiscal360PaymentPartitions(h));
      if (h.guideId) followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: h.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment });
    }
  }
  const sourceHash = fiscal360Hash([
    guide.updatedAt,
    guide.proofCount,
    guide.periodCompanyName,
    own ? [own.apExternalId, own.source] : null,
    apClaimLost,
    apEvidence,
    decisionCnpj,
  ]);
  const res = await upsertPaymentFact(tx, draft, sourceHash);
  partitions.push(...res.partitions);
  if (previous?.apExternalId != null && previous.apExternalId !== draft.apExternalId) {
    // Vínculo desfeito/trocado: o título liberado volta a ser avaliado sozinho.
    followUps.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(previous.apExternalId), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier });
  }
  await syncFiscal360Issues(tx, `PAY:${anchorKey}`, paymentIssues(draft), FISCAL360_RULE_VERSIONS.payment);
  return { changed: res.changed || partitions.length > 0, partitions, followUps };
}

// ————————————————————————————————————————————— Partição

export async function rebuildFiscal360Partition(
  tx: Tx,
  partition: Partition
): Promise<{ snapshotVersion: number; items: number; rows: number; affectedPartitions: Partition[] }> {
  const { companyCnpj, month } = partition;
  if (!isFiscal360Month(month) || !companyCnpj) throw new Error(`Partição inválida: ${companyCnpj}:${month}`);
  await fiscal360XactLock(tx, FISCAL360_LOCK_NAMESPACE.partition, fiscal360PartitionKey(companyCnpj, month));

  const [docTaxes, docs, payments, cashPayments, pendingAp, icDocs, icAp, decisions, prev] = await Promise.all([
    tx.fiscalDocumentTaxFact.groupBy({
      by: ["taxType", "effect", "operationClass", "fiscalStatus"],
      where: { companyCnpj, competenceMonth: month },
      _sum: { amount: true },
    }),
    tx.fiscalDocumentFact.groupBy({
      by: ["operationClass", "fiscalStatus", "xmlStatus", "isOfficialBilling"],
      where: { companyCnpj, competenceMonth: month },
      _count: { _all: true },
      _sum: { officialRevenueAmount: true, valorLiquido: true, vNF: true },
    }),
    tx.fiscalPaymentFact.findMany({ where: { companyCnpj, competenceMonth: month } }),
    tx.fiscalPaymentFact.findMany({ where: { companyCnpj, paidMonth: month } }),
    tx.fiscalApTitleFact.findMany({
      where: { companyCnpj, competenceMonth: month, classificationStatus: "PENDING", effectiveStatus: { not: "REMOVED_AT_SOURCE" } },
      select: { apExternalId: true, suggestedTaxType: true, amountOriginal: true, classificationConfidence: true },
    }),
    tx.fiscalDocumentFact.groupBy({
      by: ["recipientGroupCnpj"],
      where: { companyCnpj, competenceMonth: month, operationClass: "INTERCOMPANY", fiscalStatus: "AUTHORIZED", recipientGroupCnpj: { not: null } },
      _count: { _all: true },
      _sum: { vNF: true, highlightedTaxTotal: true },
    }),
    tx.fiscalApTitleFact.groupBy({
      by: ["companyCnpj"],
      where: {
        isIntercompany: true,
        intercompanyCounterpartyCnpj: companyCnpj,
        competenceMonth: month,
        effectiveStatus: { notIn: ["CANCELLED", "REMOVED_AT_SOURCE"] },
      },
      _count: { _all: true },
      _sum: { amountOriginal: true, amountPaid: true, balance: true },
    }),
    tx.fiscalReconciliationDecision.findMany({
      where: { active: true, decisionType: { in: ["MARK_DISTINCT", "ACCEPT_DIVERGENCE"] } },
      select: { decisionType: true, guideId: true, apExternalId: true, itemKey: true },
    }),
    tx.fiscalMonthlySnapshot.findFirst({
      where: { companyCnpj, competenceMonth: month },
      select: { snapshotVersion: true },
      orderBy: { snapshotVersion: "desc" },
    }),
  ]);

  // Apuração: períodos não cancelados cuja empresa resolve para o CNPJ e cujo FIM cai no mês.
  const monthStart = new Date(`${month}-01T00:00:00.000Z`);
  const monthEnd = new Date(`${addFiscal360Months(month, 1)}-01T00:00:00.000Z`);
  const periods = await tx.fiscalApurationPeriod.findMany({
    where: { status: { not: "CANCELLED" }, periodEnd: { gte: monthStart, lt: monthEnd } },
    include: { lines: true },
  });
  const apuration = periods
    .filter((p) => (resolveFiscal360GroupCnpj({ name: p.companyName }) ?? FISCAL360_UNKNOWN_COMPANY) === companyCnpj)
    .flatMap((p) =>
      p.lines.map((l) => ({
        periodId: p.id,
        periodStatus: p.status,
        taxType: l.taxType.trim().toUpperCase(),
        nature: l.nature,
        assessedAmount: num(l.assessedAmount),
        creditsAmount: num(l.creditsAmount),
        compensationsAmount: num(l.compensationsAmount),
        amountDue: num(l.amountDue),
      }))
    );

  const openIssueCount = await tx.fiscalDataQualityIssue.count({
    where: { companyCnpj, competenceMonth: month, status: "OPEN" },
  });
  const toPayment = (p: (typeof payments)[number]) => ({
    id: p.id,
    anchorKey: p.anchorKey,
    anchorType: p.anchorType,
    guideId: p.guideId,
    apExternalId: p.apExternalId,
    companyCnpj: p.companyCnpj,
    taxType: p.taxType,
    competenceMonth: p.competenceMonth,
    dueDate: p.dueDate ? p.dueDate.toISOString().slice(0, 10) : null,
    amountDue: num(p.amountDue),
    paidAmount: num(p.paidAmount),
    openBalance: num(p.openBalance),
    paidMonth: p.paidMonth,
    status: p.status,
    evidenceLevel: p.evidenceLevel,
    linkState: p.linkState,
    proofCount: p.proofCount,
    hasBankMatch: p.hasBankMatch,
    flags: p.flags,
    countsInPaidTotals: p.countsInPaidTotals,
  });

  // Universo da detecção de duplicidade (mesma empresa): competência ±1 mês + mesmos meses de caixa.
  const paidMonths = [...new Set(payments.map((p) => p.paidMonth).filter((m): m is string => Boolean(m)))];
  const poolRows = await tx.fiscalPaymentFact.findMany({
    where: {
      companyCnpj,
      OR: [
        { competenceMonth: { in: [addFiscal360Months(month, -1), month, addFiscal360Months(month, 1)] } },
        ...(paidMonths.length ? [{ paidMonth: { in: paidMonths } }] : []),
      ],
    },
  });

  const result = buildFiscal360Partition({
    companyCnpj,
    month,
    pool: poolRows.map(toPayment),
    docTaxes: docTaxes.map((d) => ({ taxType: d.taxType, effect: d.effect, operationClass: d.operationClass, fiscalStatus: d.fiscalStatus, amount: num(d._sum.amount) })),
    docs: docs.map((d) => ({
      operationClass: d.operationClass,
      fiscalStatus: d.fiscalStatus,
      xmlStatus: d.xmlStatus,
      count: d._count._all,
      officialCount: d.isOfficialBilling ? d._count._all : 0,
      officialRevenue: num(d._sum.officialRevenueAmount),
      valorLiquido: num(d._sum.valorLiquido),
      vNF: num(d._sum.vNF),
    })),
    payments: payments.map(toPayment),
    cashPayments: cashPayments.map(toPayment),
    apuration,
    pendingAp: pendingAp.map((a) => ({ apExternalId: a.apExternalId, suggestedTaxType: a.suggestedTaxType, amountOriginal: num(a.amountOriginal), confidence: a.classificationConfidence })),
    intercompanyDocs: icDocs.map((d) => ({ recipientCnpj: d.recipientGroupCnpj!, count: d._count._all, documentValue: num(d._sum.vNF), highlightedTax: num(d._sum.highlightedTaxTotal) })),
    intercompanyAp: icAp.map((a) => ({ payerCnpj: a.companyCnpj, count: a._count._all, amount: num(a._sum.amountOriginal), paid: num(a._sum.amountPaid), open: num(a._sum.balance) })),
    distinctPairs: decisions
      .filter((d) => d.decisionType === "MARK_DISTINCT" && d.guideId && d.apExternalId != null)
      .map((d) => ({ guideId: d.guideId!, apExternalId: d.apExternalId! })),
    acceptedItemKeys: decisions.filter((d) => d.decisionType === "ACCEPT_DIVERGENCE" && d.itemKey).map((d) => d.itemKey!),
    openIssueCount,
  });

  const snapshotVersion = (prev?.snapshotVersion ?? 0) + 1;
  const computedAt = new Date();
  for (const review of result.paymentReviews) {
    await tx.fiscalPaymentFact.update({ where: { id: review.id }, data: { countsInPaidTotals: review.countsInPaidTotals, reviewReason: review.reviewReason } });
  }
  // Publicação da partição: delete + insert na MESMA transação (leitores veem a versão inteira anterior ou a nova).
  await tx.fiscalReconciliationItem.deleteMany({ where: { companyCnpj, competenceMonth: month } });
  if (result.items.length) {
    await tx.fiscalReconciliationItem.createMany({
      data: result.items.map((i) => ({
        ...i,
        details: (i.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        snapshotVersion,
        computedAt,
      })),
    });
  }
  await tx.fiscalMonthlySnapshot.deleteMany({ where: { companyCnpj, competenceMonth: month } });
  const meaningful = result.snapshots.filter(
    (r) => r.taxType === "*" || Object.entries(r).some(([k, v]) => typeof v === "number" && v !== 0 && k !== "snapshotVersion")
  );
  const hasContent = meaningful.some((r) => r.taxType !== "*") || (meaningful.find((r) => r.taxType === "*")?.documentCount ?? 0) > 0 || result.items.length > 0 || pendingAp.length > 0;
  if (hasContent) {
    await tx.fiscalMonthlySnapshot.createMany({
      data: meaningful.map((r) => ({ ...r, snapshotVersion, ruleVersion: FISCAL360_RULE_VERSIONS.snapshot, computedAt })),
    });
  }
  await tx.fiscalIntercompanySnapshot.deleteMany({ where: { issuerCnpj: companyCnpj, competenceMonth: month } });
  if (result.intercompany.length) {
    await tx.fiscalIntercompanySnapshot.createMany({ data: result.intercompany.map((r) => ({ ...r, snapshotVersion, computedAt })) });
  }
  await syncFiscal360Issues(
    tx,
    `PART:${companyCnpj}:${month}`,
    result.items
      .filter((i) => i.checkType === "POSSIBLE_DUPLICATE" || (i.checkType === "APURATION_VS_GUIDE" && i.status === "DIVERGENT"))
      .map((i) => ({
        issueType: i.checkType,
        severity: i.checkType === "POSSIBLE_DUPLICATE" ? "CRITICAL" : "WARNING",
        entityType: "RECONCILIATION_ITEM",
        entityId: i.itemKey,
        companyCnpj,
        competenceMonth: month,
        taxType: i.taxType,
        message: i.message,
        details: { expected: i.expectedAmount, actual: i.actualAmount },
      })),
    FISCAL360_RULE_VERSIONS.snapshot
  );
  return { snapshotVersion, items: result.items.length, rows: hasContent ? meaningful.length : 0, affectedPartitions: result.affectedPartitions };
}

// ————————————————————————————————————————————— Projeção

export async function loadFiscal360ForecastInputs(db: PrismaClient | Tx, referenceMonth: string) {
  const fromMonth = addFiscal360Months(referenceMonth, -25);
  const [history, open, lagRows, params] = await Promise.all([
    db.fiscalMonthlySnapshot.findMany({
      where: { competenceMonth: { gte: fromMonth, lt: referenceMonth }, companyCnpj: { not: FISCAL360_UNKNOWN_COMPANY } },
      select: { companyCnpj: true, competenceMonth: true, taxType: true, officialRevenue: true, apurationAmountDue: true, obligationAmountDue: true },
    }),
    db.fiscalPaymentFact.findMany({
      where: { openBalance: { gt: 0 }, status: { notIn: ["CANCELLED"] }, countsInPaidTotals: true, companyCnpj: { not: FISCAL360_UNKNOWN_COMPANY } },
      select: { companyCnpj: true, taxType: true, competenceMonth: true, dueDate: true, openBalance: true, anchorKey: true },
    }),
    db.fiscalPaymentFact.findMany({
      where: { paidMonth: { not: null }, countsInPaidTotals: true, competenceMonth: { gte: fromMonth } },
      select: { taxType: true, competenceMonth: true, paidMonth: true },
    }),
    db.fiscalRuleVersion.findMany({ where: { ruleKey: FISCAL360_TAX_PARAMS_KEY, status: "ACTIVE" } }),
  ]);
  const parameters: ForecastTaxParameter[] = params.flatMap((p) => {
    const list = ((p.parameters ?? {}) as { items?: unknown }).items;
    if (!Array.isArray(list) || !p.effectiveFrom || !p.normativeSource) return [];
    return (list as Array<Record<string, unknown>>)
      .filter((i) => typeof i.companyCnpj === "string" && typeof i.taxType === "string" && typeof i.rate === "number")
      .map((i) => ({
        companyCnpj: String(i.companyCnpj),
        taxType: String(i.taxType),
        rate: Number(i.rate),
        creditRate: typeof i.creditRate === "number" ? i.creditRate : null,
        purchasesMonthly: typeof i.purchasesMonthly === "number" ? i.purchasesMonthly : null,
        effectiveFrom: p.effectiveFrom!.toISOString().slice(0, 10),
        effectiveTo: p.effectiveTo ? p.effectiveTo.toISOString().slice(0, 10) : null,
        normativeSource: p.normativeSource!,
        ruleVersionId: p.id,
      }));
  });
  const inputVersion = fiscal360Hash([
    history.map((h) => [h.companyCnpj, h.competenceMonth, h.taxType, h.officialRevenue, h.apurationAmountDue, h.obligationAmountDue]).sort(),
    open.map((o) => [o.anchorKey, o.openBalance, o.dueDate]).sort(),
    params.map((p) => [p.id, p.version]).sort(),
    referenceMonth,
  ]).slice(0, 24);
  return {
    history: history.map((h) => ({
      companyCnpj: h.companyCnpj,
      month: h.competenceMonth,
      taxType: h.taxType,
      officialRevenue: num(h.officialRevenue),
      apurationAmountDue: num(h.apurationAmountDue),
      obligationAmountDue: num(h.obligationAmountDue),
    })),
    openObligations: open.map((o) => ({
      companyCnpj: o.companyCnpj,
      taxType: o.taxType,
      competenceMonth: o.competenceMonth,
      dueDate: o.dueDate ? o.dueDate.toISOString().slice(0, 10) : null,
      openBalance: num(o.openBalance),
      anchorKey: o.anchorKey,
    })),
    lagSamples: lagRows.map((l) => ({ taxType: l.taxType, competenceMonth: l.competenceMonth, paidMonth: l.paidMonth! })),
    parameters,
    inputVersion,
  };
}

export async function rebuildFiscal360Forecast(db: PrismaClient, now = new Date()): Promise<{ scenarios: number; rows: number }> {
  const referenceMonth = now.toISOString().slice(0, 7);
  // Uma única transação sob lock: dois rebuilds simultâneos (um RUNNING e outro PENDING) não colidem,
  // as entradas são lidas já sob o lock e a publicação é atômica para os leitores.
  return db.$transaction(async (tx) => {
    await fiscal360XactLock(tx, FISCAL360_LOCK_NAMESPACE.discovery, "FORECAST");
    const inputs = await loadFiscal360ForecastInputs(tx, referenceMonth);
    for (const s of FISCAL360_SYSTEM_SCENARIOS) {
      await tx.fiscalForecastScenario.upsert({
        where: { systemKey: s.systemKey },
        create: { systemKey: s.systemKey, kind: s.systemKey, name: s.name, description: s.description, assumptions: s.assumptions, horizonMonths: s.assumptions.horizonMonths, methodologyVersion: FISCAL360_FORECAST_VERSION },
        update: { name: s.name, description: s.description, assumptions: s.assumptions, methodologyVersion: FISCAL360_FORECAST_VERSION },
      });
    }
    const scenarios = await tx.fiscalForecastScenario.findMany({ where: { status: "ACTIVE" } });
    let rows = 0;
    for (const scenario of scenarios) {
      const assumptions = sanitizeForecastAssumptions(scenario.assumptions as never);
      const forecast = buildFiscal360Forecast({ referenceMonth, ...inputs, assumptions });
      const computedAt = new Date();
      await tx.fiscalForecastSnapshot.deleteMany({ where: { scenarioId: scenario.id } });
      if (forecast.length) {
        await tx.fiscalForecastSnapshot.createMany({
          data: forecast.map(({ overdueAmount: _overdue, ...f }) => ({
            scenarioId: scenario.id,
            ...f,
            details: (f.details ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            forecastVersion: FISCAL360_FORECAST_VERSION,
            computedAt,
          })),
        });
      }
      await tx.fiscalForecastScenario.update({
        where: { id: scenario.id },
        data: { computedAt, inputVersion: inputs.inputVersion, methodologyVersion: FISCAL360_FORECAST_VERSION },
      });
      rows += forecast.length;
    }
    return { scenarios: scenarios.length, rows };
  }, TX_OPTIONS);
}

// ————————————————————————————————————————————— Descoberta

type DiscoveryStats = Record<string, { scanned: number; enqueued: number }>;

async function scanStream<T extends { id: string; updatedAt: Date }>(
  db: PrismaClient,
  key: string,
  batchSize: number,
  maxBatches: number,
  fetch: (cursor: { at: Date; id: string }, take: number) => Promise<T[]>,
  onBatch: (rows: T[]) => Promise<number>,
  stats: DiscoveryStats
): Promise<void> {
  const cp = await readFiscal360Checkpoint(db, key);
  const start = cp.cursorUpdatedAt ? new Date(cp.cursorUpdatedAt.getTime() - DISCOVERY_OVERLAP_MS) : new Date(0);
  // UUID nulo como menor id possível (algumas colunas id são uuid nativo; "" quebraria o cast).
  let cursor = { at: start, id: "00000000-0000-0000-0000-000000000000" };
  const s = (stats[key] = stats[key] ?? { scanned: 0, enqueued: 0 });
  // A janela de sobreposição protege contra commits tardios, mas reexaminaria as mesmas linhas a cada ciclo:
  // o mapa id→updatedAt das linhas já tratadas (só da janela) evita reenfileirar o que já foi decidido.
  const handled: Record<string, string> = { ...((cp.metadata?.handled as Record<string, string> | undefined) ?? {}) };
  let newest = cp.cursorUpdatedAt ?? new Date(0);
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await fetch(cursor, batchSize);
    if (rows.length === 0) break;
    s.scanned += rows.length;
    const fresh = rows.filter((r) => handled[r.id] !== r.updatedAt.toISOString());
    if (fresh.length > 0) s.enqueued += await onBatch(fresh);
    for (const r of rows) {
      handled[r.id] = r.updatedAt.toISOString();
      if (r.updatedAt > newest) newest = r.updatedAt;
    }
    const last = rows[rows.length - 1]!;
    cursor = { at: last.updatedAt, id: last.id };
    const floor = new Date(newest.getTime() - DISCOVERY_OVERLAP_MS).toISOString();
    for (const id of Object.keys(handled)) if (handled[id]! < floor) delete handled[id];
    // Limite do mapa (logo após um backfill todas as linhas estão na janela): reexaminar é barato (hash-gated).
    const handledIds = Object.keys(handled);
    if (handledIds.length > HANDLED_MAP_LIMIT) {
      handledIds.sort((a, b) => (handled[b]! < handled[a]! ? -1 : 1));
      for (const id of handledIds.slice(HANDLED_MAP_LIMIT)) delete handled[id];
    }
    // O cursor só avança depois que o lote foi tratado (reinício retoma do último lote concluído).
    await writeFiscal360Checkpoint(db, key, { cursorUpdatedAt: newest, cursorId: last.id, metadata: { ...(cp.metadata ?? {}), handled } });
    if (rows.length < batchSize) break;
  }
  await writeFiscal360Checkpoint(db, key, { success: true });
}

const after = (cursor: { at: Date; id: string }) => ({
  OR: [{ updatedAt: { gt: cursor.at } }, { updatedAt: cursor.at, id: { gt: cursor.id } }],
});

export async function discoverFiscal360Changes(
  db: PrismaClient,
  opts: { batchSize?: number; maxBatches?: number; runId?: string | null } = {}
): Promise<DiscoveryStats> {
  const batchSize = opts.batchSize ?? 500;
  const maxBatches = opts.maxBatches ?? 200;
  const stats: DiscoveryStats = {};
  const runId = opts.runId ?? null;

  // Regras AP mudaram → reavaliar todos os títulos (só a classificação AP; documentos intocados).
  const rules = await loadFiscal360ApRules(db);
  const rulesCp = await readFiscal360Checkpoint(db, "ap-rules");
  if ((rulesCp.metadata?.version as string | undefined) !== rules.version) {
    await writeFiscal360Checkpoint(db, "ap", { cursorUpdatedAt: null, cursorId: null, metadata: null });
    await writeFiscal360Checkpoint(db, "ap-rules", { metadata: { version: rules.version }, success: true });
  }
  const forecastParams = await db.fiscalRuleVersion.findMany({
    where: { ruleKey: { in: [FISCAL360_TAX_PARAMS_KEY, FISCAL360_REFORM_KEY] } },
    select: { id: true, status: true, version: true },
  });
  const paramsVersion = fiscal360Hash(forecastParams.map((p) => [p.id, p.status, p.version]).sort());
  const paramsCp = await readFiscal360Checkpoint(db, "forecast-params");
  if ((paramsCp.metadata?.version as string | undefined) !== paramsVersion) {
    // Parâmetros tributários: só a projeção depende deles (nenhum XML/documento reprocessado).
    await enqueueFiscal360Jobs(db, [forecastJob({ runId })]);
    await writeFiscal360Checkpoint(db, "forecast-params", { metadata: { version: paramsVersion }, success: true });
  }

  const docBatch = async (ids: string[]) => {
    const sources = await loadFiscal360DocumentSources(db, ids);
    const facts = await db.fiscalDocumentFact.findMany({ where: { nomusNfeId: { in: ids } }, select: { nomusNfeId: true, sourceHash: true, ruleVersion: true } });
    const byId = new Map(facts.map((f) => [f.nomusNfeId, f]));
    const jobs: Fiscal360JobInput[] = [];
    for (const s of sources) {
      const hash = fiscal360Hash(fiscal360DocumentHashInput(s));
      const f = byId.get(s.nomusNfeId);
      if (f && f.sourceHash === hash && f.ruleVersion === FISCAL360_RULE_VERSIONS.document) continue;
      jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeDocument, sourceEntity: "NOMUS_NFE", sourceId: s.nomusNfeId, sourceHash: hash, ruleVersion: FISCAL360_RULE_VERSIONS.document, runId, auditMeta: { reason: f ? "CHANGED" : "NEW" } });
    }
    return enqueueFiscal360Jobs(db, jobs);
  };

  await scanStream(
    db,
    "nfe",
    batchSize,
    maxBatches,
    (c, take) => db.nomusNfe.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true } }),
    (rows) => docBatch(rows.map((r) => r.id)),
    stats
  );
  await scanStream(
    db,
    "nfe-summary",
    batchSize,
    maxBatches,
    (c, take) => db.nomusNfeFiscalSummary.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true, nomusNfeId: true } }),
    (rows) => docBatch(rows.map((r) => r.nomusNfeId)),
    stats
  );

  const apBatch = async (externalIds: number[]) => {
    if (externalIds.length === 0) return 0;
    const [sources, facts, treasury, decisions, links] = await Promise.all([
      loadFiscal360ApSources(db, externalIds),
      db.fiscalApTitleFact.findMany({ where: { apExternalId: { in: externalIds } }, select: { apExternalId: true, sourceHash: true, ruleVersion: true } }),
      loadFiscal360TreasuryEvidence(db, externalIds),
      loadFiscal360ApDecisions(db, externalIds),
      loadFiscal360GuideLinks(db, { apExternalIds: externalIds }),
    ]);
    const byId = new Map(facts.map((f) => [f.apExternalId, f]));
    const ruleVersion = `${FISCAL360_RULE_VERSIONS.apClassifier}|rules:${rules.version}`;
    const jobs: Fiscal360JobInput[] = [];
    for (const s of sources) {
      const winner = resolveFiscal360ClaimWinner(links, s.externalId);
      const hash = fiscal360Hash([
        s.payloadHash,
        s.sourcePresenceStatus,
        treasury.get(s.externalId) ?? null,
        winner ? [winner.guideId, winner.source, winner.taxType] : null,
        decisions.get(s.externalId) ?? null,
        ruleVersion,
      ]);
      const f = byId.get(s.externalId);
      if (f && f.sourceHash === hash && f.ruleVersion === ruleVersion) continue;
      jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(s.externalId), sourceHash: hash, ruleVersion, runId, auditMeta: { reason: f ? "CHANGED" : "NEW" } });
    }
    // Título que sumiu da tabela espelho: fato órfão é removido pelo job.
    const present = new Set(sources.map((s) => s.externalId));
    for (const f of facts) {
      if (!present.has(f.apExternalId)) {
        jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(f.apExternalId), ruleVersion, runId, auditMeta: { reason: "REMOVED" } });
      }
    }
    return enqueueFiscal360Jobs(db, jobs);
  };

  await scanStream(
    db,
    "ap",
    batchSize,
    maxBatches,
    (c, take) => db.nomusAccountsPayable.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true, externalId: true } }),
    (rows) => apBatch(rows.map((r) => r.externalId)),
    stats
  );
  await scanStream(
    db,
    "treasury-ap",
    batchSize,
    maxBatches,
    (c, take) =>
      db.treasuryReconciliationMatch.findMany({
        where: after(c),
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take,
        select: { id: true, updatedAt: true, allocations: { where: { nomusSide: "AP", nomusExternalId: { not: null } }, select: { nomusExternalId: true } } },
      }),
    (rows) => apBatch([...new Set(rows.flatMap((r) => r.allocations.map((a) => a.nomusExternalId!)))]),
    stats
  );

  const guideJobs = (ids: string[], reason: string) =>
    enqueueFiscal360Jobs(
      db,
      [...new Set(ids)].map((id) => ({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: id, ruleVersion: FISCAL360_RULE_VERSIONS.payment, runId, auditMeta: { reason } }))
    );
  await scanStream(
    db,
    "guide",
    batchSize,
    maxBatches,
    (c, take) => db.fiscalPaymentGuide.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true } }),
    (rows) => guideJobs(rows.map((r) => r.id), "GUIDE_CHANGED"),
    stats
  );
  await scanStream(
    db,
    "proof",
    batchSize,
    maxBatches,
    async (c, take) =>
      (
        await db.fiscalPaymentProof.findMany({
          where: { OR: [{ uploadedAt: { gt: c.at } }, { uploadedAt: c.at, id: { gt: c.id } }] },
          orderBy: [{ uploadedAt: "asc" }, { id: "asc" }],
          take,
          select: { id: true, uploadedAt: true, guideId: true },
        })
      ).map((p) => ({ id: p.id, updatedAt: p.uploadedAt, guideId: p.guideId })),
    (rows) => guideJobs(rows.map((r) => r.guideId), "PROOF_ADDED"),
    stats
  );
  // Período/linha de apuração alterados → partição da competência (fim do período) da empresa.
  const apurationPartitions = async (periodIds: string[]) => {
    if (!periodIds.length) return 0;
    const periods = await db.fiscalApurationPeriod.findMany({ where: { id: { in: [...new Set(periodIds)] } }, select: { companyName: true, periodStart: true, periodEnd: true } });
    return enqueueFiscal360Jobs(
      db,
      partitionJobs(
        periods.map((p) => ({ companyCnpj: resolveFiscal360GroupCnpj({ name: p.companyName }) ?? FISCAL360_UNKNOWN_COMPANY, month: fiscal360GuideCompetence(p.periodStart, p.periodEnd) })),
        runId
      )
    );
  };
  await scanStream(
    db,
    "apuration-period",
    batchSize,
    maxBatches,
    (c, take) => db.fiscalApurationPeriod.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true } }),
    (rows) => apurationPartitions(rows.map((r) => r.id)),
    stats
  );
  await scanStream(
    db,
    "apuration-line",
    batchSize,
    maxBatches,
    (c, take) => db.fiscalApurationLine.findMany({ where: after(c), orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take, select: { id: true, updatedAt: true, periodId: true } }),
    (rows) => apurationPartitions(rows.map((r) => r.periodId)),
    stats
  );
  // Decisões manuais (criadas ou revogadas) → entidades/partições alvo.
  // Decisões são poucas: um lote único grande (createdAt/revokedAt não seguem uma única ordenação).
  await scanStream(
    db,
    "decision",
    5000,
    1,
    async (c, take) =>
      (
        await db.fiscalReconciliationDecision.findMany({
          where: {
            OR: [
              { createdAt: { gt: c.at } },
              { revokedAt: { gt: c.at } },
              { createdAt: c.at, id: { gt: c.id } },
            ],
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take,
        })
      ).map((d) => ({ ...d, updatedAt: d.revokedAt && d.revokedAt > d.createdAt ? d.revokedAt : d.createdAt })),
    async (rows) => {
      const jobs: Fiscal360JobInput[] = [];
      for (const d of rows) {
        if (d.apExternalId != null) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(d.apExternalId), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier, runId, auditMeta: { reason: "DECISION", decisionId: d.id } });
        if (d.guideId) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: d.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment, runId, auditMeta: { reason: "DECISION", decisionId: d.id } });
        if (d.itemKey) {
          const item = await db.fiscalReconciliationItem.findUnique({ where: { itemKey: d.itemKey }, select: { companyCnpj: true, competenceMonth: true } });
          if (item) jobs.push(partitionJob(item.companyCnpj, item.competenceMonth, { runId }));
        }
        if (d.decisionType === "MARK_DISTINCT" || d.decisionType === "LINK_GUIDE_AP") {
          const facts = await db.fiscalPaymentFact.findMany({
            where: { OR: [...(d.guideId ? [{ guideId: d.guideId }] : []), ...(d.apExternalId != null ? [{ apExternalId: d.apExternalId }] : [])] },
            select: { companyCnpj: true, competenceMonth: true },
          });
          jobs.push(...partitionJobs(facts.map((f) => ({ companyCnpj: f.companyCnpj, month: f.competenceMonth })), runId));
        }
      }
      return enqueueFiscal360Jobs(db, jobs);
    },
    stats
  );
  return stats;
}

// ————————————————————————————————————————————— Execução

export type Fiscal360RunOptions = {
  trigger: "CLI" | "WORKER" | "BACKFILL";
  workerId?: string;
  maxJobs?: number;
  timeBudgetMs?: number;
  batchSize?: number;
  maxDiscoveryBatches?: number;
  skipDiscovery?: boolean;
  leaseMs?: number;
  log?: (message: string) => void;
  /** Interrupção cooperativa (Ctrl+C no CLI): termina o job em curso e encerra. */
  shouldStop?: () => boolean;
};

export type Fiscal360RunResult = {
  runId: string;
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  discovered: DiscoveryStats;
  jobsSucceeded: number;
  jobsFailed: number;
  partitionsRebuilt: number;
  durationMs: number;
};

export async function executeFiscal360Job(
  db: PrismaClient,
  job: Pick<Fiscal360ClaimedJob, "jobType" | "sourceId">,
  ctx: { rules: Awaited<ReturnType<typeof loadFiscal360ApRules>>; runId: string | null }
): Promise<{ partitions: Partition[]; documentNew?: boolean; changed: boolean }> {
  if (job.jobType === FISCAL360_JOB_TYPES.rebuildForecast) {
    await rebuildFiscal360Forecast(db);
    return { partitions: [], changed: true };
  }
  return db.$transaction(async (tx) => {
    if (job.jobType === FISCAL360_JOB_TYPES.rebuildPartition) {
      const [companyCnpj, month] = job.sourceId.split(":") as [string, string];
      const rebuilt = await rebuildFiscal360Partition(tx, { companyCnpj, month });
      // Mudança de revisão (duplicidade) altera o total de caixa de outro mês: recalcula também essa partição.
      await enqueueFiscal360Jobs(tx, [forecastJob({ runId: ctx.runId }), ...partitionJobs(rebuilt.affectedPartitions, ctx.runId)]);
      return { partitions: [{ companyCnpj, month }], changed: true };
    }
    let res: { changed: boolean; partitions: Partition[]; followUps?: Fiscal360JobInput[]; created?: boolean };
    if (job.jobType === FISCAL360_JOB_TYPES.materializeDocument) res = await materializeFiscal360Document(tx, job.sourceId);
    else if (job.jobType === FISCAL360_JOB_TYPES.materializeApTitle) res = await materializeFiscal360ApTitle(tx, Number(job.sourceId), ctx);
    else if (job.jobType === FISCAL360_JOB_TYPES.materializeGuide) res = await materializeFiscal360Guide(tx, job.sourceId, ctx);
    else throw new Error(`Tipo de job desconhecido: ${job.jobType}`);
    // Partições e follow-ups entram na MESMA transação do fato: nada se perde se o processo cair.
    await enqueueFiscal360Jobs(tx, [...partitionJobs(res.partitions, ctx.runId), ...(res.followUps ?? []).map((f) => ({ ...f, runId: ctx.runId }))]);
    return { partitions: uniquePartitions(res.partitions), documentNew: res.created, changed: res.changed };
  }, TX_OPTIONS);
}

export async function runFiscal360Processing(db: PrismaClient, options: Fiscal360RunOptions): Promise<Fiscal360RunResult> {
  const log = options.log ?? (() => undefined);
  const workerId = options.workerId ?? `fiscal360-${options.trigger.toLowerCase()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const started = Date.now();
  const deadline = started + (options.timeBudgetMs ?? 10 * 60_000);
  const run = await db.fiscalProcessingRun.create({
    data: { trigger: options.trigger, workerId, status: "RUNNING", startedAt: new Date(started), ruleVersions: FISCAL360_RULE_VERSIONS },
  });
  let discovered: DiscoveryStats = {};
  let jobsSucceeded = 0;
  let jobsFailed = 0;
  let documentsNew = 0;
  let documentsChanged = 0;
  let apTitlesChanged = 0;
  let guidesChanged = 0;
  const partitionsRebuilt = new Set<string>();
  const monthsAffected = new Set<string>();
  let fatal: unknown = null;
  try {
    if (!options.skipDiscovery) {
      discovered = await discoverFiscal360Changes(db, { batchSize: options.batchSize, maxBatches: options.maxDiscoveryBatches, runId: run.id });
      log(`descoberta: ${JSON.stringify(discovered)}`);
    }
    const rules = await loadFiscal360ApRules(db);
    let processed = 0;
    const maxJobs = options.maxJobs ?? 5000;
    while (processed < maxJobs && Date.now() < deadline && !options.shouldStop?.()) {
      const jobs = await claimFiscal360Jobs(db, { workerId, limit: Math.min(25, maxJobs - processed), leaseMs: options.leaseMs ?? 5 * 60_000 });
      if (jobs.length === 0) break;
      for (const job of jobs) {
        const t0 = Date.now();
        try {
          // O lote é reivindicado de uma vez: renova o lease deste job antes de executá-lo.
          await extendFiscal360Lease(db, job, options.leaseMs ?? 5 * 60_000);
          const res = await executeFiscal360Job(db, job, { rules, runId: run.id });
          await completeFiscal360Job(db, job, {
            durationMs: Date.now() - t0,
            affectedPeriods: [...new Set(res.partitions.map((p) => p.month))],
            auditMeta: { changed: res.changed, partitions: res.partitions.map((p) => fiscal360PartitionKey(p.companyCnpj, p.month)), runId: run.id },
          });
          jobsSucceeded += 1;
          if (res.changed) {
            if (job.jobType === FISCAL360_JOB_TYPES.materializeDocument) {
              if (res.documentNew) documentsNew += 1;
              else documentsChanged += 1;
            } else if (job.jobType === FISCAL360_JOB_TYPES.materializeApTitle) apTitlesChanged += 1;
            else if (job.jobType === FISCAL360_JOB_TYPES.materializeGuide) guidesChanged += 1;
          }
          if (job.jobType === FISCAL360_JOB_TYPES.rebuildPartition) {
            partitionsRebuilt.add(job.sourceId);
            monthsAffected.add(job.sourceId.split(":")[1]!);
          }
        } catch (error) {
          jobsFailed += 1;
          const outcome = await failFiscal360Job(db, job, error);
          log(`job ${job.jobType} ${job.sourceId} falhou (${outcome}): ${error instanceof Error ? error.message : String(error)}`);
        }
        processed += 1;
        if (options.shouldStop?.()) break;
      }
    }
  } catch (error) {
    fatal = error;
  }
  // Integridade: contagens simples fonte × materializado (exibidas no painel de processamento).
  const [nfeSource, documentFacts, apSource, apFacts, guideSource, guideFacts] = await Promise.all([
    db.nomusNfe.count(),
    db.fiscalDocumentFact.count(),
    db.nomusAccountsPayable.count(),
    db.fiscalApTitleFact.count(),
    db.fiscalPaymentGuide.count(),
    db.fiscalPaymentFact.count({ where: { anchorType: "GUIDE" } }),
  ]).catch(() => [0, 0, 0, 0, 0, 0]);
  discovered = { ...discovered, integrity: { nfeSource, documentFacts, apSource, apFacts, guideSource, guideFacts } as never };
  const durationMs = Date.now() - started;
  const pending = await db.fiscalProcessingJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } });
  const status: Fiscal360RunResult["status"] = fatal ? "FAILED" : jobsFailed > 0 || pending > 0 ? "PARTIAL" : "SUCCEEDED";
  await db.fiscalProcessingRun.update({
    where: { id: run.id },
    data: {
      status,
      finishedAt: new Date(),
      durationMs,
      discovered: discovered as Prisma.InputJsonValue,
      jobsSucceeded,
      jobsFailed,
      documentsNew,
      documentsChanged,
      apTitlesChanged,
      guidesChanged,
      partitionsRebuilt: partitionsRebuilt.size,
      monthsAffected: [...monthsAffected].sort(),
      error: fatal ? (fatal instanceof Error ? fatal.message : String(fatal)).slice(0, 2000) : null,
    },
  });
  if (fatal) throw fatal;
  return { runId: run.id, status, discovered, jobsSucceeded, jobsFailed, partitionsRebuilt: partitionsRebuilt.size, durationMs };
}
