import "dotenv/config";
import {
  applySalesOrderNfeLinkBackfill,
  previewSalesOrderNfeLinkBackfill,
} from "../src/lib/salesOrderNfeLink.ts";

function printPreview(preview: Awaited<ReturnType<typeof previewSalesOrderNfeLinkBackfill>>): void {
  console.log("=== Backfill SalesOrderNfeLink — dry-run ===");
  console.log(`Pedidos analisados: ${preview.ordersAnalyzed}`);
  console.log(`Pedidos com nfes no payload: ${preview.ordersWithNfes}`);
  console.log(`Pedidos sem nfes no payload: ${preview.ordersWithoutNfes}`);
  console.log(`Total de NF-es encontradas: ${preview.totalNfesFound}`);
  console.log(`Vínculos existentes: ${preview.existingLinks}`);
  console.log(`Vínculos a criar: ${preview.linksToCreate}`);
  console.log(`Vínculos a atualizar: ${preview.linksToUpdate}`);
  console.log(`NF-es com match em NomusNfe: ${preview.matchedNomusNfe}`);
  console.log(`NF-es sem match em NomusNfe: ${preview.unmatchedNomusNfe}`);
  console.log(`Pedidos com múltiplas NF-es: ${preview.ordersWithMultipleNfes}`);
  console.log("\nExemplos — múltiplas NF-es:");
  for (const row of preview.examples.multiNfe) {
    console.log(`  ${row.orderCode}: ${row.nfeCount} NF-es [${row.nfeIds.join(", ")}]`);
  }
  console.log("\nExemplos — criar:");
  for (const row of preview.examples.create) {
    console.log(`  ${row.orderCode} → nfe.id=${row.nfeExternalId} numero=${row.nfeNumber ?? "—"}`);
  }
  console.log("\nExemplos — atualizar:");
  for (const row of preview.examples.update) {
    console.log(`  ${row.orderCode} → nfe.id=${row.nfeExternalId} numero=${row.nfeNumber ?? "—"}`);
  }
}

async function main(): Promise<void> {
  const isApply = process.argv.includes("--apply");
  const isDryRun = process.argv.includes("--dry-run") || !isApply;

  if (isDryRun) {
    const preview = await previewSalesOrderNfeLinkBackfill();
    printPreview(preview);
    console.log("\nNenhum dado alterado (dry-run).");
    return;
  }

  const preview = await previewSalesOrderNfeLinkBackfill();
  printPreview(preview);
  console.log("\n=== Aplicando backfill ===");
  const result = await applySalesOrderNfeLinkBackfill();
  console.log(`Pedidos processados: ${result.ordersProcessed}`);
  console.log(`Links criados: ${result.created}`);
  console.log(`Links atualizados: ${result.updated}`);
  console.log(`Links marcados ausentes do payload: ${result.markedAbsent}`);
}

main().catch((error) => {
  console.error("[backfill-sales-order-nfe-links]", error);
  process.exitCode = 1;
});
