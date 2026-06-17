import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  canPrintExecutiveReport,
  executiveReportPrintNeedsQualityConfirm,
  resolveExecutiveReportPrintAction,
} from "./financeExecutiveReportPrint.js";

describe("financeExecutiveReportPrint", () => {
  it("botão de imprimir existe na tela de filtros", () => {
    const filters = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportFilters.tsx"),
      "utf8"
    );
    assert.match(filters, /Imprimir \/ Salvar PDF/);
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
    assert.match(document, /pageId="billing-comparison"/);
    assert.match(document, /pageId="billing-projection"/);
    assert.match(document, /pageId="accounts-receivable"/);
    assert.match(document, /pageId="accounts-payable"/);
    assert.match(document, /pageId="cash-flow"/);
    assert.match(document, /pageId="sales-orders"/);
    assert.match(document, /pageId="conclusion"/);
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

  it("capa contém RELATÓRIO PRESIDENCIAL", () => {
    const cover = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportPrintCover.tsx"),
      "utf8"
    );
    assert.match(cover, /RELATÓRIO PRESIDENCIAL/);
    assert.match(cover, /EXECUTIVE_REPORT_SOURCES_LABEL|Fontes: Nomus/);
  });

  it("rodapé de impressão documenta fontes e geração IndusCost", () => {
    const footer = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutivePrintPageFooter.tsx"),
      "utf8"
    );
    assert.match(footer, /formatExecutiveReportGeneratedFooter/);
    assert.match(footer, /EXECUTIVE_REPORT_SOURCES_LABEL/);
    assert.match(footer, /Documento gerado pelo IndusCost/);
  });

  it("documento inclui intros de seção e footer online", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /EXECUTIVE_REPORT_SECTION_INTROS/);
    assert.match(document, /ExecutiveReportDocumentFooter/);
    assert.match(document, /formatExecutiveReportBillingYearsSubtitle/);
    assert.doesNotMatch(document, /Comparativo 2024 · 2025 · 2026/);
  });

  it("seções principais existem no documento", () => {
    const document = readFileSync(
      join(process.cwd(), "src", "components", "finance", "executive-report", "ExecutiveReportDocument.tsx"),
      "utf8"
    );
    assert.match(document, /Resumo Executivo/);
    assert.match(document, /Faturamento Comparativo/);
    assert.match(document, /Realizado vs Projetado/);
    assert.match(document, /Contas a Receber/);
    assert.match(document, /Contas a Pagar/);
    assert.match(document, /Fluxo de Caixa/);
    assert.match(document, /Pedidos de Venda/);
    assert.match(document, /Conclusão Executiva/);
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
});
