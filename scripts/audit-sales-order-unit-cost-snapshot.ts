#!/usr/bin/env npx tsx
/**
 * Auditoria read-only do campo SalesOrderItem.unitCost (preço unitário comercial Nomus).
 *
 * Nota: unitCost NÃO é custo de produção. Para margem, use motor IndusCost / audit-sales-order-cost-semantics.ts.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-unit-cost-snapshot.ts --year=2026 --month=6
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseNomusSyncStoredUnitCost } from "../src/lib/salesOrderNomusSyncCost.server.ts";

type CliArgs = {
  year: number;
  month: number | null;
  asOfDate: string | null;
  limit: number;
};

type ItemRow = {
  itemId: string;
  orderId: string;
  orderCode: string;
  issueDate: Date;
  customerId: string;
  customerName: string;
  productId: string;
  productSku: string;
  productName: string;
  externalProductId: number | null;
  unitCost: number;
  netValue: number;
  /** true quando unitCost > 0 (preço unitário comercial preenchido — não custo de produção). */
  hasCommercialUnitPrice: boolean;
  productIdMissing: boolean;
  productLinkedZeroCost: boolean;
};

type RankProduct = {
  productId: string;
  sku: string;
  name: string;
  items: number;
  netValue: number;
  orderExamples: string[];
};

type RankCustomer = {
  customerId: string;
  customerName: string;
  items: number;
  netValue: number;
  orderExamples: string[];
};

type RecentOrderGap = {
  orderCode: string;
  issueDate: string;
  itemsTotal: number;
  itemsWithoutCommercialUnitPrice: number;
  netValueWithoutCommercialUnitPrice: number;
  sampleSkus: string[];
};

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function parseCliArgs(): CliArgs {
  const year = Number(parseArg("year") ?? String(new Date().getFullYear()));
  const monthRaw = parseArg("month");
  const month = monthRaw != null && monthRaw !== "" ? Number(monthRaw) : null;
  const asOfDate = parseArg("asOfDate") ?? null;
  const limit = Math.max(1, Math.min(500, Number(parseArg("limit") ?? "20")));
  return { year, month, asOfDate, limit };
}

function parseIsoDateParts(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function buildPeriodFilter(args: CliArgs): { start: Date; endExclusive: Date; label: string } {
  const { year, month, asOfDate } = args;
  let start: Date;
  let endExclusive: Date;
  let label: string;

  if (month != null && month >= 1 && month <= 12) {
    start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    endExclusive = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    label = `${year}-${String(month).padStart(2, "0")}`;
  } else {
    start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    endExclusive = new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0, 0));
    label = String(year);
  }

  if (asOfDate) {
    const parts = parseIsoDateParts(asOfDate);
    if (!parts) {
      throw new Error(`--asOfDate inválido: ${asOfDate} (use YYYY-MM-DD)`);
    }
    const capExclusive = new Date(Date.UTC(parts.y, parts.m - 1, parts.d + 1, 0, 0, 0, 0));
    if (capExclusive < endExclusive) {
      endExclusive = capExclusive;
    }
    label += ` (até ${asOfDate})`;
  }

  return { start, endExclusive, label };
}

function fmtMoney(value: number): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isProductIdMissing(productId: string | null | undefined): boolean {
  if (typeof productId !== "string") return true;
  const trimmed = productId.trim();
  if (!trimmed) return true;
  return trimmed === "00000000-0000-0000-0000-000000000000";
}

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function customerLabel(customer: { companyName: string; tradeName: string | null }): string {
  return customer.tradeName?.trim() || customer.companyName;
}

function printRankProducts(title: string, rows: RankProduct[], limit: number): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (nenhum)");
    return;
  }
  console.log(
    "  " +
      ["SKU", "Produto", "Itens", "Receita líq. afetada", "Exemplos pedido"]
        .map((h) => h.padEnd(22))
        .join("")
  );
  console.log("  " + "-".repeat(110));
  for (const row of rows.slice(0, limit)) {
    console.log(
      "  " +
        [
          row.sku.slice(0, 20),
          row.name.slice(0, 20),
          String(row.items),
          fmtMoney(row.netValue),
          row.orderExamples.join(", "),
        ]
          .map((c, i) => c.padEnd(i === 1 ? 22 : 22))
          .join("")
    );
    console.log(`    productId: ${row.productId}`);
  }
}

