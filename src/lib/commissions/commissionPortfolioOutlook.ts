/**
 * Projeção de leitura: fluxo de comissão do vendedor.
 *
 * A comissão nasce no snapshot da venda e já está rateada em
 * CommissionReceivableSchedule.scheduledCommissionAmount. Este módulo não
 * recalcula o percentual comercial, não grava cobertura, fechamento nem pagamento.
 *
 * Competência do realizado: receiptDate.
 * Competência do previsto: dueDate da parte ainda não recebida.
 * settlementDate não entra.
 */
import { roundMoney } from "./commission-money.shared.js";

export const COMMISSION_PORTFOLIO_OUTLOOK_NOTE =
  "Projeção de leitura. A comissão continua a do pedido, rateada pelo CR. " +
  "Recebimento realiza pela data do recebimento. O que falta segue o vencimento. " +
  "Esta consulta não fecha mês, não cobre recebimento e não paga o vendedor.";

export type OutlookCoverageSource = "NOMUS_LEGACY" | "INDUSCOST_CLOSING" | "MANUAL_ADJUSTMENT";

export type OutlookReceiptInput = {
  externalId: number;
  receiptDate: string;
  receivedAmount: number;
  coverageSource: OutlookCoverageSource | null;
  coveredCommissionAmount: number | null;
};

export type OutlookScheduleInput = {
  scheduleId: string;
  scheduleStatus: string;
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  sellerResolutionStatus: string | null;
  nfeNumber: string | null;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  dueDate: string | null;
  /** Valor nominal comissionável do CR (não inclui juros). */
  nominalAmount: number;
  /** Comissão já rateada para este CR. */
  allocatedCommission: number;
  sharePercent: number;
  /** Saldo em aberto do CR na origem. null = título não encontrado. */
  balanceReceivable: number | null;
  /** amountReceived do título. Não substitui eventos de recebimento. */
  amountReceivedOnTitle: number | null;
  /** Pagamento ao vendedor já liquidado (lote PAID) neste CR. */
  paidToSellerAmount: number;
  receipts: OutlookReceiptInput[];
};

export type OutlookQuery = {
  fromMonth: string | null;
  toMonth: string | null;
  canonicalSellerId: string | null;
  customerId: string | null;
  orderCode: string | null;
  status: string | null;
  page: number;
  pageSize: number;
  /** Escopo próprio do vendedor logado. null = visão global. */
  ownNomusSellerId: number | null;
  sellerLocked: boolean;
};

export type OutlookReceiptEvent = {
  externalId: number;
  receiptDate: string;
  month: string;
  receivedAmount: number;
  eligibleAmount: number;
  excessAmount: number;
  realizedCommission: number;
  releasedCommission: number;
  paidCommission: number;
  coverageSource: OutlookCoverageSource | null;
};

export type OutlookLineStatus =
  | "PREVISTA"
  | "PARCIALMENTE_RECEBIDA"
  | "REALIZADA"
  | "LIBERADA"
  | "PAGA"
  | "VENCIDA_NAO_RECEBIDA"
  | "CUSTOMER_EXCLUDED"
  | "SEM_VENDEDOR"
  | "CANCELADA"
  | "INCONSISTENCIA_SEM_RECEBIMENTO";

export type OutlookLine = {
  scheduleId: string;
  salesOrderId: string;
  orderCode: string;
  customerId: string;
  customerName: string;
  canonicalSellerId: string | null;
  canonicalSellerName: string | null;
  rawSellerId: number | null;
  nfeNumber: string | null;
  receivableId: number;
  receivableCode: string | null;
  installmentNumber: number;
  dueDate: string | null;
  dueMonth: string | null;
  nominalAmount: number;
  balanceReceivable: number | null;
  eligibleReceived: number;
  allocatedCommission: number;
  sharePercent: number;
  realizedCommission: number;
  forecastCommission: number;
  releasedCommission: number;
  paidCommission: number;
  balanceToPay: number;
  awaitingClosing: number;
  status: OutlookLineStatus;
  daysOverdue: number | null;
  inconsistency: string | null;
  receipts: OutlookReceiptEvent[];
};

export type OutlookMonth = {
  month: string;
  label: string;
  kind: "past" | "current" | "future";
  realized: number;
  forecast: number;
  expected: number;
  released: number;
  paid: number;
  balanceToPay: number;
};

export type OutlookCards = {
  realized: number;
  forecast: number;
  expected: number;
  released: number;
  paid: number;
  balanceToPay: number;
  awaitingClosing: number;
  overdueForecast: number;
};

export type OutlookPayload = {
  note: string;
  today: string;
  cards: OutlookCards;
  months: OutlookMonth[];
  lines: OutlookLine[];
  page: number;
  pageSize: number;
  totalLines: number;
  sellerLocked: boolean;
};

