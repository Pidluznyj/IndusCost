/**
 * Labels e helpers — saldos iniciais guiados (client-safe).
 */

import type {
  TreasuryDailyOpeningDiffJustificationCode,
  TreasuryGuidedDailyOpeningAccountDto,
  TreasuryGuidedDailyOpeningWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_LABELS,
  TREASURY_GUIDED_DAILY_OPENING_TITLE,
  computeTreasuryGuidedDailyOpeningDifference,
} from "./domain/treasuryGuidedDailyOpeningRules.js";
import {
  formatTreasuryApiMoneyToPtBr,
  parseTreasuryPtBrMoneyToApi,
} from "./treasuryBalancesUi.js";
import { formatTreasuryTodayCivilDate } from "./treasuryTodayUi.js";

export const TREASURY_TODAY_OPENING_PAGE_TITLE =
  TREASURY_GUIDED_DAILY_OPENING_TITLE;

export const TREASURY_TODAY_OPENING_PAGE_SUBTITLE =
  "Confirme o saldo sugerido pelo último fechamento ou informe o valor de cada conta." as const;

export const TREASURY_TODAY_OPENING_DENIED_MESSAGE =
  "Sem permissão para informar saldos iniciais da Tesouraria." as const;

export const TREASURY_TODAY_OPENING_EMPTY_TITLE =
  "Nenhuma conta ativa" as const;

export const TREASURY_TODAY_OPENING_EMPTY_DESCRIPTION =
  "Cadastre ou ative contas financeiras para iniciar o dia." as const;

export const TREASURY_TODAY_OPENING_DIFF_LABELS = {
  previous: "Saldo final anterior",
  informed: "Saldo inicial informado",
  difference: "Diferença",
} as const;

export const TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS =
  TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_LABELS;

export type TreasuryTodayOpeningDraftRow = {
  accountId: string;
  expectedVersion: number;
  displayAmount: string;
  notes: string;
  justificationCode: TreasuryDailyOpeningDiffJustificationCode | "";
  justificationDetail: string;
  editing: boolean;
};

export type TreasuryTodayOpeningViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function formatTreasuryTodayOpeningCivilDate(date: string): string {
  return formatTreasuryTodayCivilDate(date);
}

export function formatTreasuryTodayOpeningMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatTreasuryApiMoneyToPtBr(value);
}

export function createTreasuryTodayOpeningDrafts(
  workspace: TreasuryGuidedDailyOpeningWorkspaceDto
): Record<string, TreasuryTodayOpeningDraftRow> {
  const out: Record<string, TreasuryTodayOpeningDraftRow> = {};
  for (const acc of workspace.accounts) {
    const base =
      acc.currentOpeningBalance ?? acc.suggestedOpeningBalance ?? "";
    out[acc.accountId] = {
      accountId: acc.accountId,
      expectedVersion: acc.expectedVersion,
      displayAmount: base ? formatTreasuryApiMoneyToPtBr(base) : "",
      notes: "",
      justificationCode: "",
      justificationDetail: "",
      editing: acc.situation === "NEEDS_MANUAL",
    };
  }
  return out;
}

export function resolveTreasuryTodayOpeningDraftDiff(
  account: TreasuryGuidedDailyOpeningAccountDto,
  draft: TreasuryTodayOpeningDraftRow
) {
  const api = parseTreasuryPtBrMoneyToApi(draft.displayAmount);
  if (!api) {
    return {
      hasDifference: false,
      previousClosingBalance: account.previousClosingBalance,
      informedOpeningBalance: null as string | null,
      difference: null as string | null,
      validAmount: false,
    };
  }
  const diff = computeTreasuryGuidedDailyOpeningDifference({
    previousClosingBalance: account.previousClosingBalance,
    informedOpeningBalance: api,
  });
  return {
    ...diff,
    informedOpeningBalance: api,
    validAmount: true,
  };
}

export function resolveTreasuryTodayOpeningViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  data: TreasuryGuidedDailyOpeningWorkspaceDto | null;
}): TreasuryTodayOpeningViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.data) return "loading";
  if (input.error && !input.data) return "error";
  if (input.data && input.data.accounts.length === 0) return "empty";
  if (input.data) return "ready";
  if (input.loading) return "loading";
  if (input.error) return "error";
  return "empty";
}
