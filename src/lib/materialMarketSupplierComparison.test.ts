import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketSupplierComparison,
  parseMaterialMarketSupplierPeriod,
  resolveMaterialMarketSupplierPeriodBounds,
} from "./materialMarketSupplierComparison.js";

const REFERENCE_DATE = new Date("2026-07-08T12:00:00.000Z");

function quote(
  overrides: Partial<Parameters<typeof buildMaterialMarketSupplierComparison>[0][number]> & {
    supplierName: string;
    quoteDate: string;
    netPrice: number;
  }
) {
  return {
    id: `q-${overrides.supplierName}-${overrides.quoteDate}`,
    supplierId: null,
    paymentTerms: null,
    notes: null,
    ...overrides,
  };
}

describe("materialMarketSupplierComparison", () => {
  it("ranqueia três fornecedores pelo menor preço médio", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-01", netPrice: 10 }),
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-20", netPrice: 12 }),
        quote({ supplierName: "Fornecedor B", quoteDate: "2026-06-05", netPrice: 14 }),
        quote({ supplierName: "Fornecedor B", quoteDate: "2026-06-25", netPrice: 16 }),
        quote({ supplierName: "Fornecedor C", quoteDate: "2026-06-10", netPrice: 20 }),
        quote({ supplierName: "Fornecedor C", quoteDate: "2026-06-28", netPrice: 22 }),
      ],
      { period: "90d", referenceDate: REFERENCE_DATE }
    );

    assert.equal(result.total, 3);
    assert.deepEqual(
      result.items.map((row) => row.supplierName),
      ["Fornecedor A", "Fornecedor B", "Fornecedor C"]
    );
    assert.equal(result.items[0]?.rank, 1);
    assert.equal(result.items[0]?.averagePrice, 11);
    assert.equal(result.items[1]?.averagePrice, 15);
    assert.equal(result.items[2]?.averagePrice, 21);
  });

  it("calcula bestPriceFrequency por data de cotação", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-01", netPrice: 10 }),
        quote({ supplierName: "Fornecedor B", quoteDate: "2026-06-01", netPrice: 12 }),
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-15", netPrice: 13 }),
        quote({ supplierName: "Fornecedor B", quoteDate: "2026-06-15", netPrice: 11 }),
      ],
      { period: "90d", referenceDate: REFERENCE_DATE }
    );

    const supplierA = result.items.find((row) => row.supplierName === "Fornecedor A");
    const supplierB = result.items.find((row) => row.supplierName === "Fornecedor B");

    assert.equal(supplierA?.bestPriceCount, 1);
    assert.equal(supplierA?.bestPriceFrequency, 50);
    assert.equal(supplierB?.bestPriceCount, 1);
    assert.equal(supplierB?.bestPriceFrequency, 50);
  });

  it("filtro de período exclui cotações antigas", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-20", netPrice: 10 }),
        quote({ supplierName: "Fornecedor B", quoteDate: "2026-05-01", netPrice: 5 }),
      ],
      { period: "30d", referenceDate: REFERENCE_DATE }
    );

    assert.equal(result.total, 1);
    assert.equal(result.items[0]?.supplierName, "Fornecedor A");
    assert.equal(result.period, "30d");
    const bounds = resolveMaterialMarketSupplierPeriodBounds("30d", REFERENCE_DATE);
    assert.ok(bounds.startDate);
    assert.equal(result.periodStartDate, bounds.startDate.toISOString().slice(0, 10));
  });

  it("marca fornecedor sem cotação recente como stale", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({ supplierName: "Fornecedor Atual", quoteDate: "2026-06-20", netPrice: 10 }),
        quote({ supplierName: "Fornecedor Antigo", quoteDate: "2026-02-01", netPrice: 8 }),
      ],
      { period: "all", referenceDate: REFERENCE_DATE, staleDays: 90 }
    );

    const current = result.items.find((row) => row.supplierName === "Fornecedor Atual");
    const stale = result.items.find((row) => row.supplierName === "Fornecedor Antigo");

    assert.equal(current?.isStale, false);
    assert.equal(stale?.isStale, true);
  });

  it("calcula variação percentual entre primeira e última cotação do período", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-05-01", netPrice: 10 }),
        quote({ supplierName: "Fornecedor A", quoteDate: "2026-06-20", netPrice: 12 }),
      ],
      { period: "90d", referenceDate: REFERENCE_DATE }
    );

    assert.equal(result.items[0]?.periodVariation, 20);
  });

  it("resolve condição comercial e prazo médio de pagamento", () => {
    const result = buildMaterialMarketSupplierComparison(
      [
        quote({
          supplierName: "Fornecedor A",
          quoteDate: "2026-06-01",
          netPrice: 10,
          paymentTerms: "30 dias",
        }),
        quote({
          supplierName: "Fornecedor A",
          quoteDate: "2026-06-20",
          netPrice: 11,
          paymentTerms: "60 dias",
        }),
      ],
      { period: "90d", referenceDate: REFERENCE_DATE }
    );

    assert.equal(result.items[0]?.averagePaymentTerms, "45 dias (média)");
    assert.equal(result.items[0]?.mostCommonCommercialCondition, "30 dias");
  });

  it("parseMaterialMarketSupplierPeriod usa 90d como padrão", () => {
    assert.equal(parseMaterialMarketSupplierPeriod(undefined), "90d");
    assert.equal(parseMaterialMarketSupplierPeriod("6m"), "6m");
    assert.equal(parseMaterialMarketSupplierPeriod("invalid"), "90d");
  });
});
