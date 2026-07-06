#!/usr/bin/env npx tsx
/**
 * Auditoria: cobertura de custo vigente em pedidos de venda (margem).
 *
 * Uso:
 *   npx tsx scripts/audit-sales-margin-cost-coverage.ts --year=2026 --month=7
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseYearPeriod, requireDatabaseUrl } from "./commission-audit-args.ts";
import { getEffectiveProductProductionCostsForPairs } from "../src/lib/productionCostTables.server.ts";
import { civilDateToLocalDate, toCivilDateKey } from "../src/lib/financeCivilDate.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const { from, to, label } = parseYearPeriod();
  await prisma.$connect();

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: from, lte: to },
      status: { notIn: ["CANCELLED", "DRAFT"] },
    },
    select: {
      id: true,
      code: true,
      issueDate: true,
      SalesOrderItem: {
        select: {
          id: true,
          quantity: true,
          unitPrice: true,
          productId: true,
          Product: { select: { sku: true } },
        },
      },
    },
    orderBy: { issueDate: "asc" },
  });

  type Pair = { productId: string; referenceDate: Date };
  const pairs: Pair[] = [];
  for (const order of orders) {
    const ref = civilDateToLocalDate(toCivilDateKey(order.issueDate));
    for (const item of order.SalesOrderItem) {
      if (item.productId) pairs.push({ productId: item.productId, referenceDate: ref });
    }
  }

  const resolvedMap =
    pairs.length > 0
      ? await getEffectiveProductProductionCostsForPairs(prisma, pairs)
      : new Map();

  let itemsTotal = 0;
  let itemsWithCost = 0;
  let itemsWithoutCost = 0;
  let revenueWithCost = 0;
  let revenueWithoutCost = 0;

  for (const order of orders) {
    const ref = civilDateToLocalDate(toCivilDateKey(order.issueDate));
    for (const item of order.SalesOrderItem) {
      if (!item.productId) continue;
      itemsTotal += 1;
      const qty = Number(item.quantity) || 0;
      const price = Number(item.unitPrice) || 0;
      const revenue = qty * price;
      const key = `${item.productId}|${toCivilDateKey(ref)}`;
      const effective = resolvedMap.get(key);
      if (effective?.status === "OK") {
        itemsWithCost += 1;
        revenueWithCost += revenue;
      } else {
        itemsWithoutCost += 1;
        revenueWithoutCost += revenue;
      }
    }
  }

  const coveragePct =
    itemsTotal > 0 ? Math.round((itemsWithCost / itemsTotal) * 10000) / 100 : 0;

  console.log("=== Auditoria — Cobertura de custo em pedidos (margem) ===\n");
  console.log(`Período: ${label}`);
  console.log(`Pedidos: ${orders.length}`);
  console.log(`Itens vendidos (com produto): ${itemsTotal}`);
  console.log(`Itens com custo vigente: ${itemsWithCost}`);
  console.log(`Itens SEM_CUSTO: ${itemsWithoutCost}`);
  console.log(`Cobertura: ${coveragePct}%`);
  console.log(`Receita com custo: R$ ${revenueWithCost.toFixed(2)}`);
  console.log(`Receita sem custo: R$ ${revenueWithoutCost.toFixed(2)}`);

  const order02720 = orders.find((o) => o.code === "PD 02720" || o.code === "02720");
  if (order02720) {
    console.log("\n--- Pedido PD 02720 ---");
    for (const item of order02720.SalesOrderItem) {
      if (!item.productId) continue;
      const ref = civilDateToLocalDate(toCivilDateKey(order02720.issueDate));
      const key = `${item.productId}|${toCivilDateKey(ref)}`;
      const effective = resolvedMap.get(key);
      console.log(
        `  ${item.Product?.sku ?? item.productId}: ${
          effective?.status === "OK"
            ? `custo R$ ${effective.unitProductionCost.toFixed(2)} (rev ${effective.versionCode} v${effective.revision})`
            : "SEM_CUSTO"
        }`
      );
    }
  }

  console.log("\n--- JSON ---");
  console.log(
    JSON.stringify(
      {
        period: label,
        orders: orders.length,
        itemsTotal,
        itemsWithCost,
        itemsWithoutCost,
        coveragePct,
        revenueWithCost,
        revenueWithoutCost,
      },
      null,
      2
    )
  );

  if (itemsWithoutCost > 0 && itemsWithCost === 0) process.exitCode = 1;

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
