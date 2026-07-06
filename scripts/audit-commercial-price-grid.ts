#!/usr/bin/env npx tsx
/**
 * Auditoria read-only: valida que o grid de preços comerciais publicados
 * reflete exatamente os itens congelados em PriceTableItem (sem recálculo).
 *
 * Uso:
 *   npx tsx scripts/audit-commercial-price-grid.ts
 *   npx tsx scripts/audit-commercial-price-grid.ts --sku=309.01AA
 *   npx tsx scripts/audit-commercial-price-grid.ts --search=alpha --json
 *   npx tsx scripts/audit-commercial-price-grid.ts --product-id=<uuid> --csv
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildCommercialPublishedPriceGridAudit,
  buildCommercialPublishedPriceGridCsv,
} from "../src/lib/pricing/commercialPublishedPriceGridAudit.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-audit-args.ts";

function printHumanReport(
  result: Awaited<ReturnType<typeof buildCommercialPublishedPriceGridAudit>>
): void {
  console.log("=== Auditoria — Grid de preços comerciais publicados ===\n");
  console.log(`Data de referência: ${result.referenceDate}`);
  console.log(`Status: ${result.status}`);
  console.log(`Produtos no grid: ${result.productCount}`);
  console.log("");

  console.log("--- Tabelas comerciais vigentes ---");
  if (result.tables.length === 0) {
    console.log("  (nenhuma tabela com versão publicada vigente)");
  } else {
    for (const table of result.tables) {
      console.log(
        `  ${table.tableCode} — ${table.tableName} | v${table.versionNumber} (${table.versionId}) | publicado ${table.publishedAt ?? "—"}`
      );
    }
  }

  console.log("\n--- Versões publicadas usadas ---");
  for (const entry of result.pricedCountByTable) {
    console.log(
      `  ${entry.tableCode}: v${entry.versionNumber} (${entry.versionId}) — ${entry.pricedProducts}/${entry.totalProducts} produtos com preço`
    );
  }

  console.log("\n--- Produtos sem preço em alguma tabela ---");
  if (result.partialProducts.length === 0) {
    console.log("  (nenhum — todos os produtos do grid têm preço em todas as colunas)");
  } else {
    const preview = result.partialProducts.slice(0, 20);
    for (const row of preview) {
      console.log(
        `  ${row.sku} [${row.status}] — sem preço em: ${row.missingTableCodes.join(", ") || "—"}`
      );
    }
    if (result.partialProducts.length > preview.length) {
      console.log(`  ... +${result.partialProducts.length - preview.length} produto(s)`);
    }
  }

  console.log("\n--- Divergências grid vs item publicado ---");
  if (result.mismatches.length === 0) {
    console.log("  (nenhuma — grid alinhado com PriceTableItem congelado)");
  } else {
    for (const mismatch of result.mismatches.slice(0, 30)) {
      console.log(
        `  ${mismatch.sku} @ ${mismatch.tableCode} — ${mismatch.field}: grid=${mismatch.gridValue ?? "—"} | publicado=${mismatch.publishedValue ?? "—"}`
      );
    }
    if (result.mismatches.length > 30) {
      console.log(`  ... +${result.mismatches.length - 30} divergência(s)`);
    }
  }

  console.log("\n--- Top produtos por preço (maior salePrice no grid) ---");
  for (const row of result.topProductsByPrice.slice(0, 10)) {
    console.log(
      `  ${row.sku} — ${row.productName} | R$ ${row.maxSalePrice.toFixed(2)} (${row.tableCode})`
    );
  }

  console.log(`\nResultado final: ${result.status}`);
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const search = parseArg("search");
  const sku = parseArg("sku");
  const productId = parseArg("product-id");

  await prisma.$connect();

  const result = await buildCommercialPublishedPriceGridAudit(prisma, {
    search,
    sku,
    productId,
  });

  if (hasFlag("json")) {
    const { gridSnapshot: _grid, ...payload } = result;
    console.log(JSON.stringify(payload, null, 2));
  } else if (hasFlag("csv")) {
    const csv = buildCommercialPublishedPriceGridCsv(result.gridSnapshot);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outputPath = join(process.cwd(), "tmp", `commercial-published-price-grid-${stamp}.csv`);
    writeFileSync(outputPath, csv, "utf8");
    console.log(`CSV exportado: ${outputPath} (${result.gridSnapshot.rows.length} linha(s))`);
    console.log(`Status da auditoria: ${result.status}`);
  } else {
    printHumanReport(result);
  }

  await prisma.$disconnect();
  if (result.status === "FAIL") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
