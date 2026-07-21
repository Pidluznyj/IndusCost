/**
 * OP-02 — Facts: carrega e agrega domínios por salesOrderId (server-only).
 * Cada domínio retorna no máximo um registro agregado por pedido.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { decimalToNumber } from "./executiveDashboardHelpers.js";
import { loadSalesOrderLinkedNfeContextMap } from "./salesOrderLinkedNfe.js";
import {
  loadSalesOrderEnrichedMetricsFromDb,
  type SalesOrderEnrichedMetrics,
} from "./salesOrderMetricsEngine.js";
import { mergeSalesOrderOperationalPresenceWhere } from "./nomus/nomusSourcePresencePolicy.js";
import {
  aggregateFactsBySalesOrderId,
  computeSalesOrderOperationalMetrics,
} from "./salesOrderOperationalMetrics.js";
import type { SalesOrderOperationalOrderFact } from "./salesOrderOperationalTypes.js";

export type SalesOrderOperationalFactsBundle = {
  facts: SalesOrderOperationalOrderFact[];
  factsById: Map<string, SalesOrderOperationalOrderFact>;
  enriched: SalesOrderEnrichedMetrics[];
  metrics: ReturnType<typeof computeSalesOrderOperationalMetrics>;
};

/**
 * Carrega pedidos da população e agrega NF (e header) por salesOrderId.
 * Não faz join cartesiano pedido×item×NF×CR.
 */
export async function loadSalesOrderOperationalFacts(
  prisma: PrismaClient,
  where: Prisma.SalesOrderWhereInput,
  options?: {
    referenceDate?: Date;
    context?: "OPERATIONAL" | "HISTORICAL_AUDIT";
    env?: Record<string, string | undefined>;
  }
): Promise<SalesOrderOperationalFactsBundle> {
  const referenceDate = options?.referenceDate ?? new Date();
  const includeConfirmedMissing = options?.context === "HISTORICAL_AUDIT";
  const operationalWhere = mergeSalesOrderOperationalPresenceWhere(where, {
    env: options?.env,
    includeConfirmedMissing,
  }) as Prisma.SalesOrderWhereInput;

  const [headerRows, enriched] = await Promise.all([
    prisma.salesOrder.findMany({
      where: operationalWhere,
      select: {
        id: true,
        totalNetValue: true,
        totalItems: true,
        issueDate: true,
        expectedDeliveryDate: true,
        nomusRawResponse: true,
      },
      orderBy: { id: "asc" },
    }),
    loadSalesOrderEnrichedMetricsFromDb(operationalWhere, referenceDate, {
      env: options?.env,
      // where já consolidou presença
      includeConfirmedMissing: true,
    }),
  ]);

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(headerRows, referenceDate);
  const enrichedById = new Map(enriched.map((m) => [m.salesOrderId, m]));

  const rows: SalesOrderOperationalOrderFact[] = headerRows.map((order) => {
    const linked = linkedMap.get(order.id);
    const enrichedRow = enrichedById.get(order.id);
    const invoicedNfeAmount =
      linked != null
        ? Number(linked.nfeTotalValue) || 0
        : Number(enrichedRow?.nfeTotalValue) || 0;
    return {
      salesOrderId: order.id,
      totalNetValue: decimalToNumber(order.totalNetValue) ?? 0,
      totalItems: order.totalItems ?? 0,
      invoicedNfeAmount,
    };
  });

  const factsById = aggregateFactsBySalesOrderId(rows);
  const facts = [...factsById.values()];
  const metrics = computeSalesOrderOperationalMetrics(facts);

  return { facts, factsById, enriched, metrics };
}

/** Agrega títulos de CR já filtrados — um bucket por salesOrderId. */
export function aggregateReceivablesBySalesOrderId(
  titles: Array<{
    salesOrderId: string | null | undefined;
    balanceReceivable?: unknown;
    originalAmount?: unknown;
  }>
): Map<string, { salesOrderId: string; openAmount: number; titleCount: number }> {
  const map = new Map<
    string,
    { salesOrderId: string; openAmount: number; titleCount: number }
  >();
  for (const title of titles) {
    const id = String(title.salesOrderId ?? "").trim();
    if (!id) continue;
    const open = decimalToNumber(title.balanceReceivable) ?? 0;
    const bucket = map.get(id) ?? { salesOrderId: id, openAmount: 0, titleCount: 0 };
    bucket.openAmount += open;
    bucket.titleCount += 1;
    map.set(id, bucket);
  }
  for (const bucket of map.values()) {
    bucket.openAmount = Math.round(bucket.openAmount * 100) / 100;
  }
  return map;
}

export { loadSalesOrderEnrichedMetricsFromDb, loadSalesOrderLinkedNfeContextMap };
