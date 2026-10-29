/**
 * Inteligência Fiscal 360° — consultas da interface. LEEM SOMENTE tabelas materializadas
 * (Fiscal*Fact, Fiscal*Snapshot, FiscalProcessing*, FiscalDataQualityIssue, decisões e auditoria).
 * Nenhuma função aqui lê NomusNfe.xmlRaw, varre NomusAccountsPayable ou recalcula histórico.
 * Exceções deliberadas, sempre para UM registro de drilldown: linhas por item do resumo XML
 * persistido (NomusNfeTaxLine) e as conciliações de Tesouraria do título AP.
 */
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  FISCAL360_ALL_TAXES,
  FISCAL360_COMPANIES,
  FISCAL360_RULE_VERSIONS,
  FISCAL360_UNKNOWN_COMPANY,
  addFiscal360Months,
  fiscal360MonthRange,
  isFiscal360Month,
  roundFiscal360,
} from "./fiscal360Constants.js";
import { effectiveFiscal360PaymentStatus } from "./fiscal360PaymentFact.js";
import { summarizeFiscal360Forecast, type ForecastRow } from "./fiscal360Forecast.js";
import { num } from "./fiscal360Num.js";
import type {
  Fiscal360ApTitleRow,
  Fiscal360AuditRow,
  Fiscal360DecisionRow,
  Fiscal360DocumentDetail,
  Fiscal360DocumentRow,
  Fiscal360DocumentsResponse,
  Fiscal360EvidenceStep,
  Fiscal360Filters,
  Fiscal360ForecastResponse,
  Fiscal360ForecastRowDto,
  Fiscal360ForecastScenarioDto,
  Fiscal360Freshness,
  Fiscal360IntercompanyResponse,
  Fiscal360IssueRow,
  Fiscal360Overview,
  Fiscal360Page,
  Fiscal360PaymentDetail,
  Fiscal360PaymentRow,
  Fiscal360PaymentsResponse,
  Fiscal360ProcessingResponse,
  Fiscal360ReconciliationResponse,
  Fiscal360ReconciliationRow,
} from "./fiscal360Types.js";

type Db = PrismaClient;

export class Fiscal360InputError extends Error {
  status = 400;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function isoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function todayIso(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const ALLOWED_TAX = /^[A-Z_]{2,20}$/;
const ALLOWED_TOKEN = /^[A-Z_]{2,40}$/;

/** Parse estrito dos filtros (whitelist/regex) — nenhum valor de query chega cru a SQL. */
export function parseFiscal360Filters(query: Record<string, unknown>, now = new Date()): Fiscal360Filters {
  const current = now.toISOString().slice(0, 7);
  const fromMonth = str(query.fromMonth) ?? `${current.slice(0, 4)}-01`;
  const toMonth = str(query.toMonth) ?? current;
  if (!isFiscal360Month(fromMonth) || !isFiscal360Month(toMonth)) throw new Fiscal360InputError("Competência inválida (use AAAA-MM).");
  if (fromMonth > toMonth) throw new Fiscal360InputError("Competência inicial maior que a final.");
  if (fiscal360MonthRange(fromMonth, toMonth).length > 60) throw new Fiscal360InputError("Intervalo máximo de 60 competências.");
  const company = str(query.company);
  let companyCnpj: string | null = null;
  if (company && company !== "group") {
    const digits = company.replace(/\D/g, "");
    if (company === FISCAL360_UNKNOWN_COMPANY) companyCnpj = FISCAL360_UNKNOWN_COMPANY;
    else if (FISCAL360_COMPANIES.some((c) => c.cnpj === digits)) companyCnpj = digits;
    else throw new Fiscal360InputError("Empresa fora do grupo econômico.");
  }
  const token = (v: unknown, re: RegExp) => {
    const s = str(v)?.toUpperCase() ?? null;
    if (s && !re.test(s)) throw new Fiscal360InputError("Filtro inválido.");
    return s;
  };
  const basis = str(query.basis)?.toUpperCase() === "CASH" ? "CASH" : "COMPETENCE";
  const q = str(query.q);
  return {
    companyCnpj,
    fromMonth,
    toMonth,
    basis,
    taxType: token(query.taxType, ALLOWED_TAX),
    status: token(query.status, ALLOWED_TOKEN),
    evidenceLevel: token(query.evidenceLevel, ALLOWED_TOKEN),
    linkState: token(query.linkState, ALLOWED_TOKEN),
    operationClass: token(query.operationClass, ALLOWED_TOKEN),
    jurisdiction: token(query.jurisdiction, ALLOWED_TOKEN),
    includeUnknownCompany: str(query.includeUnknown) === "1" || str(query.includeUnknown) === "true",
    q: q ? q.slice(0, 80) : null,
  };
}

export function parseFiscal360Page(query: Record<string, unknown>): { page: number; pageSize: number } {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(String(query.page ?? "1"), 10) || 1));
  const pageSize = Math.max(1, Math.min(200, Number.parseInt(String(query.pageSize ?? "50"), 10) || 50));
  return { page, pageSize };
}

function companyWhere(f: Fiscal360Filters): string[] {
  if (f.companyCnpj) return [f.companyCnpj];
  const list = FISCAL360_COMPANIES.map((c) => c.cnpj);
  return f.includeUnknownCompany ? [...list, FISCAL360_UNKNOWN_COMPANY] : list;
}

// ————————————————————————————————————————————— Frescor

export async function getFiscal360Freshness(db: Db, now = new Date()): Promise<Fiscal360Freshness> {
  const [lastRun, lastSuccess, counts, oldest, lastSnapshot] = await Promise.all([
    db.fiscalProcessingRun.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true, status: true } }),
    db.fiscalProcessingRun.findFirst({ where: { status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" }, select: { finishedAt: true } }),
    db.fiscalProcessingJob.groupBy({ by: ["status"], where: { status: { in: ["PENDING", "RUNNING", "FAILED"] } }, _count: { _all: true } }),
    db.fiscalProcessingJob.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.fiscalMonthlySnapshot.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } }),
  ]);
  const count = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const lastSuccessAt = lastSuccess?.finishedAt ?? null;
  return {
    lastRunAt: iso(lastRun?.startedAt),
    lastRunStatus: lastRun?.status ?? null,
    lastSuccessAt: iso(lastSuccessAt),
    lastSnapshotAt: iso(lastSnapshot?.computedAt),
    pendingJobs: count("PENDING"),
    runningJobs: count("RUNNING"),
    failedJobs: count("FAILED"),
    oldestPendingAt: iso(oldest?.createdAt),
    lagMinutes: oldest ? Math.round((now.getTime() - oldest.createdAt.getTime()) / 60_000) : lastSuccessAt ? 0 : null,
    workerEnabled: process.env.FISCAL360_WORKER_ENABLED === "1",
  };
}

// ————————————————————————————————————————————— Visão executiva

