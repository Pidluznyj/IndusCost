/**
 * Seed hierárquico do catálogo PermissionResource a partir do contrato canônico (Prompt 05).
 *
 * Uso:
 *   npm run permissions:seed:contract:dry
 *   npm run permissions:seed:contract:apply
 *   npx tsx scripts/seedPermissionCatalogFromContract.ts --dry-run
 *   npx tsx scripts/seedPermissionCatalogFromContract.ts --apply
 *
 * - Cria ausentes / atualiza metadados seguros.
 * - Não remove recursos.
 * - Não altera RolePermission, UserPermissionOverride, AppUser.permissions.
 * - Não aplica migration e não deve rodar em produção sem revisão explícita.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import {
  buildPermissionCatalogSeedPlan,
  createPrismaPermissionCatalogSeedPort,
  formatCatalogSeedDiffMarkdown,
  runPermissionCatalogSeed,
} from "../src/lib/security/permissionCatalogSeed/index.ts";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main(): Promise<void> {
  const apply = hasFlag("--apply");
  const forceDry = hasFlag("--dry-run");
  const isDry = forceDry || !apply;

  const plan = buildPermissionCatalogSeedPlan();
  console.log(
    `[seed:contract] mode=${isDry ? "dry-run" : "apply"} plan rows=${plan.rows.length} canonical=${plan.rows.filter((r) => r.source === "canonical_contract").length} legacy=${plan.rows.filter((r) => r.source === "legacy_pt_seed").length} issues=${plan.issues.length}`
  );

  if (hasFlag("--plan-only")) {
    console.log(
      JSON.stringify(
        {
          planOnly: true,
          generatedAt: plan.generatedAt,
          rowCount: plan.rows.length,
          keys: plan.rows.map((r) => r.key),
          issues: plan.issues,
        },
        null,
        2
      )
    );
    return;
  }

  if (!process.env.DATABASE_URL?.trim()) {
    await runOfflineDry(plan);
    return;
  }

  const prisma = new PrismaClient();
  try {
    const port = createPrismaPermissionCatalogSeedPort(prisma);
    try {
      const report = await runPermissionCatalogSeed({
        port,
        dryRun: isDry,
        plan,
      });
      writeReport(report);
      console.log(
        JSON.stringify(
          {
            dryRun: report.dryRun,
            createCount: report.createCount,
            updateCount: report.updateCount,
            unchangedCount: report.unchangedCount,
            retainLegacyCount: report.retainLegacyCount,
            note: report.note,
          },
          null,
          2
        )
      );
    } catch (err) {
      if (isDry) {
        console.warn(
          `[seed:contract] DB inacessível em dry-run — fallback offline vs catálogo vazio. (${err instanceof Error ? err.message.split("\n")[0] : String(err)})`
        );
        await runOfflineDry(plan);
        return;
      }
      throw err;
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function runOfflineDry(
  plan: ReturnType<typeof buildPermissionCatalogSeedPlan>
): Promise<void> {
  const { createInMemoryPermissionCatalogSeedPort } = await import(
    "../src/lib/security/permissionCatalogSeed/ports.ts"
  );
  const port = createInMemoryPermissionCatalogSeedPort([]);
  const report = await runPermissionCatalogSeed({
    port,
    dryRun: true,
    plan,
  });
  writeReport(report);
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        offline: true,
        createCount: report.createCount,
        updateCount: report.updateCount,
        note: "Dry-run offline vs catálogo vazio. Não escreveu banco.",
      },
      null,
      2
    )
  );
}

function writeReport(report: Parameters<typeof formatCatalogSeedDiffMarkdown>[0]): void {
  const outDir = path.join(process.cwd(), "docs", "generated");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "permission-catalog-seed-report.md");
  writeFileSync(outPath, formatCatalogSeedDiffMarkdown(report), "utf8");
  console.log(`[seed:contract] report=${path.relative(process.cwd(), outPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
