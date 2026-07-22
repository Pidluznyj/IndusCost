import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceArTitlesPrintFilterLines,
  FINANCE_AR_TITLES_PRINT_LOGO_MAX_HEIGHT_PX,
  FINANCE_AR_TITLES_PRINT_LOGO_MAX_WIDTH_PX,
} from "./financeArTitlesPrintMeta.js";
import { createDefaultFinanceArAnalyticalUiFilters } from "./financeAccountsReceivableDashboardTypes.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("financeArTitlesPrint", () => {
  it("CSS de impressão ativa display block no print root (evita PDF em branco)", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /#ar-titles-print-root\s*\{[\s\S]*?display:\s*none/);
    assert.match(css, /@media print[\s\S]*#ar-titles-print-root\s*\{[\s\S]*?display:\s*block\s*!important/);
  });

  it("CSS não força page-break-after na capa nem min-height de página inteira", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.doesNotMatch(css, /finance-ar-titles-print-cover-page/);
    assert.doesNotMatch(css, /page-break-after:\s*always/);
    assert.doesNotMatch(css, /min-height:\s*185mm/);
  });

  it("cabeçalho usa PrintHeader institucional com grid 3 colunas", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    const css = read("src/components/finance/finance-ar-titles-print.css");
    const tab = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.match(cover, /PrintHeader/);
    assert.match(cover, /documentTitle="CONTAS A RECEBER"/);
    assert.match(cover, /documentHighlight="TÍTULOS"/);
    assert.match(css, /print-doc-header-grid[\s\S]*grid-template-columns:\s*28mm/);
    assert.match(css, /print-doc-logo[\s\S]*max-height:\s*22mm/);
    assert.match(tab, /print-document\.css/);
  });

  it("logo em tamanho controlado no CSS de impressão", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /max-width:\s*28mm/);
    assert.match(css, /max-height:\s*22mm/);
    assert.match(css, /object-fit:\s*contain/);
    assert.equal(FINANCE_AR_TITLES_PRINT_LOGO_MAX_WIDTH_PX, 106);
    assert.equal(FINANCE_AR_TITLES_PRINT_LOGO_MAX_HEIGHT_PX, 83);
  });

  it("metadados ficam na coluna direita do cabeçalho (sem cards abaixo da logo)", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.match(cover, /metaLines/);
    assert.match(cover, /Emitido em/);
    assert.doesNotMatch(cover, /finance-ar-titles-print-meta-cards/);
    assert.doesNotMatch(cover, /FinanceArTitlesPrintBrand/);
  });

  it("impressão oculta #root com display none para evitar páginas em branco", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    const global = read("src/reports-print.css");
    assert.match(css, /body\.ar-titles-print-route #root[\s\S]*display:\s*none\s*!important/);
    assert.match(global, /body\.ar-titles-print-route #root[\s\S]*display:\s*none\s*!important/);
    assert.match(global, /#ar-titles-print-root,\s*\n\s*#ar-titles-print-root \*/);
  });

  it("documento unificado sem duplicação de resumo", () => {
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /FinanceAccountsReceivableTitlesPrintCover/);
    assert.match(doc, /id="ar-titles-print-root"/);
    assert.match(doc, /finance-ar-titles-print-summary-grid/);
  });

  it("não existe seção Conteúdo nas próximas páginas", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.doesNotMatch(cover, /Conteúdo nas próximas páginas/);
  });

  it("documento usa branding e badges de status coloridos", () => {
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /branding:\s*BrandingSettingsDTO/);
    assert.match(doc, /financeArTitlesPrintStatusBadgeClass/);
    assert.match(doc, /financeArTitlesPrintMoneyClass/);
    assert.match(doc, /finance-ar-titles-print-total-row/);
    assert.match(doc, /col-status/);
    assert.match(doc, /col-client/);
    assert.doesNotMatch(doc, /col-company/);
    assert.doesNotMatch(doc, /<th className="col-company">Empresa<\/th>/);
  });

  it("cabeçalho exibe disclaimer, metadados e filtros", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(cover, /finance-ar-titles-print-filter-band/);
    assert.match(doc, /FINANCE_AR_TITLES_PRINT_DISCLAIMER/);
  });

  it("CSS define badges e destaques financeiros para impressão", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /finance-ar-titles-print-status--danger/);
    assert.match(css, /finance-ar-titles-print-status--success/);
    assert.match(css, /finance-ar-titles-print-money--risk/);
    assert.match(css, /finance-ar-titles-print-summary-grid/);
    assert.match(css, /finance-ar-titles-print-filter-band/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
    assert.match(css, /\.col-money[\s\S]*white-space:\s*nowrap/);
    assert.doesNotMatch(css, /\.col-company\s*\{/);
  });

  it("resumo executivo permite quebra natural (sem page-break-inside avoid)", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /finance-ar-titles-print-summary-grid[\s\S]*break-inside:\s*auto/);
  });

  it("aba Títulos carrega branding e dispara impressão após montar portal", () => {
    const tab = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.match(tab, /printRequestId/);
    assert.match(tab, /setPrintRequestId/);
    assert.match(tab, /window\.print\(\)/);
    assert.match(tab, /\/api\/branding-settings/);
    assert.match(tab, /branding=\{branding\}/);
    assert.doesNotMatch(tab, /triggerBrowserPrint/);
  });

  it("meta de impressão monta filtros aplicados", () => {
    const meta = read("src/lib/financeArTitlesPrintMeta.ts");
    assert.match(meta, /buildFinanceArTitlesPrintFilterLines/);
    assert.match(meta, /FINANCE_AR_TITLES_PRINT_TITLE/);
    assert.match(meta, /Relatório analítico de títulos filtrados/);
  });

  it("filtros do PDF respeitam normalização da tela", () => {
    const filters = {
      ...createDefaultFinanceArAnalyticalUiFilters(),
      customerName: "Esmaltec S/A",
      year: "2026",
      status: "open",
      invoiceIssued: "yes",
      minValue: "1000",
      maxValue: "50000",
    };
    const lines = buildFinanceArTitlesPrintFilterLines(filters);
    assert.ok(lines.some((l) => l.includes("Esmaltec S/A")));
    assert.ok(lines.some((l) => l.includes("2026")));
    assert.ok(lines.some((l) => l.includes("NF emitida: Sim")));
    assert.ok(lines.some((l) => l.startsWith("Valor:") && l.includes("—")));
  });

  it("PDF não quebra sem logo nem filtros", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.match(cover, /filterLines\.length > 0 \?/);
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /allItems\.length === 0/);
  });
});
