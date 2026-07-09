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

/** Permissões para leitura da simulação HH/HM (Engenharia + Financeiro). */
export const FINANCE_COST_CENTER_HH_HM_SIMULATION_VIEW_PERMISSIONS = [
  "finance.cost_centers.view",
  "finance.view",
  "products.view",
  "simulations.view",
  "costs.view",
] as const;

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

function normalizeStringField(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/** Restaura formulário local com schema seguro (localStorage antigo/corrompido). */
export function normalizeCostCenterHhHmSimulationStoredForm(
  raw: unknown
): CostCenterHhHmSimulationFormValues {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM };
  }
  const parsed = raw as Partial<CostCenterHhHmSimulationFormValues>;
  return {
    hourType: parsed.hourType === "HH" || parsed.hourType === "HM" ? parsed.hourType : "HM",
    averagePeriod: parseCostCenterHhHmSimulationAveragePeriod(parsed.averagePeriod),
    selectedCostCenterIds: normalizeStringIdArray(parsed.selectedCostCenterIds),
    baseMonthlyHours: normalizeStringField(parsed.baseMonthlyHours),
    quantityUsedInItem: normalizeStringField(parsed.quantityUsedInItem),
    useManualRate: parsed.useManualRate === true,
    manualRatePerHour: normalizeStringField(parsed.manualRatePerHour),
    note: normalizeStringField(parsed.note),
    filteredDueDateFrom: normalizeStringField(parsed.filteredDueDateFrom),
    filteredDueDateTo: normalizeStringField(parsed.filteredDueDateTo),
  };
}

export type CostCenterHhHmSimulationCostCenterRow = {
  id: string;
  code: string;
  name: string;
  category?: CostCenterHhHmSimulationCategory;
};

export type CostCenterHhHmSimulationCategory =
  | "administrative"
  | "manufacturing"
  | "machine"
  | "exclude"
  | "other";

export const COST_CENTER_HH_HM_SIMULATION_CATEGORY_LABELS: Record<
  CostCenterHhHmSimulationCategory,
  string
> = {
  administrative: "Administrativo / mão de obra",
  manufacturing: "Fabricação / produção",
  machine: "Máquina / energia / manutenção",
  exclude: "Não considerar",
  other: "Outros",
};

export function buildCostCenterHhHmSimulationCostCentersApiPath(
  status: "ACTIVE" | "all" = "ACTIVE"
): string {
  const q = new URLSearchParams();
  if (status !== "all") q.set("status", status);
  const qs = q.toString();
  return `/api/finance/cost-centers/hh-hm-simulation/cost-centers${qs ? `?${qs}` : ""}`;
}

function normalizeCategoryToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase()
    .trim();
}

export function inferCostCenterHhHmSimulationCategory(
  code: string,
  name: string
): CostCenterHhHmSimulationCategory {
  const haystack = normalizeCategoryToken(`${code} ${name}`);
  if (
    haystack.includes("NAO CONSIDER") ||
    haystack.includes("IGNORAR") ||
    haystack.includes("EXCLUIR")
  ) {
    return "exclude";
  }
  if (
    haystack.includes("ENERG") ||
    haystack.includes("MAQUIN") ||
    haystack.includes("MANUT") ||
    haystack.includes("DEPREC")
  ) {
    return "machine";
  }
  if (haystack.includes("FABRIC") || haystack.includes("INDUSTRI") || haystack.includes("PRODUC")) {
    return "manufacturing";
  }
  if (
    haystack.includes("ADMIN") ||
    haystack.includes("FOLHA") ||
    haystack.includes("MAO DE OBRA") ||
    haystack.includes("MAO OBRA")
  ) {
    return "administrative";
  }
  return "other";
}

export function enrichCostCenterHhHmSimulationCostCenterRow(
  row: CostCenterHhHmSimulationCostCenterRow
): CostCenterHhHmSimulationCostCenterRow {
  return {
    ...row,
    category: inferCostCenterHhHmSimulationCategory(row.code, row.name),
  };
}

function categorySortRank(
  category: CostCenterHhHmSimulationCategory | undefined,
  hourType: CostCenterHhHmSimulationHourType
): number {
  if (hourType === "HH") {
    switch (category) {
      case "administrative":
        return 0;
      case "manufacturing":
        return 1;
      case "other":
        return 2;
      case "machine":
        return 3;
      case "exclude":
        return 4;
      default:
        return 2;
    }
  }
  switch (category) {
    case "machine":
      return 0;
    case "manufacturing":
      return 1;
    case "other":
      return 2;
    case "administrative":
      return 3;
    case "exclude":
      return 4;
    default:
      return 2;
  }
}

