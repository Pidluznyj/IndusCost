/**
 * Auditoria dry-run de margem de Pedidos de Venda.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-margins.ts --year=2026 --limit=50
 *   npm run audit:sales-order-margins
 *
 * Não altera dados. Usa o motor `salesOrderMarginService` com getProductCostAnalysis —
 * SalesOrderItem.unitCost Nomus não entra como custo de produção.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  calculateSalesOrderMarginsForOrders,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderForMargin,
} from "../src/lib/salesOrderMarginService.server.ts";
import { setSalesOrderMarginProductCostResolver } from "../src/lib/salesOrderMarginProductCostResolver.ts";
import { aggregateSalesOrderMarginSummaries } from "../src/lib/salesOrderMarginDisplay.ts";
import type { SalesOrderMarginItemResult, SalesOrderMarginStatus } from "../src/lib/salesOrderMarginTypes.ts";
import { isSalesOrderMarginConsolidationEligible } from "../src/lib/salesOrderMarginStatus.ts";

const YEAR = Number(
  process.argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? new Date().getFullYear()
);
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 50
);

type ProblemRow = {
  orderCode: string;
  itemId: string;
  sku: string;
  status: SalesOrderMarginStatus;
  netRevenue: number;
  note: string;
};

function parseYearRange(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1, 0, 0, 0)),
    end: new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0)),
  };
}

async function loadCostLogIndex(productIds: string[]) {
  const index = new Map<string, { totalCiu: number; calculatedAt: string }>();
  if (productIds.length === 0) return index;

  const rows = await prisma.costCalculationLog.findMany({
    where: { productId: { in: productIds } },
    orderBy: { calculatedAt: "desc" },
    select: { productId: true, totalCiu: true, calculatedAt: true },
  });

  for (const row of rows) {
    if (index.has(row.productId)) continue;
    const totalCiu = Number(row.totalCiu);
    if (!Number.isFinite(totalCiu) || totalCiu <= 0) continue;
    index.set(row.productId, {
      totalCiu,
      calculatedAt: row.calculatedAt.toISOString(),
    });
  }
  return index;
}

function registerAuditCostResolver(costLogIndex: Map<string, { totalCiu: number; calculatedAt: string }>) {
  setSalesOrderMarginProductCostResolver(async (productId) => ({
    costLog: costLogIndex.get(productId) ?? null,
  }));
}

function countByStatus(items: SalesOrderMarginItemResult[]) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
  }
  return counts;
}

async function main() {
  const { start, end } = parseYearRange(YEAR);

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    orderBy: { issueDate: "desc" },
    take: Math.max(1, Math.min(LIMIT, 500)),
    select: {
      id: true,
      orderCode: true,
      nomusRawResponse: true,
      items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
    },
  });

  const productIds = [
    ...new Set(
      orders.flatMap((o) => o.items.map((i) => i.productId).filter((id): id is string => Boolean(id)))
    ),
  ];
  const costLogIndex = await loadCostLogIndex(productIds);
  registerAuditCostResolver(costLogIndex);

  const marginByOrder = await calculateSalesOrderMarginsForOrders(
    prisma,
    orders as SalesOrderForMargin[]
  );

  let itemsAnalyzed = 0;
  let itemsOk = 0;
  let itemsWithoutCost = 0;
  let itemsWithoutProduct = 0;
  let itemsNegativeMargin = 0;
  let itemsCanceled = 0;
  const problems: ProblemRow[] = [];
  const summaries = [];

  for (const order of orders) {
    const result = marginByOrder.get(order.id);
    if (!result) continue;
    summaries.push(result.marginSummary);

    for (const item of result.itemResults) {
      itemsAnalyzed += 1;
      if (item.status === "OK") itemsOk += 1;
      if (item.status === "SEM_CUSTO") itemsWithoutCost += 1;
      if (item.status === "SEM_PRODUTO_VINCULADO") itemsWithoutProduct += 1;
      if (item.status === "MARGEM_NEGATIVA") itemsNegativeMargin += 1;
      if (item.status === "ITEM_CANCELADO") itemsCanceled += 1;

      if (
        item.status === "SEM_CUSTO" ||
        item.status === "SEM_PRODUTO_VINCULADO" ||
        item.status === "MARGEM_NEGATIVA" ||
        item.status === "REVISAR_DADOS" ||
        item.status === "RECEITA_INVALIDA"
      ) {
        problems.push({
          orderCode: order.orderCode,
          itemId: item.salesOrderItemId ?? "—",
          sku: item.productSku ?? "—",
          status: item.status,
          netRevenue: item.netRevenue,
          note: item.notes[item.notes.length - 1] ?? item.status,
        });
      }
    }
  }

  const consolidated = aggregateSalesOrderMarginSummaries(summaries);
  const statusCounts = countByStatus(
    [...marginByOrder.values()].flatMap((r) => r.itemResults)
  );

  const eligibleItems = [...marginByOrder.values()]
    .flatMap((r) => r.itemResults)
    .filter((i) => isSalesOrderMarginConsolidationEligible(i.status));

  let sumMargin = 0;
  let sumRevenue = 0;
  for (const item of eligibleItems) {
    sumRevenue += item.netRevenue;
    sumMargin += item.marginValue ?? 0;
  }
  const weightedPct = sumRevenue > 0 ? (sumMargin / sumRevenue) * 100 : null;

  console.log("\n=== Auditoria de margem — Pedidos de Venda (dry-run) ===");
  console.log(JSON.stringify({
    year: YEAR,
    limit: LIMIT,
    ordersAnalyzed: orders.length,
    itemsAnalyzed,
    itemsOk,
    itemsWithoutCost,
    itemsWithoutProduct,
    itemsWithNegativeMargin: itemsNegativeMargin,
    itemsCanceledExcluded: itemsCanceled,
    costLogsLoaded: costLogIndex.size,
    itemStatusBreakdown: statusCounts,
    consolidatedMargin: {
      netRevenue: consolidated.netRevenue,
      totalCost: consolidated.totalCost,
      marginValue: consolidated.marginValue,
      marginPercent: consolidated.marginPercent,
      ordersWithSummary: summaries.length,
    },
    weightedMarginPercentCrossCheck: weightedPct,
    topProblems: problems
      .sort((a, b) => {
        const rank = (s: SalesOrderMarginStatus) =>
          s === "MARGEM_NEGATIVA" ? 0 : s === "SEM_CUSTO" ? 1 : s === "SEM_PRODUTO_VINCULADO" ? 2 : 3;
        return rank(a.status) - rank(b.status) || b.netRevenue - a.netRevenue;
      })
      .slice(0, 15),
  }, null, 2));

  console.log(
    "\nNota: custo de produção via tabela versionada IndusCost (productId + issueDate) — SalesOrderItem.unitCost Nomus (preço de venda) não entra na margem."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    setSalesOrderMarginProductCostResolver(null);
    await prisma.$disconnect();
  });
