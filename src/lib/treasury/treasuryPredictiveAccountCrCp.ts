/**
 * Agregação CR/CP por conta no horizonte do Fluxo Gerencial.
 * Fonte: títulos/lançamentos já mapeados da agenda canônica (motores CR e CP).
 */

import type {
  PredictiveCashFlowAccount,
  PredictiveCashFlowTransaction,
} from "./treasuryPredictiveCashFlow.js";
import { formatPredictiveCashFlowMoney } from "./treasuryPredictiveCashFlow.js";

export type PredictiveAccountCrCpRow = {
  accountId: string;
  accountName: string;
  institutionName: string;
  receivables: number;
  payables: number;
  net: number;
  receivableCount: number;
  payableCount: number;
};

export type PredictiveAccountCrCpBoard = {
  fromDate: string;
  toDate: string;
  rows: PredictiveAccountCrCpRow[];
  totals: {
    receivables: number;
    payables: number;
    net: number;
    receivableCount: number;
    payableCount: number;
  };
};

export function buildPredictiveAccountCrCpBoard(input: {
  accounts: readonly PredictiveCashFlowAccount[];
  transactions: readonly PredictiveCashFlowTransaction[];
  fromDate: string;
  toDate: string;
}): PredictiveAccountCrCpBoard {
  const from = input.fromDate.trim();
  const to = input.toDate.trim();
  const inRange = input.transactions.filter(
    (t) => (!from || t.date >= from) && (!to || t.date <= to)
  );

  const active = input.accounts.filter(
    (a) => a.isActive && a.includeInConsolidated
  );

  const rows: PredictiveAccountCrCpRow[] = active.map((a) => {
    const txs = inRange.filter((t) => t.accountId === a.id);
    const recv = txs.filter((t) => t.type === "receivable");
    const pay = txs.filter((t) => t.type === "payable");
    const receivables = recv.reduce((s, t) => s + t.amount, 0);
    const payables = pay.reduce((s, t) => s + t.amount, 0);
    return {
      accountId: a.id,
      accountName: a.name,
      institutionName: a.institutionName,
      receivables,
      payables,
      net: receivables - payables,
      receivableCount: recv.length,
      payableCount: pay.length,
    };
  });

  rows.sort((a, b) => a.accountName.localeCompare(b.accountName, "pt-BR"));

  const totals = {
    receivables: rows.reduce((s, r) => s + r.receivables, 0),
    payables: rows.reduce((s, r) => s + r.payables, 0),
    net: 0,
    receivableCount: rows.reduce((s, r) => s + r.receivableCount, 0),
    payableCount: rows.reduce((s, r) => s + r.payableCount, 0),
  };
  totals.net = totals.receivables - totals.payables;

  return { fromDate: from, toDate: to, rows, totals };
}

export function formatPredictiveAccountCrCpMoney(value: number): string {
  return formatPredictiveCashFlowMoney(value);
}
