import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceExecutiveReportQuery,
  createDefaultFinanceExecutiveReportUiFilters,
  financeExecutiveReportFiltersEqual,
  normalizeFinanceExecutiveReportUiFilters,
} from "./financeExecutiveReportViewModel.js";

describe("financeExecutiveReportFilters", () => {
  it("defaults usam ano/mês/data-base atuais", () => {
    const now = new Date(2026, 4, 14);
    const defaults = createDefaultFinanceExecutiveReportUiFilters(now);
    assert.equal(defaults.year, "2026");
    assert.equal(defaults.month, "5");
    assert.equal(defaults.asOfDate, "2026-05-14");
    assert.equal(defaults.company, "all");
    assert.equal(defaults.customerType, "external");
    assert.equal(defaults.nfeFilter, "all");
    assert.equal(defaults.topN, "50");
  });

  it("buildFinanceExecutiveReportQuery inclui todos os filtros", () => {
    const qs = buildFinanceExecutiveReportQuery({
      year: "2026",
      month: "5",
      asOfDate: "2026-05-14",
      company: "lazarios",
      customerType: "external",
      nfeFilter: "with-nfe",
      topN: "100",
    });
    assert.ok(qs.includes("year=2026"));
    assert.ok(qs.includes("month=5"));
    assert.ok(qs.includes("asOfDate=2026-05-14"));
    assert.ok(qs.includes("company=lazarios"));
    assert.ok(qs.includes("customerType=external"));
    assert.ok(qs.includes("nfeFilter=with-nfe"));
    assert.ok(qs.includes("topN=100"));
  });

  it("normalize corrige valores inválidos", () => {
    const normalized = normalizeFinanceExecutiveReportUiFilters({
      year: "abc",
      month: "99",
      asOfDate: "invalid",
      company: "all",
      customerType: "external",
      nfeFilter: "all",
      topN: "50",
    });
    assert.ok(/^\d{4}$/.test(normalized.year));
    assert.ok(Number(normalized.month) >= 1 && Number(normalized.month) <= 12);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(normalized.asOfDate));
  });

  it("financeExecutiveReportFiltersEqual detecta mudanças", () => {
    const a = createDefaultFinanceExecutiveReportUiFilters(new Date(2026, 4, 14));
    const b = { ...a };
    assert.equal(financeExecutiveReportFiltersEqual(a, b), true);
    assert.equal(
      financeExecutiveReportFiltersEqual(a, { ...a, company: "koppetel" }),
      false
    );
  });
});
