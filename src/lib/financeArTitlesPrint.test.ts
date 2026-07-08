import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildFinanceArTitlesPrintFilterLines } from "./financeArTitlesPrintMeta.js";
import { createDefaultFinanceArAnalyticalUiFilters } from "./financeAccountsReceivableDashboardTypes.js";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("financeArTitlesPrint", () => {
  it("CSS de impressão ativa display block no print root (evita PDF em branco)", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /#ar-titles-print-root\s*\{[\s\S]*?display:\s*none/);
    assert.match(css, /@media print[\s\S]*#ar-titles-print-root\s*\{[\s\S]*?display:\s*block\s*!important/);
  });

  it("documento de impressão inclui capa executiva", () => {
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.match(doc, /FinanceAccountsReceivableTitlesPrintCover/);
    assert.match(doc, /id="ar-titles-print-root"/);
    assert.match(cover, /finance-ar-titles-print-cover-page/);
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

  it("capa exibe disclaimer e resumo em cards", () => {
    const cover = read("src/components/finance/FinanceAccountsReceivableTitlesPrintCover.tsx");
    assert.match(cover, /FINANCE_AR_TITLES_PRINT_DISCLAIMER/);
    assert.match(cover, /finance-ar-titles-print-cover-kpi-card/);
    assert.match(cover, /FinanceArTitlesPrintBrand/);
  });

  it("CSS define badges e destaques financeiros para impressão", () => {
    const css = read("src/components/finance/finance-ar-titles-print.css");
    assert.match(css, /finance-ar-titles-print-status--danger/);
    assert.match(css, /finance-ar-titles-print-status--success/);
    assert.match(css, /finance-ar-titles-print-money--risk/);
    assert.match(css, /finance-ar-titles-print-summary-grid/);
    assert.match(css, /finance-ar-titles-print-filter-band/);
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
    const doc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.match(brand, /BRAND_TEXT_FALLBACK|brand-fallback/);
    assert.match(doc, /filterLines\.length > 0 \?/);
    assert.match(doc, /allItems\.length === 0/);
  });
});