export function sortCostCenterHhHmSimulationCostCenters(
  items: CostCenterHhHmSimulationCostCenterRow[],
  hourType: CostCenterHhHmSimulationHourType
): CostCenterHhHmSimulationCostCenterRow[] {
  return [...items].sort((a, b) => {
    const rankDiff =
      categorySortRank(a.category, hourType) - categorySortRank(b.category, hourType);
    if (rankDiff !== 0) return rankDiff;
    const codeDiff = a.code.localeCompare(b.code, "pt-BR");
    if (codeDiff !== 0) return codeDiff;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export function filterCostCenterHhHmSimulationCostCenters(
  items: CostCenterHhHmSimulationCostCenterRow[],
  search: string
): CostCenterHhHmSimulationCostCenterRow[] {
  const term = search.trim().toUpperCase();
  if (!term) return items;
  return items.filter((row) => {
    const haystack = normalizeCategoryToken(`${row.code} ${row.name}`);
    return haystack.includes(term);
  });
}

export function formatCostCenterHhHmSimulationSelectedLabels(
  selectedIds: string[],
  items: CostCenterHhHmSimulationCostCenterRow[]
): string {
  if (selectedIds.length === 0) return "—";
  const byId = new Map(items.map((row) => [row.id, row]));
  const labels = selectedIds
    .map((id) => {
      const row = byId.get(id);
      return row ? `${row.code} — ${row.name}` : id;
    })
    .filter(Boolean);
  return labels.length > 0 ? labels.join("; ") : "—";
}

export function pruneCostCenterHhHmSimulationSelectedIds(
  selectedIds: string[],
  availableIds: string[]
): string[] {
  const valid = new Set(availableIds);
  return selectedIds.filter((id) => valid.has(id));
}

export type CostCenterHhHmSimulationCostCentersParseResult = {
  items: CostCenterHhHmSimulationCostCenterRow[];
  invalidShape: boolean;
};

function isCostCenterHhHmSimulationCostCenterRow(
  value: unknown
): value is CostCenterHhHmSimulationCostCenterRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.code === "string" &&
    typeof row.name === "string"
  );
}

/** Normaliza GET /api/finance/cost-centers/hh-hm-simulation/cost-centers ({ items }), array ou { data }. */
export function parseCostCenterHhHmSimulationCostCentersResponse(
  payload: unknown
): CostCenterHhHmSimulationCostCentersParseResult {
  const extractRows = (rows: unknown): CostCenterHhHmSimulationCostCenterRow[] => {
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(isCostCenterHhHmSimulationCostCenterRow)
      .map(enrichCostCenterHhHmSimulationCostCenterRow);
  };

  if (payload == null) {
    return { items: [], invalidShape: true };
  }
  if (Array.isArray(payload)) {
    return { items: extractRows(payload), invalidShape: false };
  }
  if (typeof payload === "object") {
    const body = payload as Record<string, unknown>;
    if (Array.isArray(body.items)) {
      return { items: extractRows(body.items), invalidShape: false };
    }
    if (Array.isArray(body.data)) {
      return { items: extractRows(body.data), invalidShape: false };
    }
  }
  return { items: [], invalidShape: true };
}

export type CostCenterHhHmSimulationMonthlyDataParseResult =
  | {
      ok: true;
      periodLabel: string;
      metricsScope: string;
      monthlyBuckets: CostCenterMonthlyExpenseBucket[];
    }
  | { ok: false; message: string };

function isMonthlyExpenseBucket(value: unknown): value is CostCenterMonthlyExpenseBucket {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.year === "number" &&
    typeof row.month === "number" &&
    typeof row.totalAmount === "number"
  );
}

/** Normaliza payload de GET .../hh-hm-simulation/monthly-data. */
export function parseCostCenterHhHmSimulationMonthlyDataResponse(
  payload: unknown
): CostCenterHhHmSimulationMonthlyDataParseResult {
  if (!payload || typeof payload !== "object") {
    return { ok: false, message: "Resposta inválida da API de média mensal." };
  }
  const body = payload as Record<string, unknown>;
  const monthlyBuckets = body.monthlyBuckets;
  if (!Array.isArray(monthlyBuckets)) {
    return { ok: false, message: "monthlyBuckets ausente ou inválido na resposta da API." };
  }
  return {
    ok: true,
    periodLabel: normalizeStringField(body.periodLabel, "Período"),
    metricsScope: normalizeStringField(
      body.metricsScope,
      COST_CENTER_HH_HM_SIMULATION_METRICS_SCOPE
    ),
    monthlyBuckets: monthlyBuckets.filter(isMonthlyExpenseBucket),
  };
}

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
