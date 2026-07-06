#!/usr/bin/env npx tsx
/**
 * Rebuild de materialização de comissão para pedidos afetados (snapshot + schedule CR).
 *
 * Uso:
 *   npx tsx scripts/rebuild-commission-materialization.ts --since=2026-06-01 --preview
 *   npx tsx scripts/rebuild-commission-materialization.ts --sales-order-id=UUID --apply
 *   npx tsx scripts/rebuild-commission-materialization.ts --nfe-id=12345 --receivable-id=999 --preview --json
 *   npx tsx scripts/rebuild-commission-materialization.ts --since=2026-06-01 --apply --csv
 *
 * Sem --apply, não grava (preview).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  parseMaterializationIdList,
  parseMaterializationNumericIdList,
  parseMaterializationSince,
  resolveMaterializationDryRun,
} from "../src/lib/commissions/commissionMaterializationOrchestrator.ts";
import { rebuildCommissionMaterializationForAffectedSales } from "../src/lib/commissions/commissionMaterializationOrchestrator.server.ts";
import {
  csvLine,
  hasFlag,
  parseArg,
  requireDatabaseUrl,
} from "./commission-script-utils.ts";

function buildCsvOutput(
  summary: Awaited<ReturnType<typeof rebuildCommissionMaterializationForAffectedSales>>
): string {
  const lines = [
    csvLine([
      "salesOrderId",
      "sources",
      "snapshotAction",
      "scheduleAction",
      "snapshotId",
      "schedulesCreated",
      "schedulesStaled",
      "error",
    ]),
  ];

  for (const order of summary.orders) {
    lines.push(
      csvLine([
        order.salesOrderId,
        order.sources.join("|"),
        order.snapshotAction,
        order.scheduleAction,
        order.snapshotId ?? "",
        order.schedulesCreated,
        order.schedulesStaled,
        order.error ?? "",
      ])
    );
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const since = parseMaterializationSince(parseArg("since"));
  const salesOrderIds = parseMaterializationIdList(parseArg("sales-order-id"));
  const nfeIds = parseMaterializationNumericIdList(parseArg("nfe-id"));
  const receivableIds = parseMaterializationNumericIdList(parseArg("receivable-id"));
  const dryRun = resolveMaterializationDryRun({
    preview: hasFlag("preview") || hasFlag("dry-run"),
    apply: hasFlag("apply"),
  });

  if (!since && salesOrderIds.length === 0 && nfeIds.length === 0 && receivableIds.length === 0) {
    throw new Error(
      "Informe ao menos um filtro: --since, --sales-order-id, --nfe-id ou --receivable-id."
    );
  }

  const summary = await rebuildCommissionMaterializationForAffectedSales(prisma, {
    since,
    salesOrderIds: salesOrderIds.length > 0 ? salesOrderIds : undefined,
    nfeIds: nfeIds.length > 0 ? nfeIds : undefined,
    receivableIds: receivableIds.length > 0 ? receivableIds : undefined,
    preview: dryRun,
    apply: !dryRun,
  });

  if (hasFlag("json")) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (hasFlag("csv")) {
    console.log(buildCsvOutput(summary));
    return;
  }

  console.log("=== Rebuild materialização de comissão ===");
  console.log(`Modo: ${summary.dryRun ? "preview (sem gravação)" : "apply (grava no banco)"}`);
  if (summary.since) console.log(`Since: ${summary.since}`);
  console.log(`Pedidos processados: ${summary.ordersProcessed}`);
  console.log(`Snapshots criados: ${summary.snapshotsCreated}`);
  console.log(`Snapshots sem alteração: ${summary.snapshotsUnchanged}`);
  console.log(`Snapshots superseded: ${summary.snapshotsSuperseded}`);
  console.log(`Schedules criados: ${summary.schedulesCreated}`);
  console.log(`Schedules atualizados: ${summary.schedulesUpdated}`);
  console.log(`Schedules stale: ${summary.schedulesStaled}`);
  console.log(`Schedules sem alteração: ${summary.schedulesUnchanged}`);

  if (summary.errors.length > 0) {
    console.log("\n--- Erros ---");
    for (const error of summary.errors) {
      console.log(`  • ${error.salesOrderId}: ${error.message}`);
    }
  }

  if (summary.orders.length > 0) {
    console.log("\n--- Pedidos ---");
    for (const order of summary.orders) {
      console.log(
        `  • ${order.salesOrderId} | ${order.sources.join(",")} | snapshot=${order.snapshotAction} | schedule=${order.scheduleAction}${order.error ? ` | ERRO: ${order.error}` : ""}`
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