export async function getFiscal360Overview(db: Db, f: Fiscal360Filters, now = new Date()): Promise<Fiscal360Overview> {
  const companies = companyWhere(f);
  const taxRowFilter = f.taxType ? { taxType: f.taxType } : { taxType: { not: FISCAL360_ALL_TAXES } };
  const [taxRows, totalRows, overdue, freshness, cashBreakdown] = await Promise.all([
    db.fiscalMonthlySnapshot.findMany({
      where: { companyCnpj: { in: companies }, competenceMonth: { gte: f.fromMonth, lte: f.toMonth }, ...taxRowFilter },
    }),
    db.fiscalMonthlySnapshot.findMany({
      where: { companyCnpj: { in: companies }, competenceMonth: { gte: f.fromMonth, lte: f.toMonth }, taxType: FISCAL360_ALL_TAXES },
    }),
    db.fiscalPaymentFact.aggregate({
      where: {
        companyCnpj: { in: companies },
        competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
        ...(f.taxType ? { taxType: f.taxType } : {}),
        status: { in: ["OPEN", "PARTIAL", "REVERSED"] },
        openBalance: { gt: 0 },
        countsInPaidTotals: true,
        dueDate: { lt: new Date(`${todayIso(now)}T00:00:00.000Z`) },
      },
      _sum: { openBalance: true },
      _count: { _all: true },
    }),
    getFiscal360Freshness(db, now),
    // Visão de caixa: a quebra por evidência também precisa ser pela data do pagamento (não misturar com competência).
    f.basis === "CASH"
      ? db.fiscalPaymentFact.groupBy({
          by: ["evidenceLevel", "countsInPaidTotals"],
          where: {
            companyCnpj: { in: companies },
            paidMonth: { gte: f.fromMonth, lte: f.toMonth },
            paidAmount: { gt: 0 },
            status: { not: "CANCELLED" },
            ...(f.taxType ? { taxType: f.taxType } : {}),
          },
          _sum: { paidAmount: true },
        })
      : Promise.resolve(null),
  ]);
  const sum = (rows: typeof taxRows, key: keyof (typeof taxRows)[number]) => roundFiscal360(rows.reduce((s, r) => s + num(r[key]), 0));
  const paidKey = f.basis === "CASH" ? "paidByCashDateAmount" : "paidAmount";
  const cashSum = (pred: (r: { evidenceLevel: string; countsInPaidTotals: boolean }) => boolean) =>
    roundFiscal360((cashBreakdown ?? []).filter(pred).reduce((s, r) => s + num(r._sum.paidAmount), 0));
  const cash = cashBreakdown != null;
  const k = {
    paid: sum(taxRows, paidKey),
    paidProven: cash ? cashSum((r) => r.countsInPaidTotals && (r.evidenceLevel === "DOCUMENTARY_PROOF" || r.evidenceLevel === "BANK_MATCH")) : sum(taxRows, "paidProvenAmount"),
    paidUnproven: cash ? cashSum((r) => r.countsInPaidTotals && r.evidenceLevel === "ERP_SETTLEMENT") : sum(taxRows, "paidUnprovenAmount"),
    paidDeclared: cash ? cashSum((r) => r.countsInPaidTotals && r.evidenceLevel !== "ERP_SETTLEMENT" && r.evidenceLevel !== "DOCUMENTARY_PROOF" && r.evidenceLevel !== "BANK_MATCH") : sum(taxRows, "paidDeclaredAmount"),
    reviewAmount: cash ? cashSum((r) => !r.countsInPaidTotals) : sum(taxRows, "reviewAmount"),
    paidWithoutCashDate: sum(taxRows, "paidWithoutCashDateAmount"),
    assessed: sum(taxRows, "assessedAmount"),
    credits: sum(taxRows, "creditsAmount"),
    retentions: sum(taxRows, "retentionAmount"),
    apurationDue: sum(taxRows, "apurationAmountDue"),
    obligationDue: sum(taxRows, "obligationAmountDue"),
    openBalance: sum(taxRows, "openBalance"),
    highlighted: sum(taxRows, "highlightedAmount"),
    highlightedMarket: sum(taxRows, "highlightedMarketAmount"),
    highlightedIntercompany: sum(taxRows, "highlightedIntercompanyAmount"),
    highlightedOther: sum(taxRows, "highlightedOtherAmount"),
    st: sum(taxRows, "stAmount"),
    desonerated: sum(taxRows, "desoneratedAmount"),
    informative: sum(taxRows, "informativeAmount"),
    documentaryCredits: sum(taxRows, "documentaryCreditAmount"),
  };
  const officialRevenue = sum(totalRows, "officialRevenue");
  const reconciliationItems = f.taxType ? taxRows.reduce((s, r) => s + r.reconciliationItemCount, 0) : totalRows.reduce((s, r) => s + r.reconciliationItemCount, 0);
  const reconciliationOk = f.taxType ? taxRows.reduce((s, r) => s + r.reconciliationOkCount, 0) : totalRows.reduce((s, r) => s + r.reconciliationOkCount, 0);
  const paymentFactCount = taxRows.reduce((s, r) => s + r.paymentFactCount, 0);
  const pendingCount = f.taxType ? taxRows.reduce((s, r) => s + r.pendingClassificationCount, 0) : totalRows.reduce((s, r) => s + r.pendingClassificationCount, 0);
  const pendingAmount = f.taxType ? sum(taxRows, "pendingClassificationAmount") : sum(totalRows, "pendingClassificationAmount");
  // Carga de caixa: pago (competência) ÷ faturamento externo. Sem pagamentos ou sem receita = dados insuficientes (nunca 0%).
  const paidCompetence = sum(taxRows, "paidAmount");
  let cashBurdenState: Fiscal360Overview["kpis"]["cashBurdenState"] = "OK";
  let cashBurdenPct: number | null = null;
  if (officialRevenue <= 0 || paymentFactCount === 0 || paidCompetence <= 0) cashBurdenState = "INSUFFICIENT_DATA";
  else {
    cashBurdenPct = Number(((paidCompetence / officialRevenue) * 100).toFixed(2));
    if (pendingCount > 0 || k.reviewAmount > 0 || reconciliationOk < reconciliationItems) cashBurdenState = "NOT_RECONCILED";
  }

  const months = fiscal360MonthRange(f.fromMonth, f.toMonth);
  const monthly = months.map((month) => {
    const rows = taxRows.filter((r) => r.competenceMonth === month);
    const total = totalRows.filter((r) => r.competenceMonth === month);
    return {
      month,
      highlighted: sum(rows, "highlightedAmount"),
      assessed: sum(rows, "assessedAmount"),
      apurationDue: sum(rows, "apurationAmountDue"),
      obligationDue: sum(rows, "obligationAmountDue"),
      paid: sum(rows, paidKey),
      officialRevenue: sum(total, "officialRevenue"),
    };
  });
  const taxes = [...new Set(taxRows.map((r) => r.taxType))].sort();
  const byTax = taxes.map((taxType) => {
    const rows = taxRows.filter((r) => r.taxType === taxType);
    return {
      taxType,
      highlighted: sum(rows, "highlightedAmount"),
      assessed: sum(rows, "assessedAmount"),
      due: sum(rows, "obligationAmountDue"),
      paid: sum(rows, paidKey),
      open: sum(rows, "openBalance"),
      review: sum(rows, "reviewAmount"),
    };
  });
  const byCompany = companies.map((companyCnpj) => {
    const rows = taxRows.filter((r) => r.companyCnpj === companyCnpj);
    const total = totalRows.filter((r) => r.companyCnpj === companyCnpj);
    return {
      companyCnpj,
      officialRevenue: sum(total, "officialRevenue"),
      highlighted: sum(rows, "highlightedAmount"),
      due: sum(rows, "obligationAmountDue"),
      paid: sum(rows, paidKey),
      open: sum(rows, "openBalance"),
    };
  });
  const notes: string[] = [];
  if (totalRows.length === 0) notes.push("Nenhuma materialização para o filtro: execute o processamento fiscal (backfill) antes de analisar.");
  if (f.basis === "CASH") notes.push("Visão de caixa: somente pagamentos com data de baixa conhecida (Tesouraria, AP ou guia).");
  if (k.paidWithoutCashDate > 0) notes.push("Há pagamentos sem data de caixa: o Nomus não envia data de baixa do contas a pagar.");
  if (k.reviewAmount > 0) notes.push("Valores em revisão (possível duplicidade/vínculo duplicado) estão FORA do total pago.");
  notes.push("NFS-e: sem fonte operacional integrada — documentos de serviço não constam desta visão.");
  return {
    filters: f,
    generatedAt: now.toISOString(),
    kpis: {
      ...k,
      overdueAmount: roundFiscal360(num(overdue._sum.openBalance)),
      overdueCount: overdue._count._all,
      officialRevenue,
      intercompanyRevenue: sum(totalRows, "intercompanyRevenue"),
      documentaryMovement: sum(totalRows, "documentaryMovement"),
      cashBurdenPct,
      cashBurdenState,
      reconciledPct: reconciliationItems > 0 ? Number(((reconciliationOk / reconciliationItems) * 100).toFixed(1)) : null,
      reconciliationItems,
      pendingClassificationCount: pendingCount,
      pendingClassificationAmount: pendingAmount,
      openIssues: totalRows.reduce((s, r) => s + r.openIssueCount, 0),
      documentCount: totalRows.reduce((s, r) => s + r.documentCount, 0),
      missingXmlCount: totalRows.reduce((s, r) => s + r.missingXmlCount, 0),
      paymentFactCount,
    },
    monthly,
    byTax,
    byCompany,
    freshness,
    notes,
  };
}

