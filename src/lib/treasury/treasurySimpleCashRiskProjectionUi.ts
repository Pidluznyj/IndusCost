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
  periodDaysForTreasurySimpleCashRisk,
  type TreasurySimpleCashRiskPeriod,
  type TreasurySimpleCashRiskScenario,
  type TreasurySimpleCashRiskSummaryDto,
} from "./domain/treasurySimpleCashRiskProjectionRules.js";
import {
  addCivilDays,
  formatTreasuryAgendaCivilDate,
  formatTreasuryAgendaMoney,
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
  periodDaysForTreasurySimpleCashRisk,
};
export type {
  TreasurySimpleCashRiskPeriod,
  TreasurySimpleCashRiskScenario,
};

export const TREASURY_SIMPLE_CASH_RISK_PAGE_SUBTITLE =
  "Fluxo Gerencial: projeção do saldo com contas, títulos e lançamentos canônicos da Tesouraria." as const;

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
    period: "30d",
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

/** Códigos de empresa distintos nas contas (ordenados), para filtro opcional na UI. */
export function listTreasurySimpleCashRiskCompanyCodes(
  accounts: ReadonlyArray<Pick<TreasuryFinancialAccountDto, "companyCode">>
): string[] {
  const set = new Set<string>();
  for (const a of accounts) {
    const code = a.companyCode?.trim();
    if (code) set.add(code);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function resolveTreasurySimpleCashRiskRange(
  period: TreasurySimpleCashRiskPeriod,
  today = todayCivilDateLocal(),
  baseCivilDate?: string | null
): { baseDate: string; endDate: string } {
  const base =
    baseCivilDate && /^\d{4}-\d{2}-\d{2}$/.test(baseCivilDate.trim())
      ? baseCivilDate.trim()
      : today;
  const days = periodDaysForTreasurySimpleCashRisk(period);
  return {
    baseDate: base,
    endDate: addCivilDays(base, Math.max(0, days - 1)),
  };
}

export function splitTreasurySimpleCashRiskCivilDate(civilDate: string): {
  year: string;
  month: string;
  day: string;
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate.trim());
  if (!m) {
    const today = todayCivilDateLocal();
    return splitTreasurySimpleCashRiskCivilDate(today);
  }
  return { year: m[1]!, month: m[2]!, day: m[3]! };
}

export function daysInTreasuryCivilMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function joinTreasurySimpleCashRiskCivilDate(input: {
  year: string;
  month: string;
  day: string;
}): string | null {
  const y = Number(input.year);
  const mo = Number(input.month);
  const d = Number(input.day);
  if (
    !Number.isInteger(y) ||
    !Number.isInteger(mo) ||
    !Number.isInteger(d) ||
    mo < 1 ||
    mo > 12 ||
    d < 1
  ) {
    return null;
  }
  const maxDay = daysInTreasuryCivilMonth(y, mo);
  const day = Math.min(d, maxDay);
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function listTreasurySimpleCashRiskYearOptions(
  aroundYear = Number(todayCivilDateLocal().slice(0, 4))
): string[] {
  const y = Number.isFinite(aroundYear) ? aroundYear : new Date().getUTCFullYear();
  const out: string[] = [];
  for (let i = y - 2; i <= y + 2; i += 1) out.push(String(i));
  return out;
}

export const TREASURY_SIMPLE_CASH_RISK_MONTH_OPTIONS: readonly {
  value: string;
  label: string;
}[] = [
  { value: "01", label: "Janeiro" },
  { value: "02", label: "Fevereiro" },
  { value: "03", label: "Março" },
  { value: "04", label: "Abril" },
  { value: "05", label: "Maio" },
  { value: "06", label: "Junho" },
  { value: "07", label: "Julho" },
  { value: "08", label: "Agosto" },
  { value: "09", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
] as const;

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
