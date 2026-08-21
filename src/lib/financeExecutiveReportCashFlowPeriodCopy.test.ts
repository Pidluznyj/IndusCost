import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildExecutiveReportCashFlowKpis } from "./financeExecutiveReportSectionKpis.js";
import {
  buildExecutiveReportCashFlowPeriodCopy,
  buildExecutiveReportCashFlowScenarioReading,
} from "./financeExecutiveReportCashFlowPeriodCopy.js";
import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";

const ROOT = join(import.meta.dirname, "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function mockReport(
  partial: Partial<FinanceExecutiveReport> & {
    year: number;
    month: number | null;
    cover: FinanceExecutiveReport["cover"];
    calendarAgenda: FinanceExecutiveReport["calendarAgenda"];
  }
): Pick<FinanceExecutiveReport, "year" | "month" | "cover" | "calendarAgenda"> {
  return {
    year: partial.year,
    month: partial.month,
    cover: partial.cover,
    calendarAgenda: partial.calendarAgenda,
  };
}

const annualPoints = [
  { month: 1, inflow: 100, outflow: 50, netFlow: 50, accumulated: 50 },
  { month: 6, inflow: 107300, outflow: 490700, netFlow: -383400, accumulated: -383400 },
  { month: 12, inflow: 0, outflow: 0, netFlow: 0, accumulated: -383400 },
];