// ————————————————————————————————————————————— Pagamentos

function paymentWhere(f: Fiscal360Filters, now = new Date()): Prisma.FiscalPaymentFactWhereInput {
  const companies = companyWhere(f);
  const range = { gte: f.fromMonth, lte: f.toMonth };
  const where: Prisma.FiscalPaymentFactWhereInput = {
    companyCnpj: { in: companies },
    ...(f.basis === "CASH" ? { paidMonth: range } : { competenceMonth: range }),
    ...(f.taxType ? { taxType: f.taxType } : {}),
    ...(f.evidenceLevel ? { evidenceLevel: f.evidenceLevel } : {}),
    ...(f.linkState ? { linkState: f.linkState } : {}),
    ...(f.jurisdiction ? { jurisdiction: f.jurisdiction } : {}),
  };
  if (f.status === "OVERDUE") {
    Object.assign(where, { status: { in: ["OPEN", "PARTIAL", "REVERSED"] }, openBalance: { gt: 0 }, dueDate: { lt: new Date(`${todayIso(now)}T00:00:00.000Z`) } });
  } else if (f.status === "REVIEW") {
    Object.assign(where, { countsInPaidTotals: false });
  } else if (f.status) {
    Object.assign(where, { status: f.status });
  }
  if (f.q) {
    where.OR = [
      { guideNumber: { contains: f.q, mode: "insensitive" } },
      { anchorKey: { contains: f.q, mode: "insensitive" } },
      { revenueCode: { contains: f.q } },
    ];
  }
  return where;
}

type PaymentFactRow = Awaited<ReturnType<Db["fiscalPaymentFact"]["findMany"]>>[number];

async function mapPayments(db: Db, rows: PaymentFactRow[], now = new Date()): Promise<Fiscal360PaymentRow[]> {
  const apIds = rows.map((r) => r.apExternalId).filter((v): v is number => v != null);
  const apFacts = apIds.length
    ? await db.fiscalApTitleFact.findMany({ where: { apExternalId: { in: apIds } }, select: { apExternalId: true, description: true, documentNumber: true } })
    : [];
  const apById = new Map(apFacts.map((a) => [a.apExternalId, a]));
  const today = todayIso(now);
  return rows.map((r) => {
    const ap = r.apExternalId != null ? apById.get(r.apExternalId) : undefined;
    const dueDate = isoDate(r.dueDate);
    const openBalance = num(r.openBalance);
    return {
      anchorKey: r.anchorKey,
      anchorType: r.anchorType,
      guideId: r.guideId,
      apExternalId: r.apExternalId,
      companyCnpj: r.companyCnpj,
      taxType: r.taxType,
      revenueCode: r.revenueCode,
      guideType: r.guideType,
      guideNumber: r.guideNumber,
      competenceMonth: r.competenceMonth,
      dueDate,
      amountDue: num(r.amountDue),
      paidAmount: num(r.paidAmount),
      openBalance,
      paidAt: isoDate(r.paidAt),
      paidAtSource: r.paidAtSource,
      paymentAccount: r.paymentAccount,
      status: r.status,
      effectiveStatus: effectiveFiscal360PaymentStatus(r.status, dueDate, openBalance, today),
      evidenceLevel: r.evidenceLevel,
      linkState: r.linkState,
      paidSource: r.paidSource,
      countsInPaidTotals: r.countsInPaidTotals,
      reviewReason: r.reviewReason,
      flags: r.flags,
      apDescription: ap?.description ?? null,
      apDocumentNumber: ap?.documentNumber ?? null,
      materializedAt: r.materializedAt.toISOString(),
    };
  });
}

