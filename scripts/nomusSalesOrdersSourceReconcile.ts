/**
 * SYNC-08 — Reconciliação histórica de Pedidos.
 *
 *   npm run reconcile:nomus:sales-orders -- preview --from=2026-07-01 --to=2026-07-31 --orderCode="PD 02739"
 *   npm run reconcile:nomus:sales-orders -- apply --from=... --to=... --confirm-candidates
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusSalesOrdersHistoricalReconcile } from "../src/lib/nomus/nomusSourceReconcile.server.ts";

const LOG_PREFIX = "[reconcile:nomus:sales-orders]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusSalesOrdersHistoricalReconcile({
      prisma,
      argv: process.argv.slice(2),
    });
    console.log(JSON.stringify(summary, null, 2));
    if (summary.lockBlocked) process.exitCode = 0;
    else if (summary.ok === false) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("nomusSalesOrdersSourceReconcile") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusSalesOrdersSourceReconcile.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
