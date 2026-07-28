/**
 * Labels e helpers — Tesouraria de hoje (client-safe).
 */

import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryDailyAccountRoutineStatus,
  TreasuryGuidedTodayDto,
  TreasuryGuidedTodayStepStatus,
} from "@/src/lib/treasury/contracts/index.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryTodayFetchParams } from "./treasuryTodayApi.js";

export const TREASURY_TODAY_PAGE_TITLE = "Tesouraria de hoje" as const;

export const TREASURY_TODAY_PAGE_SUBTITLE =
  "Veja o dinheiro do dia e siga a rotina passo a passo." as const;

export const TREASURY_TODAY_DENIED_MESSAGE =
  "Sem permissão para visualizar a Tesouraria de hoje." as const;

export const TREASURY_TODAY_EMPTY_TITLE = "Nenhuma conta para hoje" as const;

export const TREASURY_TODAY_EMPTY_DESCRIPTION =
  "Cadastre ou ative contas financeiras para começar a rotina do dia." as const;

export const TREASURY_TODAY_ATTENTION_TITLE = "Atenção" as const;

export const TREASURY_TODAY_ROUTINE_TITLE = "Rotina do dia" as const;

export const TREASURY_TODAY_ACCOUNTS_TITLE = "Contas" as const;

export const TREASURY_TODAY_STEP_STATUS_LABELS: Record<
  TreasuryGuidedTodayStepStatus,
  string
> = {
  DONE: "Concluída",
  PENDING: "Pendente",
  NEEDS_ATTENTION: "Precisa de atenção",
};

export const TREASURY_TODAY_ACCOUNT_STATUS_LABELS: Record<
  TreasuryDailyAccountRoutineStatus,
  string
> = {
  NOT_STARTED: "Não iniciada",
  OPEN: "Em andamento",
  NEEDS_REVIEW: "Precisa de atenção",
  READY_TO_CLOSE: "Pronta para fechar",
  CLOSED: "Fechada",
  REOPENED: "Reaberta",
};

export const TREASURY_TODAY_METRIC_LABELS = {
  openingBalance: "Saldo inicial",
  plannedInflows: "Entradas previstas",
  realizedInflows: "Entradas realizadas",
  plannedOutflows: "Saídas previstas",
  realizedOutflows: "Saídas realizadas",
  predictedClosingBalance: "Saldo previsto no fim do dia",
  realizedClosingBalance: "Saldo realizado calculado",
  informedClosingBalance: "Saldo bancário final informado",
  divergence: "Divergência total",
} as const;

export type TreasuryTodayViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function todayCivilDateLocal(): string {
  return todayTreasuryCivilDateInSaoPaulo();
}

export function formatTreasuryTodayMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatFinanceCurrency(value);
}

export function formatTreasuryTodayCivilDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!m) return date;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function buildTreasuryTodayQuery(params: {
  date?: string | null;
}): TreasuryTodayFetchParams {
  return {
    date: params.date?.trim() || todayCivilDateLocal(),
  };
}

export function resolveTreasuryTodayViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  data: TreasuryGuidedTodayDto | null;
}): TreasuryTodayViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.data) return "loading";
  if (input.error && !input.data) return "error";
  if (input.data?.empty) return "empty";
  if (input.data) return "ready";
  if (input.loading) return "loading";
  if (input.error) return "error";
  return "empty";
}