describe("financeExecutiveReportCashFlowPeriodCopy", () => {
  it("1–2. exibe período dos cards, gráfico e data-base", () => {
    const copy = buildExecutiveReportCashFlowPeriodCopy(
      mockReport({
        year: 2026,
        month: 6,
        cover: {
          title: "Relatório",
          reportDateLabel: "26/06/2026",
          periodLabel: "06/2026",
        },
        calendarAgenda: {
          source: {} as never,
          calendar: {} as never,
          annualChart: {
            year: 2026,
            highlightMonth: 6,
            points: annualPoints,
            hasData: true,
          },
        },
      })
    );

    assert.match(copy.metadataLine, /Período dos cards: Jan–Dez\/2026/);
    assert.match(copy.metadataLine, /Período do gráfico: Jan–Dez\/2026/);
    assert.match(copy.metadataLine, /Data-base: 26\/06\/2026/);
    assert.match(copy.metadataLine, /Fluxo previsto/);
  });

  it("3–6. cards têm descrições de período e conceito", () => {
    const copy = buildExecutiveReportCashFlowPeriodCopy(
      mockReport({
        year: 2026,
        month: 6,
        cover: {
          title: "Relatório",
          reportDateLabel: "26/06/2026",
          periodLabel: "06/2026",
        },
        calendarAgenda: {
          source: {} as never,
          calendar: {} as never,
          annualChart: { year: 2026, highlightMonth: 6, points: [], hasData: false },
        },
      })
    );

    assert.match(copy.cardSubs.inflow, /Jan–Dez\/2026/);
    assert.match(copy.cardHints.inflow, /previstas/i);
    assert.match(copy.cardSubs.outflow, /previstas/);
    assert.match(copy.cardSubs.net, /Entradas − Saídas/);
    assert.match(copy.cardSubs.accumulated, /dez\/2026/);
    assert.match(copy.cardHints.accumulated, /acumulado/i);
  });

  it("7. gráfico mostra subtítulo com período jan–dez", () => {
    const copy = buildExecutiveReportCashFlowPeriodCopy(
      mockReport({
        year: 2026,
        month: 6,
        cover: {
          title: "Relatório",
          reportDateLabel: "26/06/2026",
          periodLabel: "06/2026",
        },
        calendarAgenda: {
          source: {} as never,
          calendar: {} as never,
          annualChart: { year: 2026, highlightMonth: 6, points: [], hasData: true },
        },
      })
    );

    assert.equal(copy.chartTitle, "Fluxo de caixa planejado — 2026");
    assert.match(copy.chartSubtitle, /jan\/2026 a dez\/2026/i);
    assert.match(copy.chartSubtitle, /previsto/i);
  });

  it("8. cards e gráfico usam o mesmo período anual (explícito na metadata)", () => {
    const copy = buildExecutiveReportCashFlowPeriodCopy(
      mockReport({
        year: 2026,
        month: 6,
        cover: {
          title: "Relatório",
          reportDateLabel: "26/06/2026",
          periodLabel: "06/2026",
        },
        calendarAgenda: {
          source: {} as never,
          calendar: {} as never,
          annualChart: { year: 2026, highlightMonth: 6, points: [], hasData: true },
        },
      })
    );

    assert.match(copy.metadataLine, /Período dos cards: Jan–Dez\/2026/);
    assert.match(copy.metadataLine, /Período do gráfico: Jan–Dez\/2026/);
    assert.match(copy.metadataLine, /Mês destacado no gráfico: Jun\/2026/);
  });

  it("9. leitura executiva menciona o período", () => {
    const copy = buildExecutiveReportCashFlowPeriodCopy(
      mockReport({
        year: 2026,
        month: 6,
        cover: {
          title: "Relatório",
          reportDateLabel: "26/06/2026",
          periodLabel: "06/2026",
        },
        calendarAgenda: {
          source: {} as never,
          calendar: {} as never,
          annualChart: { year: 2026, highlightMonth: 6, points: annualPoints, hasData: true },
        },
      })
    );
    const kpis = buildExecutiveReportCashFlowKpis(
      { points: annualPoints, hasData: true },
      2026
    );
    const reading = buildExecutiveReportCashFlowScenarioReading({
      periodCopy: copy,
      netTotal: kpis.netTotal,
      chartNarrative: "Narrativa complementar.",
    });

    assert.match(reading, /Jan–Dez\/2026/);
    assert.match(reading, /saídas previstas superam/i);
    assert.match(reading, /Narrativa complementar/);
  });

  it("10. valores dos cards não mudam (KPI builder intacto)", () => {
    const kpis = buildExecutiveReportCashFlowKpis(
      { points: annualPoints, hasData: true },
      2026
    );
    assert.equal(kpis.totalInflow, 107400);
    assert.equal(kpis.totalOutflow, 490750);
    assert.equal(kpis.netTotal, -383350);
  });

  it("11–12. wiring no documento e tela Financeiro → Fluxo de Caixa intacta", () => {
    const document = read("components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.match(document, /buildExecutiveReportCashFlowPeriodCopy/);
    assert.match(document, /executive-report-cash-flow-period-meta/);
    assert.match(document, /Fluxo de Caixa \/ Agenda/);
    assert.match(document, /cashFlowPeriodCopy\.cardHints/);
    assert.match(document, /buildExecutiveReportCashFlowScenarioReading/);

    const cashFlowPage = read("components/finance/FinanceCashFlowPage.tsx");
    assert.doesNotMatch(cashFlowPage, /buildExecutiveReportCashFlowPeriodCopy/);
    assert.doesNotMatch(cashFlowPage, /ExecutiveReportPeriodMeta/);
  });

  it("13. PDF — documento usa metadados de período (mesmo markup do print)", () => {
    const printCss = read("components/finance/executive-report/finance-executive-report-print.css");
    assert.match(printCss, /executive-report-period-meta/);
    const chart = read("components/finance/executive-report/charts/ExecutiveCashFlowChart.tsx");
    assert.match(chart, /subtitle\?:/);
  });

  it("14. helper não importa Prisma ou motor de fluxo", () => {
    const src = read("lib/financeExecutiveReportCashFlowPeriodCopy.ts");
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /buildFinanceCashFlowDashboard/);
  });
});

describe("financeExecutiveReportCashFlowPeriodCopy — serviço inalterado", () => {
  it("payload financeiro continua com carga período + anual", () => {
    const service = read("lib/financeExecutiveReport.ts");
    // As duas cargas continuam existindo; o antigo `cashFlowAnnualLoad` virou
    // `cashFlowAnnualPayload`, e o período reaproveita o anual quando são a
    // mesma janela (month == null) em vez de apurar duas vezes.
    assert.match(service, /cashFlowAnnualPayload/);
    assert.match(service, /cashFlowPayload/);
    assert.match(service, /buildExecutiveReportCashFlowAnnualFilters/);
    assert.doesNotMatch(service, /financeExecutiveReportCashFlowPeriodCopy/);
  });
});
