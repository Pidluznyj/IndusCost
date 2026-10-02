/**
 * Contagem do teto de pedidos do Fluxo de Caixa.
 *
 * Replica a seleção de `loadFinanceArEffectiveOrderContextsForPortfolio`
 * (prioridade NF, depois códigos, `orderCode` asc, `take` = teto) sem
 * executar auditoria nem schedule. Não é valor financeiro projetado.
 */

export type CashFlowPortfolioOrderLimitSummary = {
  candidateOrders: number;
  processedOrders: number;
  configuredLimit: number;
  limitReached: boolean;
  ordersExcludedByLimit: number;
};

export function summarizePortfolioOrderLimitSelection(input: {
  configuredLimit: number;
  /** Ids elegíveis da prioridade NF, já na ordem `orderCode` asc. */
  priorityEligibleIdsInOrder: readonly string[];
  /**
   * Ids da consulta secundária, na ordem `orderCode` asc, cujo `where`
   * exclui apenas a fatia de prioridade já tomada (o mesmo `notIn` do loader).
   */
  secondaryEligibleIdsExcludingTakenPriority: readonly string[];
}): CashFlowPortfolioOrderLimitSummary {
  const cap = Math.max(1, Math.trunc(input.configuredLimit));
  const priority = input.priorityEligibleIdsInOrder;
  const takenPriority = priority.slice(0, cap);
  const prioritySet = new Set(priority);
  const remaining = Math.max(0, cap - takenPriority.length);
  const secondary = input.secondaryEligibleIdsExcludingTakenPriority;
  const takenSecondary = secondary.slice(0, remaining);
  const secondaryOnly = secondary.filter((id) => !prioritySet.has(id));
  const candidateOrders = priority.length + secondaryOnly.length;
  const processedOrders = takenPriority.length + takenSecondary.length;
  const ordersExcludedByLimit = Math.max(0, candidateOrders - processedOrders);
  return {
    candidateOrders,
    processedOrders,
    configuredLimit: cap,
    limitReached: ordersExcludedByLimit > 0,
    ordersExcludedByLimit,
  };
}
