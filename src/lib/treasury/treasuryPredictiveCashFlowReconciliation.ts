/**
 * View-model — Fechamento diário (Fluxo Gerencial): informado × calculado por conta.
 * Consome workspaces canônicos de abertura/fechamento (sem segundo motor).
 */

import type {
  TreasuryGuidedDailyClosingAccountDto,
  TreasuryGuidedDailyOpeningAccountDto,
} from "./contracts/treasuryDto.js";
import {
  computePredictiveReconciliationDiff,
  formatPredictiveCashFlowMoney,
  treasuryMoneyToNumber,
} from "./treasuryPredictiveCashFlow.js";

export type PredictiveCashFlowReconciliationAccountRow = {
  accountId: string;
  accountName: string;
  bank: string | null;
  /** Abertura informada (extrato / rotina). */
  informedOpening: number | null;
  /** Abertura sugerida/calculada (ex.: fechamento anterior). */
  calculatedOpening: number | null;
  openingDiff: number | null;
  receivables: number;
  payables: number;
  /** Fechamento calculado (abertura + CR − CP + transferências/locais). */
  calculatedClosing: number | null;
  /** Fechamento informado (banco). */
  informedClosing: number | null;
  closingDiff: number | null;
  situationLabel: string | null;
  hasDivergence: boolean;
};

export type PredictiveCashFlowReconciliationTotals = {
  informedOpening: number | null;
  calculatedOpening: number | null;
  openingDiff: number | null;
  receivables: number;
  payables: number;
  calculatedClosing: number | null;
  informedClosing: number | null;
  closingDiff: number | null;
  accountCount: number;
  divergenceCount: number;
};

export type PredictiveCashFlowReconciliationBoard = {
  civilDate: string;
  rows: PredictiveCashFlowReconciliationAccountRow[];
  totals: PredictiveCashFlowReconciliationTotals;
};

function sumNullable(values: readonly (number | null)[]): number | null {
  let any = false;
  let sum = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    any = true;
    sum += v;
  }
  return any ? sum : null;
}

function diffOrNull(
  informed: number | null,
  calculated: number | null
): number | null {
  if (informed == null || calculated == null) return null;
  return computePredictiveReconciliationDiff(informed, calculated);
}

