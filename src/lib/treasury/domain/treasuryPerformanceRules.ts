/**
 * Orçamentos e métricas de performance da Tesouraria (puro / testável).
 * Não altera regras de negócio — só documenta limites de round-trips.
 */

/** Contas máximas carregadas por listagem ACL/posição. */
export const TREASURY_PERF_MAX_ACCOUNTS_PAGE = 200;

/**
 * Round-trips esperados para montar posição com N contas visíveis (após otimização).
 * 1 list accounts + 1 batch access + 1 batch latest snapshots + 1 movements + 1 reconciled.
 */
export function expectedTreasuryPositionQueryBudget(_visibleAccountCount: number): number {
  return 5;
}

/** Round-trips legados (N+1) para comparação de benchmark. */
export function legacyTreasuryPositionQueryBudget(visibleAccountCount: number): number {
  // 1 list + N findAccess + N findLatest + 1 movements + 1 reconciled
  return 3 + visibleAccountCount * 2;
}

/** Round-trips OFX apply insert: 1 createMany (+1 findMany ids) vs N creates. */
export function expectedTreasuryOfxInsertQueryBudget(): number {
  return 2;
}

export function legacyTreasuryOfxInsertQueryBudget(movementCount: number): number {
  return Math.max(1, movementCount);
}

/** Engine de exceções: 1 list com status IN vs 1 por status aberto. */
export function expectedTreasuryExceptionOpenListBudget(): number {
  return 1;
}

export function legacyTreasuryExceptionOpenListBudget(openStatusCount: number): number {
  return Math.max(1, openStatusCount);
}

export type TreasuryPerfBenchmarkSample = {
  scenario: string;
  volume: {
    titles?: number;
    movements?: number;
    accounts?: number;
    projectionDays?: number;
    exceptions?: number;
  };
  before: {
    queryBudget: number;
    elapsedMs: number;
    heapUsedApproxBytes?: number;
  };
  after: {
    queryBudget: number;
    elapsedMs: number;
    heapUsedApproxBytes?: number;
  };
};

export function summarizeTreasuryPerfImprovement(
  sample: TreasuryPerfBenchmarkSample
): {
  queryReductionPct: number;
  timeReductionPct: number;
} {
  const qBefore = Math.max(1, sample.before.queryBudget);
  const tBefore = Math.max(1, sample.before.elapsedMs);
  return {
    queryReductionPct: Math.round(
      (1 - sample.after.queryBudget / qBefore) * 100
    ),
    timeReductionPct: Math.round(
      (1 - sample.after.elapsedMs / tBefore) * 100
    ),
  };
}
