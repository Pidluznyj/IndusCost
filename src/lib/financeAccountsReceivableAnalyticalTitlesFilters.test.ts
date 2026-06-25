import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceArAnalyticalTitlesExportQuery,
  buildFinanceArAnalyticalTitlesQuery,
  createDefaultFinanceArAnalyticalUiFilters,
  normalizeFinanceArAnalyticalUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import { safeTrim } from "./safeTrim.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("financeAccountsReceivableAnalyticalTitlesFilters", () => {
  it("safeTrim evita crash em undefined/null", () => {
    assert.equal(safeTrim(undefined), "");
    assert.equal(safeTrim(null), "");
    assert.equal(safeTrim(123), "");
    assert.equal(safeTrim("  abc  "), "abc");
  });

  it("normalizeFinanceArAnalyticalUiFilters inicializa campos undefined", () => {
    const normalized = normalizeFinanceArAnalyticalUiFilters({
      status: "all",
      companyName: undefined,
      customerId: undefined,
      document: undefined,
      minValue: undefined,
      maxValue: undefined,
      year: undefined,
      month: undefined,
    } as unknown as Parameters<typeof normalizeFinanceArAnalyticalUiFilters>[0]);
    assert.equal(typeof normalized.companyName, "string");
    assert.equal(typeof normalized.customerId, "string");
    assert.equal(typeof normalized.customerName, "string");
    assert.equal(typeof normalized.document, "string");
    assert.equal(typeof normalized.minValue, "string");
    assert.equal(typeof normalized.maxValue, "string");
    assert.equal(typeof normalized.year, "string");
    assert.equal(typeof normalized.month, "string");
    assert.equal(normalized.origin, "all");
    assert.equal(normalized.delaySituation, "all");
  });

  it("aplicar filtros com campos vazios monta query sem erro", () => {
    const filters = createDefaultFinanceArAnalyticalUiFilters();
    const qs = buildFinanceArAnalyticalTitlesQuery(filters, { page: 1, pageSize: 50 });
    assert.match(qs, /page=1/);
    assert.match(qs, /pageSize=50/);
    assert.doesNotMatch(qs, /undefined/);
  });

  it("query params com cliente, empresa e documento vazios não quebram", () => {
    const qs = buildFinanceArAnalyticalTitlesQuery(
      normalizeFinanceArAnalyticalUiFilters({
        ...createDefaultFinanceArAnalyticalUiFilters(),
        personName: "",
        companyName: "",
        document: "",
        customerId: "",
        minValue: "",
        maxValue: "",
      })
    );
    assert.doesNotMatch(qs, /undefined/);
    assert.doesNotMatch(qs, /customerId=/);
    assert.doesNotMatch(qs, /document=/);
  });

  it("exportação Excel/PDF usa mesma normalização", () => {
    const filters = normalizeFinanceArAnalyticalUiFilters({
      ...createDefaultFinanceArAnalyticalUiFilters(),
      document: undefined,
      customerId: undefined,
    } as unknown as Parameters<typeof normalizeFinanceArAnalyticalUiFilters>[0]);
    const exportQs = buildFinanceArAnalyticalTitlesExportQuery(filters);
    assert.match(exportQs, /page=1/);
    assert.match(exportQs, /pageSize=50000/);
    assert.doesNotMatch(exportQs, /undefined/);
  });

  it("aba Títulos normaliza filtros ao aplicar e corrige autocomplete de cliente", () => {
    const tab = read("src/components/finance/FinanceArAnalyticalTitlesTab.tsx");
    assert.ok(tab.includes("normalizeFinanceArAnalyticalUiFilters"));
    assert.ok(tab.includes("personName={draftFilters.personName}"));
    assert.ok(tab.includes("financeArCustomerFieldsFromSelection"));
    assert.ok(tab.includes("customerName: fields.customerName"));
    assert.doesNotMatch(tab, /value=\{draftFilters\.personName\}/);
  });

  it("print document não usa trim direto em filtros", () => {
    const printDoc = read("src/components/finance/FinanceAccountsReceivableTitlesPrintDocument.tsx");
    assert.ok(printDoc.includes("safeTrim"));
    assert.doesNotMatch(printDoc, /filters\.companyName\.trim\(\)/);
    assert.doesNotMatch(printDoc, /filters\.document\.trim\(\)/);
  });

  it("buildFinanceArAnalyticalTitlesQuery não usa trim direto", () => {
    const types = read("src/lib/financeAccountsReceivableDashboardTypes.ts");
    const analyticalBlock = types.slice(
      types.indexOf("buildFinanceArAnalyticalTitlesQuery"),
      types.indexOf("buildFinanceArAnalyticalTitlesExportQuery")
    );
    assert.doesNotMatch(analyticalBlock, /\.trim\(\)/);
  });
});
