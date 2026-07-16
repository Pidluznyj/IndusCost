/**
 * Consulta pontual / reconciliação operacional de Ordens de Produção Nomus (OP-10).
 *
 * Uso:
 *   npx tsx scripts/nomusProductionOrdersLookup.ts preview --name="OP 05800 - 003"
 *   npx tsx scripts/nomusProductionOrdersLookup.ts apply --external-id=30347
 *   npx tsx scripts/nomusProductionOrdersLookup.ts apply --sales-order-external-id=2530
 *   npx tsx scripts/nomusProductionOrdersLookup.ts apply --sales-order-item-external-id=11324
 *   npx tsx scripts/nomusProductionOrdersLookup.ts apply --reconcile-unresolved
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusProductionOrdersLookup } from "../src/lib/nomusProductionOrdersLookup.server.ts";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "../src/lib/nomusProductionOrdersPreview.ts";

const LOG_PREFIX = "[nomus-production-orders-lookup]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusProductionOrdersLookup({
      prisma,
      argv: process.argv.slice(2),
    });
    if (summary.mode === "preview") {
      console.warn(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
    }
    console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
    if (summary.errors > 0) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("nomusProductionOrdersLookup") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusProductionOrdersLookup.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
