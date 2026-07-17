/**
 * SYNC-08 — Reconciliação histórica de Contas a Pagar.
 *
 *   npm run reconcile:nomus:accounts-payable -- preview --explain --json
 *   npm run reconcile:nomus:accounts-payable -- apply --batch-size=100
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusAccountsPayableHistoricalReconcile } from "../src/lib/nomus/nomusSourceReconcile.server.ts";

const LOG_PREFIX = "[reconcile:nomus:accounts-payable]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusAccountsPayableHistoricalReconcile({
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
  process.argv[1]?.includes("nomusAccountsPayableSourceReconcile") ||
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("nomusAccountsPayableSourceReconcile.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
