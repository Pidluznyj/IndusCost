import "dotenv/config";
import {
  applySalesOrderNfeLinkBackfill,
  planSalesOrderNfeLinkBackfill,
  type SalesOrderNfeLinkBackfillPlan,
} from "../src/lib/salesOrderNfeLink.ts";

function fmtMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

function printSummary(
  mode: "dry-run" | "apply",
  plan: SalesOrderNfeLinkBackfillPlan,
  timings: { planMs: number; totalMs: number }
): void {
  console.log("=== Backfill SalesOrderNfeLink ===");
  console.log(`Modo: ${mode}`);
  console.log(`Pedidos analisados: ${plan.ordersAnalyzed}`);
  console.log(`Pedidos com NF-e no payload: ${plan.ordersWithNfes}`);
  console.log(`Pedidos sem NF-e no payload: ${plan.ordersWithoutNfes}`);
  console.log(`NF-es extraídas: ${plan.totalNfesFound}`);
  console.log(`NF-es únicas (externalId): ${plan.uniqueNfes}`);
  console.log(`Vínculos existentes: ${plan.existingLinks}`);
  console.log(`Vínculos a criar: ${plan.toCreate.length}`);
  console.log(`Vínculos a atualizar: ${plan.toUpdate.length}`);
  console.log(`Vínculos sem alteração: ${plan.unchanged}`);
  console.log(`Vínculos a marcar ausentes: ${plan.absentLinkIds.length}`);
  console.log(`NF-es com match em NomusNfe: ${plan.matchedNomusNfe}`);
  console.log(`NF-es sem match em NomusNfe: ${plan.unmatchedNomusNfe}`);
  console.log(`Pedidos com múltiplas NF-es: ${plan.ordersWithMultipleNfes}`);
  console.log(`Tempo de planejamento: ${fmtMs(timings.planMs)}`);
  console.log(`Tempo total: ${fmtMs(timings.totalMs)}`);

  if (plan.examples.multiNfe.length > 0) {
    console.log("\nExemplos — múltiplas NF-es (até 10):");
    for (const row of plan.examples.multiNfe) {
      console.log(`  ${row.orderCode}: ${row.nfeCount} NF-es [${row.nfeIds.join(", ")}]`);
    }
  }
  if (plan.examples.unmatched.length > 0) {
    console.log("\nExemplos — NF-es sem match em NomusNfe (até 10):");
    for (const row of plan.examples.unmatched) {
      console.log(`  ${row.orderCode} → nfe.id=${row.nfeExternalId} numero=${row.nfeNumber ?? "—"}`);
    }
  }
  if (plan.examples.create.length > 0) {
    console.log("\nExemplos — vínculos planejados para criar (até 10):");
    for (const row of plan.examples.create) {
      console.log(`  ${row.orderCode} → nfe.id=${row.nfeExternalId} numero=${row.nfeNumber ?? "—"}`);
    }
  }
  if (plan.examples.update.length > 0) {
    console.log("\nExemplos — vínculos planejados para atualizar (até 10):");
    for (const row of plan.examples.update) {
      console.log(`  ${row.orderCode} → nfe.id=${row.nfeExternalId} numero=${row.nfeNumber ?? "—"}`);
    }
  }
}

async function main(): Promise<void> {
  // `--apply` executa a gravação; qualquer outro caso (inclusive `--dry-run`)
  // apenas planeja e exibe o resumo, sem alterar dados.
  const isApply = process.argv.includes("--apply");
  const mode: "dry-run" | "apply" = isApply ? "apply" : "dry-run";

  const startedAt = Date.now();
  const planStart = Date.now();
  const plan = await planSalesOrderNfeLinkBackfill();
  const planMs = Date.now() - planStart;

  printSummary(mode, plan, { planMs, totalMs: Date.now() - startedAt });

  if (mode === "dry-run") {
    console.log("\nNenhum dado alterado (dry-run).");
    return;
  }

  console.log("\n=== Aplicando backfill (somente SalesOrderNfeLink) ===");
  const applyStart = Date.now();
  const result = await applySalesOrderNfeLinkBackfill(undefined, { plan });
  const applyMs = Date.now() - applyStart;

  console.log(`Pedidos processados: ${result.ordersProcessed}`);
  console.log(`Links criados: ${result.created}`);
  console.log(`Links atualizados: ${result.updated}`);
  console.log(`Links sem alteração: ${result.unchanged}`);
  console.log(`Links marcados ausentes do payload: ${result.markedAbsent}`);
  console.log(`Tempo de aplicação: ${fmtMs(applyMs)}`);
  console.log(`Tempo total: ${fmtMs(Date.now() - startedAt)}`);
}

main().catch((error) => {
  console.error("[backfill-sales-order-nfe-links]", error);
  process.exitCode = 1;
});
