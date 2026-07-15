/**
 * Relatório dry-run do dual-write / materialização legada (Prompt 06).
 *
 * Uso:
 *   npm run permissions:dual-write:report
 *   npx tsx scripts/permissionDualWriteReport.ts
 *
 * NÃO aplica backfill. NÃO altera produção.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDualWriteCompatibilityReport,
  formatDualWriteCompatibilityMarkdown,
  listCatalogKeysWithoutStructuralAlias,
  listAliasCollisions,
} from "../src/lib/security/permissionDualWrite/index.ts";
import { buildAllDualWriteFixtures } from "../src/lib/security/permissionDualWrite/fixtures.ts";

function main(): void {
  const fixtures = buildAllDualWriteFixtures();
  const report = buildDualWriteCompatibilityReport(fixtures);
  const md = formatDualWriteCompatibilityMarkdown(report);

  const outDir = path.join(process.cwd(), "docs", "generated");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "permission-dual-write-report.md");
  writeFileSync(outPath, md, "utf8");

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        allCompatible: report.allCompatible,
        fixtureCount: report.fixtureCount,
        aliasCollisionCount: report.aliasCollisionCount,
        catalogUnmappedCount: listCatalogKeysWithoutStructuralAlias().length,
        sampleCollisions: listAliasCollisions().slice(0, 5),
        reportPath: outPath,
        note: "Backfill NÃO executado. Sem escrita em AppUser/overrides.",
      },
      null,
      2
    )
  );

  if (!report.allCompatible) {
    process.exitCode = 1;
  }
}

main();
