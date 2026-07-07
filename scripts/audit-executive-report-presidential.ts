#!/usr/bin/env npx tsx
/**
 * Auditoria presidencial — matriz de indicadores + paridade AR/AP/Fluxo (offline).
 *
 * Uso:
 *   npx tsx scripts/audit-executive-report-presidential.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX,
  summarizePresidentialAuditMatrix,
  type PresidentialAuditRow,
} from "../src/lib/financeExecutiveReportPresidentialAudit.js";
import {
  auditExecutiveReportApParity,
  auditExecutiveReportArParity,
  auditExecutiveReportCashFlowParity,
  buildOfficialModulesForExecutiveReport,
} from "../src/lib/financeExecutiveReportConsistency.js";
import {
  buildExecutiveReportModuleSections,
  buildExecutiveReportArPortfolioFilters,
  buildExecutiveReportApPortfolioFilters,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import { loadFinanceArManagementRowsFromPrisma } from "../src/lib/financeAccountsReceivableManagement.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "../src/lib/financeAccountsReceivableHorizon.js";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
} from "../src/lib/financeAccountsPayableDashboard.js";
import { FINANCE_AP_TITLE_SELECT } from "../src/lib/financeAccountsPayableTitles.js";
import {
  buildCashFlowArPrismaWhere,
  buildCashFlowApPrismaWhere,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toApLoadFilters,
  toArLoadFilters,
} from "../src/lib/financeCashFlowDashboard.js";
import {
  buildExecutiveReportCashFlowAnnualFilters,
  buildExecutiveReportCashFlowFilters,
} from "../src/lib/financeExecutiveReport.js";
import { prisma } from "../src/lib/prisma.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "../src/lib/financeNomusArReportFreshness.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function formatRow(row: PresidentialAuditRow): string {
  return `| ${row.section} | ${row.indicator} | ${row.status} | ${row.officialMotor} | ${row.notes ?? ""} |`;
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";
  const writeMd = process.argv.includes("--write-md");

  const filters = parseFinanceExecutiveReportQuery({ year, month, asOfDate });
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const cashFlowAnnualFilters = buildExecutiveReportCashFlowAnnualFilters(filters);

  const [arLoad, arHorizon, apSyncCutoff, arSyncCutoff] = await Promise.all([
    loadFinanceArManagementRowsFromPrisma(prisma, arPortfolioFilters, referenceDate),
    loadFinanceArOpenHorizonRowsFromPrisma(prisma, referenceDate),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
  ]);

  const apWhere = buildFinanceApPrismaWhere(apPortfolioFilters, apSyncCutoff);
  const apPrisma = await prisma.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  const apRows = apPrisma.map(mapPrismaRowToFinanceApDashboardRow);

  const arFilters = toArLoadFilters(cashFlowFilters);
  const apFilters = toApLoadFilters(cashFlowFilters);
  const arWhere = buildCashFlowArPrismaWhere(cashFlowFilters, arFilters, referenceDate, arSyncCutoff);
  const apCfWhere = buildCashFlowApPrismaWhere(cashFlowFilters, apFilters, referenceDate, apSyncCutoff);
  const [arCfPrisma, apCfPrisma] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({ where: arWhere }),
    prisma.nomusAccountsPayable.findMany({ where: apCfWhere }),
  ]);
  const cashFlowArRows = arCfPrisma.map(mapPrismaRowToFinanceCashFlowArRow);
  const cashFlowApRows = apCfPrisma.map(mapPrismaRowToFinanceCashFlowApRow);

  const official = buildOfficialModulesForExecutiveReport({
    filters,
    referenceDate,
    arRows: arLoad.rows,
    apRows,
    cashFlowArRows,
    cashFlowApRows,
    arSyncCutoff: arLoad.syncCutoff,
    apSyncCutoff,
  });

  const sections = buildExecutiveReportModuleSections({
    filters,
    referenceDate,
    arPayload: official.arPayload,
    apPayload: official.apPayload,
    cashFlowPayload: official.cashFlowPayload,
    cashFlowAnnualPayload: official.cashFlowAnnualPayload,
    billingTab: null,
    salesOrdersTab: null,
  });

  const parity = [
    auditExecutiveReportArParity(sections.accountsReceivable.payload, official.arPayload, filters.topN),
    auditExecutiveReportApParity(sections.accountsPayable.payload, official.apPayload, filters.topN),
    auditExecutiveReportCashFlowParity(sections.cashFlow.payload, official.cashFlowPayload),
  ];

  const summary = summarizePresidentialAuditMatrix();

  console.log("=== AUDITORIA RELATÓRIO PRESIDENCIAL ===\n");
  console.log(`Parâmetros: year=${year} month=${month} asOfDate=${asOfDate}\n`);

  console.log("## Matriz de indicadores\n");
  console.log("| Seção | Indicador | Status | Motor oficial | Notas |");
  console.log("|-------|-----------|--------|---------------|-------|");
  for (const row of PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX) {
    console.log(formatRow(row));
  }

  console.log("\n## Resumo\n");
  console.log(JSON.stringify(summary, null, 2));

  console.log("\n## Paridade runtime (AR/AP/Fluxo)\n");
  for (const part of parity) {
    console.log(part.ok ? "OK" : "DIVERGÊNCIA", part.mismatches.join("; ") || "—");
  }

  if (writeMd) {
    const md = [
      "# Auditoria — Relatório Presidencial",
      "",
      `Gerado em ${new Date().toISOString()} · year=${year} month=${month} asOfDate=${asOfDate}`,
      "",
      "## Matriz",
      "",
      "| Seção | Indicador | Status | Motor oficial | Notas |",
      "|-------|-----------|--------|---------------|-------|",
      ...PRESIDENTIAL_EXECUTIVE_REPORT_AUDIT_MATRIX.map(formatRow),
      "",
      "## Paridade",
      "",
      ...parity.flatMap((p) => (p.ok ? ["- OK"] : p.mismatches.map((m) => `- ${m}`))),
    ].join("\n");
    const out = join(process.cwd(), "docs/audits/executive-report-presidential-audit.md");
    writeFileSync(out, md, "utf8");
    console.log(`\nMarkdown gravado em ${out}`);
  }

  await prisma.$disconnect();
  const parityOk = parity.every((p) => p.ok);
  if (!parityOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
