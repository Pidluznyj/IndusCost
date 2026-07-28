/**
 * Labels e helpers — saldos finais guiados (client-safe).
 */

import type {
  TreasuryGuidedDailyClosingAccountDto,
  TreasuryGuidedDailyClosingWorkspaceDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_GUIDED_DAILY_CLOSING_TITLE,
  formatTreasuryGuidedDailyClosingDivergenceMessage,
} from "./domain/treasuryGuidedDailyClosingRules.js";
import {
  formatTreasuryApiMoneyToPtBr,
  parseTreasuryPtBrMoneyToApi,
} from "./treasuryBalancesUi.js";
import {
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
} from "./treasuryMoney.js";
import { formatTreasuryTodayCivilDate } from "./treasuryTodayUi.js";

export const TREASURY_TODAY_CLOSING_PAGE_TITLE =
  TREASURY_GUIDED_DAILY_CLOSING_TITLE;

export const TREASURY_TODAY_CLOSING_PAGE_SUBTITLE =
  "Informe o saldo final do banco, revise diferenças e feche o dia." as const;

export const TREASURY_TODAY_CLOSING_DENIED_MESSAGE =
  "Sem permissão para informar saldos finais da Tesouraria." as const;

export const TREASURY_TODAY_CLOSING_EMPTY_TITLE =
  "Nenhuma conta ativa" as const;

export const TREASURY_TODAY_CLOSING_EMPTY_DESCRIPTION =
  "Cadastre ou ative contas financeiras para fechar o dia." as const;

export type TreasuryTodayClosingStep =
  | "final-balances"
  | "divergences"
  | "close";

export type TreasuryTodayClosingDraftRow = {
  accountId: string;
  expectedVersion: number;
  displayAmount: string;
  notes: string;
};

export type TreasuryTodayClosingViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "ready";

export function formatTreasuryTodayClosingCivilDate(date: string): string {
  return formatTreasuryTodayCivilDate(date);
}

export function formatTreasuryTodayClosingMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatTreasuryApiMoneyToPtBr(value);
}

export function parseTreasuryTodayClosingStep(
  raw: string | null | undefined
): TreasuryTodayClosingStep {
  if (raw === "divergences" || raw === "divergence") return "divergences";
  if (raw === "close" || raw === "fechamento") return "close";
  return "final-balances";
}

export function createTreasuryTodayClosingDrafts(
  workspace: TreasuryGuidedDailyClosingWorkspaceDto
): Record<string, TreasuryTodayClosingDraftRow> {
  const out: Record<string, TreasuryTodayClosingDraftRow> = {};
  for (const acc of workspace.accounts) {
    const base =
      acc.informedClosingBalance ?? acc.realizedClosingBalance ?? "";
    out[acc.accountId] = {
      accountId: acc.accountId,
      expectedVersion: acc.expectedVersion,
      displayAmount: base ? formatTreasuryApiMoneyToPtBr(base) : "",
      notes: "",
    };
  }
  return out;
}

export function resolveTreasuryTodayClosingDraftDivergence(
  account: TreasuryGuidedDailyClosingAccountDto,
  draft: TreasuryTodayClosingDraftRow
): {
  validAmount: boolean;
  informedClosingBalance: string | null;
  divergence: string | null;
  divergenceMessage: string | null;
} {
  const api = parseTreasuryPtBrMoneyToApi(draft.displayAmount);
  if (!api) {
    return {
      validAmount: false,
      informedClosingBalance: null,
      divergence: null,
      divergenceMessage: null,
    };
  }
  if (account.realizedClosingBalance == null) {
    return {
      validAmount: true,
      informedClosingBalance: api,
      divergence: null,
      divergenceMessage: null,
    };
  }
  const divergence = subtractTreasuryMoney(
    normalizeTreasuryMoneyString(api),
    normalizeTreasuryMoneyString(account.realizedClosingBalance)
  );
  return {
    validAmount: true,
    informedClosingBalance: api,
    divergence,
    divergenceMessage:
      formatTreasuryGuidedDailyClosingDivergenceMessage(divergence),
  };
}

export function resolveTreasuryTodayClosingViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  accountCount: number;
}): TreasuryTodayClosingViewKind {
  if (!input.canView) return "denied";
  if (input.loading && !input.hasLoaded) return "loading";
  if (input.error && !input.hasLoaded) return "error";
  if (input.hasLoaded && input.accountCount === 0) return "empty";
  if (input.hasLoaded) return "ready";
  return "loading";
}
