/**
 * OP-75 — Orçamentos de acesso a dados do Fluxo de Pedidos (puro).
 * Referência para testes de query count; não mede latência de produção.
 */

/** Operações Prisma no resumo (groupBy + 6 counts + aggregate). */
export const SALES_ORDER_FLOW_SUMMARY_QUERY_BUDGET = 8;

/**
 * Por coluna do Kanban: índice leve + bottleneck items + cards da página.
 * Sem N+1 por card.
 */
export const SALES_ORDER_FLOW_LIST_QUERIES_PER_STAGE_BUDGET = 3;

/**
 * Pipeline fixo do carregador de evidências em lote (ordens → … → itens DS).
 * Contagem semântica: uma rodada de findMany por estágio do pipeline.
 */
export const SALES_ORDER_FLOW_EVIDENCE_BATCH_PIPELINE_STEPS = 9;

/** Metas de referência (não afirmam latência real sem medição no servidor). */
export const SALES_ORDER_FLOW_LATENCY_TARGETS_MS = {
  summary: 1000,
  initialKanbanLoad: 2000,
  additionalColumnPage: 1000,
  detail: 2000,
} as const;
