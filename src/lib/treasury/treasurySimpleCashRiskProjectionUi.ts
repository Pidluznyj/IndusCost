/**
 * UI helpers — projeção simples de risco de caixa (Próximos dias).
 */

import type {
  TreasuryAgendaDto,
  TreasuryFinancialAccountDto,
} from "./contracts/index.js";
import {
  TREASURY_SIMPLE_CASH_RISK_PERIODS,
  TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIOS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  TREASURY_SIMPLE_CASH_RISK_TITLE,
  TREASURY_SIMPLE_CASH_RISK_UI_PATH,
  type TreasurySimpleCashRiskPeriod,
  type TreasurySimpleCashRiskScenario,
  type TreasurySimpleCashRiskSummaryDto,
} from "./domain/treasurySimpleCashRiskProjectionRules.js";
import {
  addCivilDays,
  formatTreasuryAgendaCivilDate,
  formatTreasuryAgendaMoney,
  resolveTreasuryAgendaPeriodRange,
  todayCivilDateLocal,
} from "./treasuryAgendaUi.js";
import { formatTreasuryApiMoneyToPtBr } from "./treasuryBalancesUi.js";

export {
  TREASURY_SIMPLE_CASH_RISK_PERIODS,
  TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIOS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  TREASURY_SIMPLE_CASH_RISK_TITLE,
  TREASURY_SIMPLE_CASH_RISK_UI_PATH,
};

export const TREASURY_SIMPLE_CASH_RISK_PAGE_SUBTITLE =
  "Projeção do saldo nos próximos dias, com reserva mínima e cenários contratual e provável." as const;

export const TREASURY_SIMPLE_CASH_RISK_DENIED =
  "Você não tem permissão para visualizar a projeção de caixa da Tesouraria." as const;

export const TREASURY_SIMPLE_CASH_RISK_EMPTY_TITLE =
  "Sem projeção para o período" as const;

export const TREASURY_SIMPLE_CASH_RISK_EMPTY_DESCRIPTION =
  "Não há dias projetados para o horizonte selecionado. Atualize os dados ou escolha outro período." as const;

export const TREASURY_SIMPLE_CASH_RISK_ADVANCED_HINT =
  "Cenários avançados e comparação detalhada continuam em Recursos avançados (Agenda financeira e Comparação de cenários)." as const;

export type TreasurySimpleCashRiskFilterState = {
  period: TreasurySimpleCashRiskPeriod;
  scenario: TreasurySimpleCashRiskScenario;
  companyCode: string;
  selectedCivilDate: string;
};

export type TreasurySimpleCashRiskViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function isTreasurySimpleCashRiskPeriod(
  value: string
): value is TreasurySimpleCashRiskPeriod {
  return (TREASURY_SIMPLE_CASH_RISK_PERIODS as readonly string[]).includes(value);
}

export function isTreasurySimpleCashRiskScenario(
  value: string
): value is TreasurySimpleCashRiskScenario {
  return (TREASURY_SIMPLE_CASH_RISK_SCENARIOS as readonly string[]).includes(
    value
  );
}

export function createEmptyTreasurySimpleCashRiskFilters(
  today = todayCivilDateLocal()
): TreasurySimpleCashRiskFilterState {
  return {
    period: "7d",
    scenario: "PROBABLE",
    companyCode: "",
    selectedCivilDate: today,
  };
}

export function resolveTreasurySimpleCashRiskViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
}): TreasurySimpleCashRiskViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasData) return "loading";
  if (input.error && !input.hasData) return "error";
  if (!input.hasData) return "empty";
  return "ready";
}

export function resolveTreasurySimpleCashRiskCompanyCode(
  filters: TreasurySimpleCashRiskFilterState,
  accounts: TreasuryFinancialAccountDto[]
): string | null {
  const fromFilter = filters.companyCode.trim();
  if (fromFilter) return fromFilter;
  const first = accounts.find((a) => a.companyCode?.trim())?.companyCode?.trim();
  return first || null;
}

export function resolveTreasurySimpleCashRiskRange(
  period: TreasurySimpleCashRiskPeriod,
  today = todayCivilDateLocal()
): { baseDate: string; endDate: string } {
  return resolveTreasuryAgendaPeriodRange(
    { period, baseDate: today, endDate: addCivilDays(today, 6) },
    today
  );
}

export function formatTreasurySimpleCashRiskMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  try {
    return `R$ ${formatTreasuryApiMoneyToPtBr(value)}`;
  } catch {
    return formatTreasuryAgendaMoney(value);
  }
}

export function formatTreasurySimpleCashRiskDate(civilDate: string | null): string {
  if (!civilDate) return "—";
  return formatTreasuryAgendaCivilDate(civilDate);
}

export function formatTreasurySimpleCashRiskPercent(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  try {
    return `${formatTreasuryApiMoneyToPtBr(value)}%`;
  } catch {
    return `${value}%`;
  }
}

export function reserveIndicatorLabel(
  summary: TreasurySimpleCashRiskSummaryDto | null
): string {
  const reserve = summary?.reserve;
  if (!reserve) return "Sem indicador de reserva";
  if (reserve.kind === "NO_RESERVE") {
    return "Reserva mínima não configurada (0,00) — percentual de superávit não se aplica";
  }
  if (reserve.kind === "SURPLUS") {
    return "Excedente sobre a reserva mínima";
  }
  if (reserve.kind === "SHORTAGE") {
    return "Insuficiência em relação à reserva mínima";
  }
  return "Saldo projetado igual à reserva mínima";
}

export function originLabel(
  origin: "CONTRACTUAL" | "PROBABLE" | "OTHER"
): string {
  if (origin === "CONTRACTUAL") return "Contratual";
  if (origin === "PROBABLE") return "Provável";
  return "Outra origem";
}

export function resolveTreasurySimpleCashRiskStaleMessage(
  agenda: Pick<TreasuryAgendaDto, "freshness"> | null
): string | null {
  if (!agenda?.freshness?.hasStaleSource) return null;
  return "Há fontes desatualizadas nesta projeção. Atualize os dados quando possível.";
}
