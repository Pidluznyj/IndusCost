import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PRINT_GLOBAL_CSS_FILES,
  PRINT_PDF_AUDIT_ENTRIES,
  assertNoCriticalPrintPending,
  auditPrintCssContent,
  formatPrintPdfAuditReport,
  getPrintPdfAuditEntry,
  readRepoFile,
  summarizePrintPdfAudit,
  validatePrintPdfAuditFiles,
} from "./printPdfAudit.js";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("printPdfAudit — matriz", () => {
  it("existe matriz de PDF/print com entradas", () => {
    assert.ok(PRINT_PDF_AUDIT_ENTRIES.length >= 20);
    const summary = summarizePrintPdfAudit();
    assert.ok(Number.isFinite(summary.total));
    assert.equal(summary.total, PRINT_PDF_AUDIT_ENTRIES.length);
    assert.ok(!Number.isNaN(summary.ok + summary.attention + summary.risk + summary.pending));
  });

  it("Relatório Presidencial está listado como pdf-layout ok", () => {
    const entry = getPrintPdfAuditEntry("finance-executive-report");
    assert.ok(entry);
    assert.equal(entry!.module, "Financeiro");
    assert.equal(entry!.printMode, "pdf-layout");
    assert.equal(entry!.risk, "ok");
    assert.equal(entry!.hasPrintCss, true);
    assert.equal(entry!.hasNoPrintShell, true);
    assert.equal(entry!.hasChartPrintRules, true);
  });

  it("Produtos Vendidos está listado como pdf-layout ok", () => {
    const entry = getPrintPdfAuditEntry("commercial-sold-products");
    assert.ok(entry);
    assert.equal(entry!.printMode, "pdf-layout");
    assert.equal(entry!.risk, "ok");
    assert.ok(entry!.files.some((f) => f.includes("sold-products-print.css")));
  });

  it("exportações financeiras CSV/XLSX estão listadas", () => {
    for (const id of [
      "finance-ar-csv-export",
      "finance-ap-csv-export",
      "finance-cash-flow-csv-export",
      "finance-billing-nfe-csv-export",
      "finance-billing-audit-xlsx",
    ]) {
      const entry = getPrintPdfAuditEntry(id);
      assert.ok(entry, id);
      assert.ok(["csv-only", "xlsx"].includes(entry!.printMode));
    }
  });

  it("não há entrada crítica com status pending ou risk", () => {
    const issues = assertNoCriticalPrintPending();
    assert.deepEqual(issues, []);
    const summary = summarizePrintPdfAudit();
    assert.equal(summary.pending, 0);
    assert.equal(summary.risk, 0);
  });

  it("entradas visuais possuem arquivos e CSS quando declarado", () => {
    for (const entry of PRINT_PDF_AUDIT_ENTRIES) {
      const fileIssues = validatePrintPdfAuditFiles(entry);
      assert.deepEqual(fileIssues, [], `${entry.id}: ${fileIssues.join("; ")}`);
      if (entry.hasPrintCss) {
        const cssFile = entry.files.find((f) => f.endsWith(".css"));
        assert.ok(cssFile, `${entry.id} hasPrintCss sem arquivo .css`);
        const css = readRepoFile(cssFile!);
        assert.ok(css && css.length > 0, `${entry.id} CSS vazio`);
        const audit = auditPrintCssContent(css);
        assert.equal(audit.hasMediaPrint, true, `${entry.id} sem @media print`);
      }
    }
  });

  it("entradas executivas com gráfico possuem regra de altura print", () => {
    const exec = getPrintPdfAuditEntry("finance-executive-report")!;
    assert.equal(exec.hasChartPrintRules, true);
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    const audit = auditPrintCssContent(css);
    assert.equal(audit.hasChartHeightCap, true);
  });

  it("entradas executivas ocultam app shell", () => {
    const execCss = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(execCss, /#root|aside|header/);
    assert.match(execCss, /display:\s*none|visibility:\s*hidden/);

    const soldCss = read("src/components/commercial/sold-products-print.css");
    assert.match(soldCss, /sold-products-print-route/);
    assert.match(soldCss, /#root/);
  });

  it("entradas executivas não imprimem filtros/botões", () => {
    const execDoc = read("src/components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.doesNotMatch(execDoc, /ExecutivePrintDataQualityNote/);
    assert.doesNotMatch(execDoc, /executive-alerts-panel/);

    const filters = read("src/components/finance/executive-report/ExecutiveReportFilters.tsx");
    assert.match(filters, /no-print/);
  });

  it("Relatório Presidencial possui footer safe area", () => {
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(css, /executive-print-page-footer/);
    assert.match(css, /50mm|padding-bottom/);
  });

  it("formatPrintPdfAuditReport gera relatório legível", () => {
    const report = formatPrintPdfAuditReport();
    assert.match(report, /Relatório Presidencial/);
    assert.match(report, /Produtos Vendidos/);
    assert.match(report, /OK:/);
  });
});

describe("printPdfAudit — CSS global", () => {
  it("existe @media print nos CSS globais principais", () => {
    for (const file of PRINT_GLOBAL_CSS_FILES) {
      const css = read(file);
      assert.match(css, /@media print/, file);
    }
  });

  it("existe .no-print ou equivalente", () => {
    const combined = PRINT_GLOBAL_CSS_FILES.map(read).join("\n");
    assert.match(combined, /\.no-print|no-print|print-no-print|reports-no-print/);
  });

  it("existe regra para ocultar topbar/sidebar/app shell", () => {
    const combined = PRINT_GLOBAL_CSS_FILES.map(read).join("\n");
    assert.match(combined, /#root|aside|sidebar|h-screen/);
    assert.match(combined, /display:\s*none|visibility:\s*hidden/);
  });

  it("Relatório Presidencial evita página em branco na última folha", () => {
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(css, /executive-print-page:last-child/);
    assert.match(css, /page-break-after:\s*auto|break-after:\s*auto/);
  });

  it("Produtos Vendidos usa A4 landscape", () => {
    const css = read("src/components/commercial/sold-products-print.css");
    assert.match(css, /A4 landscape/);
  });

  it("Produtos Vendidos protege coluna # e footer", () => {
    const css = read("src/components/commercial/sold-products-print.css");
    assert.match(css, /col-rank/);
    assert.match(css, /white-space:\s*nowrap/);
    assert.match(css, /print-document-footer/);
    assert.match(css, /table-layout:\s*fixed/);
  });

  it("print-document.css define thead repetível e oculta botões", () => {
    const css = read("src/components/print/print-document.css");
    assert.match(css, /table-header-group/);
    assert.match(css, /\.print-no-print/);
  });
});

describe("printPdfAudit — Relatório Presidencial", () => {
  it("PDF não inclui shell Dashboard/Sistema Online", () => {
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(css, /finance-executive-report-route/);
    assert.match(css, /#root/);
    assert.match(css, /aside/);
  });

  it("capa usa logo para fundo escuro e páginas internas logo clara", () => {
    const cover = read("src/components/finance/executive-report/ExecutiveReportPrintCover.tsx");
    const header = read("src/components/finance/executive-report/ExecutivePrintPageHeader.tsx");
    assert.match(cover, /resolvePrintCoverLogoSrc/);
    assert.match(header, /resolvePrintLogoSrc/);
  });

  it("não imprime observações técnicas de dados", () => {
    const doc = read("src/components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.doesNotMatch(doc, /ExecutivePrintDataQualityNote/);
    assert.doesNotMatch(doc, /Observações sobre os dados/);
  });

  it("gráfico de fluxo usa annualChart com 12 meses", () => {
    const doc = read("src/components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.match(doc, /calendarAgenda\.annualChart\.points/);
    const report = read("src/lib/financeExecutiveReport.ts");
    assert.match(report, /cashFlowAnnualChart/);
  });

  it("Pedidos mostra Vendido no mês", () => {
    const doc = read("src/components/finance/executive-report/ExecutiveReportDocument.tsx");
    assert.match(doc, /Vendido no mês/);
  });

  it("footer e gráfico com área segura e labels", () => {
    const css = read("src/components/finance/executive-report/finance-executive-report-print.css");
    assert.match(css, /executive-chart-body/);
    assert.match(css, /58mm/);
    assert.match(css, /executive-chart-scenario/);
    assert.match(css, /executive-print-page-footer/);
  });

  it("paginação não usa total incorreto de páginas", () => {
    const footer = read("src/components/finance/executive-report/ExecutivePrintPageFooter.tsx");
    assert.doesNotMatch(footer, /de\s*\{/);
    assert.doesNotMatch(footer, /totalPages|pageCount|de\s+\d+/i);
    assert.match(footer, /Página/);
  });
});

describe("printPdfAudit — Produtos Vendidos", () => {
  it("print usa cabeçalho institucional e shell oculto", () => {
    const page = read("src/components/commercial/SoldProductsReportPage.tsx");
    const doc = read("src/components/commercial/SoldProductsPrintDocument.tsx");
    assert.match(page, /sold-products-print-route/);
    assert.match(doc, /PrintHeader/);
    assert.match(doc, /PRODUTOS VENDIDOS/);
  });

  it("shell do app não aparece no print route", () => {
    const css = read("src/components/commercial/sold-products-print.css");
    assert.match(css, /body\.sold-products-print-route #root/);
    assert.match(css, /display:\s*none/);
  });
});

describe("printPdfAudit — Inteligência do Cliente", () => {
  it("impressão oculta shell do app durante print", () => {
    const page = read("src/components/crm/CustomerIntelligencePage.tsx");
    const css = read("src/components/crm/customer-intelligence/customer-intelligence.css");
    assert.match(page, /customer-intelligence-printing/);
    assert.match(css, /customer-intelligence-printing/);
    assert.match(css, /aside|#root|header/);
  });
});
