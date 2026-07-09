/**
 * Simulação HH/HM por centro de custo — motor puro (sem Prisma, sem custo oficial).
 * Média mensal dos centros selecionados ÷ horas base mensais = taxa simulada.
 */
import { roundMoney } from "./financeAccountsPayableDashboard.js";

export const COST_CENTER_HH_HM_SIMULATION_ZERO_MONTHS_WARNING =
  "Existem meses sem lançamentos para os centros selecionados.";

export const COST_CENTER_HH_HM_SIMULATION_INSUFFICIENT_DATA =
  "Não há dados suficientes no período. Informe um valor manual ou ajuste os filtros.";

export const COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE =
  "Valores por data de vencimento (Contas a Pagar)";

export type CostCenterHhHmSimulationHourType = "HH" | "HM";

export type CostCenterHhHmSimulationAveragePeriod =
  | "LAST_3_MONTHS"
  | "LAST_6_MONTHS"
  | "LAST_12_MONTHS"
  | "CURRENT_YEAR"
  | "FILTERED_PERIOD"
  | "MANUAL_VALUE";

export const COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS: ReadonlyArray<{
  value: CostCenterHhHmSimulationAveragePeriod;
  label: string;
}> = [
  { value: "LAST_3_MONTHS", label: "Últimos 3 meses" },
  { value: "LAST_6_MONTHS", label: "Últimos 6 meses" },
  { value: "LAST_12_MONTHS", label: "Últimos 12 meses" },
  { value: "CURRENT_YEAR", label: "Ano atual" },
  { value: "FILTERED_PERIOD", label: "Período filtrado" },
  { value: "MANUAL_VALUE", label: "Valor manual" },
] as const;

export const DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD: CostCenterHhHmSimulationAveragePeriod =
  "LAST_6_MONTHS";

const COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_SET = new Set<string>(
  COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS.map((option) => option.value)
);

export function parseCostCenterHhHmSimulationAveragePeriod(
  raw: unknown
): CostCenterHhHmSimulationAveragePeriod {
  const value = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_SET.has(value)) {
    return value as CostCenterHhHmSimulationAveragePeriod;
  }
  return DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD;
}

export type CostCenterMonthlyExpenseBucket = {
  year: number;
  month: number;
  totalAmount: number;
};

export type CostCenterMonthlyExpenseSourceRow = {
  year: number;
  month: number;
  costCenterId: string;
  amount: number;
};

export type CostCenterHhHmSimulationFormValues = {
  hourType: CostCenterHhHmSimulationHourType;
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  selectedCostCenterIds: string[];
  baseMonthlyHours: string;
  quantityUsedInItem: string;
  useManualRate: boolean;
  manualRatePerHour: string;
  note: string;
  filteredDueDateFrom: string;
  filteredDueDateTo: string;
};

export const EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM: CostCenterHhHmSimulationFormValues = {
  hourType: "HM",
  averagePeriod: DEFAULT_COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD,
  selectedCostCenterIds: [],
  baseMonthlyHours: "",
  quantityUsedInItem: "",
  useManualRate: false,
  manualRatePerHour: "",
  note: "",
  filteredDueDateFrom: "",
  filteredDueDateTo: "",
};

export type CostCenterMonthlyAverageResult = {
  monthlyBuckets: CostCenterMonthlyExpenseBucket[];
  monthsInPeriod: number;
  monthsWithData: number;
  monthsWithoutData: number;
  totalAmount: number;
  monthlyAverageAmount: number;
  zeroMonthsWarning: boolean;
  insufficientData: boolean;
};

export type CostCenterHhHmSimulationComposition = {
  monthlyAverageAmount: number | null;
  baseMonthlyHours: number | null;
  calculatedRatePerHour: number | null;
  effectiveRatePerHour: number | null;
  quantityUsedInItem: number | null;
  simulatedItemCost: number | null;
  hourType: CostCenterHhHmSimulationHourType;
  useManualRate: boolean;
};

export type CostCenterHhHmSimulationResult = {
  monthlyAverage: CostCenterMonthlyAverageResult;
  composition: CostCenterHhHmSimulationComposition;
  warnings: string[];
  errors: string[];
  canCalculateRate: boolean;
  canCalculateItemCost: boolean;
};

function parsePositiveNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseNonNegativeNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function buildRollingMonthSlots(
  referenceDate: Date,
  monthsCount: number
): Array<{ year: number; month: number }> {
  const count = Math.max(1, Math.floor(monthsCount));
  const slots: Array<{ year: number; month: number }> = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth() - offset, 1);
    slots.push({ year: date.getFullYear(), month: date.getMonth() + 1 });
  }
  return slots;
}

export function buildCurrentYearMonthSlots(referenceDate: Date): Array<{ year: number; month: number }> {
  const year = referenceDate.getFullYear();
  return Array.from({ length: 12 }, (_, index) => ({ year, month: index + 1 }));
}

export function buildFilteredPeriodMonthSlots(
  dueDateFrom: Date,
  dueDateTo: Date
): Array<{ year: number; month: number }> {
  const start = new Date(dueDateFrom.getFullYear(), dueDateFrom.getMonth(), 1);
  const end = new Date(dueDateTo.getFullYear(), dueDateTo.getMonth(), 1);
  if (end.getTime() < start.getTime()) return [];

  const slots: Array<{ year: number; month: number }> = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    slots.push({ year: cursor.getFullYear(), month: cursor.getMonth() + 1 });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return slots;
}

export function resolveCostCenterHhHmSimulationMonthSlots(input: {
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  referenceDate?: Date;
  dueDateFrom?: Date | null;
  dueDateTo?: Date | null;
}): Array<{ year: number; month: number }> {
  const referenceDate = input.referenceDate ?? new Date();
  switch (input.averagePeriod) {
    case "LAST_3_MONTHS":
      return buildRollingMonthSlots(referenceDate, 3);
    case "LAST_6_MONTHS":
      return buildRollingMonthSlots(referenceDate, 6);
    case "LAST_12_MONTHS":
      return buildRollingMonthSlots(referenceDate, 12);
    case "CURRENT_YEAR":
      return buildCurrentYearMonthSlots(referenceDate);
    case "FILTERED_PERIOD": {
      if (!input.dueDateFrom || !input.dueDateTo) return [];
      return buildFilteredPeriodMonthSlots(input.dueDateFrom, input.dueDateTo);
    }
    case "MANUAL_VALUE":
    default:
      return [];
  }
}

export function formatCostCenterHhHmSimulationPeriodLabel(input: {
  averagePeriod: CostCenterHhHmSimulationAveragePeriod;
  monthSlots: Array<{ year: number; month: number }>;
}): string {
  const option = COST_CENTER_HH_HM_SIMULATION_AVERAGE_PERIOD_OPTIONS.find(
    (row) => row.value === input.averagePeriod
  );
  if (input.averagePeriod === "MANUAL_VALUE") {
    return option?.label ?? "Valor manual";
  }
  if (input.monthSlots.length === 0) return option?.label ?? "Período";
  const first = input.monthSlots[0]!;
  const last = input.monthSlots[input.monthSlots.length - 1]!;
  if (first.year === last.year && first.month === last.month) {
    return `${String(first.month).padStart(2, "0")}/${first.year}`;
  }
  return `${String(first.month).padStart(2, "0")}/${first.year} — ${String(last.month).padStart(2, "0")}/${last.year}`;
}

export function aggregateCostCenterMonthlyTotals(input: {
  rows: CostCenterMonthlyExpenseSourceRow[];
  costCenterIds: string[];
  monthSlots: Array<{ year: number; month: number }>;
}): CostCenterMonthlyExpenseBucket[] {
  const idSet = new Set(input.costCenterIds);
  const totals = new Map<string, number>();

  for (const row of input.rows) {
    if (!idSet.has(row.costCenterId)) continue;
    const key = monthKey(row.year, row.month);
    totals.set(key, (totals.get(key) ?? 0) + row.amount);
  }

  return input.monthSlots.map((slot) => ({
    year: slot.year,
    month: slot.month,
    totalAmount: roundMoney(totals.get(monthKey(slot.year, slot.month)) ?? 0),
  }));
}

