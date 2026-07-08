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

  it("logo em tamanho controlado no CSS de impressão", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /max-width:\s*140px/);
    assert.match(css, /max-height:\s*80px/);
    assert.match(css, /object-fit:\s*contain/);
    assert.equal(FINANCE_AR_TITLES_PRINT_LOGO_MAX_WIDTH_PX, 140);
    assert.equal(FINANCE_AR_TITLES_PRINT_LOGO_MAX_HEIGHT_PX, 80);
  });

  it("cabeçalho executivo com logo e textos no mesmo bloco superior", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(cover, /finance-ar-titles-print-executive-header-row/);
    assert.match(cover, /FinanceArTitlesPrintBrand/);
    assert.match(cover, /finance-ar-titles-print-executive-title/);
    assert.match(css, /finance-ar-titles-print-executive-header-row[\s\S]*display:\s*flex/);
  });

  it("documento unificado sem capa separada nem duplicação de resumo", () => {
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /FinanceAccountsReceivableTitlesPrintCover/);
    assert.match(doc, /id="ar-titles-print-root"/);
    assert.match(doc, /finance-ar-titles-print-summary-grid/);
    assert.doesNotMatch(doc, /finance-ar-titles-print-doc-header/);
    assert.doesNotMatch(doc, /payload=\{payload\}/);
  });

  it("não existe seção Conteúdo nas próximas páginas", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.doesNotMatch(cover, /Conteúdo nas próximas páginas/);
    assert.doesNotMatch(cover, /getFinanceArTitlesPrintCoverSections/);
  });

  it("usa logo da identidade visual via resolvePrintLogoSrc", () => {
    const brand = read("src/components/finance/FinanceArTitlesPrintBrand.tsx");
    assert.match(brand, /resolvePrintLogoSrc/);
    assert.match(brand, /finance-ar-titles-print-logo/);
    assert.match(brand, /finance-ar-titles-print-brand-fallback/);
  });

  it("documento usa branding e badges de status coloridos", () => {
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /branding:\s*BrandingSettingsDTO/);
    assert.match(doc, /financeArTitlesPrintStatusBadgeClass/);
    assert.match(doc, /financeArTitlesPrintMoneyClass/);
    assert.match(doc, /finance-ar-titles-print-total-row/);
    assert.match(doc, /col-status/);
  });

  it("cabeçalho exibe disclaimer, metadados e filtros", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(cover, /finance-ar-titles-print-meta-cards/);
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
    };
    const lines = buildFinanceArTitlesPrintFilterLines(filters);
    assert.ok(lines.some((l) => l.includes("Esmaltec S/A")));
    assert.ok(lines.some((l) => l.includes("2026")));
    assert.ok(lines.some((l) => l.includes("NF emitida: Sim")));
  });

  it("PDF não quebra sem logo nem filtros", () => {
    const brand = read("src/components/finance/FinanceArTitlesPrintBrand.tsx");
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.match(brand, /BRAND_TEXT_FALLBACK|brand-fallback/);
    assert.match(cover, /filterLines\.length > 0 \?/);
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(doc, /allItems\.length === 0/);
  });
});
