#!/usr/bin/env npx tsx
/**
 * Auditoria do Radar Diário de Caixa no Relatório Presidencial.
 *
 * Uso:
 *   npx tsx scripts/audit-executive-report-cash-radar.ts --year=2026 --month=7 --asOfDate=2026-07-01
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.js";
import {
  buildFinanceExecutiveReport,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "../src/lib/financeExecutiveReport.js";
import { EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY } from "../src/lib/financeCashFlowDailyRadar.js";

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
  const year = parseArg("year") ?? "2026";
  const month = parseArg("month") ?? "7";
  const asOfDate = parseArg("asOfDate") ?? "2026-07-01";

  const query = { year, month, asOfDate, company: "all", customerType: "external", nfeFilter: "all" };
  const filters = parseFinanceExecutiveReportQuery(query);
  const referenceDate = resolveExecutiveReportReferenceDate(filters);

  const report = await buildFinanceExecutiveReport(query, prisma);
  const statuses: AuditStatus[] = [];
  const lines: string[] = [];

  const push = (status: AuditStatus, message: string) => {
    statuses.push(status);
    lines.push(`[${status}] ${message}`);
  };

  if (!report.cashRadar) {
    push("BLOQUEANTE", "Relatório Presidencial não inclui bloco cashRadar.");
  } else {
    push("OK", "Bloco cashRadar presente no payload do relatório.");
  }

  const document = readFileSync(
    join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
    "utf8"
  );
  const sectionSource = readFileSync(
    join(
      process.cwd(),
      "src",
      "components",
      "finance",
      "executive-report",
      "ExecutiveReportCashRadarSection.tsx"
    ),
    "utf8"
  );
  const printCss = readFileSync(
    join(
      process.cwd(),
      "src",
      "components",
      "finance",
      "executive-report",
      "finance-executive-report-print.css"
    ),
    "utf8"
  );

  if (!document.includes('pageId="cash-radar"') || !document.includes("allowContentFlow")) {
    push("BLOQUEANTE", "PDF/tela do Relatório Presidencial não referencia cashRadar com fluxo contínuo.");
  } else {
    push("OK", "Documento do relatório inclui seção cash-radar com fluxo para impressão.");
  }

  if (!sectionSource.includes("executive-report-cash-radar-print")) {
    push("BLOQUEANTE", "Seção do radar não usa layout de impressão alinhado à tela.");
  } else {
    push("OK", "Seção do radar usa o mesmo layout da tela na impressão.");
  }

  if (!printCss.includes("executive-print-page--flow")) {
    push("BLOQUEANTE", "CSS de impressão não libera fluxo multipágina do radar.");
  } else {
    push("OK", "CSS de impressão permite fluxo multipágina do radar.");
  }

  const cashRadar = report.cashRadar;
  if (cashRadar) {
    if (cashRadar.defaultOpenRange !== EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY) {
      push("BLOQUEANTE", `Faixa padrão esperada 0-7, recebida: ${cashRadar.defaultOpenRange}`);
    } else {
      push("OK", "Faixa 0 a 7 dias configurada como padrão.");
    }

    if (!cashRadar.ranges || cashRadar.ranges.length < 6) {
      push("BLOQUEANTE", "Cards das faixas incompletos.");
    } else {
      push("OK", `Cards das faixas: ${cashRadar.ranges.length}.`);
    }

    const range07 = cashRadar.ranges.find((r) => r.key === "0-7");
    const detail = cashRadar.selectedRangeDetail ?? cashRadar.radarPayload.selectedDetail;
    const days = cashRadar.radarPayload.selectedRange?.days ?? [];

    if (!range07 || !detail) {
      push("BLOQUEANTE", "Detalhe da faixa 0-7 ausente.");
    } else {
      const daysIn = days.reduce((s, d) => s + d.receivableTotal, 0);
      const daysOut = days.reduce((s, d) => s + d.payableTotal, 0);

      if (!nearlyEqual(daysIn, range07.receivableTotal)) {
        push(
          "BLOQUEANTE",
          `Soma dias entradas (${fmt(daysIn)}) ≠ faixa (${fmt(range07.receivableTotal)}).`
        );
      } else {
        push("OK", "Soma dos dias 0-7 bate com entradas da faixa.");
      }

      if (!nearlyEqual(daysOut, range07.payableTotal)) {
        push(
          "BLOQUEANTE",
          `Soma dias saídas (${fmt(daysOut)}) ≠ faixa (${fmt(range07.payableTotal)}).`
        );
      } else {
        push("OK", "Soma dos dias 0-7 bate com saídas da faixa.");
      }

      if (!nearlyEqual(detail.receivables.summary.total, detail.entriesTotal)) {
        push("BLOQUEANTE", "Total AR grid não bate com entradas da faixa.");
      } else {
        push("OK", "Total AR grid bate com entradas da faixa.");
      }

      if (!nearlyEqual(detail.payables.summary.total, detail.exitsTotal)) {
        push("BLOQUEANTE", "Total AP grid não bate com saídas da faixa.");
      } else {
        push("OK", "Total AP grid bate com saídas da faixa.");
      }

      if (!nearlyEqual(detail.netTotal, detail.entriesTotal - detail.exitsTotal)) {
        push("BLOQUEANTE", "Saldo ≠ entradas - saídas.");
      } else {
        push("OK", "Saldo = entradas - saídas.");
      }
    }

    const applied = cashRadar.filtersApplied.filter((f) => !f.notApplicable);
    if (applied.length === 0) {
      push("ALERTA", "Nenhum filtro aplicável registrado no cashRadar.");
    } else {
      push("OK", `Filtros aplicáveis registrados: ${applied.length}.`);
    }

    if (sectionSource.includes("buildFinanceCashFlowDailyRadar(")) {
      push("BLOQUEANTE", "Cálculo paralelo buildFinanceCashFlowDailyRadar no React.");
    } else {
      push("OK", "Sem cálculo paralelo no React (consome payload/API).");
    }
  }

  const status = mainStatus(statuses);
  console.log("=== Auditoria Radar Diário — Relatório Presidencial ===");
  console.log(`Parâmetros: year=${year} month=${month} asOfDate=${asOfDate}`);
  console.log(`Data-base resolvida: ${referenceDate.toISOString()}`);
  for (const line of lines) console.log(line);
  console.log(`\nSTATUS FINAL: ${status}`);

  await prisma.$disconnect();
  process.exit(status === "BLOQUEANTE" ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
