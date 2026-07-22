/**
 * Extração de linhas da agenda efetiva para o relatório mensal (OP-08).
 * Reutiliza FIN-08 (`buildFinanceArEffectiveTitles`) — não reimplementa substituição.
 */
import type { FinanceArDashboardRow } from "@/src/lib/financeAccountsReceivableDashboard.js";
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import {
  buildFinanceArEffectiveTitles,
  FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL,
  type FinanceArEffectiveLineKind,
  type FinanceArEffectiveTitleListItem,
} from "@/src/lib/finance/financeAccountsReceivableEffectiveTitles.js";
import type { SalesOrderEffectiveFinancialSchedule } from "@/src/lib/finance/salesOrderEffectiveFinancialSchedule.js";
import {
  accumulateMonthCell,
  classifyMonthlyReceivablesQuality,
  emptyMonthCell,
  qualityStatusLabel,
  yearMonthKeyFromDueIso,
  type SalesOrderMonthlyReceivablesCell,
  type SalesOrderMonthlyReceivablesDetailLine,
  type SalesOrderMonthlyReceivablesFinancialSituation,
  type SalesOrderMonthlyReceivablesOriginFilter,
  type SalesOrderMonthlyReceivablesRow,
} from "./salesOrderMonthlyReceivablesReport.js";

function decimalToNumber(value: { toFixed(dp: number): string } | number | string): number {
  if (typeof value === "number") return roundMoney(value);
  if (typeof value === "string") return roundMoney(Number(value));
  return roundMoney(Number(value.toFixed(2)));
}

function parseIsoDateLocal(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Converte agenda FIN-05 → linhas FIN-08 (paridade Contas a Receber por pedido).
 * CR vem de `schedule.realReceivables` (sem grid Nomus externo).
 */
export function listEffectiveReceivableLinesFromSchedule(input: {
  schedule: SalesOrderEffectiveFinancialSchedule;
  personId?: number | null;
  personName?: string | null;
  personCnpj?: string | null;
  companyName?: string | null;
  referenceDate?: Date;
}): FinanceArEffectiveTitleListItem[] {
  const referenceDate = input.referenceDate ?? new Date();
  const { schedule } = input;
  const nomusRows: FinanceArDashboardRow[] = schedule.realReceivables.map((cr) => ({
    externalId: cr.externalId,
    companyName: input.companyName ?? null,
    personId: input.personId ?? null,
    personName: input.personName ?? null,
    personCnpj: input.personCnpj ?? null,
    description: `CR ${cr.externalId} · Pedido ${schedule.orderCode}`,
    comments: null,
    dueDate: parseIsoDateLocal(cr.dueDate),
    competenceDate: null,
    settlementDate: null,
    amountReceivable: decimalToNumber(cr.amountReceivable),
    amountReceived: decimalToNumber(cr.amountReceived),
    balanceReceivable: decimalToNumber(cr.balanceReceivable),
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: cr.sourceInvoiceId,
    sourceInvoiceNumber:
      cr.sourceInvoiceId != null ? String(cr.sourceInvoiceId) : null,
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: referenceDate,
  }));

  return buildFinanceArEffectiveTitles({
    nomusRows,
    orderContexts: [
      {
        schedule,
        personId: input.personId ?? null,
        personName: input.personName ?? null,
        personCnpj: input.personCnpj ?? null,
        companyName: input.companyName ?? null,
      },
    ],
    referenceDate,
  }).items;
}

function situationLabel(status: string): string {
  switch (status) {
    case "overdue":
      return "Vencido";
    case "dueToday":
      return "Vence hoje";
    case "upcoming":
      return "A vencer";
    case "settled":
    case "received":
      return "Recebido";
    case "partial":
      return "Parcialmente recebido";
    case "open":
      return "Aberto";
    default:
      return status || "—";
  }
}

function normalizeSituation(item: FinanceArEffectiveTitleListItem): string {
  if (item.amountReceived > 0.009 && item.balanceReceivable > 0.009) {
    return "partial";
  }
  if (item.balanceReceivable <= 0.009 && item.amountReceived > 0.009) {
    return "received";
  }
  if (
    item.lineKind === "ORDER_PLAN_FORECAST" ||
    item.lineKind === "ORDER_RESIDUAL_FORECAST"
  ) {
    if (item.calculatedStatus === "overdue") return "overdue";
    return "planned";
  }
  return item.calculatedStatus || "open";
}

export function lineMatchesFinancialSituation(
  item: FinanceArEffectiveTitleListItem,
  filter: SalesOrderMonthlyReceivablesFinancialSituation
): boolean {
  if (filter === "all") return true;
  const sit = normalizeSituation(item);
  if (filter === "planned") {
    return (
      item.lineKind === "ORDER_PLAN_FORECAST" ||
      item.lineKind === "ORDER_RESIDUAL_FORECAST"
    );
  }
  if (filter === "open") {
    return sit === "open" || sit === "upcoming" || sit === "dueToday" || sit === "planned";
  }
  if (filter === "overdue") return sit === "overdue";
  if (filter === "received") return sit === "received" || sit === "settled";
  if (filter === "partial") return sit === "partial";
  return true;
}

export function lineMatchesOrigin(
  item: FinanceArEffectiveTitleListItem,
  filter: SalesOrderMonthlyReceivablesOriginFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "cr") return item.lineKind === "CR_REAL";
  if (filter === "document") return item.lineKind === "DOCUMENT_AWAITING_CR";
  if (filter === "planned") {
    return (
      item.lineKind === "ORDER_PLAN_FORECAST" ||
      item.lineKind === "ORDER_RESIDUAL_FORECAST"
    );
  }
  return true;
}

