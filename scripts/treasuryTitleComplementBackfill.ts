/**
 * Backfill de complementos operacionais da Central de Tesouraria.
 *
 * Uso:
 *   npx tsx scripts/treasuryTitleComplementBackfill.ts preview --title-type=all --from=2026-01-01 --to=2026-12-31
 *   npx tsx scripts/treasuryTitleComplementBackfill.ts apply --title-type=all --created-by-user-id=<UUID> --checkpoint-file=.tmp/treasury-complement-backfill.json --resume
 *
 * npm:
 *   npm run backfill:treasury:title-complements:preview
 *   npm run backfill:treasury:title-complements:apply -- --created-by-user-id=<UUID>
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runTreasuryTitleComplementBackfill } from "../src/lib/treasury/treasuryTitleComplementBackfill.server.ts";

const LOG_PREFIX = "[treasury-title-complement-backfill]";

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const summary = await runTreasuryTitleComplementBackfill({
      prisma,
      argv: process.argv.slice(2),
    });
    if (summary.ok === false) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  process.argv[1]?.includes("treasuryTitleComplementBackfill") ||
  process.argv[1]
    ?.replace(/\\/g, "/")
    .endsWith("treasuryTitleComplementBackfill.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(`${LOG_PREFIX} erro:`, err);
    process.exitCode = 1;
  });
}
