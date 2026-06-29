import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  areExecutiveReportChartsReady,
  canPrintExecutiveReport,
  chartFrameIsReady,
  executiveReportPrintNeedsQualityConfirm,
  resolveExecutiveReportPrintAction,
  waitForExecutiveReportChartsReady,
} from "./financeExecutiveReportPrint.js";

describe("financeExecutiveReportPrint", () => {
  it("botão de imprimir existe na tela de filtros", () => {
    const filters = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportFilters.tsx"),
      "utf8"
    );
    assert.match(filters, /FINANCE_HEADER_ACTION_EXPORT_PDF|Exportar PDF/);
    assert.match(filters, /executive-report-print-button/);
    assert.match(filters, /onPrint/);
  });

  it("classes no-print existem nos filtros e botões", () => {
    const filters = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportFilters.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.match(filters, /no-print/);
    assert.match(filters, /executive-report-filters/);
    assert.match(filters, /print-actions/);
    assert.match(page, /window\.print/);
    assert.match(page, /executive-report-screen-only/);
  });

  it("páginas possuem classe executive-print-page", () => {
    const shell = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutivePrintPageShell.tsx"),
      "utf8"
    );
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(shell, /executive-print-page/);
    assert.match(document, /executive-report-print-root/);
    assert.match(document, /pageId="cover"/);
    assert.match(document, /pageId="summary"/);
    assert.match(document, /pageId="sales-orders"/);
    assert.match(document, /pageId="billing-comparison"/);
    assert.match(document, /pageId="accounts-receivable"/);
    assert.match(document, /pageId="accounts-payable"/);
    assert.match(document, /pageId="cash-flow"/);
    assert.match(document, /pageId="conclusion"/);
    assert.match(document, /pageId="cash-flow-monthly-timeline"/);
    assert.doesNotMatch(document, /pageId="billing-projection"/);
    const salesIdx = document.indexOf('pageId="sales-orders"');
    const billingIdx = document.indexOf('pageId="billing-comparison"');
    const arIdx = document.indexOf('pageId="accounts-receivable"');
    const apIdx = document.indexOf('pageId="accounts-payable"');
    const cfIdx = document.indexOf('pageId="cash-flow"');
    const conclusionIdx = document.indexOf('pageId="conclusion"');
    const timelineIdx = document.indexOf('pageId="cash-flow-monthly-timeline"');
    assert.ok(
      salesIdx > 0 &&
        billingIdx > salesIdx &&
        arIdx > billingIdx &&
        apIdx > arIdx &&
        cfIdx > apIdx &&
        conclusionIdx > cfIdx &&
        timelineIdx > conclusionIdx
    );
  });

  it("CSS contém A4 landscape", () => {
    const css = readFileSync(
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
    assert.match(css, /size:\s*A4 landscape/);
    assert.match(css, /executive-print-page/);
    assert.match(css, /executive-report-filters/);
    assert.match(css, /\.no-print/);
  });

  it("capa usa título executivo dinâmico", () => {
    const cover = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportPrintCover.tsx"),
      "utf8"
    );
    assert.match(cover, /cover\.title/);
    assert.match(cover, /resolvePrintCoverLogoSrc/);
    assert.match(cover, /EXECUTIVE_REPORT_PRINT_DATA_NOTE/);
  });

  it("capa usa logo para fundo escuro", () => {
    const cover = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportPrintCover.tsx"),
      "utf8"
    );
    assert.match(cover, /isPrintCoverLogoLightOnDark/);
    assert.match(cover, /data-light/);
  });

  it("páginas internas usam logo para fundo claro", () => {
    const header = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutivePrintPageHeader.tsx"),
      "utf8"
    );
    assert.match(header, /resolvePrintLogoSrc/);
    assert.doesNotMatch(header, /resolvePrintCoverLogoSrc/);
  });

  it("PDF não inclui observações técnicas de AR/AP/dados", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.doesNotMatch(document, /ExecutivePrintDataQualityNote/);
    assert.doesNotMatch(document, /Observações — Contas a Receber/);
    assert.doesNotMatch(document, /Observações — Contas a Pagar/);
    assert.doesNotMatch(document, /Observações sobre os dados/);
    assert.doesNotMatch(document, /executive-alerts-panel/);
  });

  it("print CSS oculta shell do app e isola documento executivo", () => {
    const css = readFileSync(
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
    assert.match(css, /body\.finance-executive-report-route #root/);
    assert.match(css, /executive-report-print-root/);
    assert.match(css, /main > header/);
    assert.match(css, /flex\.h-screen > aside/);
  });

  it("print CSS reserva área segura para gráficos e rodapé", () => {
    const css = readFileSync(
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
    assert.match(css, /executive-report-chart-frame/);
    assert.match(css, /executive-chart-body/);
    assert.match(css, /executive-chart-region/);
    assert.match(css, /\.executive-report-chart-frame[\s\S]*height:\s*98mm/);
    assert.match(css, /executive-section--with-chart/);
    assert.match(css, /max-height:\s*none/);
    assert.match(css, /min-height:\s*17mm/);
    assert.doesNotMatch(css, /executive-section--with-chart[\s\S]*max-height:\s*11mm/);
    assert.match(css, /executive-chart-scenario/);
    assert.match(css, /executive-print-page-footer/);
    assert.match(css, /margin-top:\s*auto/);
    assert.doesNotMatch(css, /\.executive-chart-body\s*\{[\s\S]*height:\s*auto/);
  });

  it("print CSS fixa altura da página paisagem para evitar páginas em branco", () => {
    const css = readFileSync(
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
    // Altura fixa (< altura útil) + overflow hidden evita vazamento de conteúdo
    // que gerava páginas quase em branco apenas com rodapé.
    assert.match(css, /\.executive-print-page\s*\{[\s\S]*height:\s*193mm/);
    assert.match(css, /\.executive-print-page\s*\{[\s\S]*overflow:\s*hidden/);
  });

  it("print CSS evita break-inside rígido na seção inteira", () => {
    const css = readFileSync(
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
    assert.match(css, /\.executive-print-page \.finance-executive-report-section[\s\S]*break-inside:\s*auto/);
  });

  it("rodapé de impressão documenta fontes e geração IndusCost", () => {
    const footer = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutivePrintPageFooter.tsx"),
      "utf8"
    );
    assert.match(footer, /formatExecutiveReportGeneratedFooter/);
    assert.match(footer, /EXECUTIVE_REPORT_PRINT_DATA_NOTE/);
    assert.match(footer, /Página \{pageNumber\}/);
    assert.doesNotMatch(footer, /de \{totalPages\}/);
  });

  it("documento inclui intros de seção e footer online", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /EXECUTIVE_REPORT_SECTION_INTROS/);
    assert.match(document, /ExecutiveReportDocumentFooter/);
    assert.match(document, /ExecutiveNarrativeBullets/);
    assert.match(document, /getExecutiveReportKpiHint/);
    assert.match(document, /formatExecutiveReportBillingYearsSubtitle/);
    assert.doesNotMatch(document, /Comparativo 2024 · 2025 · 2026/);
  });

  it("seções principais existem no documento", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /Resumo Executivo/);
    assert.match(document, /withChart/);
    assert.match(document, /Faturamento/);
    assert.match(document, /Contas a Receber/);
    assert.match(document, /Contas a Pagar/);
    assert.match(document, /Fluxo de Caixa \/ Agenda/);
    assert.match(document, /executive-report-cash-flow-period-meta/);
    assert.match(document, /Pedidos de Venda/);
    assert.match(document, /Pedidos mês/);
    assert.match(document, /Pedidos YTD/);
    assert.match(document, /Conclusão Executiva/);
    assert.match(document, /FinanceCashFlowMonthlyTimelineTable/);
    assert.match(document, /executive-report-monthly-timeline/);
    assert.doesNotMatch(document, /pageId="billing-projection"/);
  });

  it("bloqueia impressão enquanto loading", () => {
    assert.equal(canPrintExecutiveReport({ loading: true, report: null }), false);
    assert.equal(
      resolveExecutiveReportPrintAction({ loading: true, report: null }),
      "blocked-loading"
    );
  });

  it("exige confirmação quando há avisos de qualidade", () => {
    const report = {
      dataQuality: {
        warnings: ["Sync indisponível"],
        unavailableSections: [],
        targetsDerived: false,
        freshness: { arStaleExcluded: false, apStaleExcluded: false },
      },
    } as never;

    assert.equal(executiveReportPrintNeedsQualityConfirm(report), true);
    assert.equal(
      resolveExecutiveReportPrintAction({
        loading: false,
        report,
        confirmFn: () => false,
      }),
      "blocked-cancelled"
    );
    assert.equal(
      resolveExecutiveReportPrintAction({
        loading: false,
        report,
        confirmFn: () => true,
      }),
      "print"
    );
  });

  it("containers de gráfico possuem data-report-chart e altura explícita", () => {
    const shell = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "charts", "ExecutiveChartShell.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.match(shell, /data-report-chart/);
    assert.match(shell, /data-chart-ready/);
    assert.match(shell, /executive-report-chart-frame/);
    assert.match(shell, /minHeight:\s*frameHeight/);
    assert.match(shell, /EXECUTIVE_CHART_PRINT_HEIGHT_PX/);
    assert.match(page, /waitForExecutiveReportChartsReady/);
  });

  it("gráficos Recharts usam altura explícita e animação desativada", () => {
    const charts = [
      "ExecutiveBarComparisonChart.tsx",
      "ExecutiveReportReceivablesChart.tsx",
      "ExecutiveReportPayablesChart.tsx",
      "ExecutiveSalesOrdersChart.tsx",
    ];
    for (const file of charts) {
      const src = readFileSync(
        join(process.cwd(), "src", "components", "finance", "executive-report", "charts", file),
        "utf8"
      );
      assert.match(src, /useExecutiveChartFrameDimensions/);
      assert.match(src, /isAnimationActive=\{EXECUTIVE_CHART_IS_ANIMATION_ACTIVE\}/);
    }
    const cashFlow = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "charts", "ExecutiveCashFlowChart.tsx"),
      "utf8"
    );
    assert.match(cashFlow, /ExecutiveChartShell/);
    const plannedChart = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPlannedChart.tsx"),
      "utf8"
    );
    assert.match(plannedChart, /useExecutiveChartFrameDimensions/);
    assert.match(plannedChart, /width=\{chartWidth\} height=\{chartHeight\}/);
  });

  it("waitForExecutiveReportChartsReady retorna true sem document (SSR)", async () => {
    assert.equal(await waitForExecutiveReportChartsReady(), true);
  });

  it("exige gráficos principais renderizados antes do PDF", () => {
    const empty = { getAttribute: () => "true", querySelector: () => null, getBoundingClientRect: () => ({ width: 0, height: 0 }) };
    assert.equal(chartFrameIsReady(empty as unknown as Element), true);
    assert.equal(areExecutiveReportChartsReady([]), false);
    assert.equal(areExecutiveReportChartsReady([empty as unknown as Element]), false);
    const readyCharts = Array.from({ length: 5 }, () => empty);
    assert.equal(areExecutiveReportChartsReady(readyCharts as unknown as Element[]), true);
  });

  it("aguarda mínimo de gráficos principais", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeExecutiveReportPrint.ts"),
      "utf8"
    );
    assert.match(src, /EXECUTIVE_REPORT_MIN_CHARTS/);
    assert.match(src, /areExecutiveReportChartsReady/);
    assert.match(src, /prepareExecutiveReportChartsForPrint/);
    assert.match(src, /markExecutiveReportDocumentReady/);
  });

  it("página não bloqueia impressão com alerta de gráficos", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceExecutiveReportPage.tsx"),
      "utf8"
    );
    assert.doesNotMatch(page, /EXECUTIVE_REPORT_CHARTS_LOADING_MESSAGE/);
    assert.doesNotMatch(page, /chartsReady/);
  });
});
