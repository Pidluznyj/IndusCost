/**
 * Labels e helpers — Tesouraria de hoje (client-safe).
 */

import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryDailyAccountRoutineStatus,
  TreasuryGuidedTodayAttentionCode,
  TreasuryGuidedTodayDto,
  TreasuryGuidedTodayStepDto,
  TreasuryGuidedTodayStepStatus,
} from "@/src/lib/treasury/contracts/index.js";
import { todayTreasuryCivilDateInSaoPaulo } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryTodayFetchParams } from "./treasuryTodayApi.js";

export const TREASURY_TODAY_PAGE_TITLE = "Tesouraria de hoje" as const;

export const TREASURY_TODAY_PAGE_SUBTITLE =
  "Posição do caixa, rotina do dia e próximos passos — sem inventar saldo." as const;

export const TREASURY_TODAY_DENIED_MESSAGE =
  "Sem permissão para visualizar a Tesouraria de hoje." as const;

export const TREASURY_TODAY_EMPTY_TITLE = "Nenhuma conta para hoje" as const;

export const TREASURY_TODAY_EMPTY_DESCRIPTION =
  "Cadastre ou ative contas financeiras e vincule a conta Nomus para começar a rotina do dia." as const;

export const TREASURY_TODAY_EMPTY_CTA_LABEL = "Ir para Contas" as const;

export const TREASURY_TODAY_EMPTY_CTA_HREF =
  "/finance/treasury/accounts" as const;

export const TREASURY_TODAY_ATTENTION_TITLE = "Precisa de atenção" as const;

export const TREASURY_TODAY_ROUTINE_TITLE = "Rotina do dia" as const;

export const TREASURY_TODAY_ACCOUNTS_TITLE = "Contas do dia" as const;

export const TREASURY_TODAY_NEXT_ACTION_TITLE = "Próximo passo" as const;

export const TREASURY_TODAY_FLOW_SECTION_TITLE = "Fluxo do dia" as const;

export const TREASURY_TODAY_CLOSING_SECTION_TITLE =
  "Fechamento e conferência" as const;

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
  divergence: "Divergência",
} as const;

export const TREASURY_TODAY_ATTENTION_CODE_LABELS: Record<
  TreasuryGuidedTodayAttentionCode,
  string
> = {
  MISSING_OPENING_BALANCE: "Saldo inicial",
  UNMAPPED_TITLE: "Conta",
  PENDING_RECEIPT: "Recebimentos",
  PENDING_PAYMENT: "Pagamentos",
  MISSING_CLOSING_BALANCE: "Saldo final",
  BALANCE_DIVERGENCE: "Divergência",
  UNIDENTIFIED_BANK_MOVEMENT: "Banco",
};

export type TreasuryTodayViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export type TreasuryTodayMetricTone =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info";

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

/** Relógio do payload (asOf) em pt-BR curto; null se inválido. */
export function formatTreasuryTodayAsOf(asOf: string | null | undefined): string | null {
  if (!asOf?.trim()) return null;
  const d = new Date(asOf);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildTreasuryTodayPageSubtitle(input: {
  civilDate?: string | null;
  asOf?: string | null;
}): string {
  const date = input.civilDate?.trim()
    ? formatTreasuryTodayCivilDate(input.civilDate)
    : null;
  const asOf = formatTreasuryTodayAsOf(input.asOf);
  if (date && asOf) return `${TREASURY_TODAY_PAGE_SUBTITLE} · ${date} · dados às ${asOf}`;
  if (date) return `${TREASURY_TODAY_PAGE_SUBTITLE} · ${date}`;
  return TREASURY_TODAY_PAGE_SUBTITLE;
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

/** Primeiro passo ainda não concluído — CTA principal da tela. */
export function resolveTreasuryTodayPrimaryStep(
  steps: readonly TreasuryGuidedTodayStepDto[] | null | undefined
): TreasuryGuidedTodayStepDto | null {
  if (!steps?.length) return null;
  return (
    steps.find((s) => s.status === "NEEDS_ATTENTION") ??
    steps.find((s) => s.status === "PENDING") ??
    null
  );
}

export function resolveTreasuryTodayDivergenceTone(
  divergence: string | null | undefined
): TreasuryTodayMetricTone {
  if (divergence == null || divergence === "") return "neutral";
  const n = Number(divergence);
  if (!Number.isFinite(n) || n === 0) return "success";
  return "warning";
}

export function resolveTreasuryTodayAttentionTone(
  code: TreasuryGuidedTodayAttentionCode
): TreasuryTodayMetricTone {
  if (code === "BALANCE_DIVERGENCE" || code === "UNIDENTIFIED_BANK_MOVEMENT") {
    return "warning";
  }
  if (code === "UNMAPPED_TITLE") return "danger";
  return "neutral";
}

export function resolveTreasuryTodayAccountOpenLabel(
  status: TreasuryDailyAccountRoutineStatus
): string {
  if (status === "NOT_STARTED") return "Informar saldo inicial";
  if (status === "NEEDS_REVIEW") return "Investigar";
  if (status === "READY_TO_CLOSE") return "Fechar conta";
  if (status === "CLOSED") return "Ver fechamento";
  if (status === "REOPENED") return "Revisar conta";
  return "Continuar";
}

export function resolveTreasuryTodayStepStatusTone(
  status: TreasuryGuidedTodayStepStatus
): TreasuryTodayMetricTone {
  if (status === "DONE") return "success";
  if (status === "NEEDS_ATTENTION") return "warning";
  return "neutral";
}
