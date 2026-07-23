/**
 * Contrato frontend-safe — Relatório “Recebíveis mensais por Pedido de Venda” (OP-08).
 * Consumidor somente-leitura de FIN-05/FIN-08. Sem Prisma.
 */
import { roundMoney } from "@/src/lib/commissions/commission-money.shared.js";
import type { FinanceArEffectiveLineKind } from "@/src/lib/finance/financeAccountsReceivableEffectiveTitles.js";
import {
  buildSalesOrderReportFilterLabels,
  type SalesOrderReportFilterLabel,
} from "./salesOrderReport.js";

export const SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_TITLE =
  "Recebíveis mensais por Pedido de Venda";
export const SALES_ORDER_MONTHLY_RECEIVABLES_REPORT_SUBTITLE =
  "Agenda financeira efetiva (FIN-05/FIN-08) agrupada por mês de vencimento";
export const SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS = 24;
export const SALES_ORDER_MONTHLY_RECEIVABLES_DEFAULT_HORIZON_MONTHS = 12;
export const SALES_ORDER_MONTHLY_RECEIVABLES_ROWS_LIMIT = 500;
export const SALES_ORDER_MONTHLY_RECEIVABLES_PAGE_SIZE_DEFAULT = 50;

export type SalesOrderMonthlyReceivablesQualityStatus =
  | "OK"
  | "DIFERENCA_EXPLICAVEL"
  | "AGENDA_INCOMPLETA"
  | "VINCULO_INCOMPLETO"
  | "SEM_AGENDA"
  | "REVISAR";

export type SalesOrderMonthlyReceivablesFinancialSituation =
  | "all"
  | "planned"
  | "open"
  | "overdue"
  | "received"
  | "partial";

export type SalesOrderMonthlyReceivablesOriginFilter =
  | "all"
  | "planned"
  | "document"
  | "cr"
  | "mixed";

export type SalesOrderMonthlyReceivablesMonthKey = string; // YYYY-MM

export type SalesOrderMonthlyReceivablesMonthColumn = {
  key: SalesOrderMonthlyReceivablesMonthKey;
  label: string; // Jan/2026
  year: number;
  month: number;
};

export type SalesOrderMonthlyReceivablesCell = {
  amount: number;
  titleCount: number;
  openAmount: number;
  receivedAmount: number;
  overdueAmount: number;
  plannedAmount: number;
  sourceSummary: string;
};

export type SalesOrderMonthlyReceivablesRow = {
  salesOrderId: string;
  orderCode: string;
  customerName: string;
  issueDate: string | null;
  sellerName: string;
  status: string;
  statusLabel: string;
  orderCommercialTotal: number;
  effectiveScheduleTotal: number;
  periodScheduleTotal: number;
  outsidePeriodTotal: number;
  difference: number;
  qualityStatus: SalesOrderMonthlyReceivablesQualityStatus;
  qualityStatusLabel: string;
  months: Record<SalesOrderMonthlyReceivablesMonthKey, SalesOrderMonthlyReceivablesCell>;
  hasIncompleteAgenda: boolean;
  warnings: string[];
};

export type SalesOrderMonthlyReceivablesTotals = {
  orderCommercialTotal: number;
  effectiveScheduleTotal: number;
  periodScheduleTotal: number;
  outsidePeriodTotal: number;
  difference: number;
  orderCount: number;
  titleCount: number;
  monthly: Record<
    SalesOrderMonthlyReceivablesMonthKey,
    { amount: number; titleCount: number }
  >;
};

export type SalesOrderMonthlyReceivablesDetailLine = {
  lineId: string;
  installmentLabel: string | null;
  dueDate: string | null;
  amount: number;
  amountReceived: number;
  balance: number;
  settlementDate: string | null;
  situation: string;
  situationLabel: string;
  origin: FinanceArEffectiveLineKind;
  originLabel: string;
  description: string | null;
  sourceInvoiceNumber: string | null;
  receivableExternalId: number | null;
};

export type SalesOrderMonthlyReceivablesDetailPayload = {
  salesOrderId: string;
  orderCode: string;
  customerName: string;
  monthKey: SalesOrderMonthlyReceivablesMonthKey | null;
  monthLabel: string | null;
  totalAmount: number;
  titleCount: number;
  lines: SalesOrderMonthlyReceivablesDetailLine[];
};

