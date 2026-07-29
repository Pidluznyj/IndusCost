/**
 * Adaptadores do “Fluxo Gerencial” (dashboard preditivo) → bases canônicas da Tesouraria.
 * Sem LocalStorage: Account/Transaction/DailyBalance são view-models sobre agenda + contas.
 */

import type {
  TreasuryAgendaDayDto,
  TreasuryFinancialAccountDto,
  TreasuryProjectionCompositionItemDto,
} from "./contracts/treasuryDto.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "./treasuryMoney.js";

export type PredictiveCashFlowTransactionType = "payable" | "receivable";

export type PredictiveCashFlowAccount = {
  id: string;
  name: string;
  /** Saldo de partida (latest snapshot / opening). */
  initialBalance: number;
  institutionName: string;
  includeInConsolidated: boolean;
  isActive: boolean;
};

export type PredictiveCashFlowTransaction = {
  id: string;
  description: string;
  amount: number;
  date: string;
  type: PredictiveCashFlowTransactionType;
  accountId: string;
  isPaid: boolean;
  itemKind: string;
};

export type PredictiveCashFlowDailyBalance = {
  date: string;
  /** Saldo de abertura do dia (quando conhecido). */
  openingBalance: number;
  /** Saldo final projetado do dia. */
  balance: number;
  receivables: number;
  payables: number;
};

export type PredictiveCashFlowKpis = {
  baseBalance: number;
  totalReceivables: number;
  totalPayables: number;
  finalProjection: number;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

export function treasuryMoneyToNumber(value: string | null | undefined): number {
  const n = Number(money(value));
  return Number.isFinite(n) ? n : 0;
}

export function mapTreasuryAccountToPredictiveAccount(
  account: TreasuryFinancialAccountDto,
  availableBalance: string | null | undefined
): PredictiveCashFlowAccount {
  return {
    id: account.id,
    name: account.name,
    initialBalance: treasuryMoneyToNumber(availableBalance ?? "0.00"),
    institutionName: account.institutionName,
    includeInConsolidated: account.includeInConsolidated !== false,
    isActive: account.isActive !== false,
  };
}

export function resolveCompositionTransactionType(
  item: Pick<TreasuryProjectionCompositionItemDto, "amount" | "itemKind">
): PredictiveCashFlowTransactionType {
  const kind = (item.itemKind ?? "").toUpperCase();
  if (kind.includes("PAYABLE")) return "payable";
  if (kind.includes("RECEIVABLE") || kind.includes("INFLOW")) {
    return "receivable";
  }
  return compareTreasuryMoney(money(item.amount), "0.00") < 0
    ? "payable"
    : "receivable";
}

export function mapCompositionItemToPredictiveTransaction(
  item: TreasuryProjectionCompositionItemDto
): PredictiveCashFlowTransaction {
  const signed = treasuryMoneyToNumber(item.amount);
  const type = resolveCompositionTransactionType(item);
  const kind = (item.itemKind ?? "").toUpperCase();
  return {
    id: item.id,
    description: item.label?.trim() || item.itemKind || item.id,
    amount: Math.abs(signed),
    date: item.civilDate,
    type,
    accountId: item.accountId,
    isPaid: kind === "REALIZED" || kind.includes("REALIZED"),
    itemKind: item.itemKind,
  };
}

export function extractPredictiveTransactionsFromAgendaDays(
  days: readonly TreasuryAgendaDayDto[]
): PredictiveCashFlowTransaction[] {
  const out: PredictiveCashFlowTransaction[] = [];
  for (const day of [...days].sort((a, b) =>
    a.civilDate.localeCompare(b.civilDate)
  )) {
    for (const item of day.items ?? []) {
      out.push(mapCompositionItemToPredictiveTransaction(item));
    }
  }
  return out.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.description.localeCompare(b.description);
  });
}

/**
 * Projeção diária a partir de saldo base + lançamentos (paridade com o guia).
 * Datas em YYYY-MM-DD; `horizonDays` inclui o dia base.
 */
