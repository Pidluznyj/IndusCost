/**
 * Diagnóstico READ-ONLY de DRAFTs de custo de produção.
 * Não publica, não altera status, não grava.
 *
 * Uso:
 *   npx tsx scripts/diagnose-production-cost-drafts.ts
 *   npx tsx scripts/diagnose-production-cost-drafts.ts --since=2026-07-20 --auto --source=PRODUCT_ENGINEERING_CHANGE
 */
import { PrismaClient } from "@prisma/client";
import { diagnoseProductionCostDrafts } from "../src/lib/productionCostBulkPublish.server.js";
import { PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE } from "../src/lib/productEngineeringCostSnapshot.js";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const sinceRaw = arg("since");
  const since = sinceRaw ? new Date(sinceRaw) : null;
  const source =
    arg("source") ??
    (hasFlag("engineering") ? PRODUCTION_COST_ENGINEERING_SNAPSHOT_SOURCE : null);
  const createdBy = arg("createdBy");
  const autoCodeOnly = hasFlag("auto");

  const prisma = new PrismaClient();
  try {
    const report = await diagnoseProductionCostDrafts(prisma, {
      since: since && Number.isFinite(since.getTime()) ? since : null,
      source,
      createdBy,
      autoCodeOnly,
    });
    console.log(JSON.stringify(report, null, 2));
    console.log("\n[read-only] nenhuma publicação foi executada.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