export function computeCostCenterMonthlyAverage(
  monthlyBuckets: CostCenterMonthlyExpenseBucket[]
): Omit<CostCenterMonthlyAverageResult, "monthlyBuckets"> {
  const monthsInPeriod = monthlyBuckets.length;
  const monthsWithData = monthlyBuckets.filter((bucket) => bucket.totalAmount > 0).length;
  const monthsWithoutData = monthsInPeriod - monthsWithData;
  const totalAmount = roundMoney(
    monthlyBuckets.reduce((sum, bucket) => sum + bucket.totalAmount, 0)
  );
  const monthlyAverageAmount =
    monthsInPeriod > 0 ? roundMoney(totalAmount / monthsInPeriod) : 0;

  return {
    monthsInPeriod,
    monthsWithData,
    monthsWithoutData,
    totalAmount,
    monthlyAverageAmount,
    zeroMonthsWarning: monthsInPeriod > 0 && monthsWithoutData > 0,
    insufficientData: monthsInPeriod === 0 || monthsWithData === 0,
  };
}

export function computeCostCenterHhHmRate(input: {
  monthlyAverageAmount: number | null;
  baseMonthlyHours: number | null;
}): number | null {
  if (input.monthlyAverageAmount == null || input.baseMonthlyHours == null) return null;
  if (input.baseMonthlyHours <= 0) return null;
  return roundMoney(input.monthlyAverageAmount / input.baseMonthlyHours);
}

export function computeCostCenterHhHmItemCost(input: {
  ratePerHour: number | null;
  quantityUsedInItem: number | null;
}): number | null {
  if (input.ratePerHour == null || input.quantityUsedInItem == null) return null;
  if (input.quantityUsedInItem < 0) return null;
  return roundMoney(input.ratePerHour * input.quantityUsedInItem);
}

export function computeCostCenterHhHmSimulation(input: {
  form: CostCenterHhHmSimulationFormValues;
  monthlyBuckets: CostCenterMonthlyExpenseBucket[];
}): CostCenterHhHmSimulationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const monthlyAverageSummary = computeCostCenterMonthlyAverage(input.monthlyBuckets);
  const monthlyAverage: CostCenterMonthlyAverageResult = {
    monthlyBuckets: input.monthlyBuckets,
    ...monthlyAverageSummary,
  };

  if (input.form.selectedCostCenterIds.length === 0) {
    errors.push("Selecione ao menos um centro de custo.");
  }

  if (monthlyAverage.zeroMonthsWarning) {
    warnings.push(COST_CENTER_HH_HM_SIMULATION_ZERO_MONTHS_WARNING);
  }

  const baseMonthlyHours = parsePositiveNumber(input.form.baseMonthlyHours);
  if (!input.form.useManualRate && baseMonthlyHours == null) {
    errors.push("Informe as horas base mensais (driver de rateio).");
  }

  const quantityUsedInItem = parseNonNegativeNumber(input.form.quantityUsedInItem);
  const manualRatePerHour = parsePositiveNumber(input.form.manualRatePerHour);

  const skipAverage =
    input.form.averagePeriod === "MANUAL_VALUE" || input.form.useManualRate;

  if (!skipAverage && monthlyAverage.insufficientData) {
    warnings.push(COST_CENTER_HH_HM_SIMULATION_INSUFFICIENT_DATA);
  }

  const calculatedRatePerHour = skipAverage
    ? null
    : computeCostCenterHhHmRate({
        monthlyAverageAmount: monthlyAverage.insufficientData
          ? null
          : monthlyAverage.monthlyAverageAmount,
        baseMonthlyHours,
      });

  let effectiveRatePerHour: number | null = null;
  if (input.form.useManualRate || input.form.averagePeriod === "MANUAL_VALUE") {
    if (manualRatePerHour == null) {
      errors.push("Informe o valor manual R$/hora.");
    } else {
      effectiveRatePerHour = roundMoney(manualRatePerHour);
    }
  } else if (calculatedRatePerHour != null) {
    effectiveRatePerHour = calculatedRatePerHour;
  }

  const simulatedItemCost = computeCostCenterHhHmItemCost({
    ratePerHour: effectiveRatePerHour,
    quantityUsedInItem,
  });

  const composition: CostCenterHhHmSimulationComposition = {
    monthlyAverageAmount: skipAverage ? null : monthlyAverage.monthlyAverageAmount,
    baseMonthlyHours,
    calculatedRatePerHour,
    effectiveRatePerHour,
    quantityUsedInItem,
    simulatedItemCost,
    hourType: input.form.hourType,
    useManualRate: input.form.useManualRate || input.form.averagePeriod === "MANUAL_VALUE",
  };

  return {
    monthlyAverage,
    composition,
    warnings,
    errors,
    canCalculateRate: effectiveRatePerHour != null,
    canCalculateItemCost: simulatedItemCost != null,
  };
}