function printRankCustomers(title: string, rows: RankCustomer[], limit: number): void {
  console.log(`\n${title}`);
  if (rows.length === 0) {
    console.log("  (nenhum)");
    return;
  }
  console.log(
    "  " + ["Cliente", "Itens", "Receita líq. afetada", "Exemplos pedido"].map((h) => h.padEnd(28)).join("")
  );
  console.log("  " + "-".repeat(100));
  for (const row of rows.slice(0, limit)) {
    console.log(
      "  " +
        [
          row.customerName.slice(0, 26),
          String(row.items),
          fmtMoney(row.netValue),
          row.orderExamples.join(", "),
        ]
          .map((c) => c.padEnd(28))
          .join("")
    );
  }
}

import { warnTraceLegacyMode } from "./commission-audit-args.ts";

async function main(): Promise<void> {
  warnTraceLegacyMode(
    "audit-sales-order-unit-cost-snapshot",
    "unitCost Nomus ≠ custo industrial — use audit-sales-order-trace.ts"
  );
  const args = parseCliArgs();
  const period = buildPeriodFilter(args);

  console.log("=== IndusCost — Auditoria de cobertura unitCost (Pedidos de Venda) ===");
  console.log(`Período: ${period.label}`);
  console.log(`issueDate: ${fmtDate(period.start)} .. ${fmtDate(new Date(period.endExclusive.getTime() - 1))} (exclusive end)`);
  console.log(`Rankings limit: ${args.limit}`);
  console.log("Modo: read-only (sem alterações no banco)\n");

  const orders = await prisma.salesOrder.findMany({
    where: {
      issueDate: { gte: period.start, lt: period.endExclusive },
      status: { not: "CANCELLED" },
    },
    select: {
      id: true,
      orderCode: true,
      issueDate: true,
      status: true,
      sourceSystem: true,
      customerId: true,
      Customer: { select: { companyName: true, tradeName: true } },
      items: {
        select: {
          id: true,
          productId: true,
          externalProductId: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          unitCost: true,
          totalNetValue: true,
          Product: { select: { sku: true, name: true } },
        },
      },
    },
    orderBy: { issueDate: "desc" },
  });

  const rows: ItemRow[] = [];
  for (const order of orders) {
    const custName = customerLabel(order.Customer);
    for (const item of order.items) {
      const unitCostRaw = item.unitCost;
      const unitCostNum = toNumber(unitCostRaw);
      const frozen = parseNomusSyncStoredUnitCost(unitCostRaw) != null;
      const productIdMissing = isProductIdMissing(item.productId);
      const productLinkedZeroCost = !productIdMissing && !frozen;

      rows.push({
        itemId: item.id,
        orderId: order.id,
        orderCode: order.orderCode,
        issueDate: order.issueDate,
        customerId: order.customerId,
        customerName: custName,
        productId: item.productId,
        productSku: item.Product?.sku ?? item.skuSnapshot,
        productName: item.Product?.name ?? item.productNameSnapshot,
        externalProductId: item.externalProductId,
        unitCost: unitCostNum,
        netValue: toNumber(item.totalNetValue),
        hasCommercialUnitPrice: frozen,
        productIdMissing,
        productLinkedZeroCost,
      });
    }
  }

  const totalOrders = orders.length;
  const totalItems = rows.length;
  const itemsWithCommercialPrice = rows.filter((r) => r.hasCommercialUnitPrice).length;
  const itemsWithZeroCost = rows.filter((r) => !r.hasCommercialUnitPrice && r.unitCost === 0).length;
  const itemsWithInvalidCost = rows.filter((r) => !r.hasCommercialUnitPrice && r.unitCost !== 0).length;

  const totalNetValue = rows.reduce((s, r) => s + r.netValue, 0);
  const netValueWithCommercialPrice = rows
    .filter((r) => r.hasCommercialUnitPrice)
    .reduce((s, r) => s + r.netValue, 0);
  const netValueWithoutCommercialPrice = totalNetValue - netValueWithCommercialPrice;

  const coverageByItems = totalItems > 0 ? (itemsWithCommercialPrice / totalItems) * 100 : null;
  const coverageByValue =
    totalNetValue > 0 ? (netValueWithCommercialPrice / totalNetValue) * 100 : null;

  const productIdMissingRows = rows.filter((r) => r.productIdMissing);
  const productLinkedZeroRows = rows.filter((r) => r.productLinkedZeroCost);

  const productAgg = new Map<string, RankProduct>();
  const customerAgg = new Map<string, RankCustomer>();

  for (const row of rows) {
    if (row.hasCommercialUnitPrice) continue;

    let p = productAgg.get(row.productId);
    if (!p) {
      p = {
        productId: row.productId,
        sku: row.productSku,
        name: row.productName,
        items: 0,
        netValue: 0,
        orderExamples: [],
      };
      productAgg.set(row.productId, p);
    }
    p.items += 1;
    p.netValue += row.netValue;
    if (!p.orderExamples.includes(row.orderCode) && p.orderExamples.length < 5) {
      p.orderExamples.push(row.orderCode);
    }

    let c = customerAgg.get(row.customerId);
    if (!c) {
      c = {
        customerId: row.customerId,
        customerName: row.customerName,
        items: 0,
        netValue: 0,
        orderExamples: [],
      };
      customerAgg.set(row.customerId, c);
    }
    c.items += 1;
    c.netValue += row.netValue;
    if (!c.orderExamples.includes(row.orderCode) && c.orderExamples.length < 5) {
      c.orderExamples.push(row.orderCode);
    }
  }

  const topProducts = [...productAgg.values()].sort((a, b) => b.netValue - a.netValue);
  const topCustomers = [...customerAgg.values()].sort((a, b) => b.netValue - a.netValue);

  const orderGapMap = new Map<string, RecentOrderGap>();
  for (const row of rows) {
    if (row.hasCommercialUnitPrice) continue;
    let gap = orderGapMap.get(row.orderId);
    if (!gap) {
      gap = {
        orderCode: row.orderCode,
        issueDate: fmtDate(row.issueDate),
        itemsTotal: 0,
        itemsWithoutCommercialUnitPrice: 0,
        netValueWithoutCommercialUnitPrice: 0,
        sampleSkus: [],
      };
      orderGapMap.set(row.orderId, gap);
    }
    gap.itemsWithoutCommercialUnitPrice += 1;
    gap.netValueWithoutCommercialUnitPrice += row.netValue;
    if (gap.sampleSkus.length < 5 && !gap.sampleSkus.includes(row.productSku)) {
      gap.sampleSkus.push(row.productSku);
    }
  }
  for (const order of orders) {
    const gap = orderGapMap.get(order.id);
    if (gap) gap.itemsTotal = order.items.length;
  }
  const recentOrdersWithoutCommercialPrice = [...orderGapMap.values()].sort((a, b) =>
    b.issueDate.localeCompare(a.issueDate)
  );

  console.log("--- Resumo geral ---");
  console.log(`Pedidos analisados:              ${totalOrders.toLocaleString("pt-BR")}`);
  console.log(`Itens analisados:                ${totalItems.toLocaleString("pt-BR")}`);
  console.log(
    `Itens com preço unitário comercial (unitCost > 0): ${itemsWithCommercialPrice.toLocaleString("pt-BR")}`
  );
  console.log(`Itens com unitCost = 0:          ${itemsWithZeroCost.toLocaleString("pt-BR")}`);
  console.log(`Itens com unitCost inválido*:    ${itemsWithInvalidCost.toLocaleString("pt-BR")}`);
  console.log(`Cobertura por quantidade:        ${fmtPct(coverageByItems)}`);
  console.log("");
  console.log(`Receita líquida total:           R$ ${fmtMoney(totalNetValue)}`);
  console.log(
    `Receita com preço unitário comercial: R$ ${fmtMoney(netValueWithCommercialPrice)}`
  );
  console.log(
    `Receita sem preço unitário comercial: R$ ${fmtMoney(netValueWithoutCommercialPrice)}`
  );
  console.log(`Cobertura por valor:             ${fmtPct(coverageByValue)}`);
  console.log("");
  console.log("* unitCost inválido: valor não numérico ou negativo (schema exige Decimal; null não aplicável via Prisma).");

  console.log("\n--- productId ausente ou inválido ---");
  console.log(`Contagem: ${productIdMissingRows.length}`);
  if (productIdMissingRows.length > 0) {
    console.log("Exemplos:");
    for (const ex of productIdMissingRows.slice(0, args.limit)) {
      console.log(
        `  - pedido=${ex.orderCode} item=${ex.itemId} sku=${ex.productSku} receita=R$ ${fmtMoney(ex.netValue)}`
      );
    }
  }

  console.log("\n--- Produto vinculado, unitCost zerado ---");
  console.log(`Contagem: ${productLinkedZeroRows.length}`);
  if (productLinkedZeroRows.length > 0) {
    console.log("Exemplos:");
    for (const ex of productLinkedZeroRows.slice(0, args.limit)) {
      console.log(
        `  - pedido=${ex.orderCode} produto=${ex.productId} sku=${ex.productSku} receita=R$ ${fmtMoney(ex.netValue)}`
      );
    }
  }

  printRankProducts(
    `--- Top ${args.limit} produtos sem preço unitário comercial (por receita líquida afetada) ---`,
    topProducts,
    args.limit
  );

  printRankCustomers(
    `--- Top ${args.limit} clientes com maior receita sem preço unitário comercial ---`,
    topCustomers,
    args.limit
  );

  console.log(
    `\n--- Pedidos mais recentes com linhas sem preço unitário comercial (top ${args.limit}) ---`
  );
  if (recentOrdersWithoutCommercialPrice.length === 0) {
    console.log("  (nenhum — cobertura total no período)");
  } else {
    console.log(
      "  " +
        ["Pedido", "Emissão", "Itens s/ preço", "Total itens", "Receita s/ preço", "SKUs exemplo"]
          .map((h) => h.padEnd(18))
          .join("")
    );
    console.log("  " + "-".repeat(108));
    for (const row of recentOrdersWithoutCommercialPrice.slice(0, args.limit)) {
      console.log(
        "  " +
          [
            row.orderCode.slice(0, 16),
            row.issueDate,
            String(row.itemsWithoutCommercialUnitPrice),
            String(row.itemsTotal),
            fmtMoney(row.netValueWithoutCommercialUnitPrice),
            row.sampleSkus.join(", "),
          ]
            .map((c) => c.padEnd(18))
            .join("")
      );
    }
  }

  console.log("\n--- JSON (máquina) ---");
  console.log(
    JSON.stringify(
      {
        period: period.label,
        filters: {
          year: args.year,
          month: args.month,
          asOfDate: args.asOfDate,
          limit: args.limit,
          excludeStatus: "CANCELLED",
        },
        totals: {
          orders: totalOrders,
          items: totalItems,
          itemsWithCommercialUnitPrice: itemsWithCommercialPrice,
          itemsWithZeroCost,
          itemsWithInvalidCost,
          coverageByItemsPct: coverageByItems,
          totalNetValue,
          netValueWithCommercialUnitPrice: netValueWithCommercialPrice,
          netValueWithoutCommercialUnitPrice: netValueWithoutCommercialPrice,
          coverageByValuePct: coverageByValue,
        },
        productIdMissing: {
          count: productIdMissingRows.length,
          examples: productIdMissingRows.slice(0, args.limit).map((r) => ({
            orderCode: r.orderCode,
            itemId: r.itemId,
            sku: r.productSku,
            netValue: r.netValue,
          })),
        },
        productLinkedZeroUnitCost: {
          count: productLinkedZeroRows.length,
          examples: productLinkedZeroRows.slice(0, args.limit).map((r) => ({
            orderCode: r.orderCode,
            productId: r.productId,
            sku: r.productSku,
            netValue: r.netValue,
          })),
        },
        topProductsWithoutCommercialUnitPrice: topProducts.slice(0, args.limit),
        topCustomersWithoutCommercialUnitPrice: topCustomers.slice(0, args.limit),
        recentOrdersWithCommercialPriceGaps: recentOrdersWithoutCommercialPrice.slice(0, args.limit),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[audit-sales-order-unit-cost-snapshot] erro:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