const MONTH_LABELS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function outlookMonthLabel(month: string): string {
  const [year, mon] = month.split("-");
  const index = Number(mon) - 1;
  const name = MONTH_LABELS[index] ?? mon;
  return `${name}/${(year ?? "").slice(2)}`;
}

function monthOf(date: string | null): string | null {
  if (!date || date.length < 7) return null;
  return date.slice(0, 7);
}

function compareDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function civilDayDiff(later: string, earlier: string): number {
  const a = Date.parse(`${later}T00:00:00Z`);
  const b = Date.parse(`${earlier}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((a - b) / 86_400_000);
}

function inMonthRange(month: string, from: string | null, to: string | null): boolean {
  if (from && month < from) return false;
  if (to && month > to) return false;
  return true;
}

function economicStatus(input: {
  scheduleStatus: string;
  sellerMissing: boolean;
  inconsistency: boolean;
  allocated: number;
  realized: number;
  forecast: number;
  released: number;
  paid: number;
  overdue: boolean;
}): OutlookLineStatus {
  if (input.scheduleStatus === "CUSTOMER_EXCLUDED") return "CUSTOMER_EXCLUDED";
  if (
    input.scheduleStatus === "SUPERSEDED" ||
    input.scheduleStatus === "STALE" ||
    input.scheduleStatus === "ORPHAN" ||
    input.scheduleStatus === "CANCELLED"
  ) {
    return "CANCELADA";
  }
  if (input.sellerMissing) return "SEM_VENDEDOR";
  if (input.inconsistency) return "INCONSISTENCIA_SEM_RECEBIMENTO";
  if (input.allocated <= 0 && input.realized <= 0) return "PREVISTA";
  if (input.realized > 0 && input.forecast <= 0 && input.paid + 0.001 >= input.realized) return "PAGA";
  if (input.realized > 0 && input.forecast <= 0 && input.released + 0.001 >= input.realized && input.paid + 0.001 < input.realized) {
    return "LIBERADA";
  }
  if (input.realized > 0 && input.forecast <= 0) return "REALIZADA";
  if (input.realized > 0 && input.forecast > 0) return "PARCIALMENTE_RECEBIDA";
  if (input.overdue && input.forecast > 0) return "VENCIDA_NAO_RECEBIDA";
  return "PREVISTA";
}

function projectSchedule(fact: OutlookScheduleInput, today: string): OutlookLine {
  const nominal = roundMoney(Math.max(0, fact.nominalAmount));
  const storedAllocated = roundMoney(Math.max(0, fact.allocatedCommission));
  const excluded =
    fact.scheduleStatus === "CUSTOMER_EXCLUDED" ||
    fact.scheduleStatus === "SUPERSEDED" ||
    fact.scheduleStatus === "STALE" ||
    fact.scheduleStatus === "ORPHAN" ||
    fact.scheduleStatus === "CANCELLED";
  const sellerMissing =
    !excluded &&
    (fact.sellerResolutionStatus === "NO_SELLER" ||
      fact.sellerResolutionStatus === "SELLER_UNRESOLVED" ||
      (fact.canonicalSellerId == null && fact.rawSellerId == null));
  const allocated = excluded || sellerMissing ? 0 : storedAllocated;

  const seen = new Set<number>();
  const receipts = [...fact.receipts]
    .filter((row) => {
      if (seen.has(row.externalId)) return false;
      seen.add(row.externalId);
      return true;
    })
    .sort((a, b) => compareDate(a.receiptDate, b.receiptDate) || a.externalId - b.externalId);

  const settledWithoutReceipt =
    receipts.length === 0 &&
    fact.balanceReceivable === 0 &&
    roundMoney(fact.amountReceivedOnTitle ?? 0) > 0;

  let eligibleUsed = 0;
  const drafted = receipts.map((row) => {
    const room = roundMoney(nominal - eligibleUsed);
    const gross = roundMoney(Math.max(0, row.receivedAmount));
    const eligible = settledWithoutReceipt ? 0 : roundMoney(Math.min(gross, Math.max(0, room)));
    eligibleUsed = roundMoney(eligibleUsed + eligible);
    return {
      row,
      eligible,
      excess: roundMoney(Math.max(0, gross - eligible)),
    };
  });

  const realizedTarget =
    nominal > 0 ? roundMoney((allocated * eligibleUsed) / nominal) : 0;
  const realizedCap = roundMoney(Math.min(allocated, realizedTarget));
  let assigned = 0;
  let lastEligible = -1;
  drafted.forEach((row, index) => {
    if (row.eligible > 0) lastEligible = index;
  });

  const events: OutlookReceiptEvent[] = drafted.map((row, index) => {
    let realized = 0;
    if (!settledWithoutReceipt && row.eligible > 0 && nominal > 0) {
      if (index === lastEligible) {
        realized = roundMoney(realizedCap - assigned);
      } else {
        realized = roundMoney((allocated * row.eligible) / nominal);
        assigned = roundMoney(assigned + realized);
      }
    }
    const covered = row.row.coverageSource != null;
    const released = covered ? realized : 0;
    const legacyPaid =
      row.row.coverageSource === "NOMUS_LEGACY" || row.row.coverageSource === "MANUAL_ADJUSTMENT"
        ? roundMoney(row.row.coveredCommissionAmount ?? realized)
        : 0;
    return {
      externalId: row.row.externalId,
      receiptDate: row.row.receiptDate,
      month: monthOf(row.row.receiptDate) ?? "",
      receivedAmount: roundMoney(Math.max(0, row.row.receivedAmount)),
      eligibleAmount: row.eligible,
      excessAmount: row.excess,
      realizedCommission: realized,
      releasedCommission: released,
      paidCommission: roundMoney(Math.min(legacyPaid, realized)),
      coverageSource: row.row.coverageSource,
    };
  });

  const realized = settledWithoutReceipt
    ? 0
    : roundMoney(events.reduce((sum, row) => sum + row.realizedCommission, 0));
  const forecast = settledWithoutReceipt ? 0 : roundMoney(Math.max(0, allocated - realized));
  const releasedFromReceipts = roundMoney(
    events.reduce((sum, row) => sum + row.releasedCommission, 0)
  );
  const legacyPaid = roundMoney(events.reduce((sum, row) => sum + row.paidCommission, 0));
  const batchPaid = roundMoney(Math.max(0, fact.paidToSellerAmount));
  const released = roundMoney(Math.min(realized, Math.max(releasedFromReceipts, Math.min(batchPaid, realized))));
  const paid = roundMoney(Math.min(realized, legacyPaid + batchPaid));
  const balanceToPay = roundMoney(Math.max(0, released - Math.min(paid, released)));
  const awaitingClosing = roundMoney(Math.max(0, realized - released));
  const dueMonth = monthOf(fact.dueDate);
  const overdue = Boolean(fact.dueDate && fact.dueDate < today && forecast > 0);
  const status = economicStatus({
    scheduleStatus: fact.scheduleStatus,
    sellerMissing,
    inconsistency: settledWithoutReceipt,
    allocated,
    realized,
    forecast,
    released,
    paid,
    overdue,
  });

  return {
    scheduleId: fact.scheduleId,
    salesOrderId: fact.salesOrderId,
    orderCode: fact.orderCode,
    customerId: fact.customerId,
    customerName: fact.customerName,
    canonicalSellerId: fact.canonicalSellerId,
    canonicalSellerName: fact.canonicalSellerName,
    rawSellerId: fact.rawSellerId,
    nfeNumber: fact.nfeNumber,
    receivableId: fact.receivableId,
    receivableCode: fact.receivableCode,
    installmentNumber: fact.installmentNumber,
    dueDate: fact.dueDate,
    dueMonth,
    nominalAmount: nominal,
    balanceReceivable: fact.balanceReceivable,
    eligibleReceived: settledWithoutReceipt ? 0 : eligibleUsed,
    allocatedCommission: allocated,
    sharePercent: fact.sharePercent,
    realizedCommission: realized,
    forecastCommission: forecast,
    releasedCommission: released,
    paidCommission: roundMoney(Math.min(paid, realized)),
    balanceToPay,
    awaitingClosing,
    status,
    daysOverdue: overdue && fact.dueDate ? civilDayDiff(today, fact.dueDate) : null,
    inconsistency: settledWithoutReceipt
      ? "Título baixado na origem sem evento de recebimento. A previsão não inventa receiptDate."
      : null,
    receipts: events,
  };
}

function lineVisible(line: OutlookLine, query: OutlookQuery): boolean {
  if (query.ownNomusSellerId != null && line.rawSellerId !== query.ownNomusSellerId) return false;
  if (query.canonicalSellerId && line.canonicalSellerId !== query.canonicalSellerId) return false;
  if (query.customerId && line.customerId !== query.customerId) return false;
  if (query.orderCode && !line.orderCode.toLowerCase().includes(query.orderCode.toLowerCase())) return false;
  if (query.status && line.status !== query.status) return false;
  if (!query.fromMonth && !query.toMonth) return true;
  const months = new Set<string>();
  for (const receipt of line.receipts) {
    if (receipt.month) months.add(receipt.month);
  }
  if (line.forecastCommission > 0 && line.dueMonth) months.add(line.dueMonth);
  if (months.size === 0) return false;
  for (const month of months) {
    if (inMonthRange(month, query.fromMonth, query.toMonth)) return true;
  }
  return false;
}

function monthKind(month: string, todayMonth: string): OutlookMonth["kind"] {
  if (month < todayMonth) return "past";
  if (month > todayMonth) return "future";
  return "current";
}

export function buildCommissionPortfolioOutlook(
  facts: readonly OutlookScheduleInput[],
  query: OutlookQuery,
  today: string
): OutlookPayload {
  const projected = facts.map((fact) => projectSchedule(fact, today)).filter((line) => lineVisible(line, query));
  const from = query.fromMonth;
  const to = query.toMonth;

  const cards: OutlookCards = {
    realized: 0,
    forecast: 0,
    expected: 0,
    released: 0,
    paid: 0,
    balanceToPay: 0,
    awaitingClosing: 0,
    overdueForecast: 0,
  };
  const monthMap = new Map<string, OutlookMonth>();

  const touch = (month: string) => {
    const current = monthMap.get(month);
    if (current) return current;
    const created: OutlookMonth = {
      month,
      label: outlookMonthLabel(month),
      kind: monthKind(month, today.slice(0, 7)),
      realized: 0,
      forecast: 0,
      expected: 0,
      released: 0,
      paid: 0,
      balanceToPay: 0,
    };
    monthMap.set(month, created);
    return created;
  };

  for (const line of projected) {
    let lastPaidMonth: string | null = null;
    for (const receipt of line.receipts) {
      if (!receipt.month || !inMonthRange(receipt.month, from, to)) continue;
      const bucket = touch(receipt.month);
      bucket.realized = roundMoney(bucket.realized + receipt.realizedCommission);
      bucket.released = roundMoney(bucket.released + receipt.releasedCommission);
      bucket.paid = roundMoney(bucket.paid + receipt.paidCommission);
      cards.realized = roundMoney(cards.realized + receipt.realizedCommission);
      cards.released = roundMoney(cards.released + receipt.releasedCommission);
      cards.paid = roundMoney(cards.paid + receipt.paidCommission);
      lastPaidMonth = receipt.month;
    }
    const paidOnReceipts = roundMoney(
      line.receipts.reduce((sum, receipt) => sum + receipt.paidCommission, 0)
    );
    const batchPaid = roundMoney(Math.max(0, line.paidCommission - paidOnReceipts));
    if (batchPaid > 0 && lastPaidMonth) {
      const bucket = touch(lastPaidMonth);
      bucket.paid = roundMoney(bucket.paid + batchPaid);
      cards.paid = roundMoney(cards.paid + batchPaid);
    }
    if (line.forecastCommission > 0 && line.dueMonth && inMonthRange(line.dueMonth, from, to)) {
      const bucket = touch(line.dueMonth);
      bucket.forecast = roundMoney(bucket.forecast + line.forecastCommission);
      cards.forecast = roundMoney(cards.forecast + line.forecastCommission);
      if (line.daysOverdue != null) {
        cards.overdueForecast = roundMoney(cards.overdueForecast + line.forecastCommission);
      }
    }
    const lineInPeriod =
      (!from && !to) ||
      line.receipts.some((receipt) => receipt.month && inMonthRange(receipt.month, from, to)) ||
      (line.dueMonth != null && line.forecastCommission > 0 && inMonthRange(line.dueMonth, from, to));
    if (lineInPeriod) {
      cards.awaitingClosing = roundMoney(cards.awaitingClosing + line.awaitingClosing);
    }
  }

  cards.expected = roundMoney(cards.realized + cards.forecast);
  cards.balanceToPay = roundMoney(Math.max(0, cards.released - cards.paid));

  const months = [...monthMap.values()]
    .sort((a, b) => compareDate(a.month, b.month))
    .map((row) => ({
      ...row,
      expected: roundMoney(row.realized + row.forecast),
      balanceToPay: roundMoney(Math.max(0, row.released - row.paid)),
    }));

  const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
  const page = Math.max(1, query.page || 1);
  const start = (page - 1) * pageSize;

  return {
    note: COMMISSION_PORTFOLIO_OUTLOOK_NOTE,
    today,
    cards,
    months,
    lines: projected.slice(start, start + pageSize),
    page,
    pageSize,
    totalLines: projected.length,
    sellerLocked: query.sellerLocked || query.ownNomusSellerId != null,
  };
}

export function outlookInvariantsHold(line: OutlookLine): boolean {
  if (roundMoney(line.realizedCommission + line.forecastCommission) > roundMoney(line.allocatedCommission + 0.001)) {
    return false;
  }
  if (line.eligibleReceived > roundMoney(line.nominalAmount + 0.001)) return false;
  if (line.paidCommission > roundMoney(line.realizedCommission + 0.001)) return false;
  const ids = line.receipts.map((row) => row.externalId);
  if (new Set(ids).size !== ids.length) return false;
  return true;
}
