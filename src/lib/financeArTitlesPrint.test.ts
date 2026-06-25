import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

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

  it("aba Títulos dispara impressão após montar portal", () => {
    const tab = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.match(tab, /printRequestId/);
    assert.match(tab, /setPrintRequestId/);
    assert.match(tab, /window\.print\(\)/);
    assert.doesNotMatch(tab, /triggerBrowserPrint/);
  });

  it("meta de impressão monta filtros aplicados", () => {
    const meta = read("src/lib/financeArTitlesPrintMeta.ts");
    assert.match(meta, /buildFinanceArTitlesPrintFilterLines/);
    assert.match(meta, /FINANCE_AR_TITLES_PRINT_TITLE/);
  });
});
