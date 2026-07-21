/**
 * OP-02 — Motor canônico operacional de Pedidos de Venda (server-only).
 *
 * Orquestra população → facts → métricas e expõe observabilidade.
 * Adapters (tela/PDF/Excel) devem consumir este núcleo — não recalcular.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  loadSalesOrderOperationalFacts,
  type SalesOrderOperationalFactsBundle,
} from "./salesOrderOperationalFacts.server.js";
import {
  assertUniqueSalesOrderIds,
  computeSalesOrderOperationalMetrics,
} from "./salesOrderOperationalMetrics.js";
import {
  loadSalesOrderOperationalPopulationIds,
  resolveSalesOrderOperationalPopulationFromQuery,
  resolveSalesOrderOperationalPopulationWhere,
  type ResolveOperationalPopulationInput,
} from "./salesOrderOperationalPopulation.server.js";
import type {
  SalesOrderOperationalContext,
  SalesOrderOperationalMetrics,
  SalesOrderOperationalPopulationObservability,
} from "./salesOrderOperationalTypes.js";
import { SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS } from "./salesOrderOperationalTypes.js";

export type SalesOrderOperationalEngineResult = {
  context: SalesOrderOperationalContext;
  where: Prisma.SalesOrderWhereInput;
  populationIds: string[];
  facts: SalesOrderOperationalFactsBundle;
  metrics: SalesOrderOperationalMetrics;
  observability: SalesOrderOperationalPopulationObservability;
};

export async function runSalesOrderOperationalEngine(
  prisma: PrismaClient,
  input: ResolveOperationalPopulationInput & {
    referenceDate?: Date;
    filtersApplied?: Record<string, unknown>;
  } = {}
): Promise<SalesOrderOperationalEngineResult> {
  const started = Date.now();
  const context: SalesOrderOperationalContext = input.context ?? "OPERATIONAL";
  const where = await resolveSalesOrderOperationalPopulationWhere(prisma, {
    ...input,
    context,
  });
  const populationIds = await loadSalesOrderOperationalPopulationIds(prisma, where);
  const { uniqueIds, duplicateCount } = assertUniqueSalesOrderIds(populationIds, {
    throwOnDuplicate: true,
  });
  void duplicateCount;

  const facts = await loadSalesOrderOperationalFacts(prisma, where, {
    referenceDate: input.referenceDate,
    context,
  });
  const metrics = computeSalesOrderOperationalMetrics(facts.facts);

  const observability: SalesOrderOperationalPopulationObservability = {
    context,
    populationCount: uniqueIds.length,
    uniqueIdCount: uniqueIds.length,
    beforePresenceCount: null,
    afterPresenceCount: uniqueIds.length,
    excludedMissingConfirmedCount: null,
    itemCount: metrics.itemCount,
    nfeCount: null,
    receivableCount: null,
    elapsedMs: Date.now() - started,
    filtersApplied: input.filtersApplied ?? {},
  };

  return {
    context,
    where,
    populationIds: uniqueIds,
    facts,
    metrics,
    observability,
  };
}

/**
 * Compara conjuntos de IDs entre consumidores (paridade OP-02).
 * Retorna diferenças; vazio = paridade completa.
 */
export function diffSalesOrderPopulationIds(
  left: Iterable<string>,
  right: Iterable<string>
): { onlyLeft: string[]; onlyRight: string[]; equal: boolean } {
  const a = new Set([...left].map((id) => String(id).trim()).filter(Boolean));
  const b = new Set([...right].map((id) => String(id).trim()).filter(Boolean));
  const onlyLeft: string[] = [];
  const onlyRight: string[] = [];
  for (const id of a) if (!b.has(id)) onlyLeft.push(id);
  for (const id of b) if (!a.has(id)) onlyRight.push(id);
  onlyLeft.sort();
  onlyRight.sort();
  return {
    onlyLeft,
    onlyRight,
    equal: onlyLeft.length === 0 && onlyRight.length === 0,
  };
}

export {
  SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS,
  resolveSalesOrderOperationalPopulationFromQuery,
  resolveSalesOrderOperationalPopulationWhere,
  loadSalesOrderOperationalPopulationIds,
  loadSalesOrderOperationalFacts,
  computeSalesOrderOperationalMetrics,
};
