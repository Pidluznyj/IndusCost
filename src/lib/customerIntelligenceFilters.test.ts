import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCustomerIntelligenceApiQuery,
  createDefaultCustomerIntelligenceUiFilters,
  customerIntelligenceUiFiltersFromSearchParams,
  customerIntelligenceUiFiltersToSearchParams,
} from "./customerIntelligencePageFilters.js";

describe("customerIntelligencePageFilters", () => {
  it("monta query da API com filtros aplicados", () => {
    const q = buildCustomerIntelligenceApiQuery({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      year: "",
      status: "SENT_TO_NOMUS",
      responsible: "Carlos",
      productId: "prod-uuid",
      minNetValue: "1000",
      maxNetValue: "50000",
      customerType: "external",
    });
    const params = new URLSearchParams(q);
    assert.equal(params.get("startDate"), "2025-01-01");
    assert.equal(params.get("endDate"), "2025-12-31");
    assert.equal(params.get("status"), "SENT_TO_NOMUS");
    assert.equal(params.get("responsible"), "Carlos");
    assert.equal(params.get("productId"), "prod-uuid");
    assert.equal(params.get("minNetValue"), "1000");
    assert.equal(params.get("maxNetValue"), "50000");
    assert.equal(params.get("customerType"), "external");
    assert.equal(params.get("year"), null);
  });

  it("ano padrão quando sem período explícito", () => {
    const defaults = createDefaultCustomerIntelligenceUiFilters(new Date("2026-06-17"));
    const q = buildCustomerIntelligenceApiQuery(defaults);
    assert.ok(q.includes("year=2026"));
  });

  it("round-trip URL search params", () => {
    const ui = {
      ...createDefaultCustomerIntelligenceUiFilters(new Date("2026-01-01")),
      responsible: "Maria",
      status: "DRAFT",
    };
    const params = customerIntelligenceUiFiltersToSearchParams(ui);
    const restored = customerIntelligenceUiFiltersFromSearchParams(params, new Date("2026-01-01"));
    assert.equal(restored.responsible, "Maria");
    assert.equal(restored.status, "DRAFT");
  });

  it("customerType all propagado na query", () => {
    const q = buildCustomerIntelligenceApiQuery({
      ...createDefaultCustomerIntelligenceUiFilters(),
      customerType: "all",
    });
    assert.ok(q.includes("customerType=all"));
  });
});
