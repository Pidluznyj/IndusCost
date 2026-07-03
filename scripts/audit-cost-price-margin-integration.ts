#!/usr/bin/env npx tsx
/**
 * Auditoria integrada: matéria-prima → custo produção → preço → margem.
 *
 * Uso:
 *   npx tsx scripts/audit-cost-price-margin-integration.ts --year=2026 --month=7
 *   npx tsx scripts/audit-cost-price-margin-integration.ts --year=2026 --seller=João --top=20 --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { hasFlag, parseArg, parseYearPeriod, requireDatabaseUrl } from "./commission-audit-args.ts";
import { buildCostPriceMarginIntegratedAudit } from "../src/lib/costPriceMarginIntegratedAudit.server.ts";
import type { CostPriceMarginAuditPayload } from "../src/lib/costPriceMarginIntegratedAudit.ts";

function pct(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(2)}%`;
}

function printHumanReport(payload: CostPriceMarginAuditPayload): void {
  console.log("=== Auditoria integrada — Custo, Preço e Margem ===\n");
  console.log(`Período: ${payload.period.label} (${payload.period.from} a ${payload.period.to})`);
  console.log(`Referência de cobertura (catálogo): ${payload.referenceDate}`);
  if (payload.filters.seller) console.log(`Vendedor: ${payload.filters.seller}`);
  if (payload.filters.customer) console.log(`Cliente: ${payload.filters.customer}`);
  if (payload.filters.sku) console.log(`SKU: ${payload.filters.sku}`);
  console.log("");

  console.log("--- Matéria-prima (ACTIVE) ---");
  console.log(`Total: ${payload.materials.total}`);
  console.log(`Com MP publicada: ${payload.materials.withCoverage}`);
  console.log(`Sem custo publicado: ${payload.materials.withoutCoverage}`);
  console.log(`Cobertura: ${pct(payload.materials.coveragePercent)}`);

  console.log("\n--- Custo de produção publicado ---");
  console.log(
    `Produtos ACTIVE: ${payload.products.activeProducts.withCoverage}/${payload.products.activeProducts.total} (${pct(payload.products.activeProducts.coveragePercent)})`
  );
  console.log(
    `Componentes ACTIVE: ${payload.products.activeComponents.withCoverage}/${payload.products.activeComponents.total} (${pct(payload.products.activeComponents.coveragePercent)})`
  );

  console.log("\n--- Preço oficial (tabelas ACTIVE) ---");
  console.log(`Tabelas verificadas: ${payload.officialPrice.priceTablesChecked}`);
  console.log(
    `Produtos com preço: ${payload.officialPrice.productsWithOfficialPrice}/${payload.officialPrice.activeProductsTotal}`
  );
  console.log(
    `Componentes com preço: ${payload.officialPrice.componentsWithOfficialPrice}/${payload.officialPrice.activeComponentsTotal}`
  );

  console.log("\n--- Pedidos vendidos no período ---");
  console.log(`Pedidos: ${payload.salesOrders.ordersTotal}`);
  console.log(`Itens vendidos: ${payload.salesOrders.itemsSold}`);
  console.log(`Margem OK: ${payload.salesOrders.marginOk}`);
  console.log(`SEM_CUSTO: ${payload.salesOrders.semCusto}`);
  console.log(`SEM_PRECO_TABELA: ${payload.salesOrders.semPrecoTabela}`);
  console.log(`PRECO_INDISPONIVEL: ${payload.salesOrders.precoIndisponivel}`);
  console.log(`Outros problemas de margem: ${payload.salesOrders.otherMarginIssues}`);

  if (payload.topSoldWithoutCost.length > 0) {
    console.log("\n--- Top itens vendidos SEM_CUSTO ---");
    for (const row of payload.topSoldWithoutCost) {
      console.log(
        `  ${row.sku} (${row.productType}) — receita R$ ${row.revenueSold.toFixed(2)} | qtd ${row.quantitySold} | pedidos ${row.orderCount}`
      );
    }
  }

  if (payload.topSoldWithoutOfficialPrice.length > 0) {
    console.log("\n--- Top itens vendidos sem preço oficial ---");
    for (const row of payload.topSoldWithoutOfficialPrice) {
      console.log(
        `  ${row.sku} (${row.productType}) [${row.reason}] — receita R$ ${row.revenueSold.toFixed(2)} | qtd ${row.quantitySold}`
      );
    }
  }

  if (payload.versionsUsedInPeriod.length > 0) {
    console.log("\n--- Versões vigentes usadas no período (margem) ---");
    for (const row of payload.versionsUsedInPeriod.slice(0, 15)) {
      const rev =
        row.layer === "PRICE"
          ? `v${row.versionNumber ?? "?"}`
          : `rev.${row.revision ?? "?"}`;
      console.log(
        `  ${row.layer} ${row.code} ${rev} (${row.effectiveDate ?? "?"}) — ${row.usageCount} uso(s)`
      );
    }
  }

  console.log(`\nPendências críticas (indicador): ${payload.criticalPendingCount}`);
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const { from, to, label } = parseYearPeriod();
  const seller = parseArg("seller");
  const customer = parseArg("customer");
  const sku = parseArg("sku");
  const topRaw = parseArg("top");
  const top = topRaw ? Number(topRaw) : 10;
  if (topRaw && (!Number.isFinite(top) || top < 1)) {
    throw new Error("--top inválido (>= 1).");
  }

  await prisma.$connect();

  const payload = await buildCostPriceMarginIntegratedAudit(prisma, {
    from,
    to,
    label,
    seller,
    customer,
    sku,
    top,
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport(payload);
    console.log("\n--- JSON ---");
    console.log(JSON.stringify(payload, null, 2));
  }

  if (payload.criticalPendingCount > 0) {
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
