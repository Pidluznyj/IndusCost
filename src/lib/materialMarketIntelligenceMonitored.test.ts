import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMonitoredMaterialListResponse,
  filterMonitoredMaterialRows,
  mapMonitoredMaterialListItem,
  materialMatchesMonitoredSearch,
  resolveMaterialLastQuote,
} from "./materialMarketIntelligenceMonitored.js";
import type { MonitoredMaterialSourceRow } from "./materialMarketIntelligenceMonitored.js";

function row(
  overrides: Partial<MonitoredMaterialSourceRow> & Pick<MonitoredMaterialSourceRow, "id" | "code">
): MonitoredMaterialSourceRow {
  return {
    description: "Descrição",
    unit: "KG",
    category: "MATERIA_PRIMA",
    currentCost: 10,
    isMarketMonitored: true,
    marketCriticality: "MEDIUM",
    MaterialPriceHistory: [],
    ...overrides,
  };
}

describe("materialMarketIntelligenceMonitored", () => {
  it("exclui matérias não monitoradas", () => {
    const items = filterMonitoredMaterialRows([
      row({ id: "a", code: "MP-A", isMarketMonitored: true }),
      row({ id: "b", code: "MP-B", isMarketMonitored: false }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.code, "MP-A");
  });

  it("filtra por busca em código e descrição", () => {
    const items = buildMonitoredMaterialListResponse(
      [
        row({ id: "a", code: "PP-001", description: "Polipropileno" }),
        row({ id: "b", code: "ABS-002", description: "Absorvente técnico" }),
      ],
      { q: "pp" }
    );
    assert.equal(items.total, 1);
    assert.equal(items.items[0]?.code, "PP-001");
    assert.ok(materialMatchesMonitoredSearch({ code: "ABS-002", description: "Absorvente" }, "abs"));
  });

  it("filtra por criticidade", () => {
    const items = buildMonitoredMaterialListResponse(
      [
        row({ id: "a", code: "MP-A", marketCriticality: "HIGH" }),
        row({ id: "b", code: "MP-B", marketCriticality: "LOW" }),
      ],
      { criticality: "HIGH" }
    );
    assert.equal(items.total, 1);
    assert.equal(items.items[0]?.marketCriticality, "HIGH");
  });

  it("mapeia última cotação do histórico de preços", () => {
    const mapped = mapMonitoredMaterialListItem(
      row({
        id: "a",
        code: "MP-A",
        MaterialPriceHistory: [
          { price: 12.5, effectiveDate: "2026-06-01T00:00:00.000Z" },
        ],
      })
    );
    assert.equal(mapped.lastQuoteAmount, 12.5);
    assert.ok(mapped.lastQuoteDate);
    assert.match(mapped.intelligencePath, /\/materials\/market-intelligence\/a$/);
    assert.match(mapped.monitoringStatusLabel, /Monitorada/);
  });

  it("sem histórico não inventa cotação", () => {
    const quote = resolveMaterialLastQuote({ currentCost: 99, priceHistory: [] });
    assert.equal(quote.amount, null);
    assert.equal(quote.date, null);
  });
});
