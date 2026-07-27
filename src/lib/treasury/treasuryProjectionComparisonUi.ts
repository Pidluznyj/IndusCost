/**
 * Labels e helpers — comparação de cenários (client-safe).
 * Alternância de cenários visíveis é local — sem refetch.
 */

import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryFinancialAccountDto,
  TreasuryProjectionComparisonDto,
  TreasuryProjectionComparisonDayDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_COMPARISON_SCENARIOS,
  type TreasuryComparisonScenario,
  isTreasuryComparisonScenario,
} from "./domain/treasuryProjectionComparisonRules.js";
import type { TreasuryProjectionComparisonFetchParams } from "./treasuryProjectionComparisonApi.js";
import {
  addCivilDays,
  todayCivilDateLocal,
  type TreasuryAgendaPeriodPreset,
  isTreasuryAgendaPeriodPreset,
  resolveTreasuryAgendaPeriodRange,
} from "./treasuryAgendaUi.js";

export const TREASURY_COMPARISON_PAGE_TITLE =
  "Comparação de cenários" as const;
export const TREASURY_COMPARISON_PAGE_SUBTITLE =
  "Contratual × Provável × Confirmado — saldos, diferenças, incerteza e risco, sem recalcular ao alternar." as const;

export const TREASURY_COMPARISON_DENIED_MESSAGE =
  "Sem permissão para visualizar a comparação de projeções da Tesouraria." as const;

export const TREASURY_COMPARISON_EMPTY_TITLE =
  "Sem projeções para comparar" as const;
export const TREASURY_COMPARISON_EMPTY_DESCRIPTION =
  "Calcule as projeções contratual, provável e confirmada no período para comparar cenários." as const;

export const TREASURY_COMPARISON_STALE_MESSAGE =
  "Uma ou mais projeções estão stale. A comparação usa runs persistidos — atualize/recalcule só se necessário." as const;

export const TREASURY_COMPARISON_SCENARIO_LABELS: Record<
  TreasuryComparisonScenario,
  string
> = {
  CONTRACTUAL: "Contratual",
  PROBABLE: "Provável",
  CONFIRMED: "Confirmado",
};

export type TreasuryComparisonFilterState = {
  period: TreasuryAgendaPeriodPreset;
  baseDate: string;
  endDate: string;
  accountId: string;
  companyCode: string;
  /** Cenários exibidos — toggle local, sem refetch. */
  visibleScenarios: TreasuryComparisonScenario[];
};

export function createEmptyTreasuryComparisonFilters(
  today = todayCivilDateLocal()
): TreasuryComparisonFilterState {
  return {
    period: "30d",
    baseDate: today,
    endDate: addCivilDays(today, 29),
    accountId: "",
    companyCode: "",
    visibleScenarios: [...TREASURY_COMPARISON_SCENARIOS],
  };
}

export function parseVisibleScenariosParam(
  raw: string | null
): TreasuryComparisonScenario[] {
  if (!raw?.trim()) return [...TREASURY_COMPARISON_SCENARIOS];
  const parts = raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(isTreasuryComparisonScenario);
  return parts.length > 0 ? parts : [...TREASURY_COMPARISON_SCENARIOS];
}

export function toggleVisibleScenario(
  current: TreasuryComparisonScenario[],
  scenario: TreasuryComparisonScenario
): TreasuryComparisonScenario[] {
  const set = new Set(current);
  if (set.has(scenario)) {
    if (set.size <= 1) return current;
    set.delete(scenario);
  } else {
    set.add(scenario);
  }
  return TREASURY_COMPARISON_SCENARIOS.filter((s) => set.has(s));
}

export type TreasuryComparisonViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function resolveTreasuryComparisonViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
}): TreasuryComparisonViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasData) return "loading";
  if (input.error && !input.hasData) return "error";
  if (!input.hasData) return "empty";
  return "ready";
}

export function resolveTreasuryComparisonCompanyCode(
  filters: TreasuryComparisonFilterState,
  accounts: TreasuryFinancialAccountDto[]
): string {
  const fromFilter = filters.companyCode.trim();
  if (fromFilter) return fromFilter;
  return (
    accounts.find((a) => a.companyCode?.trim())?.companyCode?.trim() ||
    "LAZARIOS"
  );
}

