#!/usr/bin/env npx tsx
/**
 * Rebuild seguro de materialização de comissão (snapshot de venda + schedule de CR).
 * Não fecha comissão — não altera fechamentos CLOSED.
 *
 * Preview (padrão — sem gravação):
 *   npx tsx scripts/rebuild-commission-materialization.ts --year=2026 --month=6 --preview
 *   npx tsx scripts/rebuild-commission-materialization.ts --since=2026-06-01 --preview --json
 *
 * Apply (exige confirmação):
 *   npx tsx scripts/rebuild-commission-materialization.ts --year=2026 --month=6 --apply --confirm="REBUILD COMMISSION"
 *
 * Filtros opcionais: --seller, --customer, --limit
 * Saída: --json, --csv
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildMaterializationRebuildCsv,
  COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION,
  parseMaterializationLimit,
  parseMaterializationSince,
  parseMaterializationIdList,
  parseMaterializationNumericIdList,
  parseMaterializationYearMonth,
  resolveMaterializationDryRun,
  validateMaterializationRebuildApply,
} from "../src/lib/commissions/commissionMaterializationOrchestrator.ts";
import { rebuildCommissionMaterializationForAffectedSales } from "../src/lib/commissions/commissionMaterializationOrchestrator.server.ts";
import { hasFlag, parseArg, requireDatabaseUrl } from "./commission-script-utils.ts";

function printHumanSummary(
  summary: Awaited<ReturnType<typeof rebuildCommissionMaterializationForAffectedSales>>
): void {
  console.log("=== Rebuild materialização de comissão ===");
  console.log(`Modo: ${summary.dryRun ? "preview (sem gravação)" : "apply (grava no banco)"}`);
  if (summary.year != null && summary.month != null) {
    console.log(`Período recebimento: ${String(summary.month).padStart(2, "0")}/${summary.year}`);
  }
  if (summary.since) console.log(`Since: ${summary.since}`);
  if (summary.sellerFilter) console.log(`Vendedor: ${summary.sellerFilter}`);
  if (summary.customerFilter) console.log(`Cliente: ${summary.customerFilter}`);
  if (summary.limit != null) console.log(`Limit: ${summary.limit}`);

  console.log("\n--- Resumo ---");
  console.log(`Pedidos avaliados: ${summary.ordersEvaluated}`);
  console.log(`Pedidos com alteração: ${summary.ordersChanged}`);
  console.log(`Snapshots criados: ${summary.snapshotsCreated}`);
  console.log(`Snapshots atualizados: ${summary.snapshotsUpdated}`);
  console.log(`Snapshots sem alteração: ${summary.snapshotsUnchanged}`);
  console.log(`Schedules criados: ${summary.schedulesCreated}`);
  console.log(`Schedules stale: ${summary.schedulesStaled}`);
  console.log(`Schedules atualizados: ${summary.schedulesUpdated}`);
  console.log(`Títulos sem vínculo: ${summary.receivablesWithoutLink}`);
  if (summary.receiptMonthReceivablesChecked != null) {
    console.log("\n--- Recebimentos do mês (passagem por título) ---");
    console.log(`Títulos comerciais no mês: ${summary.receiptMonthReceivablesChecked}`);
    console.log(
      `Sem schedule antes da passagem: ${summary.receiptMonthReceivablesMissingBefore ?? 0}`
    );
    console.log(`Schedules garantidos na passagem: ${summary.receiptMonthSchedulesEnsured ?? 0}`);
    console.log(
      `Títulos sem vínculo pedido/NF: ${summary.receiptMonthUnlinkedReceivables ?? 0}`
    );
  }
  console.log(`Clientes excluídos: ${summary.excludedCustomers}`);
  console.log(`Vendedores sem resolução: ${summary.unresolvedSellers}`);
  console.log(`Erros: ${summary.errors.length}`);

  console.log("\n--- Antes / depois (artefatos ACTIVE) ---");
  console.log(
    `Snapshots ACTIVE: ${summary.baseline.activeSnapshots} → ${summary.after.activeSnapshots}`
  );
  console.log(
    `Schedules ACTIVE: ${summary.baseline.activeSchedules} → ${summary.after.activeSchedules}`
  );

  if (summary.closedClosingsPreserved.length > 0) {
    console.log("\n--- Fechamentos CLOSED preservados (não alterados) ---");
    for (const closing of summary.closedClosingsPreserved) {
      console.log(
        `  • ${String(closing.month).padStart(2, "0")}/${closing.year} id=${closing.closingId}`
      );
    }
  }

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
        `  • ${order.salesOrderId} | ${order.sources.join(",")} | changed=${order.changed ? "yes" : "no"} | snapshot=${order.snapshotAction} | schedule=${order.scheduleAction}${order.error ? ` | ERRO: ${order.error}` : ""}`
      );
    }
  }
}

async function main(): Promise<void> {
  requireDatabaseUrl();

  const apply = hasFlag("apply");
  const preview = hasFlag("preview") || hasFlag("dry-run") || !apply;
  const dryRun = resolveMaterializationDryRun({ preview, apply });
  const confirm = parseArg("confirm");

  const applyValidation = validateMaterializationRebuildApply({ apply, confirm });
  if (!applyValidation.ok) {
    throw new Error(applyValidation.reason);
  }

  const period = parseMaterializationYearMonth({
    year: parseArg("year"),
    month: parseArg("month"),
  });
  const since = parseMaterializationSince(parseArg("since"));
  const salesOrderIds = parseMaterializationIdList(parseArg("sales-order-id"));
  const nfeIds = parseMaterializationNumericIdList(parseArg("nfe-id"));
  const receivableIds = parseMaterializationNumericIdList(parseArg("receivable-id"));
  const seller = parseArg("seller") ?? null;
  const customer = parseArg("customer") ?? null;
  const limit = parseMaterializationLimit(parseArg("limit"));

  if (
    !since &&
    !period &&
    salesOrderIds.length === 0 &&
    nfeIds.length === 0 &&
    receivableIds.length === 0
  ) {
    throw new Error(
      "Informe ao menos um filtro: --year + --month, --since, --sales-order-id, --nfe-id ou --receivable-id."
    );
  }

  const summary = await rebuildCommissionMaterializationForAffectedSales(prisma, {
    since,
    year: period?.year,
    month: period?.month,
    seller,
    customer,
    limit,
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
    console.log(buildMaterializationRebuildCsv(summary));
    return;
  }

  printHumanSummary(summary);

  if (dryRun) {
    console.log(
      `\nPreview concluído. Para aplicar: adicione --apply --confirm="${COMMISSION_MATERIALIZATION_REBUILD_CONFIRMATION}".`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
