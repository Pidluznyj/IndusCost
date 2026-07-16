/**
 * Comparação dry-run: autorização legada (bag OR) × resolvedor novo (requireResource).
 *
 * Uso:
 *   npm run permissions:compare:legacy-vs-effective
 *   npx tsx scripts/compareLegacyVsEffectiveAccess.ts
 *   npx tsx scripts/compareLegacyVsEffectiveAccess.ts --from-db
 *   npx tsx scripts/compareLegacyVsEffectiveAccess.ts --fixtures-only
 *
 * Saídas em docs/generated/ (JSON + CSV + MD). Sem escrita em AppUser/overrides.
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  buildDefaultComparisonSubjects,
  buildFixtureComparisonSubjects,
  formatComparisonMarkdown,
  runAccessComparison,
  subjectFromAppUserRow,
  toSafeJsonReport,
  toUserDiffsCsv,
  toUserSummaryCsv,
} from "../src/lib/security/accessComparison/index.ts";

async function loadSubjectsFromDb() {
  const { PrismaClient } = await import("@prisma/client");
  const { mapSeedAxisOverridesToContract } = await import(
    "../src/lib/security/effectiveAccessDto/mapOverrides.ts"
  );

  const prisma = new PrismaClient();
  try {
    const users = await prisma.appUser.findMany({
      where: { isActive: true },
      select: {
        id: true,
        role: true,
        permissions: true,
        accessProfileId: true,
        accessProfile: { select: { name: true } },
        permissionOverrides: {
          select: {
            resourceKey: true,
            canView: true,
            canExecute: true,
            canManage: true,
          },
        },
      },
      orderBy: { role: "asc" },
    });

    return users.map((u) =>
      subjectFromAppUserRow({
        id: u.id,
        role: u.role,
        permissions: u.permissions,
        accessProfileId: u.accessProfileId,
        accessProfileName: u.accessProfile?.name ?? null,
        overrides: mapSeedAxisOverridesToContract(
          u.permissionOverrides.map((o) => ({
            resourceKey: o.resourceKey,
            canView: o.canView,
            canExecute: o.canExecute,
            canManage: o.canManage,
          }))
        ),
        legacyCompatMode: u.permissions.length > 0,
      })
    );
  } finally {
    await prisma.$disconnect();
  }
}

function parseArgs(argv: string[]) {
  return {
    fromDb: argv.includes("--from-db"),
    fixturesOnly: argv.includes("--fixtures-only"),
    failOnLockout: argv.includes("--fail-on-lockout"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let subjects = args.fixturesOnly
    ? buildFixtureComparisonSubjects()
    : buildDefaultComparisonSubjects();

  if (args.fromDb) {
    try {
      const dbSubjects = await loadSubjectsFromDb();
      const seen = new Set(subjects.map((s) => s.subjectId));
      for (const s of dbSubjects) {
        if (!seen.has(s.subjectId)) {
          subjects.push(s);
          seen.add(s.subjectId);
        }
      }
    } catch (err) {
      console.error(
        "WARN: --from-db falhou (DATABASE_URL?). Continuando com fixtures/personas.",
        err instanceof Error ? err.message : err
      );
    }
  }

  const report = runAccessComparison(subjects);
  const outDir = path.join(process.cwd(), "docs", "generated");
  mkdirSync(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "legacy-vs-effective-access.json");
  const mdPath = path.join(outDir, "legacy-vs-effective-access.md");
  const summaryCsvPath = path.join(outDir, "legacy-vs-effective-access-summary.csv");
  const diffsCsvPath = path.join(outDir, "legacy-vs-effective-access-diffs.csv");

  writeFileSync(jsonPath, JSON.stringify(toSafeJsonReport(report), null, 2), "utf8");
  writeFileSync(mdPath, formatComparisonMarkdown(report), "utf8");
  writeFileSync(summaryCsvPath, toUserSummaryCsv(report), "utf8");
  writeFileSync(diffsCsvPath, toUserDiffsCsv(report), "utf8");

  console.log(
    JSON.stringify(
      {
        dryRun: true,
        subjectCount: report.subjectCount,
        probeCount: report.probeCount,
        categoryCounts: report.categoryCounts,
        lockoutRiskCount: report.lockoutRiskCount,
        megaKeyBleedCount: report.megaKeyBleedCount,
        leticia:
          report.users.find((u) => u.scenarioTag === "leticia-ap-only")?.categoryCounts ?? null,
        outputs: {
          json: jsonPath,
          markdown: mdPath,
          summaryCsv: summaryCsvPath,
          diffsCsv: diffsCsvPath,
        },
        note: report.note,
      },
      null,
      2
    )
  );

  if (args.failOnLockout && report.lockoutRiskCount > 0) {
    console.error(`FAIL: ${report.lockoutRiskCount} célula(s) lockout_risk.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