export function buildPredictiveCashFlowReconciliationBoard(input: {
  civilDate: string;
  openingAccounts?: readonly TreasuryGuidedDailyOpeningAccountDto[] | null;
  closingAccounts: readonly TreasuryGuidedDailyClosingAccountDto[];
}): PredictiveCashFlowReconciliationBoard {
  const openingById = new Map(
    (input.openingAccounts ?? []).map((a) => [a.accountId, a])
  );

  const rows: PredictiveCashFlowReconciliationAccountRow[] = input.closingAccounts
    .filter((a) => a.situation !== "INACTIVE")
    .map((closing) => {
      const opening = openingById.get(closing.accountId);
      const informedOpening =
        closing.openingBalance != null
          ? treasuryMoneyToNumber(closing.openingBalance)
          : opening?.currentOpeningBalance != null
            ? treasuryMoneyToNumber(opening.currentOpeningBalance)
            : null;
      const calculatedOpening =
        opening?.suggestedOpeningBalance != null
          ? treasuryMoneyToNumber(opening.suggestedOpeningBalance)
          : opening?.previousClosingBalance != null
            ? treasuryMoneyToNumber(opening.previousClosingBalance)
            : null;
      const informedClosing =
        closing.informedClosingBalance != null
          ? treasuryMoneyToNumber(closing.informedClosingBalance)
          : null;
      const calculatedClosing =
        closing.realizedClosingBalance != null
          ? treasuryMoneyToNumber(closing.realizedClosingBalance)
          : null;
      const closingDiff =
        closing.divergence != null
          ? treasuryMoneyToNumber(closing.divergence)
          : diffOrNull(informedClosing, calculatedClosing);
      const openingDiff = diffOrNull(informedOpening, calculatedOpening);
      const hasDivergence =
        (openingDiff != null && openingDiff !== 0) ||
        (closingDiff != null && closingDiff !== 0) ||
        closing.situation === "HAS_DIVERGENCE";

      return {
        accountId: closing.accountId,
        accountName: closing.accountName,
        bank: closing.bank,
        informedOpening,
        calculatedOpening,
        openingDiff,
        receivables: treasuryMoneyToNumber(closing.realizedInflows),
        payables: treasuryMoneyToNumber(closing.realizedOutflows),
        calculatedClosing,
        informedClosing,
        closingDiff,
        situationLabel: closing.situationLabel,
        hasDivergence,
      };
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR"));

  const totals: PredictiveCashFlowReconciliationTotals = {
    informedOpening: sumNullable(rows.map((r) => r.informedOpening)),
    calculatedOpening: sumNullable(rows.map((r) => r.calculatedOpening)),
    openingDiff: sumNullable(rows.map((r) => r.openingDiff)),
    receivables: rows.reduce((s, r) => s + r.receivables, 0),
    payables: rows.reduce((s, r) => s + r.payables, 0),
    calculatedClosing: sumNullable(rows.map((r) => r.calculatedClosing)),
    informedClosing: sumNullable(rows.map((r) => r.informedClosing)),
    closingDiff: sumNullable(rows.map((r) => r.closingDiff)),
    accountCount: rows.length,
    divergenceCount: rows.filter((r) => r.hasDivergence).length,
  };

  return {
    civilDate: input.civilDate,
    rows,
    totals,
  };
}

/** Fallback local quando APIs de abertura/fechamento não estão disponíveis. */
export function buildPredictiveCashFlowReconciliationBoardFromLocal(input: {
  civilDate: string;
  accounts: readonly {
    id: string;
    name: string;
    institutionName: string;
    initialBalance: number;
    isActive: boolean;
    includeInConsolidated: boolean;
  }[];
  transactions: readonly {
    accountId: string;
    date: string;
    type: "payable" | "receivable";
    amount: number;
  }[];
}): PredictiveCashFlowReconciliationBoard {
  const dayTx = input.transactions.filter((t) => t.date === input.civilDate);
  const rows: PredictiveCashFlowReconciliationAccountRow[] = input.accounts
    .filter((a) => a.isActive && a.includeInConsolidated)
    .map((a) => {
      const txs = dayTx.filter((t) => t.accountId === a.id);
      const receivables = txs
        .filter((t) => t.type === "receivable")
        .reduce((s, t) => s + t.amount, 0);
      const payables = txs
        .filter((t) => t.type === "payable")
        .reduce((s, t) => s + t.amount, 0);
      const calculatedOpening = a.initialBalance;
      const calculatedClosing = calculatedOpening + receivables - payables;
      return {
        accountId: a.id,
        accountName: a.name,
        bank: a.institutionName,
        informedOpening: null,
        calculatedOpening,
        openingDiff: null,
        receivables,
        payables,
        calculatedClosing,
        informedClosing: null,
        closingDiff: null,
        situationLabel: null,
        hasDivergence: false,
      };
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR"));

  return {
    civilDate: input.civilDate,
    rows,
    totals: {
      informedOpening: null,
      calculatedOpening: sumNullable(rows.map((r) => r.calculatedOpening)),
      openingDiff: null,
      receivables: rows.reduce((s, r) => s + r.receivables, 0),
      payables: rows.reduce((s, r) => s + r.payables, 0),
      calculatedClosing: sumNullable(rows.map((r) => r.calculatedClosing)),
      informedClosing: null,
      closingDiff: null,
      accountCount: rows.length,
      divergenceCount: 0,
    },
  };
}

export function formatPredictiveReconciliationMoney(
  value: number | null | undefined
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatPredictiveCashFlowMoney(value);
}

export function predictiveReconciliationDiffTone(
  value: number | null | undefined
): "ok" | "warn" | "neutral" {
  if (value == null || !Number.isFinite(value)) return "neutral";
  if (value === 0) return "ok";
  return "warn";
}
