/**
 * Inteligência Fiscal 360° — operações de escrita autorizadas. Nunca alteram dados do Nomus,
 * guias ou apuração: registram decisões/regras/cenários e ENFILEIRAM processamento (nada é
 * recalculado no ciclo da requisição, exceto a projeção de um cenário sobre agregados persistidos).
 * Toda escrita gera trilha em FiscalSettlementAuditLog (usuário, data, motivo, antes/depois).
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  FISCAL360_AP_RULES_KEY,
  FISCAL360_COMPANIES,
  FISCAL360_JOB_TYPES,
  FISCAL360_REFORM_KEY,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_TAX_PARAMS_KEY,
  FISCAL360_TAX_TYPES,
  fiscal360MonthRange,
  isFiscal360Month,
} from "./fiscal360Constants.js";
import {
  buildFiscal360Forecast,
  FISCAL360_FORECAST_VERSION,
  sanitizeForecastAssumptions,
} from "./fiscal360Forecast.js";
import { loadFiscal360ForecastInputs } from "./fiscal360Processor.server.js";
import { enqueueFiscal360Jobs, partitionJob, forecastJob, type Fiscal360JobInput } from "./fiscal360Queue.server.js";
import { Fiscal360InputError } from "./fiscal360QueryService.server.js";
import { FISCAL360_DECISION_TYPES, type Fiscal360DecisionType } from "./fiscal360Types.js";

type Db = PrismaClient;
export type Fiscal360Actor = { userId: string | null; userName: string | null };

const TAX_SET = new Set<string>(FISCAL360_TAX_TYPES);

function requireReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < 10) throw new Fiscal360InputError("Informe o motivo da decisão (mínimo de 10 caracteres).");
  return text.slice(0, 2000);
}

async function audit(
  db: Db | Prisma.TransactionClient,
  entry: { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; actor: Fiscal360Actor }
): Promise<void> {
  await db.fiscalSettlementAuditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: entry.before == null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(entry.before)) as Prisma.InputJsonValue),
      afterJson: entry.after == null ? Prisma.JsonNull : (JSON.parse(JSON.stringify(entry.after)) as Prisma.InputJsonValue),
      userId: entry.actor.userId,
      userName: entry.actor.userName,
    },
  });
}

export type Fiscal360DecisionInput = {
  decisionType: Fiscal360DecisionType;
  apExternalId?: number | null;
  guideId?: string | null;
  itemKey?: string | null;
  payload?: Record<string, unknown>;
  reason: string;
  evidence?: Record<string, unknown> | null;
};

/** Valida e normaliza a decisão (tipos, alvos existentes, payload). */
export async function validateFiscal360Decision(db: Db, input: Fiscal360DecisionInput): Promise<Required<Omit<Fiscal360DecisionInput, "evidence">> & { evidence: Record<string, unknown> | null }> {
  if (!FISCAL360_DECISION_TYPES.includes(input.decisionType)) throw new Fiscal360InputError("Tipo de decisão inválido.");
  const reason = requireReason(input.reason);
  const payload: Record<string, unknown> = {};
  const apExternalId = input.apExternalId == null ? null : Number(input.apExternalId);
  const guideId = typeof input.guideId === "string" && input.guideId.trim() ? input.guideId.trim() : null;
  const itemKey = typeof input.itemKey === "string" && input.itemKey.trim() ? input.itemKey.trim().slice(0, 300) : null;
  const needAp = ["AP_CONFIRM_TAX", "AP_REJECT_TAX", "LINK_GUIDE_AP", "MARK_DISTINCT"].includes(input.decisionType);
  const needGuide = ["LINK_GUIDE_AP", "MARK_DISTINCT", "ASSIGN_GUIDE_COMPANY"].includes(input.decisionType);
  if (needAp) {
    if (apExternalId == null || !Number.isInteger(apExternalId)) throw new Fiscal360InputError("Título AP obrigatório.");
    const ap = await db.fiscalApTitleFact.findUnique({ where: { apExternalId }, select: { apExternalId: true } });
    if (!ap) throw new Fiscal360InputError("Título AP não materializado na Inteligência Fiscal.");
  }
  if (needGuide) {
    if (!guideId) throw new Fiscal360InputError("Guia obrigatória.");
    const guide = await db.fiscalPaymentGuide.findUnique({ where: { id: guideId }, select: { id: true, status: true } });
    if (!guide) throw new Fiscal360InputError("Guia não encontrada.");
    if (input.decisionType === "LINK_GUIDE_AP" && guide.status === "CANCELLED") throw new Fiscal360InputError("Guia cancelada não pode ser vinculada.");
  }
  if (input.decisionType === "AP_CONFIRM_TAX") {
    const taxType = String(input.payload?.taxType ?? "").toUpperCase();
    if (!TAX_SET.has(taxType)) throw new Fiscal360InputError("Tributo inválido.");
    payload.taxType = taxType;
    const revenueCode = String(input.payload?.revenueCode ?? "").replace(/\D/g, "");
    if (revenueCode) payload.revenueCode = revenueCode.slice(0, 6);
    const competenceMonth = input.payload?.competenceMonth;
    if (competenceMonth != null && competenceMonth !== "") {
      if (!isFiscal360Month(competenceMonth)) throw new Fiscal360InputError("Competência inválida.");
      payload.competenceMonth = competenceMonth;
    }
  }
  if (input.decisionType === "ASSIGN_GUIDE_COMPANY") {
    const cnpj = String(input.payload?.companyCnpj ?? "").replace(/\D/g, "");
    if (!FISCAL360_COMPANIES.some((c) => c.cnpj === cnpj)) throw new Fiscal360InputError("Empresa fora do grupo econômico.");
    payload.companyCnpj = cnpj;
  }
  if (input.decisionType === "ACCEPT_DIVERGENCE") {
    if (!itemKey) throw new Fiscal360InputError("Item de conciliação obrigatório.");
    const item = await db.fiscalReconciliationItem.findUnique({ where: { itemKey }, select: { itemKey: true } });
    if (!item) throw new Fiscal360InputError("Item de conciliação não encontrado.");
  }
  return {
    decisionType: input.decisionType,
    apExternalId: needAp ? apExternalId : null,
    guideId: needGuide ? guideId : null,
    itemKey: input.decisionType === "ACCEPT_DIVERGENCE" ? itemKey : null,
    payload,
    reason,
    evidence: input.evidence ?? null,
  };
}

