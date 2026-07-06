#!/usr/bin/env npx tsx
/**
 * Auditoria read-only — cobertura de performance operacional de componentes.
 *
 * Uso:
 *   npx tsx scripts/audit-component-performance-coverage.ts
 *   npx tsx scripts/audit-component-performance-coverage.ts --year=2026 --month=7
 *   npx tsx scripts/audit-component-performance-coverage.ts --top=20 --sold-only --json
 *   npx tsx scripts/audit-component-performance-coverage.ts --missing-only --json
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  buildComponentPerformanceCoverageReportFromDb,
  serializeCoverageReportForAuditJson,
} from "../src/lib/componentPerformanceCoverage.server.ts";
import { parseArg, hasFlag, requireDatabaseUrl } from "./commission-audit-args.ts";

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

async function main(): Promise<void> {
  requireDatabaseUrl();
  const json = hasFlag("json");
  const top = parseArg("top");
  const year = parseArg("year");
  const month = parseArg("month");

  await prisma.$connect();

  const report = await buildComponentPerformanceCoverageReportFromDb(prisma, {
    ...(top != null ? { top } : {}),
    ...(year != null ? { year } : {}),
    ...(month != null ? { month } : {}),
    ...(hasFlag("sold-only") ? { soldOnly: "true" } : {}),
    ...(hasFlag("missing-only") ? { missingOnly: "true" } : {}),
  });

  const payload = serializeCoverageReportForAuditJson(report);

  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const { totals } = payload;

  console.log("=== Auditoria — cobertura de performance de componentes ===\n");
  console.log(`Período: ${payload.periodLabel} (${payload.periodFrom} a ${payload.periodTo})`);
  console.log("Modo: somente leitura — nenhum dado é alterado.\n");

  console.log("Totais:");
  console.log(`  Componentes ativos: ${totals.activeComponents}`);
  console.log(`  Vendidos no período: ${totals.soldComponentsInPeriod}`);
  console.log(`  Sem ciclo: ${totals.withoutCycle}`);
  console.log(`  Sem cavidades: ${totals.withoutCavities}`);
  console.log(`  Sem ciclo ou cavidades: ${totals.withoutCycleOrCavities}`);
  console.log(`  Vendidos sem performance completa: ${totals.soldWithoutCompletePerformance}`);
  console.log(`  Nunca revisados (sem histórico): ${totals.neverReviewed}`);
  console.log(`  Alterados recentemente: ${totals.recentlyChanged}`);

  if (payload.topSoldWithoutCompletePerformance.length > 0) {
    console.log("\nTop vendidos sem performance completa:");
    for (const row of payload.topSoldWithoutCompletePerformance) {
      console.log(
        `  [${row.severity}] ${row.sku} — ${row.name} | vendido ${formatMoney(row.periodSoldValue)} (${row.orderCountInPeriod} pedido(s)) | ciclo=${row.cycleTimeSeconds ?? "—"} cav=${row.cavities ?? "—"} | última alt.: ${row.lastPerformanceChangeAt ?? "nunca"} | resp.: ${row.lastResponsiblePersonName ?? "—"}`
      );
    }
  }

  if (payload.recentlyChanged.length > 0) {
    console.log("\nAlterados recentemente:");
    for (const row of payload.recentlyChanged.slice(0, 10)) {
      console.log(
        `  ${row.sku} — ${row.lastPerformanceChangeAt} | ${row.lastChangedByUserName ?? "—"} / resp. ${row.lastResponsiblePersonName ?? "—"}`
      );
    }
  }

  console.log("\n--- JSON ---");
  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch((error) => {
    console.error("[audit-component-performance-coverage]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
