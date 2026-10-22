/**
 * Visão 360° de Comissões — regras puras de agregação e conciliação (sem Prisma, sem I/O).
 *
 * Não existe aqui fórmula concorrente de comissão. Cada número vem de uma fonte oficial:
 * - comissão do pedido: CommissionOrderSnapshot / CommissionOrderItemSnapshot (já calculada);
 * - realizado, liberado e previsto por título: linhas do motor da Previsão
 *   (projectCommissionPortfolioOutlookLines), recebidas prontas do loader;
 * - liberado oficial: linhas de ledger de fechamentos CLOSED;
 * - pago: itens de lotes PAID.
 * Os únicos cálculos locais são somas, filtros, a proporção de quantidade não faturada
 * do PV (computeQuantityProportionalAmount, helper oficial do FIN) e a simulação em
 * memória do rateio do scheduler oficial para títulos SEM schedule (potencial não confirmado).
 */
import { Prisma } from "@prisma/client";
import {
  computeCommissionReleasedFromReceivablePrincipal,
  roundMoney,
} from "./commission-money.shared.js";
import {
  COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH,
  formatCommissionYearMonthKey,
  isCompetenceOfficialInIndusCost,
  resolveReceiptCutoverPeriod,
} from "./commissionCoverageCutover.js";
import { CommissionQueryParseError } from "./commissionQuery.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH,
  type OutlookLine,
  type OutlookReceiptEvent,
} from "./commissionPortfolioOutlook.js";
import { buildCommissionReceivableScheduleDrafts } from "./commissionReceivableScheduler.js";
import { resolveUniqueSalesOrderFromNfeLinkCandidates } from "./commissionSalesOrderNfeLinkResolution.js";
import { isCommissionSnapshotActive } from "./commissionScheduleVigency.js";
import { computeQuantityProportionalAmount } from "@/src/lib/finance/salesOrderItemFinancialAmounts.js";
import {
  COMMISSION_360_CR_STATUS_META,
  COMMISSION_360_DESCRIPTION,
  COMMISSION_360_DIAGNOSTIC_MONTHS,
  COMMISSION_360_READ_ONLY_NOTE,
  COMMISSION_360_SECTIONS,
  COMMISSION_360_SOURCES,
  COMMISSION_360_TITLE,
  commission360MonthLabel,
  type Commission360Cards,
  type Commission360CrRow,
  type Commission360CrStatus,
  type Commission360DiagnosticColumn,
  type Commission360ForecastRow,
  type Commission360LegacyRow,
  type Commission360Month,
  type Commission360Payload,
  type Commission360PaymentRow,
  type Commission360PotentialItemRow,
  type Commission360PotentialOrderRow,
  type Commission360PotentialStatus,
  type Commission360RealizedRow,
  type Commission360ReconciliationFunnel,
  type Commission360ReleasedRow,
  type Commission360Section,
  type Commission360SellerRow,
  type Commission360UnmatchedPaymentRow,
  type Commission360LegacySection,
  type Commission360SeriesInfo,
  COMMISSION_360_LEGACY_SECTION_NOTE,
  COMMISSION_360_LEGACY_SECTION_TITLE,
} from "./commission360View.shared.js";

// ---------------------------------------------------------------------------
// Corte temporal oficial (regras de commissionCoverageCutover, reaproveitadas)
// ---------------------------------------------------------------------------

/**
 * Série principal = só comissão do motor oficial IndusCost:
 * - histórico oficial (pago, realizado, liberado) a partir do cutover 10/2026;
 * - previsão a partir do marco da Previsão 09/2026 (vencimento dos CRs em aberto).
 * Até 30/09/2026 o Nomus é a fonte (espelho técnico): nada disso entra na série.
 */
export const COMMISSION_360_SERIES: Commission360SeriesInfo = {
  officialStartMonth: formatCommissionYearMonthKey(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH),
  forecastStartMonth: COMMISSION_PORTFOLIO_OUTLOOK_FIRST_MONTH,
  note:
    "A série principal mostra só o motor oficial do IndusCost: realizado e pago a partir de 10/2026 " +
    "(competência natural = data do recebimento) e previsão a partir de 09/2026 (vencimento). " +
    "Histórico do Nomus e ajustes retroativos ficam em Histórico legado / Ajustes retroativos.",
};

export type Commission360ReceiptSeriesClass = "OFICIAL" | "LEGADO_NOMUS" | "LEGADO_PRE_CORTE" | "AJUSTE_MANUAL";

/**
 * Recebimento na série oficial? A competência é a NATURAL (receiptDate); a data do fechamento,
 * do pagamento ou a baixa (settlementDate) nunca deslocam o valor de mês.
 * - coberto por relatório Nomus (NOMUS_LEGACY) → legado, mesmo que a data seja pós-corte;
 * - receiptDate antes de 01/10/2026 (resolveReceiptCutoverPeriod) → legado, mesmo que fechado
 *   depois no IndusCost (LEGACY_CARRYOVER);
 * - coberto por ajuste manual → ajuste, fora da série operacional;
 * - demais → oficial, no mês do receiptDate.
 */
export function classifyCommission360Receipt(
  receipt: Pick<OutlookReceiptEvent, "receiptDate" | "coverageSource">
): Commission360ReceiptSeriesClass {
  if (receipt.coverageSource === "NOMUS_LEGACY") return "LEGADO_NOMUS";
  if (resolveReceiptCutoverPeriod(receipt.receiptDate) !== "POST_CUTOVER") return "LEGADO_PRE_CORTE";
  if (receipt.coverageSource === "MANUAL_ADJUSTMENT") return "AJUSTE_MANUAL";
  return "OFICIAL";
}

/**
 * Lote pago na série oficial só quando sua competência (período do lote) é inteiramente
 * oficial. Lote de competência legada pago depois do corte continua legado; lote cujo período
 * atravessa o corte não é dividido (sem vínculo para isso).
 */
export function classifyCommission360BatchCompetence(
  batch: Pick<Commission360BatchInput, "periodStart" | "periodEnd">
): { official: boolean; reason: string | null } {
  const start = batch.periodStart.slice(0, 7);
  const end = batch.periodEnd.slice(0, 7);
  const cutover = COMMISSION_360_SERIES.officialStartMonth;
  if (start >= cutover) return { official: true, reason: null };
  if (end < cutover) return { official: false, reason: "Lote de competência anterior ao fechamento oficial (até 09/2026)." };
  return { official: false, reason: "Período do lote atravessa o corte de 01/10/2026: não é dividido entre legado e oficial." };
}

