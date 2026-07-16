/**
 * Sync incremental manual de Ordens de Produção Nomus (OP-09).
 *
 * Uso:
 *   npx tsx scripts/nomusProductionOrdersIncremental.ts preview
 *   npx tsx scripts/nomusProductionOrdersIncremental.ts apply --state-file=/tmp/op-incr.state.json
 *   npx tsx scripts/nomusProductionOrdersIncremental.ts apply --overlap-hours=72 --selector=dataHoraEdicao
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusProductionOrdersIncremental } from "../src/lib/nomusProductionOrdersIncremental.server.ts";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "../src/lib/nomusProductionOrdersPreview.ts";

const LOG_PREFIX = "[nomus-production-orders-incremental]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusProductionOrdersIncremental({
      prisma,
      argv: process.argv.slice(2),
    });
    if (summary.mode === "preview") {
      console.warn(`${LOG_PREFIX} ${PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER}`);
    }
    console.log(JSON.stringify({ ok: !summary.lockBlocked, ...summary }, null, 2));
    if (summary.lockBlocked) process.exitCode = 0;
    else if (summary.errors > 0 || (summary.exitCode != null && summary.exitCode !== 0)) {
      process.exitCode = summary.exitCode ?? 2;
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("nomusProductionOrdersIncremental") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusProductionOrdersIncremental.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