/** Família de decisão: uma decisão ativa por alvo e família (a nova revoga a anterior com trilha). */
function decisionFamilyWhere(d: { decisionType: string; apExternalId: number | null; guideId: string | null; itemKey: string | null }): Prisma.FiscalReconciliationDecisionWhereInput {
  if (d.decisionType === "AP_CONFIRM_TAX" || d.decisionType === "AP_REJECT_TAX") return { decisionType: { in: ["AP_CONFIRM_TAX", "AP_REJECT_TAX"] }, apExternalId: d.apExternalId };
  if (d.decisionType === "LINK_GUIDE_AP") return { decisionType: "LINK_GUIDE_AP", guideId: d.guideId };
  if (d.decisionType === "MARK_DISTINCT") return { decisionType: "MARK_DISTINCT", guideId: d.guideId, apExternalId: d.apExternalId };
  if (d.decisionType === "ASSIGN_GUIDE_COMPANY") return { decisionType: "ASSIGN_GUIDE_COMPANY", guideId: d.guideId };
  return { decisionType: "ACCEPT_DIVERGENCE", itemKey: d.itemKey };
}

function decisionJobs(d: { apExternalId: number | null; guideId: string | null }, actor: Fiscal360Actor, extra: Fiscal360JobInput[] = []): Fiscal360JobInput[] {
  const jobs: Fiscal360JobInput[] = [...extra];
  if (d.apExternalId != null) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(d.apExternalId), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier, requestedByUserId: actor.userId, auditMeta: { reason: "DECISION" } });
  if (d.guideId) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: d.guideId, ruleVersion: FISCAL360_RULE_VERSIONS.payment, requestedByUserId: actor.userId, auditMeta: { reason: "DECISION" } });
  return jobs;
}

