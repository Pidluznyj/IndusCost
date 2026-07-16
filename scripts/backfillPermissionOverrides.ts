/**
 * Backfill P20 (Etapa B) — preview obrigatório; apply explícito.
 *
 * Uso:
 *   npm run permissions:backfill:preview
 *   npx tsx scripts/backfillPermissionOverrides.ts --fixtures-only
 *   npx tsx scripts/backfillPermissionOverrides.ts --from-db
 *   npx tsx scripts/backfillPermissionOverrides.ts --apply --confirm="BACKFILL PERMISSIONS" --from-db
 *   npx tsx scripts/backfillPermissionOverrides.ts --rollback --run-id=<id> --confirm="ROLLBACK BACKFILL"
 *
 * NÃO executar em produção sem backup DB + snapshot P20 compare.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildBackfillTestUsers,
  createInMemoryBackfillPort,
  createPrismaBackfillPort,
  formatBackfillMarkdown,
  rollbackPermissionBackfill,
  runPermissionBackfill,
  toPendingCsv,
  toSafeBackfillJson,
  toSummaryCsv,
} from "../src/lib/security/permissionBackfill/index.ts";

function parseArgs(argv: string[]) {
  const confirmArg = argv.find((a) => a.startsWith("--confirm="));
  const runIdArg = argv.find((a) => a.startsWith("--run-id="));
  const batchArg = argv.find((a) => a.startsWith("--batch-size="));
  return {
    fixturesOnly: argv.includes("--fixtures-only"),
    fromDb: argv.includes("--from-db"),
    apply: argv.includes("--apply"),
    dryRun: argv.includes("--dry-run") || !argv.includes("--apply"),
    rollback: argv.includes("--rollback"),
    confirm: confirmArg?.slice("--confirm=".length).replace(/^"|"$/g, "") ?? null,
    runId: runIdArg?.slice("--run-id=".length) ?? null,
    batchSize: batchArg ? Number(batchArg.slice("--batch-size=".length)) : 25,
  };
}

async function buildPort(args: ReturnType<typeof parseArgs>) {
  if (args.fromDb) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    return { port: createPrismaBackfillPort(prisma), prisma };
  }
  if (args.fixturesOnly || !args.fromDb) {
    return { port: createInMemoryBackfillPort(buildBackfillTestUsers()), prisma: null };
  }
  return { port: createInMemoryBackfillPort(buildBackfillTestUsers()), prisma: null };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const { port, prisma } = await buildPort(args);

  try {
    if (args.rollback) {
      if (!args.runId) {
        throw new Error("BACKFILL_ROLLBACK_RUN_ID_REQUIRED: --run-id=<snapshot>");
      }
      const result = await rollbackPermissionBackfill({
        port,
        runId: args.runId,
        confirmRollback: args.confirm === "ROLLBACK BACKFILL",
      });
      console.log(JSON.stringify({ rollback: true, ...result }, null, 2));
      return;
    }

    const report = await runPermissionBackfill({
      port,
      dryRun: args.dryRun,
      apply: args.apply,
      confirmApply: args.confirm === "BACKFILL PERMISSIONS",
      batchSize: args.batchSize,
      label: args.fromDb ? "db-users" : "fixtures",
    });

    const outDir = path.join(process.cwd(), "docs", "generated");
    mkdirSync(outDir, { recursive: true });

    const jsonPath = path.join(outDir, `permission-backfill-${report.runId}.json`);
    const mdPath = path.join(outDir, `permission-backfill-${report.runId}.md`);
    const pendingPath = path.join(outDir, `permission-backfill-${report.runId}-pending.csv`);
    const summaryPath = path.join(outDir, `permission-backfill-${report.runId}-summary.csv`);

    writeFileSync(jsonPath, JSON.stringify(toSafeBackfillJson(report), null, 2), "utf8");
    writeFileSync(mdPath, formatBackfillMarkdown(report), "utf8");
    writeFileSync(pendingPath, toPendingCsv(report), "utf8");
    writeFileSync(summaryPath, toSummaryCsv(report), "utf8");

    console.log(
      JSON.stringify(
        {
          dryRun: report.dryRun,
          runId: report.runId,
          subjectCount: report.subjectCount,
          readyCount: report.readyCount,
          skippedCount: report.skippedCount,
          pendingCount: report.pendingCount,
          appliedCount: report.appliedCount,
          failedCount: report.failedCount,
          snapshotPath: report.snapshotPath,
          outputs: { json: jsonPath, markdown: mdPath, pendingCsv: pendingPath, summaryCsv: summaryPath },
          note: report.note,
        },
        null,
        2
      )
    );

    if (report.failedCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (prisma) await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
