/**
 * SYNC-08 — Backfill técnico de lifecycle Nomus.
 *
 * Uso:
 *   npx tsx scripts/nomusLifecycleBackfill.ts preview --entity=all
 *   npx tsx scripts/nomusLifecycleBackfill.ts apply --entity=sales-orders --batch-size=200
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runNomusLifecycleBackfill } from "../src/lib/nomus/nomusLifecycleBackfill.server.ts";

const LOG_PREFIX = "[nomus-lifecycle-backfill]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runNomusLifecycleBackfill({
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
  process.argv[1]?.includes("nomusLifecycleBackfill") ||
  process.argv[1]?.replace(/\\/g, "/").endsWith("nomusLifecycleBackfill.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
