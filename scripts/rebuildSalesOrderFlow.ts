/**
 * OP-56 — Rebuild do Fluxo de Pedidos (snapshots/eventos derivados).
 *
 * Uso:
 *   npm run rebuild:sales-order-flow -- --preview
 *   npm run rebuild:sales-order-flow -- --apply --from=2026-01-01 --to=2026-12-31
 *   npm run rebuild:sales-order-flow -- --apply --order="PD 02596"
 *
 * Não chama Nomus. Não altera SalesOrder / OP / Documento / NF / CR.
 * Docs: docs/commercial/sales-order-flow/rebuild-runbook.md
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  formatSalesOrderFlowRebuildSummary,
  parseSalesOrderFlowRebuildCli,
  printSalesOrderFlowRebuildHelp,
} from "../src/lib/sales/salesOrderFlowRebuild.ts";
import { runSalesOrderFlowRebuild } from "../src/lib/sales/salesOrderFlowRebuild.server.ts";

const LOG = "[sales-order-flow-rebuild]";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let options;
  try {
    options = parseSalesOrderFlowRebuildCli(argv);
  } catch (error) {
    if (error instanceof Error && error.message === "HELP") {
      console.log(printSalesOrderFlowRebuildHelp());
      process.exit(0);
    }
    console.error(LOG, error instanceof Error ? error.message : String(error));
    console.error(printSalesOrderFlowRebuildHelp());
    process.exit(2);
  }

  console.log(LOG, "start", {
    mode: options.mode,
    orderCode: options.orderCode,
    from: options.fromDate?.toISOString().slice(0, 10) ?? null,
    to: options.toDate?.toISOString().slice(0, 10) ?? null,
    batchSize: options.batchSize,
    includeCompleted: options.includeCompleted,
    resumeFrom: options.resumeFrom,
    resumeFromCheckpoint: options.resumeFromCheckpoint,
  });

  const prisma = new PrismaClient();
  try {
    const summary = await runSalesOrderFlowRebuild(prisma, options);
    console.log(formatSalesOrderFlowRebuildSummary(summary));
    process.exit(summary.exitCode);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(LOG, "fatal", error);
  process.exit(1);
});
