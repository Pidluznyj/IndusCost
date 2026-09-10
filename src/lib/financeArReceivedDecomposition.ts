/**
 * Decomposição READ-ONLY de `amountReceived` por título — lógica pura (sem
 * Prisma), usada por `scripts/auditFinanceArReceivedDecomposition.ts`.
 *
 * Duas decomposições, nunca confundidas (ver docstring do script para o
 * contexto completo — este módulo só isola o cálculo para ser testável):
 *
 *   (a) amountReceived − (amountReceivable − balanceReceivable)
 *       Conferência INTERNA do próprio título. Não depende de receipts.
 *
 *   (b) amountReceived − Σ NomusReceivableReceipt.receivedAmount
 *       Conferência do valor acumulado do CR contra a soma dos eventos reais
 *       de recebimento sincronizados localmente.
 *
 * Nunca tenta "fechar" a diferença — apenas expõe a composição.
 */

import { roundMoney, type FinanceArDashboardRow } from "./financeAccountsReceivableDashboard.js";
import { sumReceivedAmountForEvents, type FinanceReceiptEvent } from "./financeReceiptsCanonical.js";

export const FINANCE_AR_RECEIVED_DECOMPOSITION_EPSILON = 0.01;

export type FinanceArReceivedDecompositionRow = Pick<
  FinanceArDashboardRow,
  "externalId" | "personName" | "personCnpj" | "amountReceivable" | "amountReceived" | "balanceReceivable"
>;

export type FinanceArReceivedDecompositionTitle = {
  externalId: number;
  personName: string | null;
  personCnpj: string | null;
  amountReceivable: number;
  amountReceived: number;
  balanceReceivable: number;
  /** (a) amountReceived − (amountReceivable − balanceReceivable). */
  decompositionAInternal: number;
  sumRealReceipts: number;
  receiptCount: number;
  /** (b) amountReceived − Σ receivedAmount dos receipts reais. */
  decompositionBAgainstReceipts: number;
  /** Soma dos campos de composição dos receipts — null quando não há nenhum receipt. */
  receiptsFeeComposition: {
    lateFeeInterestAmount: number;
    discountAmount: number;
    bankFeeAmount: number;
  } | null;
};

/** Decomposição de UM título — as duas fórmulas, lado a lado, nunca fundidas. */
export function buildFinanceArReceivedDecompositionTitle(
  row: FinanceArReceivedDecompositionRow,
  events: readonly FinanceReceiptEvent[]
): FinanceArReceivedDecompositionTitle {
  const impliedPaidFromBalance = roundMoney(row.amountReceivable - row.balanceReceivable);
  const decompositionAInternal = roundMoney(row.amountReceived - impliedPaidFromBalance);

  const sumRealReceipts = sumReceivedAmountForEvents(events);
  const decompositionBAgainstReceipts = roundMoney(row.amountReceived - sumRealReceipts);

  const receiptsFeeComposition =
    events.length > 0
      ? {
          lateFeeInterestAmount: roundMoney(
            events.reduce((sum, e) => sum + e.lateFeeInterestAmount, 0)
          ),
          discountAmount: roundMoney(events.reduce((sum, e) => sum + e.discountAmount, 0)),
          bankFeeAmount: roundMoney(events.reduce((sum, e) => sum + e.bankFeeAmount, 0)),
        }
      : null;

  return {
    externalId: row.externalId,
    personName: row.personName,
    personCnpj: row.personCnpj,
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    balanceReceivable: roundMoney(row.balanceReceivable),
    decompositionAInternal,
    sumRealReceipts: roundMoney(sumRealReceipts),
    receiptCount: events.length,
    decompositionBAgainstReceipts,
    receiptsFeeComposition,
  };
}

/** Um título tem divergência quando qualquer uma das duas decomposições foge de zero além do épsilon. */
export function financeArReceivedDecompositionHasDivergence(
  title: FinanceArReceivedDecompositionTitle,
  epsilon: number = FINANCE_AR_RECEIVED_DECOMPOSITION_EPSILON
): boolean {
  return (
    Math.abs(title.decompositionAInternal) > epsilon ||
    Math.abs(title.decompositionBAgainstReceipts) > epsilon
  );
}

export type FinanceArReceivedDecompositionReport = {
  coorte: { criterio: string; ano: number; mes: number | null };
  populacaoQtdTitulos: number;
  totais: {
    valorOriginalTotal: number;
    amountReceivedAcumuladoTotal: number;
    saldoTotal: number;
    somaReceiptsReaisTotal: number;
    diferencaDecomposicaoATotal: number;
    diferencaDecomposicaoBTotal: number;
  };
  titulosComDivergenciaQtd: number;
  titulos: FinanceArReceivedDecompositionTitle[];
};

/**
 * Monta o relatório completo: decompõe cada título, soma os totais da coorte
 * (mesma equação do caso R$563,54 — `diferencaDecomposicaoATotal`), e lista os
 * títulos (todos, ou só os divergentes) ordenados pela decomposição (b), a
 * mais informativa para achar gap de sincronização de receipts.
 */
export function buildFinanceArReceivedDecompositionReport(
  rows: readonly FinanceArReceivedDecompositionRow[],
  receiptEventsByReceivable: ReadonlyMap<number, readonly FinanceReceiptEvent[]>,
  options: { year: number; month: number | null; limit: number; includeAll: boolean }
): FinanceArReceivedDecompositionReport {
  let totalOriginal = 0;
  let totalAmountReceived = 0;
  let totalBalance = 0;
  let totalReceiptSum = 0;

  const perTitle = rows.map((row) => {
    const events = receiptEventsByReceivable.get(row.externalId) ?? [];
    const title = buildFinanceArReceivedDecompositionTitle(row, events);
    totalOriginal += row.amountReceivable;
    totalAmountReceived += row.amountReceived;
    totalBalance += row.balanceReceivable;
    totalReceiptSum += title.sumRealReceipts;
    return title;
  });

  const divergent = perTitle.filter((t) => financeArReceivedDecompositionHasDivergence(t));
  const listed = (options.includeAll ? perTitle : divergent)
    .slice()
    .sort(
      (a, b) => Math.abs(b.decompositionBAgainstReceipts) - Math.abs(a.decompositionBAgainstReceipts)
    )
    .slice(0, options.limit);

  return {
    coorte: {
      criterio: "dueDate (coorte de vencimento) — NÃO é caixa recebido no período",
      ano: options.year,
      mes: options.month,
    },
    populacaoQtdTitulos: rows.length,
    totais: {
      valorOriginalTotal: roundMoney(totalOriginal),
      amountReceivedAcumuladoTotal: roundMoney(totalAmountReceived),
      saldoTotal: roundMoney(totalBalance),
      somaReceiptsReaisTotal: roundMoney(totalReceiptSum),
      diferencaDecomposicaoATotal: roundMoney(totalAmountReceived - (totalOriginal - totalBalance)),
      diferencaDecomposicaoBTotal: roundMoney(totalAmountReceived - totalReceiptSum),
    },
    titulosComDivergenciaQtd: divergent.length,
    titulos: listed,
  };
}
