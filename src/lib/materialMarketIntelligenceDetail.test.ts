import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialIntelligenceMonitoringStatusLabel,
  mapMaterialIntelligenceDetail,
  mapMaterialIntelligenceRecentQuotes,
} from "./materialMarketIntelligenceDetail.js";

function row(
  overrides: Partial<Parameters<typeof mapMaterialIntelligenceDetail>[0]> = {}
) {
  return {
    id: "mat-1",
    code: "MP-001",
    description: "Aço laminado",
    unit: "kg",
    category: "MATERIA_PRIMA",
    currentCost: 10,
    isMarketMonitored: false,
    ...overrides,
  };
}

describe("materialMarketIntelligenceDetail", () => {
  it("mapeia matéria não monitorada com status adequado", () => {
    const mapped = mapMaterialIntelligenceDetail(row());
    assert.equal(mapped.isMarketMonitored, false);
    assert.equal(mapped.marketCriticality, null);
    assert.equal(mapped.monitoringStatusLabel, "Não monitorada");
    assert.match(mapped.intelligencePath, /\/materials\/market-intelligence\/mat-1$/);
  });

  it("mapeia matéria monitorada com criticidade e cotação", () => {
    const mapped = mapMaterialIntelligenceDetail(
      row({
        isMarketMonitored: true,
        marketCriticality: "HIGH",
        MaterialPriceHistory: [{ price: 12.5, effectiveDate: "2026-01-15" }],
      })
    );
    assert.equal(mapped.isMarketMonitored, true);
    assert.equal(mapped.marketCriticality, "HIGH");
    assert.equal(mapped.monitoringStatusLabel, "Monitorada · Alta");
    assert.equal(mapped.lastQuoteAmount, 12.5);
    assert.ok(mapped.lastQuoteDate);
  });

  it("rótulo de status reflete monitoramento", () => {
    assert.equal(
      buildMaterialIntelligenceMonitoringStatusLabel({
        isMarketMonitored: false,
        marketCriticality: null,
      }),
      "Não monitorada"
    );
    assert.equal(
      buildMaterialIntelligenceMonitoringStatusLabel({
        isMarketMonitored: true,
        marketCriticality: "MEDIUM",
      }),
      "Monitorada · Média"
    );
  });

  it("mapeia cotações recentes e fornecedor", () => {
    const mapped = mapMaterialIntelligenceDetail(
      row({
        supplier: "  Fornecedor X  ",
        MaterialPriceHistory: [
          { price: 10, effectiveDate: "2026-01-01" },
          { price: 11, effectiveDate: "2026-02-01" },
        ],
      })
    );
    assert.equal(mapped.supplier, "Fornecedor X");
    assert.equal(mapped.recentQuotes.length, 2);
    assert.equal(mapped.recentQuotes[0]?.amount, 10);
  });

  it("cotações recentes vazias sem histórico", () => {
    assert.deepEqual(mapMaterialIntelligenceRecentQuotes(undefined), []);
    assert.deepEqual(mapMaterialIntelligenceRecentQuotes([]), []);
  });
});
