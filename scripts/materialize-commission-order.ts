#!/usr/bin/env npx tsx
/**
 * Materializa snapshot de comissão para um pedido de venda.
 *
 * Uso:
 *   npx tsx scripts/materialize-commission-order.ts --sales-order-id=UUID --preview
 *   npx tsx scripts/materialize-commission-order.ts --sales-order-id=UUID --apply
 *   npx tsx scripts/materialize-commission-order.ts --sales-order-id=UUID --preview --json
 *
 * Sem --apply, não grava (modo preview).
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  materializeCommissionForSalesOrder,
  SalesOrderNotFoundError,
} from "../src/lib/commissions/commissionOrderMaterializer.server.ts";
import { fmtBrl, hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

function parseDryRun(): boolean {
  if (hasFlag("apply")) return false;
  if (hasFlag("preview") || hasFlag("dry-run")) return true;
  return true;
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const salesOrderId = parseArg("sales-order-id");
  if (!salesOrderId?.trim()) {
    throw new Error("Informe --sales-order-id=<uuid do pedido>.");
  }

  const dryRun = parseDryRun();
  const json = hasFlag("json");

  if (hasFlag("apply") && (hasFlag("preview") || hasFlag("dry-run"))) {
    throw new Error("Use apenas um modo: --preview/--dry-run ou --apply.");
  }

  const result = await materializeCommissionForSalesOrder(prisma, {
    salesOrderId: salesOrderId.trim(),
    dryRun,
  });

  if (json) {
    console.log(
      JSON.stringify(
        {
          action: result.action,
          snapshotId: result.snapshotId,
          previousSnapshotId: result.previousSnapshotId,
          sourceHash: result.sourceHash,
          dryRun: result.dryRun,
          preview: result.preview,
        },
        null,
        2
      )
    );
    return;
  }

  console.log("=== Materialização de comissão (pedido) ===");
  console.log(`Pedido: ${salesOrderId}`);
  console.log(`Modo: ${dryRun ? "preview (sem gravação)" : "apply (grava no banco)"}`);
  console.log(`Ação: ${result.action}`);
  console.log(`sourceHash: ${result.sourceHash}`);
  if (result.snapshotId) console.log(`Snapshot: ${result.snapshotId}`);
  if (result.previousSnapshotId) {
    console.log(`Snapshot anterior: ${result.previousSnapshotId} (SUPERSEDED)`);
  }

  console.log("\n--- Totais ---");
  console.log(`Vendido: ${fmtBrl(result.preview.totalSoldAmount)}`);
  console.log(`Comissão bruta: ${fmtBrl(result.preview.totalGrossCommissionAmount)}`);
  console.log(`Comissão final: ${fmtBrl(result.preview.totalFinalCommissionAmount)}`);

  if (result.preview.items.length > 0) {
    console.log("\n--- Itens ---");
    for (const item of result.preview.items) {
      console.log(
        `  • ${item.productNameSnapshot} | ${item.status} | bruta=${fmtBrl(item.grossCommissionAmount)} | final=${fmtBrl(item.finalCommissionAmount)}${item.exclusionReason ? ` | ${item.exclusionReason}` : ""}`
      );
    }
  }
}

main().catch((error) => {
  if (error instanceof SalesOrderNotFoundError) {
    console.error(error.message);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
