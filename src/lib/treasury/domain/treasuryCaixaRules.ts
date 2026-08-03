/**
 * Regras puras — aba "Caixa" da Tesouraria.
 * Resolve o filtro Ano/(Mês)/(Dia) em um range de vencimento e soma os
 * totalizadores a partir das mesmas linhas exibidas nas tabelas (sem
 * recalcular por fora — cards e grid sempre reconciliam).
 */

import { civilDateToLocalDate } from "@/src/lib/financeCivilDate.js";
import type { FinanceAccountsReceivableGridRow } from "@/src/lib/financeAccountsReceivableRulesEngine.js";
import type { FinanceAccountsPayableGridRow } from "@/src/lib/financeAccountsPayableRulesEngine.js";

export type TreasuryCaixaPeriodInput = {
  year: number;
  month?: number;
  day?: number;
};

export type TreasuryCaixaDueDateRange = {
  dueDateFrom: Date;
  dueDateTo: Date;
};

export class TreasuryCaixaFilterError extends Error {}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Ano/(Mês)/(Dia) → range de data de vencimento (inclusive nas duas pontas). */
export function resolveTreasuryCaixaDueDateRange(
  input: TreasuryCaixaPeriodInput
): TreasuryCaixaDueDateRange {
  const { year, month, day } = input;
  if (!Number.isInteger(year) || year < 1900 || year > 2999) {
    throw new TreasuryCaixaFilterError("Ano inválido.");
  }
  if (day != null && month == null) {
    throw new TreasuryCaixaFilterError("Dia informado sem mês.");
  }
  if (month != null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new TreasuryCaixaFilterError("Mês inválido.");
  }

  if (month != null && day != null) {
    const maxDay = daysInMonth(year, month);
    if (!Number.isInteger(day) || day < 1 || day > maxDay) {
      throw new TreasuryCaixaFilterError(
        "Dia inválido para o mês/ano informado."
      );
    }
    const date = civilDateToLocalDate(`${year}-${pad2(month)}-${pad2(day)}`);
    return { dueDateFrom: date, dueDateTo: date };
  }

  if (month != null) {
    const lastDay = daysInMonth(year, month);
    return {
      dueDateFrom: civilDateToLocalDate(`${year}-${pad2(month)}-01`),
      dueDateTo: civilDateToLocalDate(`${year}-${pad2(month)}-${pad2(lastDay)}`),
    };
  }

  return {
    dueDateFrom: civilDateToLocalDate(`${year}-01-01`),
    dueDateTo: civilDateToLocalDate(`${year}-12-31`),
  };
}

export type TreasuryCaixaTotals = {
  /** Saldo em aberto (ainda não liquidado) — o que falta receber/pagar. */
  totalReceivable: number;
  totalPayable: number;
  /** Saldo líquido em aberto (a receber - a pagar). */
  netBalance: number;
  /** Já liquidado no período — o que já foi efetivamente recebido/pago. */
  totalReceived: number;
  totalPaid: number;
  /** Saldo líquido já realizado (recebido - pago). */
  netRealized: number;
  receivableCount: number;
  payableCount: number;
};

function sumField(
  rows: readonly Record<string, unknown>[],
  field: string
): number {
  return rows.reduce((sum, row) => {
    const value = row[field];
    return sum + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Soma sempre sobre as MESMAS linhas exibidas na tabela — cards nunca divergem do grid. */
export function computeTreasuryCaixaTotals(input: {
  receivables: readonly { balanceReceivable: number; amountReceived?: number }[];
  payables: readonly { balancePayable: number; amountPaid?: number }[];
}): TreasuryCaixaTotals {
  const totalReceivable = sumField(input.receivables, "balanceReceivable");
  const totalPayable = sumField(input.payables, "balancePayable");
  const totalReceived = sumField(input.receivables, "amountReceived");
  const totalPaid = sumField(input.payables, "amountPaid");
  return {
    totalReceivable: roundMoney(totalReceivable),
    totalPayable: roundMoney(totalPayable),
    netBalance: roundMoney(totalReceivable - totalPayable),
    totalReceived: roundMoney(totalReceived),
    totalPaid: roundMoney(totalPaid),
    netRealized: roundMoney(totalReceived - totalPaid),
    receivableCount: input.receivables.length,
    payableCount: input.payables.length,
  };
}

/**
 * Marco zero do saldo em caixa: assume-se caixa = R$ 0,00 em 01/01/2026.
 * Premissa de negócio declarada — o saldo exibido é o caixa GERADO desde essa data,
 * não a posição bancária real (essa vive em Tesouraria > Contas / saldos informados).
 */
export const TREASURY_CAIXA_BASELINE_CIVIL_DATE = "2026-01-01" as const;

export type TreasuryCaixaCashBalance = {
  /** Marco zero assumido (caixa = 0). */
  baselineDate: string;
  /** Última data considerada — fim do período filtrado. */
  asOfDate: string;
  /** Entradas liquidadas entre baseline e asOfDate (por data de baixa). */
  received: number;
  /** Saídas liquidadas entre baseline e asOfDate (por data de pagamento). */
  paid: number;
  /** received − paid. */
  balance: number;
};

export function buildTreasuryCaixaCashBalance(input: {
  baselineDate: string;
  asOfDate: string;
  received: number;
  paid: number;
}): TreasuryCaixaCashBalance {
  const received = Number.isFinite(input.received) ? input.received : 0;
  const paid = Number.isFinite(input.paid) ? input.paid : 0;
  return {
    baselineDate: input.baselineDate,
    asOfDate: input.asOfDate,
    received: roundMoney(received),
    paid: roundMoney(paid),
    balance: roundMoney(received - paid),
  };
}

export type TreasuryCaixaBoardDto = {
  period: TreasuryCaixaPeriodInput;
  dueDateFrom: string;
  dueDateTo: string;
  totals: TreasuryCaixaTotals;
  cashBalance: TreasuryCaixaCashBalance;
  receivables: FinanceAccountsReceivableGridRow[];
  payables: FinanceAccountsPayableGridRow[];
};
