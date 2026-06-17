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
import type { FinanceCashFlowDailyPoint } from "./financeCashFlowCfoDiagnostics.js";
import {
  cashFlowViewModeSlices,
  resolveCashFlowApAmount,
  resolveCashFlowApMovementDate,
  resolveCashFlowArAmount,
  resolveCashFlowArMovementDate,
  shouldIncludeCashFlowApMovement,
  shouldIncludeCashFlowArMovement,
} from "./financeCashFlowLedger.js";

export type FinanceCashFlowCalendarMovement = {
  id: string;
  type: "AR" | "AP";
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

export type FinanceCashFlowCalendarPayload = {
  month: number;
  year: number;
  days: FinanceCashFlowCalendarDay[];
  weeks: FinanceCashFlowCalendarWeekSummary[];
};

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

function mapArMovement(
  row: FinanceCashFlowArRow,
  slice: "projected" | "realized",
  calendarAmount: number,
  calendarDate: string,
  referenceDate: Date
): FinanceCashFlowCalendarMovement {
  const status = classifyFinanceArTitle(row, referenceDate);
  return {
    id: `AR-${row.externalId}-${calendarDate}-${slice}`,
    type: "AR",
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
  slice: "projected" | "realized",
  calendarAmount: number,
  calendarDate: string,
  referenceDate: Date
): FinanceCashFlowCalendarMovement {
  const status = classifyFinanceApTitle(row, referenceDate);
  return {
    id: `AP-${row.externalId}-${calendarDate}-${slice}`,
    type: "AP",
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
        ? ["Previsto: saldo em aberto alocado pela data operacional AP."]
        : ["Realizado: valor pago alocado pela data efetiva de pagamento."],
  };
}

export function buildFinanceCashFlowCalendarMovements(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowCalendarMovement[] {
  const movements: FinanceCashFlowCalendarMovement[] = [];

  for (const slice of cashFlowViewModeSlices(filters.viewMode)) {
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
      if (!shouldIncludeCashFlowApMovement(row, slice)) continue;
      const amount = resolveCashFlowApAmount(row, slice);
      if (amount <= 0) continue;
      const date = resolveCashFlowApMovementDate(row, slice, filters.dateBase);
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

  const parts: string[] = [];
  if (inflow > 0) parts.push(`CR +${formatFinanceCurrency(inflow)}`);
  if (outflow > 0) parts.push(`CP −${formatFinanceCurrency(outflow)}`);
  if (inflow > 0 || outflow > 0) parts.push(`Saldo ${formatFinanceCurrency(net)}`);

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
    summary: parts.length > 0 ? parts.join(" · ") : "Sem movimentos",
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

export function buildFinanceCashFlowCalendar(
  arRows: FinanceCashFlowArRow[],
  apRows: FinanceCashFlowApRow[],
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
): FinanceCashFlowCalendarPayload {
  const calendarYear = filters.year ?? referenceDate.getFullYear();
  const calendarMonth = filters.month ?? referenceDate.getMonth() + 1;
  const allMovements = buildFinanceCashFlowCalendarMovements(
    arRows,
    apRows,
    filters,
    referenceDate
  );

  const monthMovements = allMovements.filter((m) => {
    const [y, mo] = m.calendarDate.split("-").map(Number);
    return y === calendarYear && mo === calendarMonth;
  });

  let maxFlow = 0;
  for (const m of monthMovements) {
    maxFlow = Math.max(maxFlow, m.calendarAmount);
  }

  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const days: FinanceCashFlowCalendarDay[] = [];

  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dayMovements = monthMovements.filter((m) => m.calendarDate === key);
    for (const m of dayMovements) {
      maxFlow = Math.max(maxFlow, m.calendarAmount);
    }
    days.push(aggregateDayFromMovements(key, d, dayMovements, maxFlow));
  }

  const largeThreshold = maxFlow > 0 ? maxFlow * 0.35 : 0;
  for (const day of days) {
    day.hasLargeInflow = day.inflow >= largeThreshold && largeThreshold > 0;
    day.hasLargeOutflow = day.outflow >= largeThreshold && largeThreshold > 0;
  }

  return {
    month: calendarMonth,
    year: calendarYear,
    days,
    weeks: buildWeekSummaries(calendarYear, calendarMonth, days),
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
