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
  totalReceivable: number;
  totalPayable: number;
  netBalance: number;
  receivableCount: number;
  payableCount: number;
};

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Soma sempre sobre as MESMAS linhas exibidas na tabela — cards nunca divergem do grid. */
export function computeTreasuryCaixaTotals(input: {
  receivables: readonly { balanceReceivable: number }[];
  payables: readonly { balancePayable: number }[];
}): TreasuryCaixaTotals {
  const totalReceivable = input.receivables.reduce(
    (sum, r) => sum + (Number.isFinite(r.balanceReceivable) ? r.balanceReceivable : 0),
    0
  );
  const totalPayable = input.payables.reduce(
    (sum, p) => sum + (Number.isFinite(p.balancePayable) ? p.balancePayable : 0),
    0
  );
  return {
    totalReceivable: roundMoney(totalReceivable),
    totalPayable: roundMoney(totalPayable),
    netBalance: roundMoney(totalReceivable - totalPayable),
    receivableCount: input.receivables.length,
    payableCount: input.payables.length,
  };
}

export type TreasuryCaixaBoardDto = {
  period: TreasuryCaixaPeriodInput;
  dueDateFrom: string;
  dueDateTo: string;
  totals: TreasuryCaixaTotals;
  receivables: FinanceAccountsReceivableGridRow[];
  payables: FinanceAccountsPayableGridRow[];
};
