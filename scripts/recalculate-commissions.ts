#!/usr/bin/env npx tsx
/**
 * Recalcula comissões para um período.
 *
 * Uso:
 *   npx tsx scripts/recalculate-commissions.ts --year=2026 --dry-run
 *   npx tsx scripts/recalculate-commissions.ts --year=2026 --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { calculateCommissions } from "../src/lib/commissions/commission-calculation-service.server.ts";
import { loadCommissionOrderSources } from "../src/lib/commissions/commission-source-resolver.server.ts";
import { hasFlag, parseYearPeriod, requireDatabaseUrl } from "./commission-audit-args.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const range = parseYearPeriod();
  const dryRun = hasFlag("dry-run");
  const apply = hasFlag("apply");

  if (!dryRun && !apply) {
    throw new Error("Informe --dry-run (preview) ou --apply (executa recálculo).");
  }
  if (dryRun && apply) {
    throw new Error("Use apenas um modo: --dry-run ou --apply.");
  }

  console.log("=== Recálculo de comissões ===");
  console.log(`Período: ${range.label}`);
  console.log(`Modo: ${dryRun ? "dry-run (sem alterações)" : "apply (grava no banco)"}\n`);

  const periodInput = {
    from: range.from,
    to: range.to,
    year: range.from.getFullYear(),
  };

  const orders = await loadCommissionOrderSources(prisma, periodInput);
  const activeOrders = orders.filter((o) => o.status !== "CANCELLED");

  const [existingRecords, forecastRecords, confirmedRecords, openAuditIssues] =
    await Promise.all([
      prisma.commissionRecord.count({
        where: { calculatedAt: { gte: range.from, lte: range.to } },
      }),
      prisma.commissionRecord.count({
        where: {
          calculatedAt: { gte: range.from, lte: range.to },
          status: { in: ["FORECAST_FROM_ORDER", "WAITING_NFE"] },
        },
      }),
      prisma.commissionRecord.count({
        where: {
          calculatedAt: { gte: range.from, lte: range.to },
          originStage: "OUTPUT_DOCUMENT",
        },
      }),
      prisma.commissionAuditIssue.count({ where: { resolved: false } }),
    ]);

  const itemCount = activeOrders.reduce((sum, order) => sum + order.items.length, 0);

  console.log("--- Preview ---");
  console.log(`Pedidos no período: ${orders.length} (${activeOrders.length} ativos)`);
  console.log(`Itens de pedido (ativos): ${itemCount}`);
  console.log(`CommissionRecord existentes no período: ${existingRecords}`);
  console.log(`  Previstas: ${forecastRecords}`);
  console.log(`  Confirmadas (OUTPUT_DOCUMENT): ${confirmedRecords}`);
  console.log(`Issues de auditoria abertas (global): ${openAuditIssues}`);

  if (dryRun) {
    console.log("\nDry-run concluído. Nenhuma alteração foi feita.");
    return;
  }

  console.log("\nExecutando recálculo...");
  const { runId, summary } = await calculateCommissions(prisma, {
    from: range.from,
    to: range.to,
    mode: "FULL",
  });

  console.log("\n--- Resultado ---");
  console.log(`Run ID: ${runId}`);
  console.log(JSON.stringify(summary, null, 2));
  console.log("\nRecálculo concluído.");
}

main()
  .catch((err) => {
    console.error("Erro no recálculo:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
