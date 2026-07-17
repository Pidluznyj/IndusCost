/**
 * FIN-13 — Repair de agendas derivadas (entregas parciais).
 *
 * Preview:
 *   npm run repair:staged-delivery-schedules:preview -- --order="PD 02596"
 *
 * Apply (só OrderToCashAudit derivados):
 *   npm run repair:staged-delivery-schedules:apply -- --order="PD 02596"
 *
 * Cursor não executa apply em produção.
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  parseStagedDeliveryRepairCli,
  printStagedDeliveryRepairHelp,
  STAGED_DELIVERY_REPAIR_LOG,
} from "../src/lib/finance/stagedDeliveryScheduleRepair.js";
import { runStagedDeliveryScheduleRepair } from "../src/lib/finance/stagedDeliveryScheduleRepair.server.js";

async function main() {
  const cli = parseStagedDeliveryRepairCli(process.argv.slice(2));
  if (cli.help) {
    printStagedDeliveryRepairHelp();
    return;
  }

  const prisma = new PrismaClient();
  try {
    console.warn(`${STAGED_DELIVERY_REPAIR_LOG} mode=${cli.mode}`);
    const result = await runStagedDeliveryScheduleRepair({ prisma, cli });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.exitCode;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
