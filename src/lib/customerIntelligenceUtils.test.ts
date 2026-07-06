import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BRAZIL_UF_TO_REGION,
  createDefaultCustomerIntelligenceFilters,
  deriveBrazilRegionFromUf,
  filterCustomerIntelligenceOrders,
  getCustomerIntelligenceMetricsOrders,
  parseCustomerIntelligenceFilters,
  safeDivide,
} from "./customerIntelligenceUtils.js";
import type { CustomerIntelligenceOrderInput } from "./customerIntelligenceTypes.js";

function order(
  overrides: Partial<CustomerIntelligenceOrderInput> & Pick<CustomerIntelligenceOrderInput, "id">
): CustomerIntelligenceOrderInput {
  return {
    orderCode: overrides.orderCode ?? "PV-1",
    status: overrides.status ?? "SENT_TO_NOMUS",
    issueDate: overrides.issueDate ?? new Date("2025-06-15T12:00:00.000Z"),
    updatedAt: overrides.updatedAt ?? new Date("2025-06-16T12:00:00.000Z"),
    responsible: overrides.responsible ?? "Carlos",
    totalNetValue: overrides.totalNetValue ?? 1000,
    totalMarginValue: overrides.totalMarginValue ?? 100,
    totalMarginPerc: overrides.totalMarginPerc ?? 10,
    hasInvoicing: overrides.hasInvoicing ?? true,
    items: overrides.items ?? [
      {
        productId: "prod-1",
        quantity: 1,
        totalNetValue: 1000,
        Product: { id: "prod-1", sku: "SKU-1", name: "Produto 1", type: "FINAL" },
      },
    ],
    ...overrides,
  };
}

describe("customerIntelligenceUtils", () => {
  it("parseCustomerIntelligenceFilters — defaults e topN", () => {
    const f = parseCustomerIntelligenceFilters({});
    assert.equal(f.topN, 10);
    assert.equal(f.customerType, "external");
    assert.ok(f.year != null);
  });

  it("parseCustomerIntelligenceFilters — aceita topN 20/50/all", () => {
    assert.equal(parseCustomerIntelligenceFilters({ topN: "20" }).topN, 20);
    assert.equal(parseCustomerIntelligenceFilters({ topN: "all" }).topN, "all");
  });

  it("getCustomerIntelligenceMetricsOrders exclui cancelados e erro", () => {
    const orders = [
      order({ id: "1", status: "SENT_TO_NOMUS" }),
      order({ id: "2", status: "CANCELLED" }),
      order({ id: "3", status: "ERROR" }),
    ];
    const filtered = filterCustomerIntelligenceOrders(
      orders,
      createDefaultCustomerIntelligenceFilters(new Date("2026-01-01"))
    );
    const metrics = getCustomerIntelligenceMetricsOrders(filtered);
    assert.equal(metrics.length, 1);
    assert.equal(metrics[0]!.id, "1");
  });

  it("filterCustomerIntelligenceOrders respeita status explícito", () => {
    const orders = [
      order({ id: "1", status: "CANCELLED" }),
      order({ id: "2", status: "SENT_TO_NOMUS" }),
    ];
    const filtered = filterCustomerIntelligenceOrders(orders, {
      ...createDefaultCustomerIntelligenceFilters(new Date("2026-01-01")),
      year: null,
      status: "CANCELLED",
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.status, "CANCELLED");
  });

  it("safeDivide não retorna NaN", () => {
    assert.equal(safeDivide(0, 0), null);
    assert.equal(safeDivide(100, 0), null);
    assert.equal(safeDivide(100, 4), 25);
  });

  it("deriveBrazilRegionFromUf mapeia SP para Sudeste", () => {
    assert.equal(deriveBrazilRegionFromUf("SP"), "Sudeste");
    assert.equal(BRAZIL_UF_TO_REGION.SP, "Sudeste");
  });

  it("deriveBrazilRegionFromUf retorna null para UF ausente", () => {
    assert.equal(deriveBrazilRegionFromUf(null), null);
    assert.equal(deriveBrazilRegionFromUf(""), null);
  });

  it("deriveBrazilRegionFromUf aceita nome completo do estado", () => {
    assert.equal(deriveBrazilRegionFromUf("São Paulo"), "Sudeste");
  });
});