export type SalesOrderMonthlyReceivablesReportFilters = {
  customerId: string;
  customerName: string | null;
  status: string;
  sellerKey: string;
  sellerLabel: string | null;
  startDate: string | null;
  endDate: string | null;
  year: number | null;
  month: number | null;
  search: string;
  dueMonthFrom: string;
  dueMonthTo: string;
  issueDateFrom: string | null;
  issueDateTo: string | null;
  financialSituation: SalesOrderMonthlyReceivablesFinancialSituation;
  origin: SalesOrderMonthlyReceivablesOriginFilter;
  onlyDivergent: boolean;
  onlyIncompleteAgenda: boolean;
  includeCancelled: boolean;
  company: string | null;
  orderCode: string | null;
};

export type SalesOrderMonthlyReceivablesReportPayload = {
  generatedAt: string;
  emitterName: string | null;
  title: string;
  subtitle: string;
  filters: SalesOrderMonthlyReceivablesReportFilters;
  filterLabels: SalesOrderReportFilterLabel[];
  period: {
    startMonth: string;
    endMonth: string;
    months: SalesOrderMonthlyReceivablesMonthColumn[];
    monthCount: number;
    maxMonths: number;
    periodTooWide: boolean;
  };
  totals: SalesOrderMonthlyReceivablesTotals;
  pagination: {
    page: number;
    pageSize: number;
    totalRows: number;
    totalPages: number;
  };
  rows: SalesOrderMonthlyReceivablesRow[];
  truncated: boolean;
  totalOrdersInScope: number;
  rowsLimit: number;
  warnings: string[];
};

export {
  buildSalesOrderReportFilterLabels,
};