export function generatePredictiveCashFlowTimeline(input: {
  startingBalance: number;
  transactions: readonly PredictiveCashFlowTransaction[];
  fromDate: string;
  horizonDays: number;
}): PredictiveCashFlowDailyBalance[] {
  const horizon = Math.max(1, Math.floor(input.horizonDays));
  const byDate = new Map<string, { receivables: number; payables: number }>();
  for (const tx of input.transactions) {
    const bucket = byDate.get(tx.date) ?? { receivables: 0, payables: 0 };
    if (tx.type === "receivable") bucket.receivables += tx.amount;
    else bucket.payables += tx.amount;
    byDate.set(tx.date, bucket);
  }

  const timeline: PredictiveCashFlowDailyBalance[] = [];
  let balance = input.startingBalance;
  const start = parseCivilDateUtc(input.fromDate);
  for (let i = 0; i < horizon; i += 1) {
    const date = formatCivilDateUtc(addUtcDays(start, i));
    const day = byDate.get(date) ?? { receivables: 0, payables: 0 };
    const openingBalance = balance;
    balance = balance + day.receivables - day.payables;
    timeline.push({
      date,
      openingBalance,
      balance,
      receivables: day.receivables,
      payables: day.payables,
    });
  }
  return timeline;
}

/** Timeline canônica do motor (agenda consolidada) — preferida na UI. */
export function mapAgendaDaysToPredictiveTimeline(
  days: readonly TreasuryAgendaDayDto[]
): PredictiveCashFlowDailyBalance[] {
  return [...days]
    .sort((a, b) => a.civilDate.localeCompare(b.civilDate))
    .map((d) => ({
      date: d.civilDate,
      openingBalance: treasuryMoneyToNumber(d.openingBalance),
      balance: treasuryMoneyToNumber(d.closingBalance ?? d.openingBalance),
      receivables: treasuryMoneyToNumber(d.plannedInflows ?? d.inflows),
      payables: treasuryMoneyToNumber(d.plannedOutflows ?? d.outflows),
    }));
}

export function sumPredictiveAccountBalances(
  accounts: readonly PredictiveCashFlowAccount[]
): number {
  return accounts
    .filter((a) => a.isActive && a.includeInConsolidated)
    .reduce((acc, a) => acc + a.initialBalance, 0);
}

export function buildPredictiveCashFlowKpis(input: {
  accounts: readonly PredictiveCashFlowAccount[];
  timeline: readonly PredictiveCashFlowDailyBalance[];
  /** Opening do primeiro dia da agenda (quando consolidado). */
  agendaOpeningBalance?: number | null;
}): PredictiveCashFlowKpis {
  const fromAccounts = sumPredictiveAccountBalances(input.accounts);
  const baseBalance =
    input.agendaOpeningBalance != null && Number.isFinite(input.agendaOpeningBalance)
      ? input.agendaOpeningBalance
      : fromAccounts;
  let totalReceivables = 0;
  let totalPayables = 0;
  for (const d of input.timeline) {
    totalReceivables += d.receivables;
    totalPayables += d.payables;
  }
  const last = input.timeline[input.timeline.length - 1];
  return {
    baseBalance,
    totalReceivables,
    totalPayables,
    finalProjection: last?.balance ?? baseBalance,
  };
}

export function findPredictiveTimelineDay(
  timeline: readonly PredictiveCashFlowDailyBalance[],
  date: string
): PredictiveCashFlowDailyBalance | null {
  return timeline.find((d) => d.date === date) ?? null;
}

/** Diff: informado − processado. */
export function computePredictiveReconciliationDiff(
  informed: number,
  processed: number
): number {
  return informed - processed;
}

export function formatPredictiveCashFlowMoney(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatPredictiveCashFlowDate(civilDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civilDate.trim());
  if (!m) return civilDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function parseCivilDateUtc(civil: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(civil.trim());
  if (!m) return new Date(NaN);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatCivilDateUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

/** Helper de agregação money-string (testes / reconciliação). */
export function addPredictiveMoneyStrings(
  a: string,
  b: string
): TreasuryMoneyString {
  return addTreasuryMoney(money(a), money(b));
}

export function subtractPredictiveMoneyStrings(
  a: string,
  b: string
): TreasuryMoneyString {
  return subtractTreasuryMoney(money(a), money(b));
}