export function mapEffectiveLineToDetail(
  item: FinanceArEffectiveTitleListItem
): SalesOrderMonthlyReceivablesDetailLine {
  const sit = normalizeSituation(item);
  const installmentMatch = item.description?.match(/Parcela\s+(\d+)/i);
  return {
    lineId: `${item.lineKind}:${item.externalId}:${item.dueDate ?? "x"}`,
    installmentLabel: installmentMatch ? `Parcela ${installmentMatch[1]}` : null,
    dueDate: item.dueDate,
    amount: item.amountReceivable,
    amountReceived: item.amountReceived,
    balance: item.balanceReceivable,
    settlementDate: item.settlementDate,
    situation: sit,
    situationLabel: situationLabel(sit),
    origin: item.lineKind,
    originLabel: FINANCE_AR_EFFECTIVE_LINE_KIND_LABEL[item.lineKind],
    description: item.description,
    sourceInvoiceNumber: item.sourceInvoiceNumber,
    receivableExternalId: item.lineKind === "CR_REAL" ? item.externalId : null,
  };
}

export function buildMonthlyReceivablesRowFromLines(input: {
  salesOrderId: string;
  orderCode: string;
  customerName: string;
  issueDate: string | null;
  sellerName: string;
  status: string;
  statusLabel: string;
  orderCommercialTotal: number;
  monthKeys: readonly string[];
  lines: FinanceArEffectiveTitleListItem[];
  hasIncompleteAgenda?: boolean;
  hasLinkWarning?: boolean;
  warnings?: string[];
}): SalesOrderMonthlyReceivablesRow {
  const monthSet = new Set(input.monthKeys);
  const months: Record<string, SalesOrderMonthlyReceivablesCell> = {};
  for (const key of input.monthKeys) {
    months[key] = emptyMonthCell();
  }

  let effectiveScheduleTotal = 0;
  let periodScheduleTotal = 0;
  let outsidePeriodTotal = 0;
  const origins = new Set<FinanceArEffectiveLineKind>();

  for (const line of input.lines) {
    const amount = line.amountReceivable;
    effectiveScheduleTotal += amount;
    origins.add(line.lineKind);
    const monthKey = yearMonthKeyFromDueIso(line.dueDate);
    if (monthKey && monthSet.has(monthKey)) {
      periodScheduleTotal += amount;
      months[monthKey] = accumulateMonthCell(months[monthKey]!, {
        amount,
        amountReceived: line.amountReceived,
        balance: line.balanceReceivable,
        situation: normalizeSituation(line),
        origin: line.lineKind,
      });
    } else {
      outsidePeriodTotal += amount;
    }
  }

  const qualityStatus = classifyMonthlyReceivablesQuality({
    orderCommercialTotal: input.orderCommercialTotal,
    effectiveScheduleTotal: roundMoney(effectiveScheduleTotal),
    titleCount: input.lines.length,
    hasIncompleteAgenda: Boolean(input.hasIncompleteAgenda),
    hasLinkWarning: Boolean(input.hasLinkWarning),
  });

  let originFilterHint: SalesOrderMonthlyReceivablesOriginFilter = "all";
  if (origins.size === 1) {
    const only = [...origins][0]!;
    if (only === "CR_REAL") originFilterHint = "cr";
    else if (only === "DOCUMENT_AWAITING_CR") originFilterHint = "document";
    else originFilterHint = "planned";
  } else if (origins.size > 1) {
    originFilterHint = "mixed";
  }
  void originFilterHint;

  return {
    salesOrderId: input.salesOrderId,
    orderCode: input.orderCode,
    customerName: input.customerName,
    issueDate: input.issueDate,
    sellerName: input.sellerName,
    status: input.status,
    statusLabel: input.statusLabel,
    orderCommercialTotal: roundMoney(input.orderCommercialTotal),
    effectiveScheduleTotal: roundMoney(effectiveScheduleTotal),
    periodScheduleTotal: roundMoney(periodScheduleTotal),
    outsidePeriodTotal: roundMoney(outsidePeriodTotal),
    difference: roundMoney(effectiveScheduleTotal - input.orderCommercialTotal),
    qualityStatus,
    qualityStatusLabel: qualityStatusLabel(qualityStatus),
    months,
    hasIncompleteAgenda: Boolean(input.hasIncompleteAgenda),
    warnings: input.warnings ?? [],
  };
}

export function rowMatchesOriginFilter(
  row: SalesOrderMonthlyReceivablesRow,
  filter: SalesOrderMonthlyReceivablesOriginFilter
): boolean {
  if (filter === "all") return true;
  const kinds = new Set<string>();
  for (const cell of Object.values(row.months)) {
    if (!cell.sourceSummary) continue;
    for (const part of cell.sourceSummary.split("+")) {
      if (part === "CR") kinds.add("cr");
      if (part === "Doc") kinds.add("document");
      if (part === "Prev") kinds.add("planned");
    }
  }
  if (filter === "mixed") return kinds.size > 1;
  return kinds.has(filter) && kinds.size === 1;
}
