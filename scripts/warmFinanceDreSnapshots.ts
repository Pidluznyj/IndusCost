/**
 * Warm-up administrativo dos snapshots anuais da DRE Gerencial.
 *
 * Uso:
 *   npx tsx scripts/warmFinanceDreSnapshots.ts --years=2025,2026
 *   npx tsx scripts/warmFinanceDreSnapshots.ts --years=2026 --companies=all,lazarios
 *   npx tsx scripts/warmFinanceDreSnapshots.ts --years=2026 --force
 *
 * - Sem --companies: aquece os 4 escopos oficiais (all, lazarios, koppetel, sm).
 * - Sem --force: snapshots FRESH e válidos são reportados como HIT (sem trabalho).
 * - PJs são aquecidas ANTES de "all" para maximizar o reuso das bases IRPJ/CSLL.
 * - Nunca roda dentro de migration; exit code != 0 quando alguma chave falhou.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  getFinanceDreSnapshotRows,
  refreshFinanceDreSnapshot,
} from "../src/lib/financeDreSnapshot.server.ts";
import { parseFinanceDreSnapshotSeriesPayload } from "../src/lib/financeDreSnapshotTypes.ts";
import { FINANCE_DRE_LEGAL_ENTITY_COMPANIES } from "../src/lib/financeDreReportBuilder.ts";
import type { FinanceDreCompany } from "../src/lib/financeDreTypes.ts";

const LOG_PREFIX = "[dre-snapshot-warm]";
const OFFICIAL_COMPANIES: FinanceDreCompany[] = [...FINANCE_DRE_LEGAL_ENTITY_COMPANIES, "all"];

function parseListArg(name: string): string[] | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg
    .slice(name.length + 3)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const yearsArg = parseListArg("years");
  if (!yearsArg || yearsArg.length === 0) {
    console.error(`${LOG_PREFIX} uso: --years=2025,2026 [--companies=all,lazarios,koppetel,sm] [--force]`);
    process.exitCode = 1;
    return;
  }
  const years = [...new Set(yearsArg.map((y) => Number.parseInt(y, 10)))].filter(
    (y) => Number.isInteger(y) && y >= 2000 && y <= 2100
  );
  if (years.length === 0) {
    console.error(`${LOG_PREFIX} nenhum ano válido em --years.`);
    process.exitCode = 1;
    return;
  }

  const companiesArg = parseListArg("companies");
  const companies: FinanceDreCompany[] = companiesArg
    ? (OFFICIAL_COMPANIES.filter((c) => companiesArg.includes(c)) as FinanceDreCompany[])
    : OFFICIAL_COMPANIES;
  if (companies.length === 0) {
    console.error(`${LOG_PREFIX} nenhum escopo válido em --companies (oficiais: ${OFFICIAL_COMPANIES.join(", ")}).`);
    process.exitCode = 1;
    return;
  }
  const force = process.argv.includes("--force");

  let hits = 0;
  let refreshed = 0;
  let errors = 0;

  for (const year of years) {
    const rows = await getFinanceDreSnapshotRows(prisma, year, companies);
    const rowByCompany = new Map(rows.map((r) => [r.company, r]));

    // PJs primeiro; "all" por último (reuso das bases por PJ).
    for (const company of companies) {
      const row = rowByCompany.get(company);
      const freshAndValid =
        !force &&
        row != null &&
        row.dirtyAt == null &&
        parseFinanceDreSnapshotSeriesPayload(row.seriesJson) != null;

      if (freshAndValid) {
        hits += 1;
        console.warn(
          `${LOG_PREFIX} ${year}/${company} HIT computedAt=${row.computedAt?.toISOString() ?? "?"}`
        );
        continue;
      }

      const result = await refreshFinanceDreSnapshot(prisma, {
        year,
        company,
        forceAllEntities: force,
      });
      if (result.status === "refreshed") {
        refreshed += 1;
        console.warn(
          `${LOG_PREFIX} ${year}/${company} REFRESH duration=${result.computeDurationMs}ms computedAt=${result.computedAt}` +
            (result.entitiesRefreshed.length > 0
              ? ` entidades=[${result.entitiesRefreshed.join(", ")}]`
              : "")
        );
      } else if (result.status === "already_running") {
        console.warn(`${LOG_PREFIX} ${year}/${company} SKIP (refresh já em andamento)`);
      } else {
        errors += 1;
        console.error(`${LOG_PREFIX} ${year}/${company} ERRO: ${result.error}`);
      }
    }
  }

  console.warn(`${LOG_PREFIX} concluído — hits=${hits} refreshed=${refreshed} errors=${errors}`);
  if (errors > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
