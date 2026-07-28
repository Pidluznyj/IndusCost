/**
 * Labels, estados de view e helpers — Dashboard Central de Tesouraria (client-safe).
 */

import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryDashboardCompositionItemDto,
  TreasuryDashboardDto,
  TreasuryExceptionSeverity,
  TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PROJECTION_LAYERS,
  todayTreasuryCivilDateInSaoPaulo,
} from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryDashboardFetchParams } from "./treasuryDashboardApi.js";

export const TREASURY_DASHBOARD_PAGE_TITLE = "Visão geral" as const;
export const TREASURY_DASHBOARD_PAGE_SUBTITLE =
  "Posição financeira do dia, previsto × realizado e exceções prioritárias da Central de Tesouraria." as const;

export const TREASURY_DASHBOARD_DENIED_MESSAGE =
  "Sem permissão para visualizar o dashboard da Central de Tesouraria." as const;

export const TREASURY_DASHBOARD_EMPTY_TITLE = "Sem dados de posição" as const;
export const TREASURY_DASHBOARD_EMPTY_DESCRIPTION =
  "Não há contas acessíveis ou saldos para montar a visão do dia. Cadastre contas ou atualize saldos." as const;

export const TREASURY_DASHBOARD_EMPTY_FILTERED_TITLE =
  "Nenhum dado no filtro" as const;
export const TREASURY_DASHBOARD_EMPTY_FILTERED_DESCRIPTION =
  "Ajuste data, contas ou cenário para ver a posição." as const;

export const TREASURY_DASHBOARD_RECALCULATING_MESSAGE =
  "Recálculo em andamento — atualizando posição e fluxos do dia…" as const;

export const TREASURY_DASHBOARD_STALE_MESSAGE =
  "Dados desatualizados: uma ou mais fontes estão stale (sync/snapshot). Atualize saldos ou aguarde o sync Nomus." as const;

export type TreasuryDashboardPeriod = "day" | "week" | "month";

export const TREASURY_DASHBOARD_PERIOD_LABELS: Record<
  TreasuryDashboardPeriod,
  string
> = {
  day: "Dia",
  week: "Semana",
  month: "Mês",
};

export const TREASURY_DASHBOARD_SCENARIO_LABELS: Record<
  TreasuryProjectionLayer,
  string
> = {
  CONTRACTUAL: "Contratual",
  PROBABLE: "Provável",
  CONFIRMED: "Confirmado",
  MANUAL: "Manual",
};

export const TREASURY_DASHBOARD_SEVERITY_LABELS: Record<
  TreasuryExceptionSeverity,
  string
> = {
  INFO: "Informativo",
  WARNING: "Atenção",
  CRITICAL: "Crítico",
};

export type TreasuryDashboardFilterState = {
  date: string;
  period: TreasuryDashboardPeriod;
  accountId: string;
  scenario: TreasuryProjectionLayer;
};

export function todayCivilDateLocal(): string {
  return todayTreasuryCivilDateInSaoPaulo();
}

export function createEmptyTreasuryDashboardFilters(
  date = todayCivilDateLocal()
): TreasuryDashboardFilterState {
  return {
    date,
    period: "day",
    accountId: "",
    scenario: "PROBABLE",
  };
}

export type TreasuryDashboardViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "empty-filtered"
  | "ready";

export function resolveTreasuryDashboardViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  hasFilters: boolean;
}): TreasuryDashboardViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasData) return "loading";
  if (input.error && !input.hasData) return "error";
  if (!input.hasData) {
    return input.hasFilters ? "empty-filtered" : "empty";
  }
  return "ready";
}

export function treasuryDashboardHasActiveFilters(
  filters: TreasuryDashboardFilterState,
  baselineDate = todayCivilDateLocal()
): boolean {
  return (
    filters.date !== baselineDate ||
    filters.period !== "day" ||
    filters.accountId.trim() !== "" ||
    filters.scenario !== "PROBABLE"
  );
}

export function buildTreasuryDashboardQuery(input: {
  filters: TreasuryDashboardFilterState;
}): TreasuryDashboardFetchParams & { hasFilters: boolean } {
  const { filters } = input;
  const accountIds = filters.accountId.trim()
    ? [filters.accountId.trim()]
    : null;
  return {
    date: filters.date.trim() || todayCivilDateLocal(),
    accountIds,
    scenario: filters.scenario,
    hasFilters: treasuryDashboardHasActiveFilters(filters),
  };
}

export function formatTreasuryDashboardMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatFinanceCurrency(value);
}

export function formatTreasuryDashboardDateTime(
  iso: string | null | undefined
): string {
  return formatFinanceDateTime(iso);
}

export function formatTreasuryDashboardCivilDate(
  civil: string | null | undefined
): string {
  if (!civil) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil.trim());
  if (!m) return civil;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function resolveTreasuryDashboardStaleState(
  dto: TreasuryDashboardDto | null
): string | null {
  if (!dto?.freshness?.hasStaleSource) return null;
  const n = dto.freshness.staleSourceCount;
  return `${TREASURY_DASHBOARD_STALE_MESSAGE} (${n} fonte${n === 1 ? "" : "s"}).`;
}

export function isTreasuryDashboardRecalculating(input: {
  loading: boolean;
  hasData: boolean;
}): boolean {
  return input.loading && input.hasData;
}

export function describeTreasuryDashboardPeriod(
  filters: TreasuryDashboardFilterState
): string {
  const dateLabel = formatTreasuryDashboardCivilDate(filters.date);
  const periodLabel = TREASURY_DASHBOARD_PERIOD_LABELS[filters.period];
  return `${periodLabel} · referência ${dateLabel}`;
}

export function findDashboardCompositionItem(
  dto: TreasuryDashboardDto | null,
  key: string | null
): TreasuryDashboardCompositionItemDto | null {
  if (!dto || !key) return null;
  return dto.composition.find((c) => c.key === key) ?? null;
}

export function isTreasuryDashboardScenario(
  value: string
): value is TreasuryProjectionLayer {
  return (TREASURY_PROJECTION_LAYERS as readonly string[]).includes(value);
}

export function isTreasuryDashboardPeriod(
  value: string
): value is TreasuryDashboardPeriod {
  return value === "day" || value === "week" || value === "month";
}

export type TreasuryDashboardShortcut = {
  id: string;
  label: string;
  path: string;
  description: string;
};

export function buildTreasuryDashboardShortcuts(basePath = "/finance/treasury"): TreasuryDashboardShortcut[] {
  return [
    {
      id: "accounts",
      label: "Contas financeiras",
      path: `${basePath}/accounts`,
      description: "Cadastro, liquidez e consolidado",
    },
    {
      id: "receivables",
      label: "Contas a receber",
      path: `${basePath}/receivables`,
      description: "Títulos oficiais e expectativa",
    },
    {
      id: "payables",
      label: "Contas a pagar",
      path: `${basePath}/payables`,
      description: "Programação e impacto de caixa",
    },
  ];
}

/** Valor textual complementar (não depender só de cor). */
export function divergenceStatusLabel(
  hasDivergence: boolean,
  divergence: string | null | undefined
): string {
  if (!hasDivergence) return "Sem divergência";
  return `Divergência: ${formatTreasuryDashboardMoney(divergence)}`;
}