export async function listFiscal360Payments(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number },
  now = new Date()
): Promise<Fiscal360PaymentsResponse> {
  const where = paymentWhere(f, now);
  const [rows, total, counted, review] = await Promise.all([
    db.fiscalPaymentFact.findMany({
      where,
      orderBy: [{ competenceMonth: "desc" }, { dueDate: "desc" }, { anchorKey: "asc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    db.fiscalPaymentFact.count({ where }),
    db.fiscalPaymentFact.aggregate({ where: { AND: [where, { countsInPaidTotals: true }] }, _sum: { amountDue: true, paidAmount: true, openBalance: true } }),
    db.fiscalPaymentFact.aggregate({ where: { AND: [where, { countsInPaidTotals: false }] }, _sum: { paidAmount: true, amountDue: true, openBalance: true } }),
  ]);
  return {
    rows: await mapPayments(db, rows, now),
    page: page.page,
    pageSize: page.pageSize,
    total,
    // Devido e saldo só das obrigações contadas: a evidência duplicada em revisão não os repete.
    totals: {
      amountDue: roundFiscal360(num(counted._sum.amountDue)),
      paidCounted: roundFiscal360(num(counted._sum.paidAmount)),
      paidInReview: roundFiscal360(num(review._sum.paidAmount)),
      openBalance: roundFiscal360(num(counted._sum.openBalance)),
    },
  };
}

function decisionRow(d: Awaited<ReturnType<Db["fiscalReconciliationDecision"]["findMany"]>>[number]): Fiscal360DecisionRow {
  return {
    id: d.id,
    decisionType: d.decisionType,
    apExternalId: d.apExternalId,
    guideId: d.guideId,
    itemKey: d.itemKey,
    payload: (d.payload ?? {}) as Record<string, unknown>,
    reason: d.reason,
    active: d.active,
    createdByName: d.createdByName,
    createdAt: d.createdAt.toISOString(),
    revokedAt: iso(d.revokedAt),
    revokedByName: d.revokedByName,
    revokeReason: d.revokeReason,
  };
}

function reconciliationRow(i: Awaited<ReturnType<Db["fiscalReconciliationItem"]["findMany"]>>[number]): Fiscal360ReconciliationRow {
  return {
    itemKey: i.itemKey,
    companyCnpj: i.companyCnpj,
    competenceMonth: i.competenceMonth,
    taxType: i.taxType,
    checkType: i.checkType,
    status: i.status,
    subjectType: i.subjectType,
    subjectId: i.subjectId,
    relatedType: i.relatedType,
    relatedId: i.relatedId,
    expectedAmount: i.expectedAmount == null ? null : num(i.expectedAmount),
    actualAmount: i.actualAmount == null ? null : num(i.actualAmount),
    difference: i.difference == null ? null : num(i.difference),
    message: i.message,
    computedAt: i.computedAt.toISOString(),
  };
}

export async function getFiscal360PaymentDetail(db: Db, anchorKey: string, now = new Date()): Promise<Fiscal360PaymentDetail | null> {
  if (!/^(GUIDE|AP):[\w-]{1,64}$/.test(anchorKey)) throw new Fiscal360InputError("Identificador inválido.");
  const fact = await db.fiscalPaymentFact.findUnique({ where: { anchorKey } });
  if (!fact) return null;
  const [mapped] = await mapPayments(db, [fact], now);
  const [guide, apTitle, decisions, items, audit] = await Promise.all([
    fact.guideId
      ? db.fiscalPaymentGuide.findUnique({ where: { id: fact.guideId }, include: { proofs: { orderBy: { uploadedAt: "desc" } }, period: { select: { companyName: true, status: true, periodStart: true, periodEnd: true } } } })
      : null,
    fact.apExternalId != null ? db.fiscalApTitleFact.findUnique({ where: { apExternalId: fact.apExternalId } }) : null,
    db.fiscalReconciliationDecision.findMany({
      where: { OR: [...(fact.guideId ? [{ guideId: fact.guideId }] : []), ...(fact.apExternalId != null ? [{ apExternalId: fact.apExternalId }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.fiscalReconciliationItem.findMany({ where: { OR: [{ subjectId: anchorKey }, { relatedId: anchorKey }] }, take: 50 }),
    db.fiscalSettlementAuditLog.findMany({
      where: {
        OR: [
          ...(fact.guideId ? [{ entityType: "FiscalPaymentGuide", entityId: fact.guideId }] : []),
          ...(fact.apExternalId != null ? [{ entityType: "Fiscal360ApClassification", entityId: String(fact.apExternalId) }] : []),
          { entityType: "Fiscal360Decision", entityId: { in: [fact.guideId ?? "-", String(fact.apExternalId ?? "-")] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const treasury =
    fact.apExternalId != null
      ? await db.$queryRaw<Array<{ matchId: string; matchedCivilDate: Date; amount: unknown; accountName: string | null }>>(Prisma.sql`
          SELECT m."id"::text AS "matchId", m."matchedCivilDate", a."amount", acc."name" AS "accountName"
          FROM "TreasuryReconciliationAllocation" a
          JOIN "TreasuryReconciliationMatch" m ON m."id" = a."matchId"
          LEFT JOIN "TreasuryFinancialAccount" acc ON acc."id" = m."accountId"
          WHERE a."nomusSide" = 'AP' AND a."kind"::text = 'TITLE' AND m."status"::text = 'MATCHED' AND a."nomusExternalId" = ${fact.apExternalId}
          ORDER BY m."matchedCivilDate" DESC
          LIMIT 20`)
      : [];
  const trail: Fiscal360EvidenceStep[] = [];
  trail.push({
    step: "Apuração da competência",
    // Período vinculado e fechado = ok; aberto = revisar; sem período = ausente (a divergência de valores vem da conciliação).
    status: !guide?.period ? "MISSING" : guide.period.status === "CLOSED" && !items.some((i) => i.checkType === "APURATION_VS_GUIDE" && i.status === "DIVERGENT") ? "OK" : "REVIEW",
    detail: guide?.period ? `Período ${isoDate(guide.period.periodStart)} a ${isoDate(guide.period.periodEnd)} (${guide.period.status})` : "Sem período de apuração vinculado.",
    source: "FiscalApurationPeriod",
    reference: guide?.periodId ?? null,
  });
  trail.push({
    step: "Guia de recolhimento",
    status: fact.guideId ? "OK" : "MISSING",
    detail: fact.guideId ? `${fact.guideType ?? "Guia"} ${fact.guideNumber ?? "sem número"} · cód. ${fact.revenueCode ?? "—"}` : "Título tributário sem guia cadastrada.",
    source: "FiscalPaymentGuide",
    reference: fact.guideId,
  });
  trail.push({
    step: "Título no contas a pagar (Nomus)",
    status: fact.apExternalId != null ? "OK" : "MISSING",
    detail: apTitle ? `${apTitle.description ?? "Sem descrição"} · ${apTitle.personName ?? ""} · vínculo ${fact.apLinkSource}` : "Sem título AP vinculado.",
    source: "NomusAccountsPayable",
    reference: fact.apExternalId != null ? String(fact.apExternalId) : null,
  });
  trail.push({
    step: "Baixa financeira",
    status: num(fact.paidAmount) > 0 ? (fact.paidSource === "GUIDE_MANUAL" ? "REVIEW" : "OK") : "MISSING",
    detail:
      num(fact.paidAmount) > 0
        ? `${fact.paidSource === "GUIDE_MANUAL" ? "Valor declarado na guia" : "Baixa no AP"}: R$ ${num(fact.paidAmount).toFixed(2)}${fact.paidAt ? ` em ${isoDate(fact.paidAt)} (${fact.paidAtSource})` : " · data de caixa indisponível"}`
        : "Sem baixa registrada.",
    source: fact.paidSource === "GUIDE_MANUAL" ? "FiscalPaymentGuide.amountPaid" : "NomusAccountsPayable.amountPaid",
    reference: null,
  });
  trail.push({
    step: "Comprovação",
    status: fact.evidenceLevel === "BANK_MATCH" || fact.evidenceLevel === "DOCUMENTARY_PROOF" ? "OK" : num(fact.paidAmount) > 0 ? "REVIEW" : "INFO",
    detail:
      fact.evidenceLevel === "BANK_MATCH"
        ? `Conciliado na Tesouraria (${treasury.length} match).`
        : fact.evidenceLevel === "DOCUMENTARY_PROOF"
          ? `${fact.proofCount} comprovante(s) anexado(s) à guia.`
          : "Sem comprovante documental nem conciliação bancária.",
    source: fact.evidenceLevel === "BANK_MATCH" ? "TreasuryReconciliationMatch" : "FiscalPaymentProof",
    reference: null,
  });
  trail.push({
    step: "Contagem no total pago",
    status: fact.countsInPaidTotals ? "OK" : "REVIEW",
    detail: fact.countsInPaidTotals ? "Contado uma única vez no total pago." : fact.reviewReason ?? "Em revisão.",
    source: "FiscalPaymentFact",
    reference: fact.anchorKey,
  });
  return {
    fact: { ...mapped!, amountOriginal: num(fact.amountOriginal), interestAmount: num(fact.interestAmount), fineAmount: num(fact.fineAmount), creditsAmount: num(fact.creditsAmount), compensationsAmount: num(fact.compensationsAmount), apLinkSource: fact.apLinkSource, companyResolution: fact.companyResolution, sourceHash: fact.sourceHash, ruleVersion: fact.ruleVersion, version: fact.version },
    guide: guide
      ? {
          id: guide.id,
          guideType: guide.guideType,
          guideNumber: guide.guideNumber,
          revenueCode: guide.revenueCode,
          status: guide.status,
          periodStart: isoDate(guide.periodStart),
          periodEnd: isoDate(guide.periodEnd),
          dueDate: isoDate(guide.dueDate),
          amountDue: num(guide.amountDue),
          amountPaid: num(guide.amountPaid),
          paidAt: isoDate(guide.paidAt),
          source: guide.source,
          periodCompanyName: guide.period?.companyName ?? null,
          accountsPayableExternalId: guide.accountsPayableExternalId,
        }
      : null,
    proofs: (guide?.proofs ?? []).map((p) => ({ id: p.id, originalFileName: p.originalFileName, uploadedAt: p.uploadedAt.toISOString(), uploadedBy: p.uploadedBy })),
    apTitle: apTitle
      ? {
          apExternalId: apTitle.apExternalId,
          description: apTitle.description,
          personName: apTitle.personName,
          nomusClassification: apTitle.nomusClassification,
          documentNumber: apTitle.documentNumber,
          dueDate: isoDate(apTitle.dueDate),
          amountOriginal: num(apTitle.amountOriginal),
          amountPaid: num(apTitle.amountPaid),
          balance: num(apTitle.balance),
          effectiveStatus: apTitle.effectiveStatus,
          classificationStatus: apTitle.classificationStatus,
          classificationRule: apTitle.classificationRule,
          classificationConfidence: apTitle.classificationConfidence,
          companyName: apTitle.companyName,
        }
      : null,
    treasury: treasury.map((t) => ({ matchId: t.matchId, matchedCivilDate: t.matchedCivilDate.toISOString().slice(0, 10), amount: num(t.amount), accountName: t.accountName })),
    evidenceTrail: trail,
    reconciliation: items.map(reconciliationRow),
    decisions: decisions.map(decisionRow),
    audit: audit.map((a) => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, action: a.action, userName: a.userName, createdAt: a.createdAt.toISOString(), before: a.beforeJson, after: a.afterJson })),
  };
}

// ————————————————————————————————————————————— Conciliação

export async function listFiscal360Reconciliation(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number },
  checkType: string | null
): Promise<Fiscal360ReconciliationResponse> {
  if (checkType && !ALLOWED_TOKEN.test(checkType)) throw new Fiscal360InputError("Checagem inválida.");
  const base: Prisma.FiscalReconciliationItemWhereInput = {
    companyCnpj: { in: companyWhere(f) },
    competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
    ...(f.taxType ? { taxType: f.taxType } : {}),
  };
  const where: Prisma.FiscalReconciliationItemWhereInput = {
    ...base,
    ...(checkType ? { checkType } : {}),
    ...(f.status ? { status: f.status } : { status: { not: "OK" } }),
  };
  const [rows, total, summary] = await Promise.all([
    db.fiscalReconciliationItem.findMany({ where, orderBy: [{ competenceMonth: "desc" }, { checkType: "asc" }, { itemKey: "asc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalReconciliationItem.count({ where }),
    db.fiscalReconciliationItem.groupBy({ by: ["checkType", "status"], where: base, _count: { _all: true } }),
  ]);
  return {
    rows: rows.map(reconciliationRow),
    page: page.page,
    pageSize: page.pageSize,
    total,
    summary: summary.map((s) => ({ checkType: s.checkType, status: s.status, count: s._count._all })),
  };
}

function apRow(a: Awaited<ReturnType<Db["fiscalApTitleFact"]["findMany"]>>[number]): Fiscal360ApTitleRow {
  return {
    apExternalId: a.apExternalId,
    companyCnpj: a.companyCnpj,
    companyName: a.companyName,
    personName: a.personName,
    description: a.description,
    nomusClassification: a.nomusClassification,
    documentNumber: a.documentNumber,
    dueDate: isoDate(a.dueDate),
    competenceMonth: a.competenceMonth,
    amountOriginal: num(a.amountOriginal),
    amountPaid: num(a.amountPaid),
    balance: num(a.balance),
    effectiveStatus: a.effectiveStatus,
    classificationStatus: a.classificationStatus,
    taxType: a.taxType,
    suggestedTaxType: a.suggestedTaxType,
    classificationConfidence: a.classificationConfidence,
    classificationRule: a.classificationRule,
    claimedByGuideId: a.claimedByGuideId,
    isIntercompany: a.isIntercompany,
    intercompanyCounterpartyCnpj: a.intercompanyCounterpartyCnpj,
    treasuryPaidDate: isoDate(a.treasuryPaidDate),
  };
}

export async function listFiscal360ApTitles(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number },
  classificationStatus: string | null
): Promise<Fiscal360Page<Fiscal360ApTitleRow>> {
  if (classificationStatus && !["TAX", "NOT_TAX", "PENDING"].includes(classificationStatus)) throw new Fiscal360InputError("Classificação inválida.");
  const where: Prisma.FiscalApTitleFactWhereInput = {
    companyCnpj: { in: [...companyWhere(f), FISCAL360_UNKNOWN_COMPANY] },
    competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
    classificationStatus: classificationStatus ?? { in: ["TAX", "PENDING"] },
    ...(f.taxType ? { OR: [{ taxType: f.taxType }, { suggestedTaxType: f.taxType }] } : {}),
    ...(f.q ? { description: { contains: f.q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    db.fiscalApTitleFact.findMany({ where, orderBy: [{ competenceMonth: "desc" }, { apExternalId: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalApTitleFact.count({ where }),
  ]);
  return { rows: rows.map(apRow), page: page.page, pageSize: page.pageSize, total };
}

// ————————————————————————————————————————————— Documentos

type DocWithTaxes = Awaited<ReturnType<Db["fiscalDocumentFact"]["findMany"]>>[number] & {
  taxes: Array<{ taxType: string; effect: string; amount: Prisma.Decimal }>;
};

function documentRow(d: DocWithTaxes): Fiscal360DocumentRow {
  return {
    nomusNfeId: d.nomusNfeId,
    nomusExternalId: d.nomusExternalId,
    documentKind: d.documentKind,
    numero: d.numero,
    serie: d.serie,
    chave: d.chave,
    companyCnpj: d.companyCnpj,
    recipientCnpj: d.recipientCnpj,
    recipientGroupCnpj: d.recipientGroupCnpj,
    issueDate: isoDate(d.issueDate),
    competenceMonth: d.competenceMonth,
    natOp: d.natOp,
    fiscalStatus: d.fiscalStatus,
    operationClass: d.operationClass,
    isOfficialBilling: d.isOfficialBilling,
    officialRevenueAmount: num(d.officialRevenueAmount),
    vNF: d.vNF == null ? null : num(d.vNF),
    highlightedTaxTotal: num(d.highlightedTaxTotal),
    xmlStatus: d.xmlStatus,
    taxes: d.taxes.map((t) => ({ taxType: t.taxType, effect: t.effect, amount: num(t.amount) })),
  };
}

function documentWhere(f: Fiscal360Filters): Prisma.FiscalDocumentFactWhereInput {
  return {
    companyCnpj: { in: companyWhere(f) },
    competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
    ...(f.operationClass ? { operationClass: f.operationClass } : {}),
    ...(f.status ? { fiscalStatus: f.status } : {}),
    ...(f.taxType ? { taxes: { some: { taxType: f.taxType } } } : {}),
    ...(f.q ? { OR: [{ numero: { contains: f.q } }, { chave: { contains: f.q } }, { natOp: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listFiscal360Documents(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number }
): Promise<Fiscal360DocumentsResponse> {
  const where = documentWhere(f);
  const [rows, total, byOperation] = await Promise.all([
    db.fiscalDocumentFact.findMany({
      where,
      include: { taxes: { select: { taxType: true, effect: true, amount: true } } },
      orderBy: [{ competenceMonth: "desc" }, { issueDate: "desc" }, { nomusExternalId: "desc" }],
      skip: (page.page - 1) * page.pageSize,
      take: page.pageSize,
    }),
    db.fiscalDocumentFact.count({ where }),
    db.fiscalDocumentFact.groupBy({
      by: ["operationClass", "fiscalStatus"],
      where,
      _count: { _all: true },
      _sum: { vNF: true, officialRevenueAmount: true, highlightedTaxTotal: true },
    }),
  ]);
  return {
    rows: rows.map((r) => documentRow(r as DocWithTaxes)),
    page: page.page,
    pageSize: page.pageSize,
    total,
    byOperation: byOperation.map((b) => ({
      operationClass: b.operationClass,
      fiscalStatus: b.fiscalStatus,
      count: b._count._all,
      vNF: roundFiscal360(num(b._sum.vNF)),
      officialRevenue: roundFiscal360(num(b._sum.officialRevenueAmount)),
      highlighted: roundFiscal360(num(b._sum.highlightedTaxTotal)),
    })),
    nfseAvailable: false,
  };
}

export async function getFiscal360DocumentDetail(db: Db, nomusNfeId: string): Promise<Fiscal360DocumentDetail | null> {
  if (!/^[\w-]{1,64}$/.test(nomusNfeId)) throw new Fiscal360InputError("Identificador inválido.");
  const doc = await db.fiscalDocumentFact.findUnique({ where: { nomusNfeId }, include: { taxes: true } });
  if (!doc) return null;
  const ITEM_LIMIT = 500;
  const [items, issues] = await Promise.all([
    db.nomusNfeTaxLine.findMany({
      where: { nomusNfeId, scope: "ITEM" },
      orderBy: [{ itemNumber: "asc" }, { taxType: "asc" }],
      take: ITEM_LIMIT + 1,
      select: { itemNumber: true, taxType: true, amount: true, baseAmount: true, rate: true, cfop: true, ncm: true, cst: true, csosn: true },
    }),
    db.fiscalDataQualityIssue.findMany({ where: { entityId: nomusNfeId }, orderBy: { lastDetectedAt: "desc" }, take: 20 }),
  ]);
  return {
    document: {
      ...documentRow(doc as DocWithTaxes),
      vProd: doc.vProd == null ? null : num(doc.vProd),
      vDesc: doc.vDesc == null ? null : num(doc.vDesc),
      valorLiquido: doc.valorLiquido == null ? null : num(doc.valorLiquido),
      billingClassification: doc.billingClassification,
      parserVersion: doc.parserVersion,
      qualityFlags: doc.qualityFlags,
      materializedAt: doc.materializedAt.toISOString(),
      ruleVersion: doc.ruleVersion,
      issuerCnpj: doc.issuerCnpj,
    },
    items: items.slice(0, ITEM_LIMIT).map((i) => ({
      itemNumber: i.itemNumber,
      taxType: i.taxType,
      amount: i.amount == null ? null : num(i.amount),
      baseAmount: i.baseAmount == null ? null : num(i.baseAmount),
      rate: i.rate == null ? null : num(i.rate),
      cfop: i.cfop,
      ncm: i.ncm,
      cst: i.cst,
      csosn: i.csosn,
    })),
    itemsTruncated: items.length > ITEM_LIMIT,
    issues: issues.map(issueRow),
  };
}

// ————————————————————————————————————————————— Intercompany

export async function getFiscal360Intercompany(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number }
): Promise<Fiscal360IntercompanyResponse> {
  const groupCnpjs = FISCAL360_COMPANIES.map((c) => c.cnpj);
  const involve = f.companyCnpj ? [f.companyCnpj] : groupCnpjs;
  const snapshots = await db.fiscalIntercompanySnapshot.findMany({
    where: {
      competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
      OR: [{ issuerCnpj: { in: involve } }, { recipientCnpj: { in: involve } }],
    },
    orderBy: [{ competenceMonth: "asc" }],
  });
  const pairMap = new Map<string, Fiscal360IntercompanyResponse["pairs"][number]>();
  for (const s of snapshots) {
    const key = `${s.issuerCnpj}>${s.recipientCnpj}`;
    const p = pairMap.get(key) ?? { issuerCnpj: s.issuerCnpj, recipientCnpj: s.recipientCnpj, documentCount: 0, documentValue: 0, highlightedTaxAmount: 0, apTitleCount: 0, apAmount: 0, apPaidAmount: 0, apOpenAmount: 0, divergenceAmount: 0 };
    p.documentCount += s.documentCount;
    p.documentValue += num(s.documentValue);
    p.highlightedTaxAmount += num(s.highlightedTaxAmount);
    p.apTitleCount += s.apTitleCount;
    p.apAmount += num(s.apAmount);
    p.apPaidAmount += num(s.apPaidAmount);
    p.apOpenAmount += num(s.apOpenAmount);
    pairMap.set(key, p);
  }
  const pairs = [...pairMap.values()].map((p) => ({
    ...p,
    documentValue: roundFiscal360(p.documentValue),
    highlightedTaxAmount: roundFiscal360(p.highlightedTaxAmount),
    apAmount: roundFiscal360(p.apAmount),
    apPaidAmount: roundFiscal360(p.apPaidAmount),
    apOpenAmount: roundFiscal360(p.apOpenAmount),
    divergenceAmount: roundFiscal360(p.documentValue - p.apAmount),
  }));
  const docFilter: Fiscal360Filters = { ...f, operationClass: "INTERCOMPANY", status: null, companyCnpj: null, includeUnknownCompany: false };
  const docWhere: Prisma.FiscalDocumentFactWhereInput = {
    ...documentWhere(docFilter),
    ...(f.companyCnpj ? { OR: [{ companyCnpj: f.companyCnpj }, { recipientGroupCnpj: f.companyCnpj }] } : {}),
  };
  const apWhere: Prisma.FiscalApTitleFactWhereInput = {
    isIntercompany: true,
    competenceMonth: { gte: f.fromMonth, lte: f.toMonth },
    ...(f.companyCnpj ? { OR: [{ companyCnpj: f.companyCnpj }, { intercompanyCounterpartyCnpj: f.companyCnpj }] } : {}),
  };
  const [docs, docTotal, aps, apTotal, eliminated] = await Promise.all([
    db.fiscalDocumentFact.findMany({ where: docWhere, include: { taxes: { select: { taxType: true, effect: true, amount: true } } }, orderBy: [{ competenceMonth: "desc" }, { nomusExternalId: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalDocumentFact.count({ where: docWhere }),
    db.fiscalApTitleFact.findMany({ where: apWhere, orderBy: [{ competenceMonth: "desc" }, { apExternalId: "desc" }], take: page.pageSize }),
    db.fiscalApTitleFact.count({ where: apWhere }),
    db.fiscalDocumentFact.aggregate({ where: { ...docWhere, fiscalStatus: "AUTHORIZED" }, _sum: { valorLiquido: true } }),
  ]);
  return {
    pairs,
    monthly: snapshots.map((s) => ({ month: s.competenceMonth, issuerCnpj: s.issuerCnpj, recipientCnpj: s.recipientCnpj, documentValue: num(s.documentValue), apAmount: num(s.apAmount) })),
    eliminatedRevenue: roundFiscal360(num(eliminated._sum.valorLiquido)),
    documents: { rows: docs.map((d) => documentRow(d as DocWithTaxes)), page: page.page, pageSize: page.pageSize, total: docTotal },
    apTitles: { rows: aps.map(apRow), page: 1, pageSize: page.pageSize, total: apTotal },
    nfseAvailable: false,
  };
}

// ————————————————————————————————————————————— Projeções

function scenarioDto(s: Awaited<ReturnType<Db["fiscalForecastScenario"]["findMany"]>>[number]): Fiscal360ForecastScenarioDto {
  return {
    id: s.id,
    kind: s.kind,
    systemKey: s.systemKey,
    name: s.name,
    description: s.description,
    assumptions: (s.assumptions ?? {}) as Record<string, unknown>,
    horizonMonths: s.horizonMonths,
    computedAt: iso(s.computedAt),
    inputVersion: s.inputVersion,
    methodologyVersion: s.methodologyVersion,
    createdByName: s.createdByName,
  };
}

function forecastRowDto(r: Awaited<ReturnType<Db["fiscalForecastSnapshot"]["findMany"]>>[number]): Fiscal360ForecastRowDto {
  return {
    companyCnpj: r.companyCnpj,
    month: r.month,
    taxType: r.taxType,
    kind: r.kind,
    availability: r.availability,
    unavailableReason: r.unavailableReason,
    amount: r.amount == null ? null : num(r.amount),
    lowAmount: r.lowAmount == null ? null : num(r.lowAmount),
    highAmount: r.highAmount == null ? null : num(r.highAmount),
    revenueBase: r.revenueBase == null ? null : num(r.revenueBase),
    ratioUsed: r.ratioUsed == null ? null : num(r.ratioUsed),
    cashMonth: r.cashMonth,
    methodology: r.methodology,
    overdueAmount: (r.details as { overdueAmount?: number } | null)?.overdueAmount ?? null,
  };
}

export async function getFiscal360Forecast(
  db: Db,
  f: Fiscal360Filters,
  scenarioId: string | null,
  now = new Date()
): Promise<Fiscal360ForecastResponse> {
  const scenarios = await db.fiscalForecastScenario.findMany({ where: { status: "ACTIVE" }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
  const base = scenarios.find((s) => s.systemKey === "BASE") ?? null;
  const selected = (scenarioId ? scenarios.find((s) => s.id === scenarioId) : null) ?? base ?? scenarios[0] ?? null;
  const companies = companyWhere(f);
  const load = async (id: string) =>
    (
      await db.fiscalForecastSnapshot.findMany({
        where: { scenarioId: id, companyCnpj: { in: companies }, ...(f.taxType ? { taxType: f.taxType } : {}) },
        orderBy: [{ month: "asc" }, { taxType: "asc" }],
      })
    ).map(forecastRowDto);
  const rows = selected ? await load(selected.id) : [];
  const baseRows = base && selected && base.id !== selected.id ? await load(base.id) : rows;
  const referenceMonth = now.toISOString().slice(0, 7);
  const horizon = Array.from({ length: selected?.horizonMonths ?? 6 }, (_, i) => addFiscal360Months(referenceMonth, i));
  const asForecast = (list: Fiscal360ForecastRowDto[]) => list.map((r) => ({ ...r, details: null }) as unknown as ForecastRow);
  const lastSnapshot = await db.fiscalMonthlySnapshot.findFirst({ orderBy: { computedAt: "desc" }, select: { computedAt: true } });
  const stale = Boolean(
    selected && (!selected.computedAt || (lastSnapshot && selected.computedAt < lastSnapshot.computedAt) || selected.computedAt.toISOString().slice(0, 7) !== referenceMonth)
  );
  return {
    scenarios: scenarios.map(scenarioDto),
    selected: selected ? scenarioDto(selected) : null,
    rows,
    horizon,
    effects: selected ? summarizeFiscal360Forecast(asForecast(rows), horizon) : null,
    baseEffects: base ? summarizeFiscal360Forecast(asForecast(baseRows), horizon) : null,
    stale,
    methodologyDoc: "docs/finance/fiscal-intelligence-360-forecast.md",
  };
}

// ————————————————————————————————————————————— Processamento, qualidade e auditoria

export async function getFiscal360Processing(db: Db, now = new Date()): Promise<Fiscal360ProcessingResponse> {
  const [freshness, runs, jobsByStatus, failed, checkpoints, ruleRows] = await Promise.all([
    getFiscal360Freshness(db, now),
    db.fiscalProcessingRun.findMany({ orderBy: { startedAt: "desc" }, take: 20 }),
    db.fiscalProcessingJob.groupBy({ by: ["jobType", "status"], where: { createdAt: { gte: new Date(now.getTime() - 7 * 86_400_000) } }, _count: { _all: true } }),
    db.fiscalProcessingJob.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 50 }),
    db.fiscalProcessingCheckpoint.findMany({ orderBy: { key: "asc" } }),
    db.fiscalRuleVersion.findMany({ where: { status: { in: ["ACTIVE", "DRAFT"] } }, orderBy: [{ ruleKey: "asc" }, { version: "desc" }], take: 50 }),
  ]);
  const integritySource = (runs.find((r) => r.discovered && (r.discovered as Record<string, unknown>).integrity)?.discovered as Record<string, unknown> | undefined)?.integrity as
    | Record<string, number>
    | undefined;
  const integrity = integritySource
    ? [
        { label: "NF-e espelho × fatos de documento", source: integritySource.nfeSource ?? 0, materialized: integritySource.documentFacts ?? 0 },
        { label: "Títulos AP × fatos AP", source: integritySource.apSource ?? 0, materialized: integritySource.apFacts ?? 0 },
        { label: "Guias × obrigações ancoradas em guia", source: integritySource.guideSource ?? 0, materialized: integritySource.guideFacts ?? 0 },
      ].map((i) => ({ ...i, ok: i.source === i.materialized }))
    : [];
  return {
    freshness,
    runs: runs.map((r) => ({
      id: r.id,
      trigger: r.trigger,
      status: r.status,
      startedAt: r.startedAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      durationMs: r.durationMs,
      jobsSucceeded: r.jobsSucceeded,
      jobsFailed: r.jobsFailed,
      documentsNew: r.documentsNew,
      documentsChanged: r.documentsChanged,
      apTitlesChanged: r.apTitlesChanged,
      guidesChanged: r.guidesChanged,
      partitionsRebuilt: r.partitionsRebuilt,
      monthsAffected: r.monthsAffected,
      integrity: ((r.discovered as Record<string, unknown> | null)?.integrity as Record<string, number> | undefined) ?? null,
    })),
    jobsByStatus: jobsByStatus.map((j) => ({ jobType: j.jobType, status: j.status, count: j._count._all })),
    failedJobs: failed.map((j) => ({ id: j.id, jobType: j.jobType, sourceEntity: j.sourceEntity, sourceId: j.sourceId, attempts: j.attempts, lastError: j.lastError, updatedAt: j.updatedAt.toISOString() })),
    checkpoints: checkpoints.map((c) => ({ key: c.key, cursorUpdatedAt: iso(c.cursorUpdatedAt), lastRunAt: iso(c.lastRunAt), lastSuccessAt: iso(c.lastSuccessAt) })),
    ruleVersions: [
      ...Object.entries(FISCAL360_RULE_VERSIONS).map(([key, version]) => ({ key, version, source: "CODE" as const })),
      ...ruleRows.map((r) => ({ key: r.ruleKey, version: `v${r.version}`, source: "CONFIG" as const, status: r.status, effectiveFrom: isoDate(r.effectiveFrom), normativeSource: r.normativeSource })),
    ],
    integrity,
  };
}

function issueRow(i: Awaited<ReturnType<Db["fiscalDataQualityIssue"]["findMany"]>>[number]): Fiscal360IssueRow {
  return {
    id: i.id,
    issueType: i.issueType,
    severity: i.severity,
    entityType: i.entityType,
    entityId: i.entityId,
    companyCnpj: i.companyCnpj,
    competenceMonth: i.competenceMonth,
    taxType: i.taxType,
    message: i.message,
    status: i.status,
    firstDetectedAt: i.firstDetectedAt.toISOString(),
    lastDetectedAt: i.lastDetectedAt.toISOString(),
    resolvedAt: iso(i.resolvedAt),
  };
}

export async function listFiscal360Issues(
  db: Db,
  f: Fiscal360Filters,
  page: { page: number; pageSize: number },
  opts: { issueType: string | null; issueStatus: string | null }
): Promise<Fiscal360Page<Fiscal360IssueRow> & { summary: Array<{ issueType: string; severity: string; count: number }> }> {
  if (opts.issueType && !ALLOWED_TOKEN.test(opts.issueType)) throw new Fiscal360InputError("Tipo de pendência inválido.");
  const status = opts.issueStatus && ["OPEN", "RESOLVED", "ACKNOWLEDGED"].includes(opts.issueStatus) ? opts.issueStatus : "OPEN";
  const base: Prisma.FiscalDataQualityIssueWhereInput = {
    status,
    OR: [
      { companyCnpj: { in: [...companyWhere(f), FISCAL360_UNKNOWN_COMPANY] }, competenceMonth: { gte: f.fromMonth, lte: f.toMonth } },
      { companyCnpj: null },
    ],
    ...(f.taxType ? { taxType: f.taxType } : {}),
  };
  const where = { ...base, ...(opts.issueType ? { issueType: opts.issueType } : {}) };
  const [rows, total, summary] = await Promise.all([
    db.fiscalDataQualityIssue.findMany({ where, orderBy: [{ severity: "asc" }, { lastDetectedAt: "desc" }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalDataQualityIssue.count({ where }),
    db.fiscalDataQualityIssue.groupBy({ by: ["issueType", "severity"], where: base, _count: { _all: true } }),
  ]);
  return {
    rows: rows.map(issueRow),
    page: page.page,
    pageSize: page.pageSize,
    total,
    summary: summary.map((s) => ({ issueType: s.issueType, severity: s.severity, count: s._count._all })),
  };
}

export const FISCAL360_AUDIT_ENTITY_TYPES = [
  "Fiscal360Decision",
  "Fiscal360ApClassification",
  "Fiscal360Reprocess",
  "Fiscal360RuleVersion",
  "Fiscal360Scenario",
  "Fiscal360Job",
] as const;

export async function listFiscal360Audit(db: Db, page: { page: number; pageSize: number }, entityType: string | null): Promise<Fiscal360Page<Fiscal360AuditRow>> {
  const types = entityType && (FISCAL360_AUDIT_ENTITY_TYPES as readonly string[]).includes(entityType) ? [entityType] : [...FISCAL360_AUDIT_ENTITY_TYPES];
  const where = { entityType: { in: types } };
  const [rows, total] = await Promise.all([
    db.fiscalSettlementAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalSettlementAuditLog.count({ where }),
  ]);
  return {
    rows: rows.map((a) => ({ id: a.id, entityType: a.entityType, entityId: a.entityId, action: a.action, userName: a.userName, createdAt: a.createdAt.toISOString(), before: a.beforeJson, after: a.afterJson })),
    page: page.page,
    pageSize: page.pageSize,
    total,
  };
}

export async function listFiscal360Decisions(db: Db, page: { page: number; pageSize: number }, activeOnly: boolean): Promise<Fiscal360Page<Fiscal360DecisionRow>> {
  const where = activeOnly ? { active: true } : {};
  const [rows, total] = await Promise.all([
    db.fiscalReconciliationDecision.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    db.fiscalReconciliationDecision.count({ where }),
  ]);
  return { rows: rows.map(decisionRow), page: page.page, pageSize: page.pageSize, total };
}
