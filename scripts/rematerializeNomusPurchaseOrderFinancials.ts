/**
 * Rematerializa NomusPurchaseOrder.totalAmount / item.totalAmount a partir do
 * rawPayload já persistido. Não chama Nomus. Não altera produção por si só.
 *
 *   npx tsx scripts/rematerializeNomusPurchaseOrderFinancials.ts --dry-run
 *   npx tsx scripts/rematerializeNomusPurchaseOrderFinancials.ts --limit 200
 *
 * Idempotente. Não execute em produção sem autorização explícita.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { rematerializeNomusPurchaseOrderFinancials } from "@/src/lib/nomus/nomusPurchaseOrderFinancialRematerialize.js";

const LOG_PREFIX = "[nomus-po-financial-rematerialize]";

function parseArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || argv.includes("preview");
  const onlyMissing = !argv.includes("--all");
  const limitRaw = parseArg(argv, "--limit");
  const batchRaw = parseArg(argv, "--batch-size");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const batchSize = batchRaw ? Number.parseInt(batchRaw, 10) : 200;

  console.warn(
    `${LOG_PREFIX} início dryRun=${dryRun} onlyMissing=${onlyMissing} limit=${limit ?? "∞"} batchSize=${batchSize}`
  );

  const prisma = new PrismaClient();
  try {
    const counts = await rematerializeNomusPurchaseOrderFinancials(prisma, {
      dryRun,
      onlyMissing,
      limit: limit != null && Number.isFinite(limit) ? limit : undefined,
      batchSize: Number.isFinite(batchSize) ? batchSize : 200,
    });
    console.warn(
      `${LOG_PREFIX} scanned=${counts.scanned} updated=${counts.updated} unchanged=${counts.unchanged} skippedUnmapped=${counts.skippedUnmapped} failed=${counts.failed}`
    );
    if (counts.failed > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
