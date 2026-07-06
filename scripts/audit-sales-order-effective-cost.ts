#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: custo efetivo por pedido/produto/data para margem oficial.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-effective-cost.ts --year=2026 --month=6
 *   npx tsx scripts/audit-sales-order-effective-cost.ts --orderCode=PD0001 --productCode=PA
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import {
  getEffectiveProductProductionCost,
} from "../src/lib/productionCostTables.server.ts";
import {
  buildSalesOrderMarginInputsFromVersionedProductionCosts,
} from "../src/lib/salesOrderMarginResolver.server.ts";
import { calculateSalesOrderItemMargin } from "../src/lib/salesOrderMarginMath.ts";
import { loadSalesMarginNomusConfig } from "../src/lib/salesMarginNomusConfig.ts";
import { resolveSalesTaxRuleById } from "../src/lib/averageSalesTaxEngine.ts";

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

type Finding = { area: string; status: AuditStatus; message: string };

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function assertDatabaseUrl(): void {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL ausente.");
    process.exit(1);
  }
}

import { warnTraceLegacyMode } from "./commission-audit-args.ts";

async function main(): Promise<void> {
  warnTraceLegacyMode(
    "audit-sales-order-effective-cost",
    "scripts/audit-sales-order-trace.ts e GET /api/audit/sales-order-trace"
  );
  assertDatabaseUrl();
  await prisma.$connect();

  const orderCode = parseArg("orderCode")?.trim();
  const productCode = parseArg("productCode")?.trim();
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");

  const findings: Finding[] = [];
  const { config } = await loadSalesMarginNomusConfig(prisma);

  if (config.taxMode === "deductFromGross" && !config.defaultTaxRuleId?.trim()) {
    findings.push({
      area: "tax",
      status: "BLOQUEANTE",
      message: "taxMode deductFromGross sem defaultTaxRuleId — margem gerencial incompleta.",
    });
  }

  if (config.allowLiveCostFallback) {
    findings.push({
      area: "cost",
      status: "ALERTA",
      message: "allowLiveCostFallback=true na config — motor oficial deve usar apenas tabela versionada.",
    });
  }

  const marginResolverSrc = await import("node:fs").then((fs) =>
    fs.readFileSync("src/lib/salesOrderMarginResolver.server.ts", "utf8")
  );
  if (!marginResolverSrc.includes("getEffectiveProductProductionCostsForPairs")) {
    findings.push({
      area: "margin",
      status: "BLOQUEANTE",
      message: "Margin resolver server não usa getEffectiveProductProductionCostsForPairs.",
    });
  }
  if (/getSalesOrderMarginProductCostResolver/.test(marginResolverSrc) &&
      marginResolverSrc.includes("buildSalesOrderMarginContext")) {
    findings.push({
      area: "margin",
      status: "BLOQUEANTE",
      message: "buildSalesOrderMarginContext ainda referencia motor vivo getProductCostAnalysis.",
    });
  }

  const whereOrder = orderCode
    ? { orderCode }
    : {
        issueDate: {
          gte: new Date(year, month - 1, 1),
          lt: new Date(year, month, 1),
        },
      };

  const orders = await prisma.salesOrder.findMany({
    where: whereOrder,
    take: orderCode ? 1 : 5,
    orderBy: { issueDate: "desc" },
    include: {
      items: {
        where: productCode ? { skuSnapshot: productCode } : undefined,
        take: productCode ? 1 : 50,
      },
    },
  });

  console.log("=== Auditoria — Custo efetivo para margem ===\n");
  console.log(`Pedidos amostrados: ${orders.length}`);

  for (const order of orders) {
    console.log(`\n--- Pedido ${order.orderCode} ---`);
    console.log(`Data do pedido: ${toCivilDateKey(order.issueDate)}`);

    const taxRule = config.defaultTaxRuleId
      ? await resolveSalesTaxRuleById(prisma, config.defaultTaxRuleId)
      : null;
    console.log(
      `TaxRule: ${taxRule?.name ?? "—"} (${taxRule?.totalPercent ?? "—"}%) · taxMode=${config.taxMode}`
    );

    const resolverItems = order.items.map((item) => ({
      salesOrderItemId: item.id,
      productId: item.productId,
      skuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: item.quantity,
      negotiatedPrice: item.negotiatedPrice,
      totalNetValue: item.totalNetValue,
      referenceDate: order.issueDate,
    }));

    if (resolverItems.length === 0) {
      console.log("  (sem itens no escopo)");
      continue;
    }

    const marginInputs = await buildSalesOrderMarginInputsFromVersionedProductionCosts(
      prisma,
      resolverItems
    );

    for (const input of marginInputs) {
      const item = order.items.find((row) => row.id === input.salesOrderItemId);
      if (!item) continue;

      const revenue = Number(item.totalNetValue);
      const effective = input.productId
        ? await getEffectiveProductProductionCost(prisma, input.productId, order.issueDate)
        : null;

      const margin = calculateSalesOrderItemMargin(input);
      const taxPct = taxRule?.totalPercent ?? 0;
      const taxAmount =
        config.taxMode === "deductFromGross" && taxPct > 0
          ? (revenue * taxPct) / 100
          : 0;

      let lineStatus: AuditStatus = "OK";
      if (margin.status === "SEM_CUSTO") lineStatus = "ALERTA";
      if (input.costSource === "SALES_ORDER_ITEM_SNAPSHOT") lineStatus = "BLOQUEANTE";
      if (input.costSource === "LIVE_PRODUCT_COST") lineStatus = "BLOQUEANTE";
      if (margin.unitCost === 0) lineStatus = "BLOQUEANTE";

      console.log(`  Produto ${item.skuSnapshot} qty=${item.quantity}`);
      console.log(`    Preço venda (linha): ${revenue}`);
      console.log(`    Imposto est.: ${taxAmount.toFixed(2)}`);
      console.log(`    Custo unit.: ${margin.unitCost ?? "SEM_CUSTO"}`);
      console.log(`    Custo total: ${margin.totalCost ?? "—"}`);
      console.log(`    Fonte: ${input.costSource ?? "—"}`);
      if (effective?.status === "OK") {
        console.log(
          `    Tabela: ${effective.versionCode} rev.${effective.revision} vigência=${toCivilDateKey(effective.effectiveDate)}`
        );
      }
      console.log(`    Margem R$: ${margin.marginValue ?? "—"} · status ${margin.status}`);
      console.log(`    Linha: ${lineStatus}`);

      if (lineStatus === "BLOQUEANTE") {
        findings.push({
          area: "line",
          status: "BLOQUEANTE",
          message: `${order.orderCode}/${item.skuSnapshot}: fonte de custo inválida ou zero silencioso.`,
        });
      }
    }
  }

  const draftUsed = await prisma.productionCostTableVersion.count({
    where: { status: "DRAFT" },
  });
  if (draftUsed > 0) {
    console.log(`\nDRAFTs existentes (não usados na margem): ${draftUsed}`);
  }

  console.log("\n--- Achados ---");
  if (findings.length === 0) console.log("  OK");
  else for (const f of findings) console.log(`  [${f.status}] ${f.area}: ${f.message}`);

  const blocked = findings.some((f) => f.status === "BLOQUEANTE");
  const alert = findings.some((f) => f.status === "ALERTA");
  console.log(`\nStatus geral: ${blocked ? "BLOQUEANTE" : alert ? "ALERTA" : "OK"}`);

  await prisma.$disconnect();
  process.exit(blocked ? 2 : alert ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
