#!/usr/bin/env npx tsx
/**
 * Auditoria do período personalizado — Radar Diário de Caixa.
 *
 * Uso:
 *   npx tsx scripts/audit-cash-flow-custom-period-radar.ts --startDate=2026-06-30 --endDate=2026-07-11 --asOfDate=2026-06-30
 */
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceCashFlowDailyRadar,
  createDailyRadarDashboardFilters,
  DAILY_RADAR_CUSTOM_RANGE_KEY,
  filterDailyRadarPortfolioRows,
  parseDailyRadarQuery,
} from "../src/lib/financeCashFlowDailyRadar.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  FINANCE_CASH_FLOW_AR_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "../src/lib/financeCashFlowDashboard.js";
import { buildFinanceApPrismaWhere } from "../src/lib/financeAccountsPayableDashboard.js";
import { buildFinanceArPrismaWhere } from "../src/lib/financeAccountsReceivableDashboard.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "../src/lib/financeNomusApReportFreshness.js";
import { resolveNomusArReportSyncCutoffFromPrisma } from "../src/lib/financeNomusArReportFreshness.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  return "INVÁLIDO";
}

function nearlyEqual(a: number, b: number, epsilon = 0.02): boolean {
  return Math.abs(a - b) <= epsilon;
}

type AuditStatus = "OK" | "ALERTA" | "BLOQUEANTE";

function mainStatus(items: AuditStatus[]): AuditStatus {
  if (items.includes("BLOQUEANTE")) return "BLOQUEANTE";
  if (items.includes("ALERTA")) return "ALERTA";
  return "OK";
}

async function main() {
  const startDate = parseArg("startDate") ?? "2026-06-30";
  const endDate = parseArg("endDate") ?? "2026-07-11";
  const asOfDate = parseArg("asOfDate") ?? startDate;
  const referenceDate = new Date(`${asOfDate}T12:00:00.000Z`);

  const query = parseDailyRadarQuery({
    range: DAILY_RADAR_CUSTOM_RANGE_KEY,
    customStartDate: startDate,
    customEndDate: endDate,
    baseDate: asOfDate,
  });

  const filters = createDailyRadarDashboardFilters();
  const [arSyncCutoff, apSyncCutoff] = await Promise.all([
    resolveNomusArReportSyncCutoffFromPrisma(prisma),
    resolveNomusApReportSyncCutoffFromPrisma(prisma),
  ]);
  const arWhere = buildFinanceArPrismaWhere(
    toCashFlowPortfolioArFilters(filters),
    referenceDate,
    arSyncCutoff
  );
  const apWhere = buildFinanceApPrismaWhere(toCashFlowPortfolioApFilters(filters), apSyncCutoff);

  const [arPrisma, apPrisma] = await Promise.all([
    prisma.nomusAccountsReceivable.findMany({
      where: arWhere,
      select: FINANCE_CASH_FLOW_AR_SELECT,
    }),
    prisma.nomusAccountsPayable.findMany({
      where: apWhere,
      select: FINANCE_CASH_FLOW_AP_SELECT,
    }),
  ]);

  const portfolio = filterDailyRadarPortfolioRows(
    arPrisma.map(mapPrismaRowToFinanceCashFlowArRow),
    apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    referenceDate,
    arSyncCutoff,
    apSyncCutoff
  );

  const payload = buildFinanceCashFlowDailyRadar(
    portfolio.arRows,
    portfolio.apRows,
    query,
    referenceDate
  );

  const statuses: AuditStatus[] = [];
  const notes: string[] = [];

  const custom = payload.customRange;
  const detail = payload.selectedDetail;
  const days = payload.selectedCustomRange?.days ?? [];

  if (!custom) {
    statuses.push("BLOQUEANTE");
    notes.push("customRange ausente no payload.");
  }
  if (!detail) {
    statuses.push("BLOQUEANTE");
    notes.push("selectedDetail ausente — período personalizado sem listagem AR/AP.");
  } else if (detail.rangeKey !== DAILY_RADAR_CUSTOM_RANGE_KEY) {
    statuses.push("BLOQUEANTE");
    notes.push(`selectedDetail.rangeKey=${detail.rangeKey} (esperado custom).`);
  }

  const sumDayReceivable = days.reduce((sum, day) => sum + day.receivableTotal, 0);
  const sumDayPayable = days.reduce((sum, day) => sum + day.payableTotal, 0);

  if (custom && !nearlyEqual(sumDayReceivable, custom.receivableTotal)) {
    statuses.push("BLOQUEANTE");
    notes.push("Soma recebível dos dias difere do total do período.");
  }
  if (custom && !nearlyEqual(sumDayPayable, custom.payableTotal)) {
    statuses.push("BLOQUEANTE");
    notes.push("Soma pagável dos dias difere do total do período.");
  }

  if (detail && custom) {
    if (!nearlyEqual(detail.entriesTotal, custom.receivableTotal)) {
      statuses.push("BLOQUEANTE");
      notes.push("Entradas do detalhe diferem do card do período.");
    }
    if (!nearlyEqual(detail.exitsTotal, custom.payableTotal)) {
      statuses.push("BLOQUEANTE");
      notes.push("Saídas do detalhe diferem do card do período.");
    }
    if (!nearlyEqual(detail.receivables.summary.total, detail.entriesTotal)) {
      statuses.push("BLOQUEANTE");
      notes.push("Total AR listado difere de entradas do detalhe.");
    }
    if (!nearlyEqual(detail.payables.summary.total, detail.exitsTotal)) {
      statuses.push("BLOQUEANTE");
      notes.push("Total AP listado difere de saídas do detalhe.");
    }
    if (detail.receivables.summary.count !== custom.receivableCount) {
      statuses.push("ALERTA");
      notes.push("Quantidade AR do card difere da contagem do grid (paginação/busca).");
    }
    if (detail.payables.summary.count !== custom.payableCount) {
      statuses.push("ALERTA");
      notes.push("Quantidade AP do card difere da contagem do grid (paginação/busca).");
    }
  }

  if (days.length === 0 && custom && (custom.receivableTotal > 0 || custom.payableTotal > 0)) {
    statuses.push("ALERTA");
    notes.push("Período com valor mas sem cards diários.");
  }

  if (statuses.length === 0) statuses.push("OK");

  console.log(
    `Auditoria período personalizado radar — ${startDate} a ${endDate} asOfDate=${asOfDate}\n`
  );
  console.log("### Resumo do período");
  console.log(`- label: ${custom?.label ?? "—"}`);
  console.log(`- entradas: ${fmt(custom?.receivableTotal)} (${custom?.receivableCount ?? 0} títulos)`);
  console.log(`- saídas: ${fmt(custom?.payableTotal)} (${custom?.payableCount ?? 0} títulos)`);
  console.log(`- saldo: ${fmt(custom?.netTotal)}`);
  console.log(`- dias no período: ${days.length}`);

  if (detail) {
    console.log("\n### Detalhe / listagens");
    console.log(`- entradas detalhe: ${fmt(detail.entriesTotal)}`);
    console.log(`- saídas detalhe: ${fmt(detail.exitsTotal)}`);
    console.log(`- AR grid total: ${fmt(detail.receivables.summary.total)} (${detail.receivables.summary.count})`);
    console.log(`- AP grid total: ${fmt(detail.payables.summary.total)} (${detail.payables.summary.count})`);
  }

  if (notes.length > 0) {
    console.log("\n### Observações");
    for (const note of notes) console.log(`- ${note}`);
  }

  const result = mainStatus(statuses);
  console.log(`\n### Resultado: ${result}`);
  if (result === "BLOQUEANTE") process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