/**
 * Query de rede — NÃO inclui visibleScenarios (toggle é só UI).
 */
export function buildTreasuryComparisonQuery(input: {
  filters: TreasuryComparisonFilterState;
  accounts: TreasuryFinancialAccountDto[];
  today?: string;
}): TreasuryProjectionComparisonFetchParams & {
  range: { baseDate: string; endDate: string };
} {
  const today = input.today ?? todayCivilDateLocal();
  const range = resolveTreasuryAgendaPeriodRange(input.filters, today);
  return {
    companyCode: resolveTreasuryComparisonCompanyCode(
      input.filters,
      input.accounts
    ),
    baseDate: range.baseDate,
    endDate: range.endDate,
    accountIds: input.filters.accountId.trim()
      ? [input.filters.accountId.trim()]
      : null,
    consolidated: true,
    range,
  };
}

/** Chave estável do fetch — muda só quando período/conta/empresa mudam. */
export function treasuryComparisonFetchKey(
  query: Pick<
    TreasuryProjectionComparisonFetchParams,
    "companyCode" | "baseDate" | "endDate" | "accountIds" | "consolidated"
  >
): string {
  return [
    query.companyCode,
    query.baseDate,
    query.endDate,
    query.consolidated ? "1" : "0",
    (query.accountIds ?? []).join(","),
  ].join("|");
}

export function formatTreasuryComparisonMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  try {
    return formatFinanceCurrency(Number(value));
  } catch {
    return value;
  }
}

export function formatTreasuryComparisonCivilDate(civilDate: string): string {
  const [y, m, d] = civilDate.split("-");
  if (!y || !m || !d) return civilDate;
  return `${d}/${m}/${y}`;
}

export function formatTreasuryComparisonDateTime(
  value: string | null | undefined
): string {
  if (!value) return "—";
  return formatFinanceDateTime(value);
}

export function resolveTreasuryComparisonStaleState(
  comparison: TreasuryProjectionComparisonDto | null
): string | null {
  if (!comparison?.freshness?.hasStaleSource) return null;
  return TREASURY_COMPARISON_STALE_MESSAGE;
}

export type TreasuryComparisonChartPoint = {
  civilDate: string;
  label: string;
  CONTRACTUAL: number | null;
  PROBABLE: number | null;
  CONFIRMED: number | null;
  CONTRACTUALText: string;
  PROBABLEText: string;
  CONFIRMEDText: string;
};

export function buildTreasuryComparisonChartPoints(
  days: TreasuryProjectionComparisonDayDto[],
  visible: TreasuryComparisonScenario[]
): TreasuryComparisonChartPoint[] {
  const show = new Set(visible);
  return days.map((d) => ({
    civilDate: d.civilDate,
    label: formatTreasuryComparisonCivilDate(d.civilDate),
    CONTRACTUAL: show.has("CONTRACTUAL")
      ? d.balances.CONTRACTUAL != null
        ? Number(d.balances.CONTRACTUAL)
        : null
      : null,
    PROBABLE: show.has("PROBABLE")
      ? d.balances.PROBABLE != null
        ? Number(d.balances.PROBABLE)
        : null
      : null,
    CONFIRMED: show.has("CONFIRMED")
      ? d.balances.CONFIRMED != null
        ? Number(d.balances.CONFIRMED)
        : null
      : null,
    CONTRACTUALText: formatTreasuryComparisonMoney(d.balances.CONTRACTUAL),
    PROBABLEText: formatTreasuryComparisonMoney(d.balances.PROBABLE),
    CONFIRMEDText: formatTreasuryComparisonMoney(d.balances.CONFIRMED),
  }));
}

export {
  TREASURY_COMPARISON_SCENARIOS,
  isTreasuryComparisonScenario,
  isTreasuryAgendaPeriodPreset,
  todayCivilDateLocal,
  type TreasuryComparisonScenario,
  type TreasuryAgendaPeriodPreset,
};
