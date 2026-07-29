/**
 * Série de evolução do caixa (Fluxo Gerencial).
 * Partida: abertura informada → fechamento de ontem → automático (saldo canônico).
 */

import type { TreasuryGuidedDailyOpeningAccountDto } from "./contracts/treasuryDto.js";
import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "./treasuryPredictiveCashFlow.js";
import {
  formatPredictiveCashFlowDate,
  formatPredictiveCashFlowMoney,
  treasuryMoneyToNumber,
} from "./treasuryPredictiveCashFlow.js";

export type PredictiveEvolutionStartSource =
  | "informed_opening"
  | "previous_closing"
  | "automatic";

export type PredictiveEvolutionViewMode = "consolidated" | "by_account";

export type PredictiveEvolutionSeriesPoint = {
  date: string;
  label: string;
  /** Saldo de abertura do dia (antes dos movimentos). */
  opening: number;
  /** Saldo de fechamento projetado do dia. */
  balance: number;
  balanceText: string;
  receivables: number;
  payables: number;
  /** Abaixo de zero = cruzou o limite operacional (caixa negativo). */
  belowLimit: boolean;
  /** Valores por conta (só modo by_account no ponto consolidado da grade). */
  byAccount?: Record<string, number>;
};

export type PredictiveEvolutionAccountStart = {
  accountId: string;
  amount: number;
  source: PredictiveEvolutionStartSource;
};

export type PredictiveEvolutionBoard = {
  mode: PredictiveEvolutionViewMode;
  fromDate: string;
  toDate: string;
  points: PredictiveEvolutionSeriesPoint[];
  starts: readonly PredictiveEvolutionAccountStart[];
  startSourceSummary: PredictiveEvolutionStartSource;
  accounts: readonly { id: string; name: string; color: string }[];
};

const ACCOUNT_COLORS = [
  "#0369a1",
  "#059669",
  "#7c3aed",
  "#d97706",
  "#dc2626",
  "#0d9488",
  "#4f46e5",
  "#db2777",
] as const;

export function resolvePredictiveEvolutionStartBalance(input: {
  informedOpening: number | null;
  previousClosing: number | null;
  automatic: number;
}): { amount: number; source: PredictiveEvolutionStartSource } {
  if (input.informedOpening != null && Number.isFinite(input.informedOpening)) {
    return { amount: input.informedOpening, source: "informed_opening" };
  }
  if (input.previousClosing != null && Number.isFinite(input.previousClosing)) {
    return { amount: input.previousClosing, source: "previous_closing" };
  }
  return {
    amount: Number.isFinite(input.automatic) ? input.automatic : 0,
    source: "automatic",
  };
}

export function resolvePredictiveEvolutionStartsFromOpeningWorkspace(input: {
  accounts: readonly PredictiveCashFlowAccount[];
  openingAccounts?: readonly TreasuryGuidedDailyOpeningAccountDto[] | null;
}): PredictiveEvolutionAccountStart[] {
  const byId = new Map(
    (input.openingAccounts ?? []).map((a) => [a.accountId, a])
  );
  return input.accounts
    .filter((a) => a.isActive && a.includeInConsolidated)
    .map((a) => {
      const op = byId.get(a.id);
      const informed =
        op?.currentOpeningBalance != null
          ? treasuryMoneyToNumber(op.currentOpeningBalance)
          : null;
      const previous =
        op?.previousClosingBalance != null
          ? treasuryMoneyToNumber(op.previousClosingBalance)
          : op?.suggestedOpeningBalance != null
            ? treasuryMoneyToNumber(op.suggestedOpeningBalance)
            : null;
      const resolved = resolvePredictiveEvolutionStartBalance({
        informedOpening: informed,
        previousClosing: previous,
        automatic: a.initialBalance,
      });
      return {
        accountId: a.id,
        amount: resolved.amount,
        source: resolved.source,
      };
    });
}

