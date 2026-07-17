/**
 * SYNC-08 — Reconciliação histórica de Contas a Receber.
 *
 *   npm run reconcile:nomus:accounts-receivable -- preview --externalId=17748 --explain
 *   npm run reconcile:nomus:accounts-receivable -- apply --from=... --to=... --confirm-candidates
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusAccountsReceivableHistoricalReconcile } from "../src/lib/nomus/nomusSourceReconcile.server.ts";

const LOG_PREFIX = "[reconcile:nomus:accounts-receivable]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusAccountsReceivableHistoricalReconcile({
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
  process.argv[1]?.includes("nomusAccountsReceivableSourceReconcile") ||
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("nomusAccountsReceivableSourceReconcile.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