async function itemPartitionJob(db: Db | Prisma.TransactionClient, itemKey: string | null): Promise<Fiscal360JobInput[]> {
  if (!itemKey) return [];
  const item = await db.fiscalReconciliationItem.findUnique({ where: { itemKey }, select: { companyCnpj: true, competenceMonth: true } });
  return item ? [partitionJob(item.companyCnpj, item.competenceMonth)] : [];
}

export async function createFiscal360Decision(db: Db, input: Fiscal360DecisionInput, actor: Fiscal360Actor) {
  const d = await validateFiscal360Decision(db, input);
  return db.$transaction(async (tx) => {
    // Serializa decisões concorrentes sobre o mesmo alvo.
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(913604, hashtext(${`${d.decisionType}:${d.guideId ?? ""}:${d.apExternalId ?? ""}:${d.itemKey ?? ""}`}))`);
    const previous = await tx.fiscalReconciliationDecision.findMany({ where: { ...decisionFamilyWhere(d), active: true } });
    const now = new Date();
    for (const p of previous) {
      await tx.fiscalReconciliationDecision.update({
        where: { id: p.id },
        data: { active: false, revokedAt: now, revokedByUserId: actor.userId, revokedByName: actor.userName, revokeReason: "Substituída por nova decisão." },
      });
    }
    const created = await tx.fiscalReconciliationDecision.create({
      data: {
        decisionType: d.decisionType,
        apExternalId: d.apExternalId,
        guideId: d.guideId,
        itemKey: d.itemKey,
        payload: d.payload as Prisma.InputJsonValue,
        reason: d.reason,
        evidence: (d.evidence ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
        createdByName: actor.userName,
      },
    });
    await audit(tx, {
      entityType: "Fiscal360Decision",
      entityId: d.guideId ?? (d.apExternalId != null ? String(d.apExternalId) : d.itemKey ?? created.id),
      action: `DECISION_${d.decisionType}`,
      before: previous.length ? previous.map((p) => ({ id: p.id, decisionType: p.decisionType, payload: p.payload })) : null,
      after: { id: created.id, decisionType: created.decisionType, apExternalId: created.apExternalId, guideId: created.guideId, itemKey: created.itemKey, payload: created.payload, reason: created.reason },
      actor,
    });
    // Revogação/novo vínculo podem liberar outro título: reprocessa também os alvos das decisões substituídas.
    const extra = previous.flatMap((p) => decisionJobs({ apExternalId: p.apExternalId, guideId: p.guideId }, actor));
    await enqueueFiscal360Jobs(tx, decisionJobs(d, actor, [...extra, ...(await itemPartitionJob(tx, d.itemKey))]));
    return created;
  });
}

export async function revokeFiscal360Decision(db: Db, id: string, reason: unknown, actor: Fiscal360Actor) {
  const text = requireReason(reason);
  return db.$transaction(async (tx) => {
    const existing = await tx.fiscalReconciliationDecision.findUnique({ where: { id } });
    if (!existing) throw Object.assign(new Fiscal360InputError("Decisão não encontrada."), { status: 404 });
    if (!existing.active) throw new Fiscal360InputError("Decisão já revogada.");
    const updated = await tx.fiscalReconciliationDecision.update({
      where: { id },
      data: { active: false, revokedAt: new Date(), revokedByUserId: actor.userId, revokedByName: actor.userName, revokeReason: text },
    });
    await audit(tx, { entityType: "Fiscal360Decision", entityId: existing.guideId ?? (existing.apExternalId != null ? String(existing.apExternalId) : existing.itemKey ?? id), action: "DECISION_REVOKE", before: { id, active: true }, after: { id, active: false, reason: text }, actor });
    await enqueueFiscal360Jobs(tx, decisionJobs(existing, actor, await itemPartitionJob(tx, existing.itemKey)));
    return updated;
  });
}

export type Fiscal360ReprocessInput = {
  scope: "PARTITIONS" | "DOCUMENTS" | "AP_TITLES" | "GUIDES" | "FORECAST";
  companyCnpj?: string | null;
  fromMonth?: string | null;
  toMonth?: string | null;
  ids?: Array<string | number>;
  reason: string;
};

const MAX_REPROCESS_IDS = 500;

/**
 * Reprocessamento SELETIVO: só enfileira (o worker/CLI executa). Para entidades, invalida o hash do
 * fato para forçar rematerialização mesmo sem mudança na fonte (ex.: correção de regra).
 */
export async function requestFiscal360Reprocess(db: Db, input: Fiscal360ReprocessInput, actor: Fiscal360Actor) {
  const reason = requireReason(input.reason);
  const jobs: Fiscal360JobInput[] = [];
  const meta = { reason: "MANUAL_REPROCESS", requestedBy: actor.userName };
  if (input.scope === "PARTITIONS") {
    const from = input.fromMonth ?? "";
    const to = input.toMonth ?? from;
    if (!isFiscal360Month(from) || !isFiscal360Month(to)) throw new Fiscal360InputError("Competências inválidas.");
    const months = fiscal360MonthRange(from, to);
    if (months.length === 0 || months.length > 24) throw new Fiscal360InputError("Reprocesse no máximo 24 competências por vez.");
    const companies = input.companyCnpj ? [input.companyCnpj.replace(/\D/g, "")] : FISCAL360_COMPANIES.map((c) => c.cnpj);
    if (!companies.every((c) => FISCAL360_COMPANIES.some((x) => x.cnpj === c))) throw new Fiscal360InputError("Empresa fora do grupo econômico.");
    for (const c of companies) for (const m of months) jobs.push(partitionJob(c, m, { requestedByUserId: actor.userId, auditMeta: meta }));
  } else if (input.scope === "FORECAST") {
    jobs.push(forecastJob({ requestedByUserId: actor.userId, auditMeta: meta }));
  } else {
    const ids = (input.ids ?? []).map((v) => String(v).trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > MAX_REPROCESS_IDS) throw new Fiscal360InputError(`Informe de 1 a ${MAX_REPROCESS_IDS} identificadores.`);
    if (input.scope === "DOCUMENTS") {
      const docs = await db.fiscalDocumentFact.findMany({ where: { OR: [{ nomusNfeId: { in: ids } }, { nomusExternalId: { in: ids.filter((i) => /^\d+$/.test(i)).map(Number) } }] }, select: { nomusNfeId: true } });
      const nfeIds = [...new Set([...docs.map((d) => d.nomusNfeId), ...ids.filter((i) => !/^\d+$/.test(i))])];
      await db.fiscalDocumentFact.updateMany({ where: { nomusNfeId: { in: nfeIds } }, data: { sourceHash: "REPROCESS_REQUESTED" } });
      for (const id of nfeIds) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeDocument, sourceEntity: "NOMUS_NFE", sourceId: id, ruleVersion: FISCAL360_RULE_VERSIONS.document, requestedByUserId: actor.userId, auditMeta: meta });
    } else if (input.scope === "AP_TITLES") {
      const nums = ids.filter((i) => /^\d+$/.test(i)).map(Number);
      await db.fiscalApTitleFact.updateMany({ where: { apExternalId: { in: nums } }, data: { sourceHash: "REPROCESS_REQUESTED" } });
      for (const id of nums) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeApTitle, sourceEntity: "AP_TITLE", sourceId: String(id), ruleVersion: FISCAL360_RULE_VERSIONS.apClassifier, requestedByUserId: actor.userId, auditMeta: meta });
    } else if (input.scope === "GUIDES") {
      await db.fiscalPaymentFact.updateMany({ where: { guideId: { in: ids } }, data: { sourceHash: "REPROCESS_REQUESTED" } });
      for (const id of ids) jobs.push({ jobType: FISCAL360_JOB_TYPES.materializeGuide, sourceEntity: "FISCAL_GUIDE", sourceId: id, ruleVersion: FISCAL360_RULE_VERSIONS.payment, requestedByUserId: actor.userId, auditMeta: meta });
    } else {
      throw new Fiscal360InputError("Escopo de reprocessamento inválido.");
    }
  }
  const enqueued = await enqueueFiscal360Jobs(db, jobs);
  await audit(db, { entityType: "Fiscal360Reprocess", entityId: input.scope, action: "REPROCESS_REQUEST", after: { ...input, reason, requested: jobs.length, enqueued }, actor });
  return { requested: jobs.length, enqueued };
}

export async function retryFiscal360Job(db: Db, id: string, actor: Fiscal360Actor) {
  const job = await db.fiscalProcessingJob.findUnique({ where: { id } });
  if (!job) throw Object.assign(new Fiscal360InputError("Job não encontrado."), { status: 404 });
  if (job.status !== "FAILED" && job.status !== "CANCELLED") throw new Fiscal360InputError("Só jobs com falha ou cancelados podem ser reenfileirados.");
  const pendingTwin = await db.fiscalProcessingJob.findFirst({ where: { dedupeKey: job.dedupeKey, status: "PENDING" }, select: { id: true } });
  if (pendingTwin) throw new Fiscal360InputError("Já existe um job pendente equivalente.");
  const updated = await db.fiscalProcessingJob.update({
    where: { id },
    data: { status: "PENDING", attempts: 0, availableAt: new Date(), leasedBy: null, leaseToken: null, leaseUntil: null, finishedAt: null, requestedByUserId: actor.userId },
  });
  await audit(db, { entityType: "Fiscal360Job", entityId: id, action: "JOB_RETRY", before: { status: job.status, lastError: job.lastError }, after: { status: "PENDING" }, actor });
  return updated;
}

export async function cancelFiscal360Job(db: Db, id: string, actor: Fiscal360Actor) {
  // Jobs de entidade carregam a mudança descoberta (o cursor já avançou): cancelá-los a perderia. Só partição/projeção.
  const res = await db.fiscalProcessingJob.updateMany({ where: { id, status: "PENDING", jobType: { in: ["REBUILD_PARTITION", "REBUILD_FORECAST"] } }, data: { status: "CANCELLED", finishedAt: new Date(), lastError: `Cancelado por ${actor.userName ?? actor.userId ?? "usuário"}` } });
  if (res.count !== 1) throw new Fiscal360InputError("Só jobs pendentes de reconstrução (partição ou projeção) podem ser cancelados.");
  await audit(db, { entityType: "Fiscal360Job", entityId: id, action: "JOB_CANCEL", after: { status: "CANCELLED" }, actor });
  return { cancelled: true };
}

// ————————————————————————————————————————————— Regras versionadas

const RULE_KEYS = [FISCAL360_AP_RULES_KEY, FISCAL360_TAX_PARAMS_KEY, FISCAL360_REFORM_KEY] as const;

export function validateFiscal360RuleParameters(ruleKey: string, parameters: unknown): Record<string, unknown> {
  if (!(RULE_KEYS as readonly string[]).includes(ruleKey)) throw new Fiscal360InputError("Regra desconhecida.");
  const p = (parameters ?? {}) as Record<string, unknown>;
  if (ruleKey === FISCAL360_AP_RULES_KEY) {
    const rules = Array.isArray(p.rules) ? p.rules : [];
    if (rules.length === 0 || rules.length > 200) throw new Fiscal360InputError("Informe de 1 a 200 regras.");
    return {
      rules: rules.map((raw, idx) => {
        const r = raw as Record<string, unknown>;
        const field = String(r.field ?? "");
        const match = String(r.match ?? "contains");
        const outcome = String(r.outcome ?? "");
        const value = String(r.value ?? "").trim();
        const taxType = r.taxType == null || r.taxType === "" ? null : String(r.taxType).toUpperCase();
        if (!["classification", "personName", "description", "personCnpj"].includes(field)) throw new Fiscal360InputError(`Regra ${idx + 1}: campo inválido.`);
        if (!["equals", "contains", "startsWith"].includes(match)) throw new Fiscal360InputError(`Regra ${idx + 1}: comparação inválida.`);
        if (!["TAX", "NOT_TAX"].includes(outcome)) throw new Fiscal360InputError(`Regra ${idx + 1}: resultado inválido.`);
        if (value.length < 3) throw new Fiscal360InputError(`Regra ${idx + 1}: valor muito curto (mínimo 3 caracteres).`);
        // "IMPOSTO"/"TRIBUTO" isolados nunca bastam para classificar como tributo.
        if (outcome === "TAX" && /^(IMPOSTOS?|TRIBUTOS?|TAXAS?)$/i.test(value)) throw new Fiscal360InputError(`Regra ${idx + 1}: termo genérico não é evidência suficiente.`);
        if (outcome === "TAX" && (!taxType || !TAX_SET.has(taxType))) throw new Fiscal360InputError(`Regra ${idx + 1}: tributo obrigatório.`);
        return { id: String(r.id ?? `r${idx + 1}`).slice(0, 40), field, match, value, outcome, taxType };
      }),
    };
  }
  if (ruleKey === FISCAL360_TAX_PARAMS_KEY) {
    const items = Array.isArray(p.items) ? p.items : [];
    if (items.length === 0 || items.length > 200) throw new Fiscal360InputError("Informe de 1 a 200 parâmetros.");
    return {
      items: items.map((raw, idx) => {
        const i = raw as Record<string, unknown>;
        const companyCnpj = String(i.companyCnpj ?? "").replace(/\D/g, "");
        const taxType = String(i.taxType ?? "").toUpperCase();
        const rate = Number(i.rate);
        if (!FISCAL360_COMPANIES.some((c) => c.cnpj === companyCnpj)) throw new Fiscal360InputError(`Parâmetro ${idx + 1}: empresa inválida.`);
        if (!TAX_SET.has(taxType)) throw new Fiscal360InputError(`Parâmetro ${idx + 1}: tributo inválido.`);
        if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Fiscal360InputError(`Parâmetro ${idx + 1}: alíquota efetiva deve ser fração entre 0 e 1.`);
        const creditRate = i.creditRate == null || i.creditRate === "" ? null : Number(i.creditRate);
        const purchasesMonthly = i.purchasesMonthly == null || i.purchasesMonthly === "" ? null : Number(i.purchasesMonthly);
        if (creditRate != null && (!Number.isFinite(creditRate) || creditRate < 0 || creditRate > 1)) throw new Fiscal360InputError(`Parâmetro ${idx + 1}: crédito inválido.`);
        if (purchasesMonthly != null && (!Number.isFinite(purchasesMonthly) || purchasesMonthly < 0)) throw new Fiscal360InputError(`Parâmetro ${idx + 1}: compras inválidas.`);
        return { companyCnpj, taxType, rate, creditRate, purchasesMonthly };
      }),
    };
  }
  // Reforma: só registro/documentação de regra (IBS/CBS/IS) — nenhuma alíquota é presumida pelo sistema.
  const notes = String(p.notes ?? "").trim();
  if (notes.length < 10) throw new Fiscal360InputError("Descreva a regra da reforma (mínimo 10 caracteres).");
  return { notes, rates: Array.isArray(p.rates) ? p.rates : [] };
}

export async function createFiscal360RuleVersion(
  db: Db,
  input: { ruleKey: string; parameters: unknown; effectiveFrom?: string | null; effectiveTo?: string | null; normativeSource?: string | null; description?: string | null },
  actor: Fiscal360Actor
) {
  const parameters = validateFiscal360RuleParameters(input.ruleKey, input.parameters);
  const needsLegalSource = input.ruleKey !== FISCAL360_AP_RULES_KEY;
  const normativeSource = (input.normativeSource ?? "").trim();
  if (needsLegalSource && normativeSource.length < 5) throw new Fiscal360InputError("Fonte normativa obrigatória (lei, IN, ato).");
  const day = (v: string | null | undefined) => {
    if (!v) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Fiscal360InputError("Data de vigência inválida.");
    return new Date(`${v}T00:00:00.000Z`);
  };
  const effectiveFrom = day(input.effectiveFrom);
  const effectiveTo = day(input.effectiveTo);
  if (needsLegalSource && !effectiveFrom) throw new Fiscal360InputError("Início de vigência obrigatório.");
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) throw new Fiscal360InputError("Fim de vigência anterior ao início.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(913605, hashtext(${input.ruleKey}))`);
    const last = await tx.fiscalRuleVersion.findFirst({ where: { ruleKey: input.ruleKey }, orderBy: { version: "desc" }, select: { version: true } });
    const created = await tx.fiscalRuleVersion.create({
      data: {
        ruleKey: input.ruleKey,
        version: (last?.version ?? 0) + 1,
        status: "DRAFT",
        effectiveFrom,
        effectiveTo,
        normativeSource: normativeSource || null,
        description: input.description?.trim().slice(0, 1000) || null,
        parameters: parameters as Prisma.InputJsonValue,
        createdByUserId: actor.userId,
        createdByName: actor.userName,
      },
    });
    await audit(tx, { entityType: "Fiscal360RuleVersion", entityId: created.id, action: "RULE_CREATE", after: created, actor });
    return created;
  });
}