const CUTOVER_MONTH = formatCommissionYearMonthKey(COMMISSION_OFFICIAL_CUTOVER_YEAR_MONTH);
const MAX_RANGE_MONTHS = 36;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export type Commission360Query = {
  fromMonth: string;
  toMonth: string;
  canonicalSellerId: string | null;
  customer: string | null;
  orderCode: string | null;
  section: Commission360Section;
  crStatus: Commission360CrStatus | null;
  page: number;
  pageSize: number;
  sellerLocked: boolean;
  /** Vendedor Nomus do usuário quando o escopo é próprio. */
  ownNomusSellerId: number | null;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function addCommission360Months(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7)) - 1 + delta;
  const date = new Date(Date.UTC(year, mon, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthSpan(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Validação de entrada. Período padrão: 12 meses para trás e 12 para frente.
 * Vendedor de escopo próprio nunca escolhe outro vendedor (sellerId é ignorado).
 */
export function parseCommission360Query(
  raw: Record<string, unknown>,
  scope: Pick<CommissionAccessScope, "dataScope" | "nomusSellerId">,
  today: string
): Commission360Query {
  const todayMonth = today.slice(0, 7);
  const fromRaw = text(raw.from);
  const toRaw = text(raw.to);
  if (fromRaw && !MONTH_RE.test(fromRaw)) throw new CommissionQueryParseError("Período inicial inválido (use AAAA-MM).");
  if (toRaw && !MONTH_RE.test(toRaw)) throw new CommissionQueryParseError("Período final inválido (use AAAA-MM).");
  const fromMonth = fromRaw ?? addCommission360Months(todayMonth, -11);
  const toMonth = toRaw ?? addCommission360Months(todayMonth, 12);
  if (fromMonth > toMonth) throw new CommissionQueryParseError("O período inicial é posterior ao final.");
  if (monthSpan(fromMonth, toMonth) > MAX_RANGE_MONTHS) {
    throw new CommissionQueryParseError(`Período máximo de ${MAX_RANGE_MONTHS} meses.`);
  }
  const sellerRaw = text(raw.sellerId);
  if (sellerRaw && sellerRaw !== "all" && !UUID_RE.test(sellerRaw)) {
    throw new CommissionQueryParseError("Vendedor inválido.");
  }
  const sectionRaw = text(raw.section) ?? "reconciliation";
  const section = COMMISSION_360_SECTIONS.find((row) => row.id === sectionRaw)?.id;
  if (!section) throw new CommissionQueryParseError("Seção inválida.");
  const crStatusRaw = text(raw.crStatus);
  if (crStatusRaw && crStatusRaw !== "all" && !(crStatusRaw in COMMISSION_360_CR_STATUS_META)) {
    throw new CommissionQueryParseError("Classificação de CR inválida.");
  }
  const own = scope.dataScope === "own";
  return {
    fromMonth,
    toMonth,
    canonicalSellerId: own || !sellerRaw || sellerRaw === "all" ? null : sellerRaw,
    customer: text(raw.customer),
    orderCode: text(raw.orderCode),
    section,
    crStatus: crStatusRaw && crStatusRaw !== "all" ? (crStatusRaw as Commission360CrStatus) : null,
    page: Math.max(1, Math.floor(Number(raw.page)) || 1),
    pageSize: Math.min(200, Math.max(1, Math.floor(Number(raw.pageSize)) || 50)),
    sellerLocked: own,
    ownNomusSellerId: own ? scope.nomusSellerId : null,
  };
}

function inRange(month: string | null, query: Pick<Commission360Query, "fromMonth" | "toMonth">): boolean {
  return month != null && month >= query.fromMonth && month <= query.toMonth;
}

function includesText(value: string | null | undefined, needle: string | null): boolean {
  if (!needle) return true;
  return (value ?? "").toLocaleLowerCase("pt-BR").includes(needle.toLocaleLowerCase("pt-BR"));
}

function sellerKeyOf(canonicalSellerId: string | null, rawSellerId: number | null | undefined): string {
  if (canonicalSellerId) return canonicalSellerId;
  if (rawSellerId != null) return `raw:${rawSellerId}`;
  return "sem-vendedor";
}

// ---------------------------------------------------------------------------
// A — Pagamentos efetivos
// ---------------------------------------------------------------------------

export type Commission360BatchInput = {
  batchId: string;
  status: string;
  /** Dia civil do pagamento (paymentDate do lote). */
  paymentDate: string | null;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  sellerName: string;
  totalPaid: number;
  items: Array<{ itemId: string; status: string; amountPaid: number; receivableId: number | null; commissionRecordId?: string | null }>;
};

export type Commission360LegacyCoverageInput = {
  coverageId: string;
  coverageSource: string;
  coverageStatus: string;
  receiptExternalId: number | null;
  receivableId: number;
  coveredYear: number | null;
  coveredMonth: number | null;
  coveredCommissionAmount: number | null;
  legacyImportId: string | null;
};

export type Commission360PaidResult = {
  payments: Commission360PaymentRow[];
  legacy: Commission360LegacyRow[];
  confirmedByMonth: Map<string, { amount: number; count: number }>;
  legacyByMonth: Map<string, number>;
  confirmedBySeller: Map<string, { name: string; amount: number }>;
  legacyBySeller: Map<string, { name: string; amount: number }>;
  anomalies: string[];
};

/**
 * Política de prevalência (sem dupla contagem):
 * 1. Lote PAID com data de pagamento = pagamento confirmado (único valor "pago").
 * 2. Relatório Nomus importado (NOMUS_LEGACY COVERED) = histórico legado, mostrado à parte
 *    e nunca somado ao pago; se o mesmo título já está num lote pago, o lote prevalece.
 * 3. Cobertura INDUSCOST_CLOSING = liberação (fechamento), não pagamento.
 * Cada item de lote e cada cobertura entram uma única vez (dedupe por id e por recebimento).
 */
export function buildCommission360Paid(input: {
  batches: readonly Commission360BatchInput[];
  legacyCoverages: readonly Commission360LegacyCoverageInput[];
  sellerByReceivable: ReadonlyMap<number, { key: string; name: string }>;
}): Commission360PaidResult {
  const payments: Commission360PaymentRow[] = [];
  const confirmedByMonth = new Map<string, { amount: number; count: number }>();
  const confirmedBySeller = new Map<string, { name: string; amount: number }>();
  const anomalies: string[] = [];
  const seenItems = new Set<string>();
  const seenBatches = new Set<string>();
  const paidReceivables = new Set<number>();

  for (const batch of input.batches) {
    if (batch.status !== "PAID" || seenBatches.has(batch.batchId)) continue;
    seenBatches.add(batch.batchId);
    let amount = 0;
    let itemCount = 0;
    for (const item of batch.items) {
      if (item.status !== "PAID" || seenItems.has(item.itemId)) continue;
      seenItems.add(item.itemId);
      const paid = roundMoney(Math.max(0, item.amountPaid));
      if (paid <= 0) continue;
      amount = roundMoney(amount + paid);
      itemCount += 1;
      if (item.receivableId != null) paidReceivables.add(item.receivableId);
    }
    const month = batch.paymentDate ? batch.paymentDate.slice(0, 7) : null;
    const notes: string[] = [];
    if (!batch.paymentDate) notes.push("Lote PAID sem data de pagamento: fora da evolução mensal.");
    if (Math.abs(roundMoney(batch.totalPaid) - amount) > 0.01) {
      notes.push(`Total do lote (${batch.totalPaid.toFixed(2)}) difere da soma dos itens pagos (${amount.toFixed(2)}); vale a soma dos itens.`);
    }
    if (notes.length > 0) anomalies.push(`Lote ${batch.batchId}: ${notes.join(" ")}`);
    payments.push({
      batchId: batch.batchId,
      paymentDate: batch.paymentDate,
      month,
      sellerKey: batch.commissionPersonId,
      sellerName: batch.sellerName,
      itemCount,
      amountPaid: amount,
      source: "LOTE_INDUSCOST_PAGO",
      notes: notes.length > 0 ? notes.join(" ") : null,
    });
    if (!month) continue;
    const bucket = confirmedByMonth.get(month) ?? { amount: 0, count: 0 };
    bucket.amount = roundMoney(bucket.amount + amount);
    bucket.count += 1;
    confirmedByMonth.set(month, bucket);
    const seller = confirmedBySeller.get(batch.commissionPersonId) ?? { name: batch.sellerName, amount: 0 };
    seller.amount = roundMoney(seller.amount + amount);
    confirmedBySeller.set(batch.commissionPersonId, seller);
  }

  const legacy: Commission360LegacyRow[] = [];
  const legacyByMonth = new Map<string, number>();
  const legacyBySeller = new Map<string, { name: string; amount: number }>();
  const seenCoverage = new Set<string>();
  const seenReceipt = new Set<number>();
  for (const row of input.legacyCoverages) {
    if (row.coverageSource !== "NOMUS_LEGACY" || row.coverageStatus !== "COVERED") continue;
    if (seenCoverage.has(row.coverageId)) continue;
    seenCoverage.add(row.coverageId);
    if (row.receiptExternalId != null) {
      if (seenReceipt.has(row.receiptExternalId)) continue;
      seenReceipt.add(row.receiptExternalId);
    }
    const competence =
      row.coveredYear != null && row.coveredMonth != null
        ? `${row.coveredYear}-${String(row.coveredMonth).padStart(2, "0")}`
        : null;
    const seller = input.sellerByReceivable.get(row.receivableId) ?? { key: "sem-vendedor", name: "Sem vendedor identificado" };
    const superseded = paidReceivables.has(row.receivableId);
    legacy.push({
      coverageId: row.coverageId,
      receiptExternalId: row.receiptExternalId,
      receivableId: row.receivableId,
      competence,
      sellerKey: seller.key,
      sellerName: seller.name,
      coveredCommissionAmount: row.coveredCommissionAmount == null ? null : roundMoney(row.coveredCommissionAmount),
      legacyImportId: row.legacyImportId,
      supersededByConfirmedPayment: superseded,
    });
    if (superseded || row.coveredCommissionAmount == null || !competence) continue;
    legacyByMonth.set(competence, roundMoney((legacyByMonth.get(competence) ?? 0) + row.coveredCommissionAmount));
    const bucket = legacyBySeller.get(seller.key) ?? { name: seller.name, amount: 0 };
    bucket.amount = roundMoney(bucket.amount + row.coveredCommissionAmount);
    legacyBySeller.set(seller.key, bucket);
  }

  return { payments, legacy, confirmedByMonth, legacyByMonth, confirmedBySeller, legacyBySeller, anomalies };
}

// ---------------------------------------------------------------------------
// B2 — Liberada (fechamento oficial) e ainda não paga
// ---------------------------------------------------------------------------

export type Commission360LedgerLineInput = {
  lineId: string;
  closingId: string;
  closingStatus: string;
  year: number;
  month: number;
  canonicalSellerId: string | null;
  rawSellerId: number | null;
  sellerName: string;
  releasedCommissionAmount: number;
  /** CommissionRecord da linha (só no caminho legado do motor; nulo nas linhas vindas de schedule). */
  commissionRecordId: string | null;
  /** NORMAL | LATE_CARRYOVER | LEGACY_CARRYOVER | MANUAL_ADJUSTMENT (ausente = NORMAL). */
  inclusionType?: string | null;
  /** Competência natural (mês do receiptDate); ausente = competência do fechamento. */
  naturalYear?: number | null;
  naturalMonth?: number | null;
};

/** Quanto de cada lote PAID pagou comissão operacional, ajuste retroativo ou não é atribuível. */
export type Commission360BatchAttribution = { operational: number; adjustment: number; unattributed: number };

export type Commission360ReleasedResult = {
  rows: Commission360ReleasedRow[];
  unmatchedPayments: Commission360UnmatchedPaymentRow[];
  batchAttribution: Map<string, Commission360BatchAttribution>;
};

const MONEY_TOLERANCE = 0.01;

/**
 * Linha de fechamento oficial que integra a série operacional: incluída como NORMAL ou
 * LATE_CARRYOVER (recebimento pós-cutover fechado depois) e com competência natural no período
 * oficial. LEGACY_CARRYOVER (natural < 10/2026), MANUAL_ADJUSTMENT e qualquer natural anterior
 * ao cutover são ajustes retroativos: ficam fora da série, sem alterar o fechamento.
 */
export function isCommission360OperationalLedgerLine(
  line: Pick<Commission360LedgerLineInput, "year" | "month" | "inclusionType" | "naturalYear" | "naturalMonth">
): boolean {
  const inclusion = line.inclusionType ?? "NORMAL";
  if (inclusion !== "NORMAL" && inclusion !== "LATE_CARRYOVER") return false;
  const naturalYear = line.naturalYear ?? line.year;
  const naturalMonth = line.naturalMonth ?? line.month;
  return isCompetenceOfficialInIndusCost(naturalYear, naturalMonth);
}

/**
 * Liberada (fechamento CLOSED a partir do cutover) × pagamentos em lote.
 *
 * O lote não aponta a linha do fechamento: seus itens apontam CommissionRecord, e as linhas
 * de fechamento vindas de schedule não têm CommissionRecord. Por isso só há duas evidências
 * aceitas, nesta ordem, e nenhuma atribuição por aproximação:
 * 1. LINHA — item do lote com o mesmo CommissionRecord de uma linha do fechamento;
 * 2. COMPETENCIA_EXATA — lote do mesmo vendedor cujo período está inteiro num único mês,
 *    e esse mês tem exatamente um fechamento CLOSED do vendedor.
 * Lote sem evidência (período em mais de um mês, competência anterior ao cutover, sem
 * fechamento do vendedor no mês) fica em `unmatchedPayments` e não abate nada; a liberada
 * do mesmo vendedor nas competências que o lote cobre vira NAO_CONCILIADO, não "não paga".
 * REPROCESSED e CANCELLED nunca contam (o novo CLOSED da mesma competência substitui).
 */
export function buildCommission360ReleasedNotPaid(input: {
  ledgerLines: readonly Commission360LedgerLineInput[];
  batches: readonly Commission360BatchInput[];
}): Commission360ReleasedResult {
  const rows = new Map<string, Commission360ReleasedRow>();
  const rowByRecord = new Map<string, { row: Commission360ReleasedRow; operational: boolean }>();
  const closingsOfRow = new Map<Commission360ReleasedRow, Set<string>>();
  const paidByLineKind = new Map<Commission360ReleasedRow, { operational: number; adjustment: number }>();
  const seenLines = new Set<string>();
  for (const line of input.ledgerLines) {
    if (line.closingStatus !== "CLOSED" || seenLines.has(line.lineId)) continue;
    seenLines.add(line.lineId);
    const competence = `${line.year}-${String(line.month).padStart(2, "0")}`;
    if (competence < CUTOVER_MONTH) continue;
    const sellerKey = sellerKeyOf(line.canonicalSellerId, line.rawSellerId);
    const key = `${competence}|${sellerKey}`;
    const row = rows.get(key) ?? {
      key,
      competence,
      sellerKey,
      canonicalSellerId: line.canonicalSellerId,
      sellerName: line.sellerName,
      closingId: line.closingId,
      released: 0,
      releasedOperational: 0,
      releasedAdjustment: 0,
      adjustmentNotPaid: 0,
      paidByLine: 0,
      paidByCompetence: 0,
      paid: 0,
      releasedNotPaid: 0,
      unreconciledAmount: 0,
      overpaidAmount: 0,
      status: "NAO_PAGO",
      matchedBatchIds: [],
      candidateBatchIds: [],
    };
    const amount = Math.max(0, line.releasedCommissionAmount);
    const operational = isCommission360OperationalLedgerLine(line);
    row.released = roundMoney(row.released + amount);
    if (operational) row.releasedOperational = roundMoney(row.releasedOperational + amount);
    else row.releasedAdjustment = roundMoney(row.releasedAdjustment + amount);
    rows.set(key, row);
    closingsOfRow.set(row, (closingsOfRow.get(row) ?? new Set<string>()).add(line.closingId));
    if (line.commissionRecordId) rowByRecord.set(line.commissionRecordId, { row, operational });
  }
  const ordered = [...rows.values()].sort((a, b) => (a.competence < b.competence ? -1 : a.competence > b.competence ? 1 : 0));

  const unmatchedPayments: Commission360UnmatchedPaymentRow[] = [];
  const seenBatches = new Set<string>();
  const seenItems = new Set<string>();
  // Rastreio por lote para separar depois o que ele pagou de operacional × ajuste retroativo.
  const traces: Array<{
    batchId: string;
    lineOperational: number;
    lineAdjustment: number;
    remaining: number;
    target: Commission360ReleasedRow | null;
    candidates: Commission360ReleasedRow[];
  }> = [];
  const competenceBatches = new Map<Commission360ReleasedRow, string[]>();
  for (const batch of input.batches) {
    if (batch.status !== "PAID" || seenBatches.has(batch.batchId)) continue;
    seenBatches.add(batch.batchId);
    const trace = { batchId: batch.batchId, lineOperational: 0, lineAdjustment: 0, remaining: 0, target: null as Commission360ReleasedRow | null, candidates: [] as Commission360ReleasedRow[] };
    traces.push(trace);
    let remaining = 0;
    for (const item of batch.items) {
      if (item.status !== "PAID" || seenItems.has(item.itemId)) continue;
      seenItems.add(item.itemId);
      const amount = roundMoney(Math.max(0, item.amountPaid));
      const linked = item.commissionRecordId ? rowByRecord.get(item.commissionRecordId) : undefined;
      if (linked) {
        linked.row.paidByLine = roundMoney(linked.row.paidByLine + amount);
        const kinds = paidByLineKind.get(linked.row) ?? { operational: 0, adjustment: 0 };
        if (linked.operational) kinds.operational = roundMoney(kinds.operational + amount);
        else kinds.adjustment = roundMoney(kinds.adjustment + amount);
        paidByLineKind.set(linked.row, kinds);
        if (linked.operational) trace.lineOperational = roundMoney(trace.lineOperational + amount);
        else trace.lineAdjustment = roundMoney(trace.lineAdjustment + amount);
        if (!linked.row.matchedBatchIds.includes(batch.batchId)) linked.row.matchedBatchIds.push(batch.batchId);
      } else {
        remaining = roundMoney(remaining + amount);
      }
    }
    trace.remaining = remaining;
    if (remaining <= 0) continue;
    const startMonth = batch.periodStart.slice(0, 7);
    const endMonth = batch.periodEnd.slice(0, 7);
    const sameSeller = ordered.filter((row) => row.canonicalSellerId === batch.commissionPersonId);
    const exact = startMonth === endMonth ? sameSeller.filter((row) => row.competence === startMonth) : [];
    // Dois fechamentos CLOSED distintos na mesma competência (o índice parcial deveria impedir) = ambíguo.
    if (exact.length === 1 && closingsOfRow.get(exact[0]!)!.size === 1) {
      exact[0]!.paidByCompetence = roundMoney(exact[0]!.paidByCompetence + remaining);
      exact[0]!.matchedBatchIds.push(batch.batchId);
      trace.target = exact[0]!;
      competenceBatches.set(exact[0]!, [...(competenceBatches.get(exact[0]!) ?? []), batch.batchId]);
      continue;
    }
    trace.candidates = sameSeller.filter((row) => row.competence >= startMonth && row.competence <= endMonth);
    const reason =
      startMonth !== endMonth
        ? `Período do lote (${batch.periodStart} a ${batch.periodEnd}) cobre mais de uma competência: não há vínculo para dividir o pagamento.`
        : endMonth < CUTOVER_MONTH
          ? "Lote de competência anterior ao fechamento oficial do IndusCost (histórico Nomus)."
          : exact.length === 1
            ? "Há mais de um fechamento CLOSED do vendedor na competência: o pagamento não é atribuído."
            : "Não há fechamento CLOSED do vendedor na competência do lote.";
    unmatchedPayments.push({
      batchId: batch.batchId,
      sellerKey: batch.commissionPersonId,
      sellerName: batch.sellerName,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      paymentDate: batch.paymentDate,
      amount: remaining,
      reason,
    });
    // A liberada do vendedor nas competências que o lote cobre deixa de ser "não paga":
    // pode ter sido paga por este lote, sem prova. Fica não conciliada.
    for (const row of sameSeller) {
      if (row.competence >= startMonth && row.competence <= endMonth) row.candidateBatchIds.push(batch.batchId);
    }
  }

  for (const row of ordered) {
    row.paid = roundMoney(row.paidByLine + row.paidByCompetence);
    const unpaid = roundMoney(Math.max(0, row.released - row.paid));
    row.overpaidAmount = roundMoney(Math.max(0, row.paid - row.released));
    if (row.overpaidAmount > MONEY_TOLERANCE) row.status = "PAGO_ACIMA_DO_LIBERADO";
    else if (unpaid <= MONEY_TOLERANCE) row.status = "PAGO";
    else if (row.candidateBatchIds.length > 0) row.status = "NAO_CONCILIADO";
    else if (row.paid > 0) row.status = "PAGO_PARCIAL";
    else row.status = "NAO_PAGO";
    row.unreconciledAmount = row.status === "NAO_CONCILIADO" ? unpaid : 0;
    row.releasedNotPaid = 0;
    row.adjustmentNotPaid = 0;
    if (row.status !== "NAO_PAGO" && row.status !== "PAGO_PARCIAL") continue;
    // Não paga: separar operacional × ajuste retroativo só quando o pagamento é atribuível.
    const byLine = paidByLineKind.get(row) ?? { operational: 0, adjustment: 0 };
    const unattributedPaid = roundMoney(row.paid - byLine.operational - byLine.adjustment);
    const opUnpaid = roundMoney(Math.max(0, row.releasedOperational - byLine.operational));
    const adjUnpaid = roundMoney(Math.max(0, row.releasedAdjustment - byLine.adjustment));
    if (unattributedPaid <= MONEY_TOLERANCE || adjUnpaid <= MONEY_TOLERANCE || opUnpaid <= MONEY_TOLERANCE) {
      // Sem pagamento por competência, ou só uma das partes ainda em aberto: atribuição sem ambiguidade.
      const remainingPaid = Math.max(0, unattributedPaid);
      row.releasedNotPaid = adjUnpaid <= MONEY_TOLERANCE ? roundMoney(Math.max(0, opUnpaid - remainingPaid)) : opUnpaid;
      row.adjustmentNotPaid = opUnpaid <= MONEY_TOLERANCE ? roundMoney(Math.max(0, adjUnpaid - remainingPaid)) : adjUnpaid;
    } else {
      // Pagamento parcial por competência sobre liberada operacional + ajuste: não há como saber
      // qual parte foi paga. Não é atribuído a nenhuma das duas.
      row.unreconciledAmount = unpaid;
    }
  }

  // O que cada lote pagou. Só há divisão com evidência exata; lote que paga fechamento com
  // parte operacional E ajuste retroativo, sem como separar, fica inteiro "não atribuível".
  const batchAttribution = new Map<string, Commission360BatchAttribution>();
  // Saldo de cada fechamento ainda não explicado por pagamento por linha; consumido lote a lote.
  const capacity = new Map<Commission360ReleasedRow, { operational: number; adjustment: number }>();
  for (const trace of traces) {
    const result = { operational: trace.lineOperational, adjustment: trace.lineAdjustment, unattributed: 0 };
    const remaining = trace.remaining;
    if (remaining > 0) {
      const row = trace.target;
      if (row) {
        if (!capacity.has(row)) {
          const byLine = paidByLineKind.get(row) ?? { operational: 0, adjustment: 0 };
          capacity.set(row, {
            operational: Math.max(0, row.releasedOperational - byLine.operational),
            adjustment: Math.max(0, row.releasedAdjustment - byLine.adjustment),
          });
        }
        const open = capacity.get(row)!;
        const opOpen = open.operational;
        const adjOpen = open.adjustment;
        const soleCompetenceBatch = (competenceBatches.get(row) ?? []).length === 1;
        if (adjOpen <= MONEY_TOLERANCE) {
          const used = Math.min(remaining, opOpen);
          result.operational += used;
          result.unattributed += Math.max(0, remaining - used);
          open.operational -= used;
        } else if (opOpen <= MONEY_TOLERANCE) {
          const used = Math.min(remaining, adjOpen);
          result.adjustment += used;
          result.unattributed += Math.max(0, remaining - used);
          open.adjustment -= used;
        } else if (soleCompetenceBatch && remaining + MONEY_TOLERANCE >= opOpen + adjOpen) {
          // Um único lote quita o fechamento inteiro: cada parte foi paga integralmente.
          result.operational += opOpen;
          result.adjustment += adjOpen;
          result.unattributed += Math.max(0, remaining - opOpen - adjOpen);
          open.operational = 0;
          open.adjustment = 0;
        } else {
          result.unattributed += remaining;
        }
      } else if (trace.candidates.some((row) => row.releasedAdjustment > MONEY_TOLERANCE)) {
        result.unattributed += remaining;
      } else {
        // Sem fechamento casado e sem ajuste retroativo nas competências do lote: pagamento da competência do lote.
        result.operational += remaining;
      }
    }
    batchAttribution.set(trace.batchId, {
      operational: roundMoney(result.operational),
      adjustment: roundMoney(result.adjustment),
      unattributed: roundMoney(result.unattributed),
    });
  }
  return { rows: ordered, unmatchedPayments, batchAttribution };
}

// ---------------------------------------------------------------------------
// B1 / C — linhas do motor da Previsão
// ---------------------------------------------------------------------------

function lineSellerName(line: OutlookLine): string {
  return line.canonicalSellerName?.trim() || (line.rawSellerId != null ? `Vendedor Nomus ${line.rawSellerId}` : "Sem vendedor");
}

export function filterCommission360OutlookLines(lines: readonly OutlookLine[], query: Commission360Query): OutlookLine[] {
  return lines.filter((line) => {
    // Escopo próprio sem vendedor Nomus vinculado: nada é visível.
    if (query.sellerLocked && line.rawSellerId !== query.ownNomusSellerId) return false;
    if (query.canonicalSellerId && line.canonicalSellerId !== query.canonicalSellerId) return false;
    if (!includesText(line.customerName, query.customer)) return false;
    if (!includesText(line.orderCode, query.orderCode)) return false;
    return true;
  });
}

export function buildCommission360RealizedRows(lines: readonly OutlookLine[]): Commission360RealizedRow[] {
  return lines
    .filter((line) => line.awaitingClosing > 0)
    .map((line) => ({
      scheduleId: line.scheduleId,
      receivableId: line.receivableId,
      installmentNumber: line.installmentNumber,
      orderCode: line.orderCode,
      customerName: line.customerName,
      canonicalSellerId: line.canonicalSellerId,
      sellerName: lineSellerName(line),
      realizedCommission: line.realizedCommission,
      awaitingClosing: line.awaitingClosing,
      lastReceiptDate: line.receipts.length > 0 ? line.receipts[line.receipts.length - 1]!.receiptDate : null,
    }));
}

export function buildCommission360ForecastRows(lines: readonly OutlookLine[], query: Commission360Query): Commission360ForecastRow[] {
  return lines
    .filter((line) => (line.forecastCommission > 0 || line.unreconciledCommission > 0) && inRange(line.dueMonth, query))
    .map((line) => ({
      scheduleId: line.scheduleId,
      receivableId: line.receivableId,
      receivableCode: line.receivableCode,
      installmentNumber: line.installmentNumber,
      dueDate: line.dueDate,
      dueMonth: line.dueMonth,
      orderCode: line.orderCode,
      salesOrderId: line.salesOrderId,
      customerId: line.customerId,
      customerName: line.customerName,
      canonicalSellerId: line.canonicalSellerId,
      sellerName: lineSellerName(line),
      openPrincipal: line.openPrincipal,
      allocatedCommission: line.allocatedCommission,
      forecastCommission: line.forecastCommission,
      unreconciledCommission: line.unreconciledCommission,
      status: line.status,
    }))
    .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : (a.dueDate ?? "") > (b.dueDate ?? "") ? 1 : a.receivableId - b.receivableId));
}

// ---------------------------------------------------------------------------
// D — Potencial em PVs pendentes
// ---------------------------------------------------------------------------

export type Commission360PotentialItemInput = {
  salesOrderItemId: string;
  productName: string | null;
  /** Comissão final do item em cada snapshot ACTIVE do pedido que contém o item. */
  snapshotFinalCommissions: number[];
  snapshotItemStatuses: string[];
  /** Quantidades oficiais do fluxo do item (SalesOrderItemFlowSnapshot). null = sem fluxo. */
  flow: { orderedQuantity: number | null; shipTargetQuantity: number; invoicedQuantity: number } | null;
};

export type Commission360PotentialOrderInput = {
  salesOrderId: string;
  orderCode: string | null;
  orderStatus: string;
  saleDate: string | null;
  customerName: string;
  canonicalSellerId: string | null;
  sellerName: string | null;
  rawSellerId: number | null;
  sellerResolutionStatus: string | null;
  customerExcludedByActiveRule: boolean;
  hasActiveSnapshot: boolean;
  /**
   * Σ scheduledCommissionAmount dos schedules ACTIVE (snapshot ACTIVE) de TODAS as NF-e do pedido.
   * O motor aloca a comissão inteira do pedido já na primeira NF-e; o potencial nunca passa do
   * que ainda não está em schedule. Ausente = nenhum schedule.
   */
  scheduledCommissionAmount?: number;
  items: Commission360PotentialItemInput[];
};

function decimalNumber(value: Prisma.Decimal | null): number | null {
  return value == null ? null : Number(value.toFixed(2));
}

function resolvePotentialItem(
  order: Commission360PotentialOrderInput,
  item: Commission360PotentialItemInput
): Commission360PotentialItemRow {
  const base = {
    salesOrderItemId: item.salesOrderItemId,
    productName: item.productName,
    orderedQuantity: item.flow?.orderedQuantity ?? null,
    invoicedQuantity: item.flow?.invoicedQuantity ?? null,
    pendingQuantity: null as number | null,
    totalCommission: null as number | null,
    invoicedCommission: null as number | null,
    pendingCommission: null as number | null,
  };
  const row = (status: Commission360PotentialStatus, reason: string | null, extra: Partial<typeof base> = {}) => ({
    ...base,
    ...extra,
    status,
    reason,
  });
  if (order.orderStatus === "CANCELLED") return row("PEDIDO_CANCELADO", "Pedido cancelado: sem potencial.");
  if (!order.hasActiveSnapshot || item.snapshotFinalCommissions.length === 0) {
    return row("SEM_SNAPSHOT", "Item sem snapshot oficial de comissão vigente: comissão não é estimada.");
  }
  if (order.customerExcludedByActiveRule || item.snapshotItemStatuses.every((status) => status === "CUSTOMER_EXCLUDED")) {
    return row("CLIENTE_EXCLUIDO", "Cliente das Exceções por cliente: sem comissão.", { totalCommission: 0, invoicedCommission: 0, pendingCommission: 0 });
  }
  if (
    order.sellerResolutionStatus === "NO_SELLER" ||
    order.sellerResolutionStatus === "SELLER_UNRESOLVED" ||
    (order.canonicalSellerId == null && order.rawSellerId == null)
  ) {
    return row("VENDEDOR_NAO_RESOLVIDO", "Vendedor comissionável não resolvido no snapshot.");
  }
  const distinct = [...new Set(item.snapshotFinalCommissions.map((value) => roundMoney(value)))];
  if (distinct.length > 1) {
    return row(
      "SNAPSHOTS_DIVERGENTES",
      `Snapshots vigentes do pedido divergem para o item (${distinct.map((v) => v.toFixed(2)).join(" × ")}).`
    );
  }
  const total = roundMoney(Math.max(0, distinct[0] ?? 0));
  const ordered = item.flow?.orderedQuantity ?? null;
  if (!item.flow || ordered == null || ordered <= 0) {
    return row("SEM_SALDO_OPERACIONAL", "Sem quantidade oficial do fluxo do item: a parte pendente não é estimada.", { totalCommission: total });
  }
  const pendingQuantity = Math.max(0, item.flow.shipTargetQuantity - item.flow.invoicedQuantity);
  const invoicedQuantity = Math.min(ordered, Math.max(0, item.flow.invoicedQuantity));
  const amount = new Prisma.Decimal(total);
  const pending = decimalNumber(computeQuantityProportionalAmount(amount, pendingQuantity, ordered)) ?? 0;
  const invoiced = decimalNumber(computeQuantityProportionalAmount(amount, invoicedQuantity, ordered)) ?? 0;
  return row(pendingQuantity > 0 ? "PENDENTE_FATURAMENTO" : "TOTALMENTE_FATURADO", null, {
    pendingQuantity,
    totalCommission: total,
    invoicedCommission: roundMoney(Math.min(total, invoiced)),
    pendingCommission: roundMoney(Math.min(total, pending)),
  });
}

/**
 * Comissão potencial da carteira. Por item, nunca pelo valor total do pedido:
 * cada item usa a SUA comissão do snapshot e a SUA quantidade não faturada.
 *
 * Não duplicação com a previsão (C): o motor oficial grava em cada snapshot por NF-e a
 * comissão do pedido INTEIRO (R1) e o scheduler a rateia nos CRs dessa NF-e. Então a parte
 * já alocada em schedules não pode reaparecer como potencial: potencial do pedido =
 * min(parte não faturada pela quantidade, comissão do pedido − já alocada em schedules).
 * Alocação acima da comissão do pedido fica como não conciliada (`overAllocatedCommission`).
 */
export function buildCommission360Potential(orders: readonly Commission360PotentialOrderInput[]): Commission360PotentialOrderRow[] {
  const out: Commission360PotentialOrderRow[] = [];
  for (const order of orders) {
    const items = order.items.map((item) => resolvePotentialItem(order, item));
    const toReconcile = items.filter((item) =>
      ["SEM_SNAPSHOT", "VENDEDOR_NAO_RESOLVIDO", "SNAPSHOTS_DIVERGENTES", "SEM_SALDO_OPERACIONAL"].includes(item.status)
    ).length;
    const sum = (pick: (item: Commission360PotentialItemRow) => number | null) =>
      roundMoney(items.reduce((acc, item) => acc + (pick(item) ?? 0), 0));
    const total = sum((item) => item.totalCommission);
    const quantityPending = sum((item) => item.pendingCommission);
    const scheduled = roundMoney(Math.max(0, order.scheduledCommissionAmount ?? 0));
    const pending = roundMoney(Math.min(quantityPending, Math.max(0, total - scheduled)));
    // Excesso só é afirmado quando a comissão do pedido é conhecida em todos os itens.
    const overAllocated = toReconcile === 0 ? roundMoney(Math.max(0, scheduled - total)) : 0;
    const status: Commission360PotentialStatus =
      order.orderStatus === "CANCELLED"
        ? "PEDIDO_CANCELADO"
        : items.length > 0 && items.every((item) => item.status === "CLIENTE_EXCLUIDO")
          ? "CLIENTE_EXCLUIDO"
          : !order.hasActiveSnapshot
            ? "SEM_SNAPSHOT"
            : pending > 0
              ? "PENDENTE_FATURAMENTO"
              : quantityPending > 0
                ? "JA_ALOCADO_EM_CR"
                : toReconcile > 0
                  ? items.find((item) => item.status !== "TOTALMENTE_FATURADO" && item.status !== "CLIENTE_EXCLUIDO")!.status
                  : "TOTALMENTE_FATURADO";
    out.push({
      salesOrderId: order.salesOrderId,
      orderCode: order.orderCode,
      saleDate: order.saleDate,
      customerName: order.customerName,
      canonicalSellerId: order.canonicalSellerId,
      sellerName: order.sellerName?.trim() || (order.rawSellerId != null ? `Vendedor Nomus ${order.rawSellerId}` : "Sem vendedor"),
      totalCommission: total,
      invoicedCommission: sum((item) => item.invoicedCommission),
      pendingCommission: pending,
      quantityPendingCommission: quantityPending,
      alreadyScheduledCommission: scheduled,
      overAllocatedCommission: overAllocated,
      toReconcileItemCount: toReconcile,
      status,
      items,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conciliação inversa CR → comissão
// ---------------------------------------------------------------------------

export type Commission360SnapshotRef = {
  id: string;
  status: string;
  salesOrderId: string;
  nfeId: number | null;
  sourceHash: string;
  customerId: string;
  createdAt: string;
  totalFinalCommissionAmount: number;
  itemStatuses: string[];
  sellerResolutionStatus: string | null;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  customerExcludedByActiveRule: boolean;
};

export type Commission360ReceivableInput = {
  receivableId: number;
  invoiceNumber: string | null;
  sourceInvoiceId: number | null;
  dueDate: string | null;
  customerName: string | null;
  nominalAmount: number;
  /** Saldo oficial; null = título removido na origem. */
  openBalance: number | null;
  suspended: boolean;
  groupCompany: boolean;
  orderLinks: Array<{ salesOrderId: string; orderCode: string | null; status: string; externalSellerId: number | null }>;
  /** Snapshots (qualquer status) do pedido/NF-e do título. */
  snapshots: Commission360SnapshotRef[];
  /** Todos os títulos da mesma NF-e (rateio do scheduler). */
  nfeReceivables: Array<{ receivableId: number; nominalAmount: number; dueDate: string | null; invoiceNumber: string | null }>;
  /** Linhas do motor da Previsão para o título (inclui schedules anulados pelo motor). */
  outlookLines: OutlookLine[];
  /**
   * Alocação do PV inteiro (todas as NF-e), por salesOrderId: comissão do pedido (itens dos
   * snapshots ACTIVE, cada item uma vez; null se divergirem) × Σ schedules ACTIVE vigentes.
   */
  orderAllocations?: ReadonlyMap<string, Commission360OrderAllocation>;
};

export type Commission360OrderAllocation = {
  orderCommission: number | null;
  scheduledTotal: number;
  activeSnapshotCount: number;
};

/** Excesso alocado em schedules acima da comissão do pedido (R1). null = não verificável. */
export function resolveCommission360OrderOverAllocation(allocation: Commission360OrderAllocation | undefined): number | null {
  if (!allocation || allocation.orderCommission == null) return null;
  return roundMoney(Math.max(0, allocation.scheduledTotal - allocation.orderCommission));
}

const SELLER_UNRESOLVED = new Set(["NO_SELLER", "SELLER_UNRESOLVED"]);

function crRow(
  input: Commission360ReceivableInput,
  status: Commission360CrStatus,
  reason: string | null,
  extra: Partial<Commission360CrRow> = {}
): Commission360CrRow {
  const meta = COMMISSION_360_CR_STATUS_META[status];
  return {
    receivableId: input.receivableId,
    invoiceNumber: input.invoiceNumber,
    sourceInvoiceId: input.sourceInvoiceId,
    dueDate: input.dueDate,
    dueMonth: input.dueDate ? input.dueDate.slice(0, 7) : null,
    customerName: input.customerName,
    orderCode: null,
    salesOrderId: null,
    canonicalSellerId: null,
    sellerName: null,
    nominalAmount: roundMoney(input.nominalAmount),
    openBalance: input.openBalance == null ? null : roundMoney(input.openBalance),
    status,
    group: meta.group,
    reason: reason ?? meta.description,
    allocatedCommission: 0,
    forecastCommission: 0,
    realizedCommission: 0,
    unreconciledCommission: 0,
    potentialUncoveredCommission: null,
    orderOverAllocatedCommission: null,
    scheduleIds: input.outlookLines.map((line) => line.scheduleId),
    snapshotIds: input.snapshots.map((snap) => snap.id),
    ...extra,
  };
}

/**
 * Classifica um título pela cadeia oficial CR → NF-e → PV → snapshot → schedule.
 * Com schedule vigente, vale a linha do motor da Previsão (nunca recalculada aqui).
 * Sem schedule, prova cada elo; o que não puder ser provado fica sem comissão estimada.
 */
export function classifyCommission360Receivable(input: Commission360ReceivableInput): Commission360CrRow {
  if (input.openBalance == null) {
    return crRow(input, "FORA_UNIVERSO", "Título removido na origem (ausência confirmada): sem saldo oficial.");
  }
  if (input.suspended) return crRow(input, "FORA_UNIVERSO", "Cobrança suspensa na origem: fora do fechamento.");
  if (input.groupCompany) return crRow(input, "EMPRESA_GRUPO", null);

  const counting = input.outlookLines.filter((line) => line.status !== "CANCELADA");
  if (counting.length > 0) {
    const line = counting[0]!;
    const sellerExtra = {
      orderCode: line.orderCode,
      salesOrderId: line.salesOrderId,
      canonicalSellerId: line.canonicalSellerId,
      sellerName: lineSellerName(line),
      allocatedCommission: line.allocatedCommission,
      forecastCommission: line.forecastCommission,
      realizedCommission: line.realizedCommission,
      unreconciledCommission: line.unreconciledCommission,
      orderOverAllocatedCommission: resolveCommission360OrderOverAllocation(input.orderAllocations?.get(line.salesOrderId)),
    };
    if (line.status === "CUSTOMER_EXCLUDED") return crRow(input, "CLIENTE_EXCLUIDO", line.inconsistency, sellerExtra);
    if (line.status === "SEM_VENDEDOR") return crRow(input, "VENDEDOR_NAO_COMISSIONAVEL", null, sellerExtra);
    if (line.unreconciledCommission > 0 || line.status === "INCONSISTENCIA_SEM_RECEBIMENTO" || line.status === "TITULO_NAO_ENCONTRADO") {
      return crRow(input, "DIVERGENCIA_ALOCACAO", line.inconsistency, sellerExtra);
    }
    if (line.forecastCommission > 0) return crRow(input, "COBERTO_FUTURA", null, sellerExtra);
    if (line.allocatedCommission <= 0) return crRow(input, "COBERTO_ZERADA", null, sellerExtra);
    return crRow(input, "COBERTO_REALIZADA", null, sellerExtra);
  }
  if (input.outlookLines.length > 0) {
    const reasons = [...new Set(input.outlookLines.map((line) => line.inconsistency).filter(Boolean))];
    return crRow(input, "SCHEDULE_INCONSISTENTE", reasons.join(" ") || null, {
      orderCode: input.outlookLines[0]!.orderCode,
      salesOrderId: input.outlookLines[0]!.salesOrderId,
    });
  }

  // Sem schedule nenhum: só a origem do título explica.
  if (input.sourceInvoiceId == null) {
    return input.openBalance <= 0 ? crRow(input, "SALDO_LIQUIDADO", null) : crRow(input, "SEM_VINCULO_NFE", null);
  }
  const resolution = resolveUniqueSalesOrderFromNfeLinkCandidates(
    input.orderLinks.map((link) => ({ salesOrderId: link.salesOrderId, orderCode: link.orderCode }))
  );
  if (resolution.status === "UNRESOLVED") {
    return input.openBalance <= 0 ? crRow(input, "SALDO_LIQUIDADO", null) : crRow(input, "SEM_VINCULO_PV", null);
  }
  if (resolution.status === "AMBIGUOUS") {
    return crRow(input, "VINCULO_PV_AMBIGUO", `NF-e vinculada a ${resolution.candidateCount} pedidos: ${resolution.candidateOrderCodes.join(", ")}.`);
  }
  const order = input.orderLinks.find((link) => link.salesOrderId === resolution.salesOrderId)!;
  const orderExtra = { orderCode: resolution.orderCode, salesOrderId: resolution.salesOrderId };
  if (order.status === "CANCELLED") return crRow(input, "PEDIDO_CANCELADO", null, orderExtra);
  if (input.openBalance <= 0) return crRow(input, "SALDO_LIQUIDADO", null, orderExtra);

  const ofOrder = input.snapshots.filter((snap) => snap.salesOrderId === resolution.salesOrderId && snap.nfeId === input.sourceInvoiceId);
  const active = ofOrder
    .filter((snap) => isCommissionSnapshotActive(snap.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  if (active.length === 0) {
    return ofOrder.length > 0
      ? crRow(input, "SNAPSHOT_SUBSTITUIDO", `Snapshots do pedido/NF-e: ${ofOrder.map((s) => s.status).join(", ")}.`, orderExtra)
      : crRow(input, "SEM_SNAPSHOT", null, orderExtra);
  }
  // Mesma escolha do scheduler oficial: o snapshot ACTIVE mais recente do pedido/NF-e.
  const snapshot = active[0]!;
  const sellerExtra = {
    ...orderExtra,
    canonicalSellerId: snapshot.canonicalSellerId,
    sellerName: snapshot.canonicalSellerName ?? (snapshot.rawSellerId != null ? `Vendedor Nomus ${snapshot.rawSellerId}` : null),
  };
  if (snapshot.customerExcludedByActiveRule || (snapshot.itemStatuses.length > 0 && snapshot.itemStatuses.every((s) => s === "CUSTOMER_EXCLUDED"))) {
    return crRow(input, "CLIENTE_EXCLUIDO", null, sellerExtra);
  }
  if (SELLER_UNRESOLVED.has(snapshot.sellerResolutionStatus ?? "") || (snapshot.canonicalSellerId == null && snapshot.rawSellerId == null)) {
    return crRow(input, "VENDEDOR_NAO_COMISSIONAVEL", null, sellerExtra);
  }
  if (snapshot.itemStatuses.length === 0 || snapshot.itemStatuses.some((s) => s === "ERROR")) {
    return crRow(input, "DADOS_INSUFICIENTES", "Snapshot vigente sem itens ou com item em erro: o rateio não é presumido.", sellerExtra);
  }

  // Potencial NÃO confirmado: rateio do scheduler oficial simulado em memória (nada é gravado).
  const siblings = [...input.nfeReceivables].sort(
    (a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : (a.dueDate ?? "") > (b.dueDate ?? "") ? 1 : a.receivableId - b.receivableId)
  );
  const drafts = buildCommissionReceivableScheduleDrafts({
    snapshot: {
      id: snapshot.id,
      sourceHash: snapshot.sourceHash,
      salesOrderId: snapshot.salesOrderId,
      nfeId: snapshot.nfeId,
      customerId: snapshot.customerId,
      canonicalSellerId: snapshot.canonicalSellerId,
      totalFinalCommissionAmount: snapshot.totalFinalCommissionAmount,
      itemStatuses: snapshot.itemStatuses,
    },
    receivables: siblings.map((row, index) => ({
      receivableId: row.receivableId,
      receivableCode: row.invoiceNumber,
      installmentNumber: index + 1,
      receivableNominalAmount: row.nominalAmount,
    })),
  });
  const draft = drafts.find((row) => row.receivableId === input.receivableId);
  const allocated = draft?.scheduledCommissionAmount ?? 0;
  const potential = computeCommissionReleasedFromReceivablePrincipal({
    commissionExpectedAmount: allocated,
    receivableOriginalAmount: input.nominalAmount,
    receivedAmount: Math.min(input.nominalAmount, input.openBalance),
  });
  return crRow(
    input,
    "SEM_SCHEDULE",
    active.length > 1
      ? `Há ${active.length} snapshots vigentes para o pedido/NF-e; o rateio usa o mais recente, como o scheduler.`
      : null,
    { ...sellerExtra, potentialUncoveredCommission: potential }
  );
}

export function filterCommission360ReceivableRows(
  rows: readonly Commission360CrRow[],
  inputs: ReadonlyMap<number, Commission360ReceivableInput>,
  query: Commission360Query
): Commission360CrRow[] {
  return rows.filter((row) => {
    if (query.sellerLocked) {
      if (query.ownNomusSellerId == null) return false;
      const input = inputs.get(row.receivableId);
      const owners = new Set<number>();
      for (const line of input?.outlookLines ?? []) if (line.rawSellerId != null) owners.add(line.rawSellerId);
      for (const snap of input?.snapshots ?? []) if (snap.rawSellerId != null) owners.add(snap.rawSellerId);
      for (const link of input?.orderLinks ?? []) if (link.externalSellerId != null) owners.add(link.externalSellerId);
      // Título sem vínculo provado com o vendedor não aparece no escopo próprio.
      if (!owners.has(query.ownNomusSellerId)) return false;
    }
    if (query.canonicalSellerId && row.canonicalSellerId !== query.canonicalSellerId) return false;
    if (!includesText(row.customerName, query.customer)) return false;
    if (query.orderCode && !includesText(row.orderCode, query.orderCode)) return false;
    return true;
  });
}

const ELIGIBLE: ReadonlySet<Commission360CrStatus> = new Set([
  "COBERTO_FUTURA",
  "COBERTO_REALIZADA",
  "COBERTO_ZERADA",
  "DIVERGENCIA_ALOCACAO",
  "SEM_SCHEDULE",
]);
const COVERED: ReadonlySet<Commission360CrStatus> = new Set([
  "COBERTO_FUTURA",
  "COBERTO_REALIZADA",
  "COBERTO_ZERADA",
  "DIVERGENCIA_ALOCACAO",
]);

/** Funil: só títulos do universo operacional com saldo em aberto. Operacionais = excluídos + cobertos + diferenças. */
export function buildCommission360Funnel(rows: readonly Commission360CrRow[]): Commission360ReconciliationFunnel {
  const funnel: Commission360ReconciliationFunnel = {
    operationalCount: 0,
    operationalBalance: 0,
    commissionableCount: 0,
    commissionableBalance: 0,
    coveredCount: 0,
    coveredBalance: 0,
    forecastCommission: 0,
    differenceCount: 0,
    differenceBalance: 0,
  };
  for (const row of rows) {
    if (row.group === "FORA_UNIVERSO" || row.openBalance == null || row.openBalance <= 0) continue;
    funnel.operationalCount += 1;
    funnel.operationalBalance = roundMoney(funnel.operationalBalance + row.openBalance);
    if (ELIGIBLE.has(row.status)) {
      funnel.commissionableCount += 1;
      funnel.commissionableBalance = roundMoney(funnel.commissionableBalance + row.openBalance);
    }
    if (COVERED.has(row.status)) {
      funnel.coveredCount += 1;
      funnel.coveredBalance = roundMoney(funnel.coveredBalance + row.openBalance);
      funnel.forecastCommission = roundMoney(funnel.forecastCommission + row.forecastCommission);
    }
    if (row.group === "SEM_COBERTURA" || row.group === "DIVERGENCIA") {
      funnel.differenceCount += 1;
      funnel.differenceBalance = roundMoney(funnel.differenceBalance + row.openBalance);
    }
  }
  return funnel;
}

/** Diagnóstico de novembro e dezembro de 2026 (e total), título a título. */
export function buildCommission360Diagnostic(
  rows: readonly Commission360CrRow[],
  months: readonly string[] = COMMISSION_360_DIAGNOSTIC_MONTHS
): Commission360DiagnosticColumn[] {
  const column = (month: string | "TOTAL", subset: Commission360CrRow[]): Commission360DiagnosticColumn => {
    const byStatus = new Map<Commission360CrStatus, { count: number; openBalance: number }>();
    const col: Commission360DiagnosticColumn = {
      month,
      label: month === "TOTAL" ? "Total" : commission360MonthLabel(month),
      crCount: subset.length,
      openBalance: 0,
      eligibleBalance: 0,
      coveredBalance: 0,
      uncoveredBalance: 0,
      excludedBalance: 0,
      allocatedCommission: 0,
      forecastCommission: 0,
      potentialUncoveredCommission: 0,
      differenceBalance: 0,
      forecastOnOverAllocatedOrders: 0,
      orderOverAllocationExcess: 0,
      byStatus: [],
    };
    const excessByOrder = new Map<string, number>();
    for (const row of subset) {
      const open = row.openBalance ?? 0;
      col.openBalance = roundMoney(col.openBalance + open);
      if (ELIGIBLE.has(row.status)) col.eligibleBalance = roundMoney(col.eligibleBalance + open);
      if (COVERED.has(row.status)) col.coveredBalance = roundMoney(col.coveredBalance + open);
      if (row.group === "SEM_COBERTURA") col.uncoveredBalance = roundMoney(col.uncoveredBalance + open);
      if (row.group === "EXCLUIDO") col.excludedBalance = roundMoney(col.excludedBalance + open);
      if (row.group === "DIVERGENCIA") col.differenceBalance = roundMoney(col.differenceBalance + open);
      col.allocatedCommission = roundMoney(col.allocatedCommission + row.allocatedCommission);
      col.forecastCommission = roundMoney(col.forecastCommission + row.forecastCommission);
      col.potentialUncoveredCommission = roundMoney(col.potentialUncoveredCommission + (row.potentialUncoveredCommission ?? 0));
      if ((row.orderOverAllocatedCommission ?? 0) > MONEY_TOLERANCE && row.salesOrderId) {
        col.forecastOnOverAllocatedOrders = roundMoney(col.forecastOnOverAllocatedOrders + row.forecastCommission);
        excessByOrder.set(row.salesOrderId, row.orderOverAllocatedCommission!);
      }
      const bucket = byStatus.get(row.status) ?? { count: 0, openBalance: 0 };
      bucket.count += 1;
      bucket.openBalance = roundMoney(bucket.openBalance + open);
      byStatus.set(row.status, bucket);
    }
    col.orderOverAllocationExcess = roundMoney([...excessByOrder.values()].reduce((sum, value) => sum + value, 0));
    col.byStatus = [...byStatus.entries()]
      .map(([status, value]) => ({ status, ...value }))
      .sort((a, b) => b.openBalance - a.openBalance);
    return col;
  };
  const columns = months.map((month) => column(month, rows.filter((row) => row.dueMonth === month)));
  columns.push(column("TOTAL", rows.filter((row) => row.dueMonth != null && months.includes(row.dueMonth))));
  return columns;
}

// ---------------------------------------------------------------------------
// Montagem do payload
// ---------------------------------------------------------------------------

function monthKind(month: string, todayMonth: string): Commission360Month["kind"] {
  return month < todayMonth ? "past" : month > todayMonth ? "future" : "current";
}

function paginate<T>(rows: readonly T[], page: number, pageSize: number): T[] {
  const start = (Math.max(1, page) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export type Commission360Facts = {
  /** Linhas oficiais do motor da Previsão (versão vigente, como a aba Previsão). */
  outlookLines: OutlookLine[];
  batches: Commission360BatchInput[];
  legacyCoverages: Commission360LegacyCoverageInput[];
  ledgerLines: Commission360LedgerLineInput[];
  potentialOrders: Commission360PotentialOrderInput[];
  receivables: Commission360ReceivableInput[];
};

export function buildCommission360View(facts: Commission360Facts, query: Commission360Query, today: string): Commission360Payload {
  const todayMonth = today.slice(0, 7);
  const lines = filterCommission360OutlookLines(facts.outlookLines, query);

  const sellerByReceivable = new Map<number, { key: string; name: string }>();
  for (const line of facts.outlookLines) {
    if (line.status === "CANCELADA" || sellerByReceivable.has(line.receivableId)) continue;
    sellerByReceivable.set(line.receivableId, { key: sellerKeyOf(line.canonicalSellerId, line.rawSellerId), name: lineSellerName(line) });
  }
  const sellerFilter = query.canonicalSellerId;
  const batches = facts.batches.filter((batch) => !sellerFilter || batch.commissionPersonId === sellerFilter);
  const paid = buildCommission360Paid({
    batches,
    legacyCoverages: facts.legacyCoverages.filter((row) => {
      const seller = sellerByReceivable.get(row.receivableId);
      if (query.sellerLocked && !seller) return false;
      return !sellerFilter || seller?.key === sellerFilter;
    }),
    sellerByReceivable,
  });
  const releasedResult = buildCommission360ReleasedNotPaid({
    ledgerLines: facts.ledgerLines.filter((line) => !sellerFilter || line.canonicalSellerId === sellerFilter),
    batches,
  });
  const released = releasedResult.rows;
  const series = COMMISSION_360_SERIES;

  // Recebimentos por competência NATURAL (receiptDate): oficial × legado/ajuste.
  const realizedRows: Commission360RealizedRow[] = [];
  const officialRealizedByMonth = new Map<string, number>();
  const legacyByMonth = new Map<string, { nomusLegacyCovered: number; legacyRealized: number; retroactiveReleased: number }>();
  const legacySellers = new Map<string, Commission360LegacySection["bySeller"][number]>();
  const legacyMonth = (month: string) => {
    const found = legacyByMonth.get(month) ?? { nomusLegacyCovered: 0, legacyRealized: 0, retroactiveReleased: 0 };
    legacyByMonth.set(month, found);
    return found;
  };
  const legacySeller = (key: string, sellerName: string) => {
    const found = legacySellers.get(key) ?? {
      key,
      sellerName,
      nomusLegacyCovered: 0,
      legacyRealized: 0,
      legacyAwaitingClosing: 0,
      retroactiveReleased: 0,
      legacyPayments: 0,
    };
    legacySellers.set(key, found);
    return found;
  };
  let legacyRealizedTotal = 0;
  let legacyAwaitingTotal = 0;
  for (const line of lines) {
    let opRealized = 0;
    let opAwaiting = 0;
    let legRealized = 0;
    let legAwaiting = 0;
    let lastOfficialReceipt: string | null = null;
    for (const receipt of line.receipts) {
      if (receipt.realizedCommission <= 0) continue;
      const awaiting = receipt.coverageSource == null ? receipt.realizedCommission : 0;
      if (classifyCommission360Receipt(receipt) === "OFICIAL") {
        opRealized = roundMoney(opRealized + receipt.realizedCommission);
        opAwaiting = roundMoney(opAwaiting + awaiting);
        lastOfficialReceipt = receipt.receiptDate;
        if (inRange(receipt.month, query)) {
          officialRealizedByMonth.set(receipt.month, roundMoney((officialRealizedByMonth.get(receipt.month) ?? 0) + receipt.realizedCommission));
        }
      } else {
        legAwaiting = roundMoney(legAwaiting + awaiting);
        if (!inRange(receipt.month, query)) continue;
        legRealized = roundMoney(legRealized + receipt.realizedCommission);
        const bucket = legacyMonth(receipt.month);
        bucket.legacyRealized = roundMoney(bucket.legacyRealized + receipt.realizedCommission);
      }
    }
    // O saldo aguardando do motor (line.awaitingClosing) é o teto: lote antigo sem cobertura reduz o pendente.
    opAwaiting = roundMoney(Math.min(opAwaiting, line.awaitingClosing));
    legAwaiting = roundMoney(Math.min(legAwaiting, Math.max(0, line.awaitingClosing - opAwaiting)));
    if (opAwaiting > 0) {
      realizedRows.push({
        scheduleId: line.scheduleId,
        receivableId: line.receivableId,
        installmentNumber: line.installmentNumber,
        orderCode: line.orderCode,
        customerName: line.customerName,
        canonicalSellerId: line.canonicalSellerId,
        sellerName: lineSellerName(line),
        realizedCommission: opRealized,
        awaitingClosing: opAwaiting,
        lastReceiptDate: lastOfficialReceipt,
      });
    }
    if (legRealized > 0 || legAwaiting > 0) {
      const s = legacySeller(sellerKeyOf(line.canonicalSellerId, line.rawSellerId), lineSellerName(line));
      s.legacyRealized = roundMoney(s.legacyRealized + legRealized);
      s.legacyAwaitingClosing = roundMoney(s.legacyAwaitingClosing + legAwaiting);
      legacyRealizedTotal = roundMoney(legacyRealizedTotal + legRealized);
      legacyAwaitingTotal = roundMoney(legacyAwaitingTotal + legAwaiting);
    }
  }

  // Previsão: vencimento dos CRs em aberto, a partir do marco da Previsão (09/2026).
  const allForecastRows = buildCommission360ForecastRows(lines, query);
  const forecastRows = allForecastRows.filter((row) => row.dueMonth != null && row.dueMonth >= series.forecastStartMonth);
  const forecastBefore = allForecastRows.filter((row) => row.forecastCommission > 0 && !(row.dueMonth != null && row.dueMonth >= series.forecastStartMonth));

  // Lotes pagos: só competência oficial entra na série; o restante é legado.
  const batchById = new Map(batches.map((batch) => [batch.batchId, batch]));
  const officialPayments: Commission360PaymentRow[] = [];
  const legacyPayments: Commission360LegacySection["payments"] = [];
  for (const row of paid.payments) {
    const batch = batchById.get(row.batchId);
    const competence = batch ? classifyCommission360BatchCompetence(batch) : { official: false, reason: "Lote sem período." };
    if (!competence.official || (row.month != null && row.month < series.officialStartMonth)) {
      legacyPayments.push({ ...row, reason: competence.reason ?? "Data de pagamento anterior ao corte de 01/10/2026." });
      continue;
    }
    // Lote de competência oficial: na série só a parte comprovadamente operacional.
    const split = releasedResult.batchAttribution.get(row.batchId) ?? { operational: row.amountPaid, adjustment: 0, unattributed: 0 };
    const operational = roundMoney(Math.min(row.amountPaid, split.operational));
    const adjustment = roundMoney(Math.min(row.amountPaid - operational, split.adjustment));
    const unattributed = roundMoney(row.amountPaid - operational - adjustment);
    if (operational > MONEY_TOLERANCE) {
      officialPayments.push({
        ...row,
        amountPaid: operational,
        notes:
          operational < row.amountPaid - MONEY_TOLERANCE
            ? [row.notes, `Lote de ${row.amountPaid.toFixed(2)}: só ${operational.toFixed(2)} é comissão operacional; o resto está no histórico legado / ajustes.`]
                .filter(Boolean)
                .join(" ")
            : row.notes,
      });
    }
    if (adjustment > MONEY_TOLERANCE) {
      legacyPayments.push({ ...row, amountPaid: adjustment, reason: "Parte do lote que paga ajuste retroativo do fechamento (LEGACY_CARRYOVER / ajuste manual)." });
    }
    if (unattributed > MONEY_TOLERANCE) {
      legacyPayments.push({
        ...row,
        amountPaid: unattributed,
        reason: "Valor misto: o lote paga fechamento com parte operacional e ajuste retroativo sem vínculo para separar (ou acima do liberado). Fora da série operacional.",
      });
    }
  }
  const potentialRows = buildCommission360Potential(
    facts.potentialOrders.filter(
      (order) =>
        (!sellerFilter || order.canonicalSellerId === sellerFilter) &&
        (!query.sellerLocked || order.rawSellerId === query.ownNomusSellerId) &&
        includesText(order.customerName, query.customer) &&
        includesText(order.orderCode, query.orderCode)
    )
  );

  const inputs = new Map(facts.receivables.map((row) => [row.receivableId, row]));
  const crAll = filterCommission360ReceivableRows(facts.receivables.map(classifyCommission360Receivable), inputs, query);
  const crInRange = crAll.filter((row) => inRange(row.dueMonth, query));

  // Série principal: só o motor oficial. Eixo a partir do marco da Previsão (09/2026); pago e
  // realizado só existem a partir do cutover (10/2026) — antes disso são null, não zero.
  const monthMap = new Map<string, Commission360Month>();
  const seriesStart = query.fromMonth > series.forecastStartMonth ? query.fromMonth : series.forecastStartMonth;
  const touch = (month: string) => {
    const found = monthMap.get(month);
    if (found) return found;
    const official = month >= series.officialStartMonth;
    const created: Commission360Month = {
      month,
      label: commission360MonthLabel(month),
      kind: monthKind(month, todayMonth),
      official,
      paidConfirmed: official ? 0 : null,
      realized: official ? 0 : null,
      forecast: 0,
    };
    monthMap.set(month, created);
    return created;
  };
  for (let month = seriesStart; month <= query.toMonth; month = addCommission360Months(month, 1)) touch(month);
  let paidConfirmed = 0;
  let paidConfirmedCount = 0;
  for (const row of officialPayments) {
    if (!row.month || !inRange(row.month, query)) continue;
    const bucket = touch(row.month);
    bucket.paidConfirmed = roundMoney((bucket.paidConfirmed ?? 0) + row.amountPaid);
    paidConfirmed = roundMoney(paidConfirmed + row.amountPaid);
    paidConfirmedCount += 1;
  }
  let legacyUnconfirmed = 0;
  for (const [month, value] of paid.legacyByMonth) {
    if (!inRange(month, query)) continue;
    legacyUnconfirmed = roundMoney(legacyUnconfirmed + value);
    const bucket = legacyMonth(month);
    bucket.nomusLegacyCovered = roundMoney(bucket.nomusLegacyCovered + value);
  }
  for (const [month, value] of officialRealizedByMonth) {
    const bucket = touch(month);
    bucket.realized = roundMoney((bucket.realized ?? 0) + value);
  }
  let forecastTotal = 0;
  for (const row of forecastRows) {
    if (row.forecastCommission <= 0 || !row.dueMonth) continue;
    const bucket = touch(row.dueMonth);
    bucket.forecast = roundMoney(bucket.forecast + row.forecastCommission);
    forecastTotal = roundMoney(forecastTotal + row.forecastCommission);
  }

  const realizedAwaiting = roundMoney(realizedRows.reduce((sum, row) => sum + row.awaitingClosing, 0));
  const releasedNotPaid = roundMoney(released.reduce((sum, row) => sum + row.releasedNotPaid, 0));
  const releasedUnreconciled = roundMoney(released.reduce((sum, row) => sum + row.unreconciledAmount, 0));
  const potentialTotal = roundMoney(potentialRows.reduce((sum, row) => sum + row.pendingCommission, 0));
  const uncovered = crInRange.filter((row) => row.group === "SEM_COBERTURA" && (row.openBalance ?? 0) > 0);

  const cards: Commission360Cards = {
    paidConfirmed,
    paidConfirmedCount,
    legacyUnconfirmed,
    realizedAwaitingClosing: realizedAwaiting,
    releasedNotPaid,
    releasedUnreconciled,
    unmatchedPaymentsAmount: roundMoney(releasedResult.unmatchedPayments.reduce((sum, row) => sum + row.amount, 0)),
    unmatchedPaymentsCount: releasedResult.unmatchedPayments.length,
    forecastOnReceivables: forecastTotal,
    potentialOnOrders: potentialTotal,
    potentialToReconcileCount: potentialRows.reduce((sum, row) => sum + row.toReconcileItemCount, 0),
    uncoveredReceivablesCount: uncovered.length,
    uncoveredReceivablesBalance: roundMoney(uncovered.reduce((sum, row) => sum + (row.openBalance ?? 0), 0)),
  };

  // Por vendedor (cada natureza em sua coluna).
  const sellers = new Map<string, Commission360SellerRow>();
  const seller = (key: string, name: string, canonicalSellerId: string | null) => {
    const found = sellers.get(key);
    if (found) return found;
    const created: Commission360SellerRow = {
      key,
      canonicalSellerId,
      sellerName: name,
      paidConfirmed: 0,
      realizedAwaitingClosing: 0,
      releasedNotPaid: 0,
      forecast: 0,
      potential: 0,
    };
    sellers.set(key, created);
    return created;
  };
  for (const row of officialPayments) {
    if (!inRange(row.month, query)) continue;
    const s = seller(row.sellerKey, row.sellerName, row.sellerKey);
    s.paidConfirmed = roundMoney(s.paidConfirmed + row.amountPaid);
  }
  // Legado / ajustes por vendedor (seção separada, nunca na tabela principal).
  for (const row of paid.legacy) {
    if (row.supersededByConfirmedPayment || row.coveredCommissionAmount == null || !inRange(row.competence, query)) continue;
    const s = legacySeller(row.sellerKey, row.sellerName);
    s.nomusLegacyCovered = roundMoney(s.nomusLegacyCovered + row.coveredCommissionAmount);
  }
  for (const row of legacyPayments) {
    if (row.month != null && !inRange(row.month, query)) continue;
    const s = legacySeller(row.sellerKey, row.sellerName);
    s.legacyPayments = roundMoney(s.legacyPayments + row.amountPaid);
  }
  const retroactive = new Map<string, Commission360LegacySection["retroactiveLines"][number]>();
  let retroactiveReleasedTotal = 0;
  for (const line of facts.ledgerLines) {
    if (line.closingStatus !== "CLOSED" || (sellerFilter && line.canonicalSellerId !== sellerFilter)) continue;
    const competence = `${line.year}-${String(line.month).padStart(2, "0")}`;
    if (competence < series.officialStartMonth || !inRange(competence, query)) continue;
    if (isCommission360OperationalLedgerLine(line)) continue;
    const naturalMonth =
      line.naturalYear != null && line.naturalMonth != null ? `${line.naturalYear}-${String(line.naturalMonth).padStart(2, "0")}` : null;
    const inclusionType = line.inclusionType ?? "NORMAL";
    const key = `${competence}|${naturalMonth}|${line.sellerName}|${inclusionType}`;
    const row = retroactive.get(key) ?? { competence, naturalMonth, sellerName: line.sellerName, inclusionType, released: 0 };
    const amount = Math.max(0, line.releasedCommissionAmount);
    row.released = roundMoney(row.released + amount);
    retroactive.set(key, row);
    retroactiveReleasedTotal = roundMoney(retroactiveReleasedTotal + amount);
    const bucket = legacyMonth(naturalMonth ?? competence);
    bucket.retroactiveReleased = roundMoney(bucket.retroactiveReleased + amount);
    const s = legacySeller(sellerKeyOf(line.canonicalSellerId, line.rawSellerId), line.sellerName);
    s.retroactiveReleased = roundMoney(s.retroactiveReleased + amount);
  }
  for (const row of realizedRows) {
    const s = seller(sellerKeyOf(row.canonicalSellerId, null), row.sellerName, row.canonicalSellerId);
    s.realizedAwaitingClosing = roundMoney(s.realizedAwaitingClosing + row.awaitingClosing);
  }
  for (const row of released) {
    const s = seller(row.sellerKey, row.sellerName, row.canonicalSellerId);
    s.releasedNotPaid = roundMoney(s.releasedNotPaid + row.releasedNotPaid);
  }
  for (const row of forecastRows) {
    const s = seller(sellerKeyOf(row.canonicalSellerId, null), row.sellerName, row.canonicalSellerId);
    s.forecast = roundMoney(s.forecast + row.forecastCommission);
  }
  for (const row of potentialRows) {
    const s = seller(sellerKeyOf(row.canonicalSellerId, null), row.sellerName, row.canonicalSellerId);
    s.potential = roundMoney(s.potential + row.pendingCommission);
  }

  const detail: Commission360Payload["detail"] = {
    section: query.section,
    page: query.page,
    pageSize: query.pageSize,
    totalRows: 0,
  };
  if (query.section === "paid") {
    const payments = officialPayments
      .filter((row) => row.month == null || inRange(row.month, query))
      .sort((a, b) => ((a.paymentDate ?? "") < (b.paymentDate ?? "") ? 1 : -1));
    const legacy = paid.legacy.filter((row) => inRange(row.competence, query));
    detail.totalRows = payments.length + legacy.length;
    detail.payments = paginate(payments, query.page, query.pageSize);
    detail.legacy = paginate(legacy, query.page, query.pageSize);
  } else if (query.section === "realized") {
    detail.totalRows = realizedRows.length + released.length + releasedResult.unmatchedPayments.length;
    detail.realized = paginate(realizedRows, query.page, query.pageSize);
    detail.released = paginate(released, query.page, query.pageSize);
    detail.unmatchedPayments = paginate(releasedResult.unmatchedPayments, query.page, query.pageSize);
  } else if (query.section === "forecast") {
    detail.totalRows = forecastRows.length;
    detail.forecast = paginate(forecastRows, query.page, query.pageSize);
  } else if (query.section === "potential") {
    const pending = potentialRows
      .filter((row) => row.status !== "TOTALMENTE_FATURADO")
      .sort((a, b) => b.pendingCommission - a.pendingCommission);
    detail.totalRows = pending.length;
    detail.potential = paginate(pending, query.page, query.pageSize);
  } else {
    const rows = crInRange
      .filter((row) => !query.crStatus || row.status === query.crStatus)
      .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : (a.dueDate ?? "") > (b.dueDate ?? "") ? 1 : a.receivableId - b.receivableId));
    detail.totalRows = rows.length;
    detail.receivables = paginate(rows, query.page, query.pageSize);
  }

  const legacyPaymentsInRange = legacyPayments.filter((row) => row.month == null || inRange(row.month, query));
  const legacySection: Commission360LegacySection = {
    title: COMMISSION_360_LEGACY_SECTION_TITLE,
    note: COMMISSION_360_LEGACY_SECTION_NOTE,
    totals: {
      nomusLegacyCovered: legacyUnconfirmed,
      nomusLegacyCoveredCount: paid.legacy.filter(
        (row) => !row.supersededByConfirmedPayment && row.coveredCommissionAmount != null && inRange(row.competence, query)
      ).length,
      legacyRealized: legacyRealizedTotal,
      legacyAwaitingClosing: legacyAwaitingTotal,
      retroactiveReleased: retroactiveReleasedTotal,
      retroactiveNotPaid: roundMoney(released.reduce((sum, row) => sum + row.adjustmentNotPaid, 0)),
      legacyPayments: roundMoney(legacyPaymentsInRange.reduce((sum, row) => sum + row.amountPaid, 0)),
      legacyPaymentsCount: legacyPaymentsInRange.length,
      forecastBeforeStart: roundMoney(forecastBefore.reduce((sum, row) => sum + row.forecastCommission, 0)),
      forecastBeforeStartCount: forecastBefore.length,
    },
    byMonth: [...legacyByMonth.entries()]
      .map(([month, value]) => ({ month, label: commission360MonthLabel(month), ...value }))
      .sort((a, b) => (a.month < b.month ? -1 : 1)),
    bySeller: [...legacySellers.values()].sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR")),
    payments: legacyPaymentsInRange,
    retroactiveLines: [...retroactive.values()].sort((a, b) =>
      a.competence < b.competence ? -1 : a.competence > b.competence ? 1 : a.sellerName.localeCompare(b.sellerName, "pt-BR")
    ),
  };

  const limitations = [
    `Série principal: realizado e pago a partir de ${series.officialStartMonth}, previsão a partir de ${series.forecastStartMonth}. Legado e ajustes retroativos ficam fora (seção própria).`,
    "Saldos de 'Realizada aguardando fechamento' e 'Liberada e ainda não paga' são a posição atual; meses passados não são reconstruídos.",
    "Pagamentos em lote não têm cliente nem pedido: os filtros de cliente e pedido não se aplicam ao indicador de pagamentos.",
    "O histórico do Nomus não informa a data do desembolso ao vendedor; aparece separado como legado sem confirmação.",
    "A carteira de PVs não tem data confiável de faturamento: o potencial fica sem vencimento financeiro.",
    ...paid.anomalies,
  ];

  return {
    title: COMMISSION_360_TITLE,
    description: COMMISSION_360_DESCRIPTION,
    readOnlyNote: COMMISSION_360_READ_ONLY_NOTE,
    today,
    filters: {
      fromMonth: query.fromMonth,
      toMonth: query.toMonth,
      canonicalSellerId: query.canonicalSellerId,
      customer: query.customer,
      orderCode: query.orderCode,
      section: query.section,
      crStatus: query.crStatus,
    },
    sellerLocked: query.sellerLocked,
    cards,
    months: [...monthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    bySeller: [...sellers.values()].sort((a, b) => a.sellerName.localeCompare(b.sellerName, "pt-BR")),
    funnel: buildCommission360Funnel(crInRange),
    diagnostic: buildCommission360Diagnostic(crAll),
    detail,
    series,
    legacySection,
    sources: COMMISSION_360_SOURCES,
    limitations,
  };
}

/** CSV (separador ;) da seção de detalhe, sem paginação. */
export function buildCommission360ReceivablesCsv(rows: readonly Commission360CrRow[]): string {
  const header = [
    "Título",
    "NF-e",
    "Vencimento",
    "Cliente",
    "Pedido",
    "Vendedor",
    "Nominal",
    "Saldo aberto",
    "Classificação",
    "Motivo",
    "Comissão alocada",
    "Comissão futura",
    "Comissão realizada",
    "Fora da previsão",
    "Potencial sem cobertura",
    "Excesso de alocação do PV (R1)",
    "Schedules",
    "Snapshots",
  ];
  const cell = (value: unknown) => {
    let raw = value == null ? "" : typeof value === "number" ? value.toFixed(2).replace(".", ",") : String(value);
    // Texto vindo da origem (nome de cliente, motivo) nunca vira fórmula na planilha.
    if (typeof value === "string" && /^[=+\-@\t\r]/.test(raw)) raw = `'${raw}`;
    return /[;"\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  };
  const body = rows.map((row) =>
    [
      String(row.receivableId),
      row.invoiceNumber,
      row.dueDate,
      row.customerName,
      row.orderCode,
      row.sellerName,
      row.nominalAmount,
      row.openBalance,
      COMMISSION_360_CR_STATUS_META[row.status].label,
      row.reason,
      row.allocatedCommission,
      row.forecastCommission,
      row.realizedCommission,
      row.unreconciledCommission,
      row.potentialUncoveredCommission,
      row.orderOverAllocatedCommission,
      row.scheduleIds.join(" "),
      row.snapshotIds.join(" "),
    ]
      .map(cell)
      .join(";")
  );
  return [header.join(";"), ...body].join("\n");
}
