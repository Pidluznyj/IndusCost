/**
 * Backfill manual de Ordens de Produção Nomus `/rest/ordens` (OP-08).
 *
 * NÃO entra em cron nem no orquestrador. Execução explícita apenas.
 *
 * Uso:
 *   npx tsx scripts/nomusProductionOrdersBackfill.ts preview
 *   npx tsx scripts/nomusProductionOrdersBackfill.ts apply --cursor-file=/tmp/op-backfill.cursor
 *   npx tsx scripts/nomusProductionOrdersBackfill.ts apply --reprocess=10 --max-pages=5
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusProductionOrdersBackfill } from "../src/lib/nomusProductionOrdersBackfill.server.ts";
import { PRODUCTION_ORDERS_PREVIEW_DRY_RUN_BANNER } from "../src/lib/nomusProductionOrdersPreview.ts";

const LOG_PREFIX = "[nomus-production-orders-backfill]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const abort = new AbortController();
  const onSignal = () => {
    console.warn(`${LOG_PREFIX} sinal recebido — interrupção segura entre páginas.`);
    abort.abort();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const summary = await runNomusProductionOrdersBackfill({
      prisma,
      argv: process.argv.slice(2),
      signal: abort.signal,
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
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("nomusProductionOrdersBackfill") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusProductionOrdersBackfill.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
