/**
 * Calendário diário/semanal do Fluxo de Caixa — movimentos primeiro, totais derivados.
 * Usa as mesmas regras do ledger (série mensal, cards e reconciliação).
 */
import { formatFinanceCurrency } from "./financeAccountsReceivableFormat.js";
import {
  classifyFinanceArTitle,
  roundMoney,
  startOfLocalDay,
} from "./financeAccountsReceivableDashboard.js";
import { classifyFinanceApTitle } from "./financeAccountsPayableDashboard.js";
import type {
  FinanceCashFlowApRow,
  FinanceCashFlowArRow,
  FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type {
  FinanceCashFlowMonthlyPoint,
  FinanceCashFlowViewMode,
} from "./financeCashFlowDashboardTypes.js";
import type { FinanceCashFlowDailyPoint } from "./financeCashFlowCfoDiagnostics.js";
import type { FinanceCashFlowExecutiveMonthlyRow } from "./financeCashFlowExecutiveSummary.js";
import {
  calendarCashFlowMovementSlices,
  resolveCalendarApRealizedMovementDate,
  resolveCashFlowApAmount,
  resolveCashFlowApMovementDate,
  resolveCashFlowArAmount,
  resolveCashFlowArMovementDate,
  shouldIncludeCalendarApRealizedMovement,
  shouldIncludeCashFlowApMovement,
  shouldIncludeCashFlowArMovement,
  type CashFlowMovementSlice,
} from "./financeCashFlowLedger.js";

export type FinanceCashFlowCalendarMovementNature =
  | "AR_REALIZED"
  | "AR_OPEN"
  | "AP_REALIZED"
  | "AP_OPEN";

export const CALENDAR_MOVEMENT_NATURE_LABELS: Record<
  FinanceCashFlowCalendarMovementNature,
  string
> = {
  AR_REALIZED: "CR realizado",
  AR_OPEN: "CR aberto",
  AP_REALIZED: "CP pago",
  AP_OPEN: "CP aberto",
};

export type FinanceCashFlowCalendarMovement = {
  id: string;
  type: "AR" | "AP";
  nature: FinanceCashFlowCalendarMovementNature;
  source: "NomusAccountsReceivable" | "NomusAccountsPayable";
  externalId: string | null;
  documentNumber: string | null;
  invoiceNumber: string | null;
  companyName: string | null;
  personName: string | null;
  description: string | null;
  dueDate: string | null;
  scheduleDate?: string | null;
  settlementDate?: string | null;
  amountOriginal: number;
  amountRealized: number;
  balanceOpen: number;
  calendarAmount: number;
  calendarDate: string;
  status: string;
  ruleNotes?: string[];
};

export type FinanceCashFlowCalendarDay = {
  date: string;
  day: number;
  inflow: number;
  outflow: number;
  net: number;
  receivableCount: number;
  payableCount: number;
  movementCount: number;
  movements: FinanceCashFlowCalendarMovement[];
  status: "positive" | "negative" | "neutral";
  hasLargeInflow: boolean;
  hasLargeOutflow: boolean;
  summary: string;
};

export type FinanceCashFlowCalendarWeekSummary = {
  weekIndex: number;
  startDate: string;
  endDate: string;
  inflow: number;
  outflow: number;
  net: number;
  receivableCount: number;
  payableCount: number;
  movementCount: number;
};

export type FinanceCashFlowCalendarMonthSummary = {
  inflow: number;
  outflow: number;
  net: number;
  inflowRealized: number;
  inflowOpen: number;
  outflowRealized: number;
  outflowOpen: number;
  receivableCount: number;
  payableCount: number;
  movementCount: number;
};

export type FinanceCashFlowCalendarMonthNavItem = FinanceCashFlowCalendarMonthSummary & {
  month: number;
  monthLabel: string;
};

export type FinanceCashFlowCalendarReconciliation = {
  month: number;
  year: number;
  viewMode: FinanceCashFlowViewMode;
  calendarReceived: number;
  timelineReceived: number;
  receivedDiff: number;
  calendarOpenReceivable: number;
  timelineOpenReceivable: number;
  openReceivableDiff: number;
  calendarEstimatedInflow: number;
  timelineEstimatedInflow: number;
  estimatedInflowDiff: number;
  calendarPaid: number;
  timelinePaid: number;
  paidDiff: number;
  calendarOpenPayable: number;
  timelineOpenPayable: number;
  openPayableDiff: number;
  calendarEstimatedOutflow: number;
  timelineEstimatedOutflow: number;
  estimatedOutflowDiff: number;
  calendarNet: number;
  timelineNet: number;
  netDiff: number;
  status: "ok" | "mismatch";
};

export type FinanceCashFlowCalendarPayload = {
  /** Mês fixado no filtro global; null quando filtro anual (Mês = Todos). */
  filterMonth: number | null;
  /** Mês efetivamente exibido no calendário diário. */
  displayMonth: number;
  year: number;
  isAnnualFilter: boolean;
  monthSummary: FinanceCashFlowCalendarMonthSummary;
  reconciliation: FinanceCashFlowCalendarReconciliation;
  /** Totais por mês do ano — navegação sem recalcular motor. */
  monthNav: FinanceCashFlowCalendarMonthNavItem[];
  /** Total de movimentos no ano (ledger completo, sem top N). */
  yearMovementCount: number;
  month: number;
  days: FinanceCashFlowCalendarDay[];
  weeks: FinanceCashFlowCalendarWeekSummary[];
};

const CALENDAR_MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

const RECONCILIATION_EPSILON = 0.01;

function dateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toIsoDate(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString();
}

function resolveArDocument(row: FinanceCashFlowArRow): string | null {
  return row.sourceInvoiceNumber?.trim() || null;
}

function movementNature(
  type: "AR" | "AP",
  slice: CashFlowMovementSlice
): FinanceCashFlowCalendarMovementNature {
  if (type === "AR") return slice === "realized" ? "AR_REALIZED" : "AR_OPEN";
  return slice === "realized" ? "AP_REALIZED" : "AP_OPEN";
}

function mapArMovement(
  row: FinanceCashFlowArRow,
  slice: CashFlowMovementSlice,
  calendarAmount: number,
  calendarDate: string,
  referenceDate: Date
): FinanceCashFlowCalendarMovement {
  const status = classifyFinanceArTitle(row, referenceDate);
  return {
    id: `AR-${row.externalId}-${calendarDate}-${slice}`,
    type: "AR",
    nature: movementNature("AR", slice),
    source: "NomusAccountsReceivable",
    externalId: String(row.externalId),
    documentNumber: resolveArDocument(row),
    invoiceNumber: row.sourceInvoiceNumber ?? null,
    companyName: row.companyName,
    personName: row.personName,
    description: row.description,
    dueDate: toIsoDate(row.dueDate),
    settlementDate: toIsoDate(row.settlementDate),
    amountOriginal: roundMoney(row.amountReceivable),
    amountRealized: roundMoney(row.amountReceived),
    balanceOpen: roundMoney(row.balanceReceivable),
    calendarAmount: roundMoney(calendarAmount),
    calendarDate,
    status,
    ruleNotes:
      slice === "projected"
        ? ["Previsto: saldo em aberto alocado pelo vencimento (dueDate)."]
        : ["Realizado: valor recebido alocado pelo vencimento (dueDate)."],
  };
}

function mapApMovement(
  row: FinanceCashFlowApRow,
  slice: CashFlowMovementSlice,
  calendarAmount: number,
  calendarDate: string,
  referenceDate: Date
): FinanceCashFlowCalendarMovement {
  const status = classifyFinanceApTitle(row, referenceDate);
  return {
    id: `AP-${row.externalId}-${calendarDate}-${slice}`,
    type: "AP",
    nature: movementNature("AP", slice),
    source: "NomusAccountsPayable",
    externalId: String(row.externalId),
    documentNumber: row.documentNumber,
    invoiceNumber: null,
    companyName: row.companyName,
    personName: row.personName,
    description: row.description,
    dueDate: toIsoDate(row.dueDate),
    scheduleDate: toIsoDate(row.scheduleDate),
    settlementDate: toIsoDate(row.settlementDate ?? row.paymentDate),
    amountOriginal: roundMoney(row.amountPayable),
    amountRealized: roundMoney(row.amountPaid),
    balanceOpen: roundMoney(row.balancePayable),
    calendarAmount: roundMoney(calendarAmount),
    calendarDate,
    status,
    ruleNotes:
      slice === "projected"
        ? ["Previsto: saldo em aberto alocado pela data de vencimento AP."]
        : ["Realizado: valor pago alocado pela data de vencimento AP."],
  };
}

export function buildFinanceCashFlowCalendarMovements(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowCalendarMovement[] {
  const movements: FinanceCashFlowCalendarMovement[] = [];

  for (const slice of calendarCashFlowMovementSlices(filters.viewMode)) {
    for (const row of arRows) {
      if (!shouldIncludeCashFlowArMovement(row, slice)) continue;
      const amount = resolveCashFlowArAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowArMovementDate(row, slice, filters.dateBase);
      if (!date) continue;
      const calendarDate = dateKey(startOfLocalDay(date));
      movements.push(mapArMovement(row, slice, amount, calendarDate, referenceDate));
    }

    for (const row of apRows) {
      const includeAp =
        slice === "realized"
          ? shouldIncludeCalendarApRealizedMovement(row)
          : shouldIncludeCashFlowApMovement(row, slice);
      if (!includeAp) continue;
      const amount = resolveCashFlowApAmount(row, slice);
      if (amount <= 0) continue;
      const date =
        slice === "realized"
          ? resolveCalendarApRealizedMovementDate(row)
          : resolveCashFlowApMovementDate(row, slice, filters.dateBase);
      if (!date) continue;
      const calendarDate = dateKey(startOfLocalDay(date));
      movements.push(mapApMovement(row, slice, amount, calendarDate, referenceDate));
    }
  }

  return movements;
}

function aggregateDayFromMovements(
  date: string,
  day: number,
  movements: FinanceCashFlowCalendarMovement[],
  maxFlow: number
): FinanceCashFlowCalendarDay {
  const arMovements = movements.filter((m) => m.type === "AR");
  const apMovements = movements.filter((m) => m.type === "AP");
  const inflow = roundMoney(arMovements.reduce((sum, m) => sum + m.calendarAmount, 0));
  const outflow = roundMoney(apMovements.reduce((sum, m) => sum + m.calendarAmount, 0));
  const net = roundMoney(inflow - outflow);
  const largeThreshold = maxFlow > 0 ? maxFlow * 0.35 : 0;
  const breakdown = sumMovementBreakdown(movements);

  const parts: string[] = [];
  if (inflow > 0) parts.push(`CR +${formatFinanceCurrency(inflow)}`);
  if (outflow > 0) parts.push(`CP −${formatFinanceCurrency(outflow)}`);
  if (inflow > 0 || outflow > 0) parts.push(`Saldo ${formatFinanceCurrency(net)}`);

  const detailParts: string[] = [];
  if (breakdown.inflowRealized > 0) {
    detailParts.push(`CR realizado +${formatFinanceCurrency(breakdown.inflowRealized)}`);
  }
  if (breakdown.inflowOpen > 0) {
    detailParts.push(`CR aberto +${formatFinanceCurrency(breakdown.inflowOpen)}`);
  }
  if (breakdown.outflowRealized > 0) {
    detailParts.push(`CP pago −${formatFinanceCurrency(breakdown.outflowRealized)}`);
  }
  if (breakdown.outflowOpen > 0) {
    detailParts.push(`CP aberto −${formatFinanceCurrency(breakdown.outflowOpen)}`);
  }

  return {
    date,
    day,
    inflow,
    outflow,
    net,
    receivableCount: arMovements.length,
    payableCount: apMovements.length,
    movementCount: movements.length,
    movements,
    status: net > 0 ? "positive" : net < 0 ? "negative" : "neutral",
    hasLargeInflow: inflow >= largeThreshold && largeThreshold > 0,
    hasLargeOutflow: outflow >= largeThreshold && largeThreshold > 0,
    summary:
      detailParts.length > 0
        ? `${parts.join(" · ")} (${detailParts.join(" · ")})`
        : parts.length > 0
          ? parts.join(" · ")
          : "Sem movimentos",
  };
}

function buildWeekSummaries(
  year: number,
  month: number,
  days: FinanceCashFlowCalendarDay[]
): FinanceCashFlowCalendarWeekSummary[] {
  const dayMap = new Map(days.map((d) => [d.date, d]));
  const daysInMonth = new Date(year, month, 0).getDate();
  const startWeekday = new Date(year, month - 1, 1).getDay();
  const totalCells = startWeekday + daysInMonth;
  const numRows = Math.ceil(totalCells / 7);
  const weeks: FinanceCashFlowCalendarWeekSummary[] = [];
  let weekIndex = 0;

  for (let row = 0; row < numRows; row += 1) {
    let inflow = 0;
    let outflow = 0;
    let receivableCount = 0;
    let payableCount = 0;
    let movementCount = 0;
    let startDate: string | null = null;
    let endDate: string | null = null;

    for (let col = 0; col < 7; col += 1) {
      const cellIndex = row * 7 + col;
      const dayNum = cellIndex - startWeekday + 1;
      if (dayNum < 1 || dayNum > daysInMonth) continue;
      const key = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const day = dayMap.get(key);
      if (!day || day.movementCount === 0) continue;
      inflow += day.inflow;
      outflow += day.outflow;
      receivableCount += day.receivableCount;
      payableCount += day.payableCount;
      movementCount += day.movementCount;
      if (!startDate) startDate = key;
      endDate = key;
    }

    if (startDate && endDate) {
      weekIndex += 1;
      weeks.push({
        weekIndex,
        startDate,
        endDate,
        inflow: roundMoney(inflow),
        outflow: roundMoney(outflow),
        net: roundMoney(inflow - outflow),
        receivableCount,
        payableCount,
        movementCount,
      });
    }
  }

  return weeks;
}

export function resolveCalendarDisplayMonth(
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): number {
  if (filters.month != null) return filters.month;
  const override = filters.calendarDisplayMonth;
  if (override != null && override >= 1 && override <= 12) return override;
  const calendarYear = filters.year ?? referenceDate.getFullYear();
  if (calendarYear === referenceDate.getFullYear()) {
    return referenceDate.getMonth() + 1;
  }
  return 1;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < RECONCILIATION_EPSILON;
}

function sumMovementBreakdown(movements: FinanceCashFlowCalendarMovement[]): {
  inflowRealized: number;
  inflowOpen: number;
  outflowRealized: number;
  outflowOpen: number;
} {
  let inflowRealized = 0;
  let inflowOpen = 0;
  let outflowRealized = 0;
  let outflowOpen = 0;
  for (const movement of movements) {
    switch (movement.nature) {
      case "AR_REALIZED":
        inflowRealized += movement.calendarAmount;
        break;
      case "AR_OPEN":
        inflowOpen += movement.calendarAmount;
        break;
      case "AP_REALIZED":
        outflowRealized += movement.calendarAmount;
        break;
      case "AP_OPEN":
        outflowOpen += movement.calendarAmount;
        break;
      default:
        break;
    }
  }
  return {
    inflowRealized: roundMoney(inflowRealized),
    inflowOpen: roundMoney(inflowOpen),
    outflowRealized: roundMoney(outflowRealized),
    outflowOpen: roundMoney(outflowOpen),
  };
}

export function sumCalendarDays(days: FinanceCashFlowCalendarDay[]): FinanceCashFlowCalendarMonthSummary {
  let inflow = 0;
  let outflow = 0;
  let receivableCount = 0;
  let payableCount = 0;
  let movementCount = 0;
  const allMovements: FinanceCashFlowCalendarMovement[] = [];
  for (const day of days) {
    inflow += day.inflow;
    outflow += day.outflow;
    receivableCount += day.receivableCount;
    payableCount += day.payableCount;
    movementCount += day.movementCount;
    allMovements.push(...day.movements);
  }
  const breakdown = sumMovementBreakdown(allMovements);
  const inflowRounded = roundMoney(inflow);
  const outflowRounded = roundMoney(outflow);
  return {
    inflow: inflowRounded,
    outflow: outflowRounded,
    net: roundMoney(inflowRounded - outflowRounded),
    ...breakdown,
    receivableCount,
    payableCount,
    movementCount,
  };
}

export function buildCalendarReconciliation(
  year: number,
  month: number,
  monthSummary: FinanceCashFlowCalendarMonthSummary,
  executiveTimeline: FinanceCashFlowExecutiveMonthlyRow[],
  viewMode: FinanceCashFlowViewMode
): FinanceCashFlowCalendarReconciliation {
  const point = executiveTimeline.find((p) => p.year === year && p.month === month);
  const timelineReceived = point?.received ?? 0;
  const timelineOpenReceivable = point?.receivableOpenDue ?? 0;
  const timelineEstimatedInflow = point?.estimatedInflow ?? 0;
  const timelinePaid = point?.paid ?? 0;
  const timelineOpenPayable = point?.payableOpenDue ?? 0;
  const timelineEstimatedOutflow = point?.estimatedOutflow ?? 0;
  const timelineNet =
    viewMode === "realized"
      ? roundMoney(timelineReceived - timelinePaid)
      : (point?.netFlow ?? roundMoney(timelineEstimatedInflow - timelineEstimatedOutflow));

  const calendarReceived = monthSummary.inflowRealized;
  const calendarOpenReceivable = monthSummary.inflowOpen;
  const calendarEstimatedInflow = monthSummary.inflow;
  const calendarPaid = monthSummary.outflowRealized;
  const calendarOpenPayable = monthSummary.outflowOpen;
  const calendarEstimatedOutflow = monthSummary.outflow;
  const calendarNet = monthSummary.net;

  const receivedDiff = roundMoney(calendarReceived - timelineReceived);
  const openReceivableDiff = roundMoney(calendarOpenReceivable - timelineOpenReceivable);
  const estimatedInflowDiff = roundMoney(calendarEstimatedInflow - timelineEstimatedInflow);
  const paidDiff = roundMoney(calendarPaid - timelinePaid);
  const openPayableDiff = roundMoney(calendarOpenPayable - timelineOpenPayable);
  const estimatedOutflowDiff = roundMoney(calendarEstimatedOutflow - timelineEstimatedOutflow);
  const netDiff = roundMoney(calendarNet - timelineNet);

  const status: "ok" | "mismatch" =
    viewMode === "realized"
      ? nearlyEqual(calendarReceived, timelineReceived) &&
        nearlyEqual(calendarPaid, timelinePaid) &&
        nearlyEqual(calendarNet, timelineNet)
        ? "ok"
        : "mismatch"
      : nearlyEqual(calendarEstimatedInflow, timelineEstimatedInflow) &&
          nearlyEqual(calendarEstimatedOutflow, timelineEstimatedOutflow) &&
          nearlyEqual(calendarNet, timelineNet)
        ? "ok"
        : "mismatch";

  return {
    month,
    year,
    viewMode,
    calendarReceived,
    timelineReceived,
    receivedDiff,
    calendarOpenReceivable,
    timelineOpenReceivable,
    openReceivableDiff,
    calendarEstimatedInflow,
    timelineEstimatedInflow,
    estimatedInflowDiff,
    calendarPaid,
    timelinePaid,
    paidDiff,
    calendarOpenPayable,
    timelineOpenPayable,
    openPayableDiff,
    calendarEstimatedOutflow,
    timelineEstimatedOutflow,
    estimatedOutflowDiff,
    calendarNet,
    timelineNet,
    netDiff,
    status,
  };
}

function groupMovementsByMonth(
  movements: FinanceCashFlowCalendarMovement[],
  calendarYear: number
): Map<number, FinanceCashFlowCalendarMovement[]> {
  const buckets = new Map<number, FinanceCashFlowCalendarMovement[]>();
  for (let m = 1; m <= 12; m += 1) buckets.set(m, []);
  for (const movement of movements) {
    const [y, mo] = movement.calendarDate.split("-").map(Number);
    if (y !== calendarYear || mo == null || mo < 1 || mo > 12) continue;
    buckets.get(mo)!.push(movement);
  }
  return buckets;
}

function groupMovementsByDate(
  movements: FinanceCashFlowCalendarMovement[]
): Map<string, FinanceCashFlowCalendarMovement[]> {
  const byDate = new Map<string, FinanceCashFlowCalendarMovement[]>();
  for (const movement of movements) {
    const list = byDate.get(movement.calendarDate);
    if (list) list.push(movement);
    else byDate.set(movement.calendarDate, [movement]);
  }
  return byDate;
}

function calendarDateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function buildCalendarDaysForMonth(
  calendarYear: number,
  calendarMonth: number,
  monthMovements: FinanceCashFlowCalendarMovement[]
): FinanceCashFlowCalendarDay[] {
  let maxFlow = 0;
  for (const m of monthMovements) {
    maxFlow = Math.max(maxFlow, m.calendarAmount);
  }

  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const byDate = groupMovementsByDate(monthMovements);
  const days: FinanceCashFlowCalendarDay[] = [];

  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = calendarDateKey(calendarYear, calendarMonth, d);
    const dayMovements = byDate.get(key) ?? [];
    days.push(aggregateDayFromMovements(key, d, dayMovements, maxFlow));
  }

  const largeThreshold = maxFlow > 0 ? maxFlow * 0.35 : 0;
  for (const day of days) {
    day.hasLargeInflow = day.inflow >= largeThreshold && largeThreshold > 0;
    day.hasLargeOutflow = day.outflow >= largeThreshold && largeThreshold > 0;
  }

  return days;
}

/** Resumo mensal com o mesmo arredondamento por dia de `sumCalendarDays`, sem montar a grade. */
function summarizeMonthFromMovements(
  calendarYear: number,
  calendarMonth: number,
  monthMovements: FinanceCashFlowCalendarMovement[]
): FinanceCashFlowCalendarMonthSummary {
  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const byDate = groupMovementsByDate(monthMovements);
  let inflow = 0;
  let outflow = 0;
  let receivableCount = 0;
  let payableCount = 0;

  for (let d = 1; d <= daysInMonth; d += 1) {
    const dayMovements = byDate.get(calendarDateKey(calendarYear, calendarMonth, d)) ?? [];
    let arSum = 0;
    let apSum = 0;
    let arCount = 0;
    let apCount = 0;
    for (const movement of dayMovements) {
      if (movement.type === "AR") {
        arSum += movement.calendarAmount;
        arCount += 1;
      } else {
        apSum += movement.calendarAmount;
        apCount += 1;
      }
    }
    inflow += roundMoney(arSum);
    outflow += roundMoney(apSum);
    receivableCount += arCount;
    payableCount += apCount;
  }

  const breakdown = sumMovementBreakdown(monthMovements);
  const inflowRounded = roundMoney(inflow);
  const outflowRounded = roundMoney(outflow);
  return {
    inflow: inflowRounded,
    outflow: outflowRounded,
    net: roundMoney(inflowRounded - outflowRounded),
    ...breakdown,
    receivableCount,
    payableCount,
    movementCount: monthMovements.length,
  };
}

export function buildFinanceCashFlowCalendar(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  options?: {
    monthlySeries?: FinanceCashFlowMonthlyPoint[];
    executiveMonthlyTimeline?: FinanceCashFlowExecutiveMonthlyRow[];
  }
): FinanceCashFlowCalendarPayload {
  const calendarYear = filters.year ?? referenceDate.getFullYear();
  const displayMonth = resolveCalendarDisplayMonth(filters, referenceDate);
  const filterMonth = filters.month ?? null;
  const isAnnualFilter = filterMonth == null;

  const allMovements = buildFinanceCashFlowCalendarMovements(
    arRows,
    apRows,
    filters,
    referenceDate
  );

  const yearMovements = allMovements.filter((m) => {
    const [y] = m.calendarDate.split("-").map(Number);
    return y === calendarYear;
  });

  const byMonth = groupMovementsByMonth(yearMovements, calendarYear);
  const monthNav: FinanceCashFlowCalendarMonthNavItem[] = [];

  for (let m = 1; m <= 12; m += 1) {
    const movements = byMonth.get(m) ?? [];
    const summary = summarizeMonthFromMovements(calendarYear, m, movements);
    monthNav.push({
      month: m,
      monthLabel: CALENDAR_MONTH_LABELS[m - 1]!,
      ...summary,
    });
  }

  const displayMovements = byMonth.get(displayMonth) ?? [];
  const days = buildCalendarDaysForMonth(calendarYear, displayMonth, displayMovements);
  const monthSummary = sumCalendarDays(days);
  const executiveTimeline = options?.executiveMonthlyTimeline ?? [];

  return {
    filterMonth,
    displayMonth,
    year: calendarYear,
    isAnnualFilter,
    monthSummary,
    reconciliation: buildCalendarReconciliation(
      calendarYear,
      displayMonth,
      monthSummary,
      executiveTimeline,
      filters.viewMode
    ),
    monthNav,
    yearMovementCount: yearMovements.length,
    month: displayMonth,
    days,
    weeks: buildWeekSummaries(calendarYear, displayMonth, days),
  };
}

export function calendarDayToDailyPoint(day: FinanceCashFlowCalendarDay): FinanceCashFlowDailyPoint {
  const d = startOfLocalDay(new Date(`${day.date}T12:00:00`));
  return {
    date: day.date,
    dayLabel: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
    inflowAmount: day.inflow,
    outflowAmount: day.outflow,
    netAmount: day.net,
    status: day.status,
    inflowCount: day.receivableCount,
    outflowCount: day.payableCount,
    hasLargeInflow: day.hasLargeInflow,
    hasLargeOutflow: day.hasLargeOutflow,
    summary: day.summary,
  };
}

/** Compatibilidade: apenas dias com movimento (comportamento legado). */
export function buildCashFlowDailyCalendarFromMovements(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowDailyPoint[] {
  const calendar = buildFinanceCashFlowCalendar(arRows, apRows, filters, referenceDate);
  return calendar.days
    .filter((d) => d.movementCount > 0)
    .map(calendarDayToDailyPoint)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getCalendarDayByDate(
  calendar: FinanceCashFlowCalendarPayload,
  date: string
): FinanceCashFlowCalendarDay | undefined {
  return calendar.days.find((d) => d.date === date);
}

export function filterCalendarMovements(
  movements: FinanceCashFlowCalendarMovement[],
  typeFilter: "all" | "AR" | "AP",
  search: string
): FinanceCashFlowCalendarMovement[] {
  const normalizedSearch = search.trim().toLowerCase();
  return movements.filter((m) => {
    if (typeFilter === "AR" && m.type !== "AR") return false;
    if (typeFilter === "AP" && m.type !== "AP") return false;
    if (!normalizedSearch) return true;
    const haystack = [
      m.type,
      m.nature,
      CALENDAR_MOVEMENT_NATURE_LABELS[m.nature],
      m.source,
      m.companyName,
      m.personName,
      m.documentNumber,
      m.invoiceNumber,
      m.description,
      m.status,
      m.externalId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalizedSearch);
  });
}

export function sumCalendarMovementAmounts(movements: FinanceCashFlowCalendarMovement[]): {
  inflow: number;
  outflow: number;
  net: number;
} {
  const inflow = roundMoney(
    movements.filter((m) => m.type === "AR").reduce((sum, m) => sum + m.calendarAmount, 0)
  );
  const outflow = roundMoney(
    movements.filter((m) => m.type === "AP").reduce((sum, m) => sum + m.calendarAmount, 0)
  );
  return { inflow, outflow, net: roundMoney(inflow - outflow) };
}
