#!/usr/bin/env npx tsx
/**
 * OP-14.1 — Repara datas de NomusProductionOrder a partir do rawJson local.
 *
 * Não consulta Nomus. Não altera rawJson, payloadHash nem timestamps de sync.
 *
 * Preview:
 *   npx tsx scripts/nomusProductionOrdersRepairDates.ts preview --only-null-dates --limit=50
 *
 * Apply:
 *   npx tsx scripts/nomusProductionOrdersRepairDates.ts apply --only-null-dates
 *   npx tsx scripts/nomusProductionOrdersRepairDates.ts apply --externalId=30347
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { parseProductionOrderDateRepairCli } from "../src/lib/nomusProductionOrdersDateRepair.ts";
import { runProductionOrderDateRepairFromRawJson } from "../src/lib/nomusProductionOrdersDateRepair.server.ts";

async function main() {
  const cli = parseProductionOrderDateRepairCli(process.argv.slice(2));
  const result = await runProductionOrderDateRepairFromRawJson(prisma, cli);
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