/** Ativa uma versão (a anterior ativa da mesma chave é aposentada). O processador detecta e reprocessa só o dependente. */
export async function activateFiscal360RuleVersion(db: Db, id: string, actor: Fiscal360Actor) {
  return db.$transaction(async (tx) => {
    const rule = await tx.fiscalRuleVersion.findUnique({ where: { id } });
    if (!rule) throw Object.assign(new Fiscal360InputError("Regra não encontrada."), { status: 404 });
    await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(913605, hashtext(${rule.ruleKey}))`);
    if (rule.status !== "DRAFT") throw new Fiscal360InputError("Só versões em rascunho podem ser ativadas.");
    const now = new Date();
    // Parâmetros por vigência convivem (não retroativos); regras do classificador AP têm uma versão ativa.
    if (rule.ruleKey === FISCAL360_AP_RULES_KEY) {
      await tx.fiscalRuleVersion.updateMany({ where: { ruleKey: rule.ruleKey, status: "ACTIVE" }, data: { status: "RETIRED", retiredAt: now } });
    }
    const updated = await tx.fiscalRuleVersion.update({ where: { id }, data: { status: "ACTIVE", activatedAt: now } });
    await audit(tx, { entityType: "Fiscal360RuleVersion", entityId: id, action: "RULE_ACTIVATE", before: { status: rule.status }, after: { status: "ACTIVE", ruleKey: rule.ruleKey, version: rule.version }, actor });
    return updated;
  });
}

export async function retireFiscal360RuleVersion(db: Db, id: string, actor: Fiscal360Actor) {
  const rule = await db.fiscalRuleVersion.findUnique({ where: { id } });
  if (!rule) throw Object.assign(new Fiscal360InputError("Regra não encontrada."), { status: 404 });
  if (rule.status !== "ACTIVE") throw new Fiscal360InputError("Só versões ativas podem ser aposentadas.");
  const updated = await db.fiscalRuleVersion.update({ where: { id }, data: { status: "RETIRED", retiredAt: new Date() } });
  await audit(db, { entityType: "Fiscal360RuleVersion", entityId: id, action: "RULE_RETIRE", before: { status: "ACTIVE" }, after: { status: "RETIRED" }, actor });
  return updated;
}

export async function listFiscal360RuleVersions(db: Db, ruleKey: string | null) {
  const where = ruleKey && (RULE_KEYS as readonly string[]).includes(ruleKey) ? { ruleKey } : { ruleKey: { in: [...RULE_KEYS] } };
  const rows = await db.fiscalRuleVersion.findMany({ where, orderBy: [{ ruleKey: "asc" }, { version: "desc" }], take: 100 });
  return rows.map((r) => ({
    id: r.id,
    ruleKey: r.ruleKey,
    version: r.version,
    status: r.status,
    effectiveFrom: r.effectiveFrom?.toISOString().slice(0, 10) ?? null,
    effectiveTo: r.effectiveTo?.toISOString().slice(0, 10) ?? null,
    normativeSource: r.normativeSource,
    description: r.description,
    parameters: r.parameters,
    createdByName: r.createdByName,
    createdAt: r.createdAt.toISOString(),
    activatedAt: r.activatedAt?.toISOString() ?? null,
  }));
}

// ————————————————————————————————————————————— Cenários

export async function previewFiscal360Scenario(db: Db, assumptions: unknown, now = new Date()) {
  const referenceMonth = now.toISOString().slice(0, 7);
  const inputs = await loadFiscal360ForecastInputs(db, referenceMonth);
  const sanitized = sanitizeForecastAssumptions(assumptions as never);
  return { assumptions: sanitized, referenceMonth, rows: buildFiscal360Forecast({ referenceMonth, ...inputs, assumptions: sanitized }), inputVersion: inputs.inputVersion };
}

export async function saveFiscal360Scenario(db: Db, input: { name: unknown; description?: unknown; assumptions: unknown }, actor: Fiscal360Actor, now = new Date()) {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 80) : "";
  if (name.length < 3) throw new Fiscal360InputError("Nome do cenário obrigatório (mínimo 3 caracteres).");
  const preview = await previewFiscal360Scenario(db, input.assumptions, now);
  return db.$transaction(async (tx) => {
    const scenario = await tx.fiscalForecastScenario.create({
      data: {
        kind: "CUSTOM",
        name,
        description: typeof input.description === "string" ? input.description.trim().slice(0, 500) : null,
        assumptions: preview.assumptions as unknown as Prisma.InputJsonValue,
        horizonMonths: preview.assumptions.horizonMonths,
        methodologyVersion: FISCAL360_FORECAST_VERSION,
        inputVersion: preview.inputVersion,
        computedAt: now,
        createdByUserId: actor.userId,
        createdByName: actor.userName,
      },
    });
    if (preview.rows.length) {
      await tx.fiscalForecastSnapshot.createMany({
        data: preview.rows.map(({ overdueAmount: _overdue, ...r }) => ({ scenarioId: scenario.id, ...r, details: (r.details ?? Prisma.JsonNull) as Prisma.InputJsonValue, forecastVersion: FISCAL360_FORECAST_VERSION, computedAt: now })),
      });
    }
    await audit(tx, { entityType: "Fiscal360Scenario", entityId: scenario.id, action: "SCENARIO_CREATE", after: { name, assumptions: preview.assumptions }, actor });
    return scenario;
  });
}

export async function archiveFiscal360Scenario(db: Db, id: string, actor: Fiscal360Actor) {
  const s = await db.fiscalForecastScenario.findUnique({ where: { id } });
  if (!s) throw Object.assign(new Fiscal360InputError("Cenário não encontrado."), { status: 404 });
  if (s.kind !== "CUSTOM") throw new Fiscal360InputError("Cenários do sistema não podem ser arquivados.");
  const updated = await db.fiscalForecastScenario.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(db, { entityType: "Fiscal360Scenario", entityId: id, action: "SCENARIO_ARCHIVE", before: { status: s.status }, after: { status: "ARCHIVED" }, actor });
  return updated;
}