export function summarizePredictiveEvolutionStartSource(
  starts: readonly PredictiveEvolutionAccountStart[]
): PredictiveEvolutionStartSource {
  if (starts.length === 0) return "automatic";
  if (starts.every((s) => s.source === "informed_opening")) {
    return "informed_opening";
  }
  if (starts.every((s) => s.source === "previous_closing")) {
    return "previous_closing";
  }
  if (starts.some((s) => s.source === "informed_opening")) {
    return "informed_opening";
  }
  if (starts.some((s) => s.source === "previous_closing")) {
    return "previous_closing";
  }
  return "automatic";
}

export const PREDICTIVE_EVOLUTION_START_SOURCE_LABELS: Record<
  PredictiveEvolutionStartSource,
  string
> = {
  informed_opening: "Abertura informada do dia",
  previous_closing: "Fechamento de ontem",
  automatic: "Saldo automático (canônico)",
};

function parseCivilUtc(civil: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil.trim());
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatCivilUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function listPredictiveEvolutionCivilDates(
  fromDate: string,
  toDate: string
): string[] {
  const start = parseCivilUtc(fromDate);
  const end = parseCivilUtc(toDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return [];
  }
  const out: string[] = [];
  let cur = start;
  // Limite de segurança (1 ano).
  for (let i = 0; i < 366; i += 1) {
    out.push(formatCivilUtc(cur));
    if (cur.getTime() >= end.getTime()) break;
    cur = addUtcDays(cur, 1);
  }
  return out;
}

export function buildPredictiveEvolutionBoard(input: {
  mode: PredictiveEvolutionViewMode;
  fromDate: string;
  toDate: string;
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  starts: readonly PredictiveEvolutionAccountStart[];
}): PredictiveEvolutionBoard {
  const active = input.accounts.filter(
    (a) => a.isActive && a.includeInConsolidated
  );
  const startById = new Map(input.starts.map((s) => [s.accountId, s]));
  const dates = listPredictiveEvolutionCivilDates(input.fromDate, input.toDate);

  const accountMeta = active.map((a, i) => ({
    id: a.id,
    name: a.name,
    color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]!,
  }));

  const balances = new Map<string, number>();
  for (const a of active) {
    balances.set(a.id, startById.get(a.id)?.amount ?? a.initialBalance);
  }

  const points: PredictiveEvolutionSeriesPoint[] = [];

  for (const date of dates) {
    const dayTx = input.transactions.filter((t) => t.date === date);
    const byAccountOpening: Record<string, number> = {};
    const byAccountClosing: Record<string, number> = {};
    let recv = 0;
    let pay = 0;

    for (const a of active) {
      const opening = balances.get(a.id) ?? 0;
      byAccountOpening[a.id] = opening;
      const txs = dayTx.filter((t) => t.accountId === a.id);
      const r = txs
        .filter((t) => t.type === "receivable")
        .reduce((s, t) => s + t.amount, 0);
      const p = txs
        .filter((t) => t.type === "payable")
        .reduce((s, t) => s + t.amount, 0);
      recv += r;
      pay += p;
      const closing = opening + r - p;
      byAccountClosing[a.id] = closing;
      balances.set(a.id, closing);
    }

    const openingSum = active.reduce(
      (s, a) => s + (byAccountOpening[a.id] ?? 0),
      0
    );
    const closingSum = active.reduce(
      (s, a) => s + (byAccountClosing[a.id] ?? 0),
      0
    );

    points.push({
      date,
      label: formatPredictiveCashFlowDate(date),
      opening: openingSum,
      balance: closingSum,
      balanceText: formatPredictiveCashFlowMoney(closingSum),
      receivables: recv,
      payables: pay,
      belowLimit: closingSum < 0,
      byAccount: { ...byAccountClosing },
    });
  }

  return {
    mode: input.mode,
    fromDate: input.fromDate,
    toDate: input.toDate,
    points,
    starts: input.starts,
    startSourceSummary: summarizePredictiveEvolutionStartSource(input.starts),
    accounts: accountMeta,
  };
}
