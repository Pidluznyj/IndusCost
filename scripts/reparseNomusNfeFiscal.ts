/**
 * Backfill / reprocessamento fiscal a partir de NomusNfe.xmlRaw.
 * Uso: tsx scripts/reparseNomusNfeFiscal.ts [--limit=N] [--force] [--dry-run]
 * Não executa migration; assume schema T02 já aplicado no banco alvo.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { ensureNomusNfeFiscalPersisted } from "../src/lib/nfeFiscalPersist.ts";

function parseArgs(argv: string[]) {
  let limit: number | null = null;
  let force = false;
  let dryRun = false;
  for (const arg of argv) {
    if (arg === "--force") force = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg.startsWith("--limit=")) {
      const n = Number.parseInt(arg.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { limit, force, dryRun };
}

async function main() {
  const { limit, force, dryRun } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const rows = await prisma.nomusNfe.findMany({
      select: { id: true, externalId: true, xmlRaw: true, status: true },
      orderBy: { syncedAt: "desc" },
      ...(limit ? { take: limit } : {}),
    });

    console.warn(
      `[reparse-nfe-fiscal] rows=${rows.length} force=${force} dryRun=${dryRun}`
    );

    for (const row of rows) {
      if (dryRun) {
        processed += 1;
        continue;
      }
      try {
        const result = await ensureNomusNfeFiscalPersisted(prisma, {
          nomusNfeId: row.id,
          xmlRaw: row.xmlRaw,
          status: row.status,
          force,
        });
        if (result.skipped) skipped += 1;
        else processed += 1;
      } catch (err) {
        errors += 1;
        console.error(
          `[reparse-nfe-fiscal] erro externalId=${row.externalId}`,
          err instanceof Error ? err.message : err
        );
      }
    }

    console.warn(
      JSON.stringify({
        ok: errors === 0,
        processed,
        skipped,
        errors,
        dryRun,
        force,
      })
    );
  } finally {
    await prisma.$disconnect();
  }

  if (errors > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
