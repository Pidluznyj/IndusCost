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
 * Passo 3 — fluxo de um dia: "começou com X, entrou Y, saiu Z, terminou com W".
 *
 * Os quatro números vêm prontos do workspace canônico de fechamento diário
 * (`/today/closing`), por conta. Aqui só consolidamos somando as contas — nenhum
 * cálculo de caixa é refeito. `null` significa "não informado" (≠ zero).
 */
export type TreasuryCaixaDayFlowAccountInput = {
  openingBalance: number | null;
  realizedInflows: number;
  realizedOutflows: number;
  realizedClosingBalance: number | null;
  informedClosingBalance: number | null;
};

export type TreasuryCaixaDayFlow = {
  civilDate: string;
  /** Soma dos saldos de abertura; null se nenhuma conta tem abertura informada. */
  opening: number | null;
  inflows: number;
  outflows: number;
  /** Fechamento calculado pelo motor (abertura + entradas − saídas). */
  closingCalculated: number | null;
  /** Fechamento informado no extrato; null se ninguém informou ainda. */
  closingInformed: number | null;
  /** informado − calculado; null quando falta um dos lados. */
  divergence: number | null;
  accountCount: number;
  /** Quantas contas ainda não têm fechamento informado. */
  pendingClosingCount: number;
};

/** Soma tratando null como ausência: se ninguém informou, o total é null (não zero). */
function sumNullable(values: readonly (number | null)[]): number | null {
  let hasAny = false;
  let total = 0;
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue;
    hasAny = true;
    total += v;
  }
  return hasAny ? roundMoney(total) : null;
}

export function buildTreasuryCaixaDayFlow(input: {
  civilDate: string;
  accounts: readonly TreasuryCaixaDayFlowAccountInput[];
}): TreasuryCaixaDayFlow {
  const opening = sumNullable(input.accounts.map((a) => a.openingBalance));
  const inflows = roundMoney(
    input.accounts.reduce(
      (s, a) => s + (Number.isFinite(a.realizedInflows) ? a.realizedInflows : 0),
      0
    )
  );
  const outflows = roundMoney(
    input.accounts.reduce(
      (s, a) => s + (Number.isFinite(a.realizedOutflows) ? a.realizedOutflows : 0),
      0
    )
  );
  const closingCalculated = sumNullable(
    input.accounts.map((a) => a.realizedClosingBalance)
  );
  const closingInformed = sumNullable(
    input.accounts.map((a) => a.informedClosingBalance)
  );

  return {
    civilDate: input.civilDate,
    opening,
    inflows,
    outflows,
    closingCalculated,
    closingInformed,
    divergence:
      closingInformed != null && closingCalculated != null
        ? roundMoney(closingInformed - closingCalculated)
        : null,
    accountCount: input.accounts.length,
    pendingClosingCount: input.accounts.filter(
      (a) => a.informedClosingBalance == null
    ).length,
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
