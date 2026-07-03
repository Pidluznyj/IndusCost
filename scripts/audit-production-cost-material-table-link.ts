#!/usr/bin/env npx tsx
/**
 * Auditoria: versões de custo de produção sem vínculo materialCostTableVersionId.
 *
 * Uso:
 *   npx tsx scripts/audit-production-cost-material-table-link.ts
 *   npx tsx scripts/audit-production-cost-material-table-link.ts --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { toCivilDateKey } from "../src/lib/financeCivilDate.ts";
import { hasFlag, requireDatabaseUrl } from "./commission-audit-args.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const json = hasFlag("json");
  await prisma.$connect();

  const [withoutLink, withLink, recentDrafts] = await Promise.all([
    prisma.productionCostTableVersion.findMany({
      where: { materialCostTableVersionId: null },
      orderBy: [{ effectiveDate: "desc" }, { revision: "desc" }],
      take: 50,
      select: {
        id: true,
        code: true,
        revision: true,
        status: true,
        effectiveDate: true,
        createdAt: true,
      },
    }),
    prisma.productionCostTableVersion.count({
      where: { materialCostTableVersionId: { not: null } },
    }),
    prisma.productionCostTableVersion.findMany({
      where: { status: "DRAFT", materialCostTableVersionId: { not: null } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        code: true,
        revision: true,
        materialCostTableVersionId: true,
        materialCostTableVersion: {
          select: { code: true, revision: true, status: true },
        },
      },
    }),
  ]);

  const payload = {
    withMaterialCostTableLink: withLink,
    withoutMaterialCostTableLink: withoutLink.length,
    samplesWithoutLink: withoutLink.map((v) => ({
      ...v,
      effectiveDate: toCivilDateKey(v.effectiveDate),
    })),
    recentDraftsWithLink: recentDrafts,
  };

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("=== Auditoria — vínculo produção ↔ tabela de MP ===\n");
    console.log(`Versões com materialCostTableVersionId: ${withLink}`);
    console.log(`Versões sem vínculo (amostra até 50): ${withoutLink.length}`);
    for (const v of withoutLink.slice(0, 15)) {
      console.log(
        `  ${v.code} rev.${v.revision} [${v.status}] vigência=${toCivilDateKey(v.effectiveDate)}`
      );
    }
    console.log("\n--- DRAFTs recentes com vínculo ---");
    for (const d of recentDrafts) {
      console.log(
        `  ${d.code} rev.${d.revision} → MP ${d.materialCostTableVersion?.code ?? "?"} rev.${d.materialCostTableVersion?.revision ?? "?"}`
      );
    }
    console.log("\n--- JSON ---");
    console.log(JSON.stringify(payload, null, 2));
  }

  if (withoutLink.some((v) => v.status === "DRAFT")) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("[audit-production-cost-material-table-link] erro:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