const MONTH_LABELS_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export function parseYearMonthKey(raw: string | null | undefined): {
  year: number;
  month: number;
} | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(String(raw).trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Chave YYYY-MM do mês civil corrente (referência local). */
export function currentYearMonthKey(referenceDate = new Date()): string {
  return formatYearMonthKey(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1
  );
}

/**
 * scrollLeft para alinhar a coluna do mês à direita das colunas sticky
 * (Pedido / Cliente / Valor pedido).
 */
export function scrollLeftToAlignMonthAfterSticky(args: {
  monthOffsetLeft: number;
  stickyRightOffset: number;
}): number {
  const month = Number.isFinite(args.monthOffsetLeft) ? args.monthOffsetLeft : 0;
  const sticky = Number.isFinite(args.stickyRightOffset)
    ? args.stickyRightOffset
    : 0;
  return Math.max(0, Math.round(month - sticky));
}

export function formatYearMonthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function yearMonthKeyFromDueIso(dueIso: string | null | undefined): string | null {
  if (!dueIso) return null;
  const m = /^(\d{4})-(\d{2})/.exec(dueIso);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(dueIso);
  if (!Number.isFinite(d.getTime())) return null;
  return formatYearMonthKey(d.getFullYear(), d.getMonth() + 1);
}

export function buildMonthColumns(
  startKey: string,
  endKey: string
): SalesOrderMonthlyReceivablesMonthColumn[] {
  const start = parseYearMonthKey(startKey);
  const end = parseYearMonthKey(endKey);
  if (!start || !end) return [];
  const out: SalesOrderMonthlyReceivablesMonthColumn[] = [];
  let y = start.year;
  let m = start.month;
  while (y < end.year || (y === end.year && m <= end.month)) {
    out.push({
      key: formatYearMonthKey(y, m),
      label: `${MONTH_LABELS_PT[m - 1]}/${y}`,
      year: y,
      month: m,
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > SALES_ORDER_MONTHLY_RECEIVABLES_MAX_MONTHS + 2) break;
  }
  return out;
}

export function defaultDueMonthRange(referenceDate = new Date()): {
  dueMonthFrom: string;
  dueMonthTo: string;
} {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth() + 1;
  const from = formatYearMonthKey(y, m);
  let ey = y;
  let em = m + (SALES_ORDER_MONTHLY_RECEIVABLES_DEFAULT_HORIZON_MONTHS - 1);
  while (em > 12) {
    em -= 12;
    ey += 1;
  }
  return { dueMonthFrom: from, dueMonthTo: formatYearMonthKey(ey, em) };
}

/**
 * Filtro inicial da UI: ano calendário corrente (emissão + vencimento).
 * Alinha a tela ao padrão de Pedidos de Venda (ano atual).
 */
export function defaultMonthlyReceivablesYearFilters(referenceDate = new Date()): {
  dueMonthFrom: string;
  dueMonthTo: string;
  startDate: string;
  endDate: string;
  year: number;
} {
  const year = referenceDate.getFullYear();
  return {
    year,
    dueMonthFrom: formatYearMonthKey(year, 1),
    dueMonthTo: formatYearMonthKey(year, 12),
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
}

export function emptyMonthCell(): SalesOrderMonthlyReceivablesCell {
  return {
    amount: 0,
    titleCount: 0,
    openAmount: 0,
    receivedAmount: 0,
    overdueAmount: 0,
    plannedAmount: 0,
    sourceSummary: "",
  };
}

export function qualityStatusLabel(
  status: SalesOrderMonthlyReceivablesQualityStatus
): string {
  switch (status) {
    case "OK":
      return "OK";
    case "DIFERENCA_EXPLICAVEL":
      return "Diferença explicável";
    case "AGENDA_INCOMPLETA":
      return "Agenda incompleta";
    case "VINCULO_INCOMPLETO":
      return "Vínculo incompleto";
    case "SEM_AGENDA":
      return "Sem agenda";
    case "REVISAR":
      return "Revisar";
    default:
      return status;
  }
}

export function classifyMonthlyReceivablesQuality(input: {
  orderCommercialTotal: number;
  effectiveScheduleTotal: number;
  titleCount: number;
  hasIncompleteAgenda: boolean;
  hasLinkWarning: boolean;
}): SalesOrderMonthlyReceivablesQualityStatus {
  if (input.titleCount <= 0 && input.effectiveScheduleTotal <= 0.009) {
    return "SEM_AGENDA";
  }
  if (input.hasIncompleteAgenda) return "AGENDA_INCOMPLETA";
  if (input.hasLinkWarning) return "VINCULO_INCOMPLETO";
  const diff = roundMoney(input.effectiveScheduleTotal - input.orderCommercialTotal);
  if (Math.abs(diff) <= 1) return "OK";
  if (Math.abs(diff) <= Math.max(50, input.orderCommercialTotal * 0.05)) {
    return "DIFERENCA_EXPLICAVEL";
  }
  return "REVISAR";
}

export function accumulateMonthCell(
  cell: SalesOrderMonthlyReceivablesCell,
  line: {
    amount: number;
    amountReceived: number;
    balance: number;
    situation: string;
    origin: FinanceArEffectiveLineKind;
  }
): SalesOrderMonthlyReceivablesCell {
  const next = { ...cell };
  next.amount = roundMoney(next.amount + line.amount);
  next.titleCount += 1;
  next.receivedAmount = roundMoney(next.receivedAmount + line.amountReceived);
  if (line.situation === "overdue") {
    next.overdueAmount = roundMoney(next.overdueAmount + line.balance);
  } else if (line.situation === "settled" || line.situation === "received") {
    // já em receivedAmount
  } else {
    next.openAmount = roundMoney(next.openAmount + line.balance);
  }
  if (
    line.origin === "ORDER_PLAN_FORECAST" ||
    line.origin === "ORDER_RESIDUAL_FORECAST"
  ) {
    next.plannedAmount = roundMoney(next.plannedAmount + line.amount);
  }
  const tag =
    line.origin === "CR_REAL"
      ? "CR"
      : line.origin === "DOCUMENT_AWAITING_CR"
        ? "Doc"
        : "Prev";
  if (!next.sourceSummary.includes(tag)) {
    next.sourceSummary = next.sourceSummary
      ? `${next.sourceSummary}+${tag}`
      : tag;
  }
  return next;
}

export function computeMonthlyReceivablesTotalsFromRows(
  rows: ReadonlyArray<SalesOrderMonthlyReceivablesRow>,
  monthKeys: readonly string[]
): SalesOrderMonthlyReceivablesTotals {
  const monthly: SalesOrderMonthlyReceivablesTotals["monthly"] = {};
  for (const key of monthKeys) {
    monthly[key] = { amount: 0, titleCount: 0 };
  }
  let orderCommercialTotal = 0;
  let effectiveScheduleTotal = 0;
  let periodScheduleTotal = 0;
  let outsidePeriodTotal = 0;
  let titleCount = 0;

  for (const row of rows) {
    orderCommercialTotal += row.orderCommercialTotal;
    effectiveScheduleTotal += row.effectiveScheduleTotal;
    periodScheduleTotal += row.periodScheduleTotal;
    outsidePeriodTotal += row.outsidePeriodTotal;
    for (const key of monthKeys) {
      const cell = row.months[key];
      if (!cell) continue;
      const bucket = monthly[key]!;
      bucket.amount = roundMoney(bucket.amount + cell.amount);
      bucket.titleCount += cell.titleCount;
      titleCount += cell.titleCount;
    }
  }

  return {
    orderCommercialTotal: roundMoney(orderCommercialTotal),
    effectiveScheduleTotal: roundMoney(effectiveScheduleTotal),
    periodScheduleTotal: roundMoney(periodScheduleTotal),
    outsidePeriodTotal: roundMoney(outsidePeriodTotal),
    difference: roundMoney(effectiveScheduleTotal - orderCommercialTotal),
    orderCount: rows.length,
    titleCount,
    monthly,
  };
}
