#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: cobertura de componentes na tabela oficial de custo de produção.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-component-coverage.ts
 *   npx tsx scripts/audit-production-cost-component-coverage.ts --year=2026 --month=7
 *   npx tsx scripts/audit-production-cost-component-coverage.ts --top=20 --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import { parseYearPeriod, parseArg, hasFlag, requireDatabaseUrl } from "./commission-audit-args.ts";
import { getEffectiveProductProductionCostsForPairs } from "../src/lib/productionCostTables.server.ts";
import { effectiveProductionCostLookupKey } from "../src/lib/productionCostVersioning.ts";

type SoldComponentRow = {
  productId: string;
  sku: string;
  name: string;
  orderCount: number;
};

async function main(): Promise<void> {
  requireDatabaseUrl();
  const json = hasFlag("json");
  const top = Math.min(Math.max(Number(parseArg("top") ?? "15") || 15, 1), 100);
  const referenceDateRaw = parseArg("date")?.trim();
  const { from, to, label: periodLabel } = parseYearPeriod();
  const referenceDate = referenceDateRaw
    ? civilDateToLocalDate(referenceDateRaw)
    : civilDateToLocalDate(toCivilDateKey(new Date()));

  if (Number.isNaN(referenceDate.getTime())) {
    console.error(`--date inválida: ${referenceDateRaw}`);
    process.exit(1);
  }

  await prisma.$connect();

  const [activeProducts, activeComponents, soldComponentGroups] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE", type: "PRODUCT" } }),
    prisma.product.count({ where: { status: "ACTIVE", type: "COMPONENT" } }),
    prisma.salesOrderItem.groupBy({
      by: ["productId"],
      where: {
        Product: { type: "COMPONENT", status: "ACTIVE" },
        SalesOrder: { issueDate: { gte: from, lte: to } },
      },
      _count: { _all: true },
    }),
  ]);

  const soldComponentIds = soldComponentGroups.map((row) => row.productId);
  const soldComponents = soldComponentIds.length
    ? await prisma.product.findMany({
        where: { id: { in: soldComponentIds }, type: "COMPONENT", status: "ACTIVE" },
        select: { id: true, sku: true, name: true },
        orderBy: { sku: "asc" },
      })
    : [];

  const soldById = new Map(soldComponents.map((row) => [row.id, row]));
  const soldRows: SoldComponentRow[] = soldComponentGroups
    .map((group) => {
      const product = soldById.get(group.productId);
      if (!product) return null;
      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        orderCount: group._count._all,
      };
    })
    .filter((row): row is SoldComponentRow => row != null)
    .sort((a, b) => b.orderCount - a.orderCount || a.sku.localeCompare(b.sku));

  const costPairs = soldRows.map((row) => ({
    productId: row.productId,
    referenceDate,
  }));
  const costMap =
    costPairs.length > 0
      ? await getEffectiveProductProductionCostsForPairs(prisma, costPairs)
      : new Map<string, { status: string; unitProductionCost?: number }>();

  const withPublished: SoldComponentRow[] = [];
  const withoutPublished: SoldComponentRow[] = [];
  for (const row of soldRows) {
    const key = effectiveProductionCostLookupKey(row.productId, referenceDate);
    const resolved = costMap.get(key);
    if (resolved?.status === "OK" && (resolved.unitProductionCost ?? 0) > 0) {
      withPublished.push(row);
    } else {
      withoutPublished.push(row);
    }
  }

  const payload = {
    periodLabel,
    referenceDate: toCivilDateKey(referenceDate),
    totals: {
      activeProducts,
      activeComponents,
      soldComponents: soldRows.length,
      soldComponentsWithPublishedCost: withPublished.length,
      soldComponentsWithoutPublishedCost: withoutPublished.length,
    },
    topSoldWithoutPublishedCost: withoutPublished.slice(0, top).map((row) => ({
      sku: row.sku,
      name: row.name,
      orderCount: row.orderCount,
    })),
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Auditoria — cobertura de componentes (custo de produção) ===\n");
  console.log(`Período de vendas: ${periodLabel}`);
  console.log(`Data de referência para custo vigente: ${payload.referenceDate}\n`);
  console.log(`PRODUCT ativos: ${activeProducts}`);
  console.log(`COMPONENT ativos: ${activeComponents}`);
  console.log(`Componentes vendidos no período: ${soldRows.length}`);
  console.log(`Componentes com custo publicado vigente: ${withPublished.length}`);
  console.log(`Componentes vendidos SEM custo publicado: ${withoutPublished.length}`);

  if (withoutPublished.length > 0) {
    console.log(`\n--- Top ${Math.min(top, withoutPublished.length)} componentes vendidos sem custo ---`);
    for (const row of withoutPublished.slice(0, top)) {
      console.log(`  ${row.sku} — ${row.name} (${row.orderCount} pedido(s))`);
    }
  }

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error("[audit-production-cost-component-coverage]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
