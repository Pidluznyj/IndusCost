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

  it("mapeia situação de mercado a partir das cotações", () => {
    const mapped = mapMonitoredMaterialListItem(
      row({
        id: "a",
        code: "MP-A",
        MaterialMarketQuote: [
          {
            id: "q1",
            materialId: "a",
            quoteDate: "2026-01-01",
            price: 100,
            currency: "BRL",
            unit: "KG",
            netPrice: 100,
            status: "ACTIVE",
            createdAt: "2026-01-01T10:00:00Z",
            updatedAt: "2026-01-01T10:00:00Z",
          },
          {
            id: "q2",
            materialId: "a",
            quoteDate: "2026-02-01",
            price: 85,
            currency: "BRL",
            unit: "KG",
            netPrice: 85,
            status: "ACTIVE",
            createdAt: "2026-02-01T10:00:00Z",
            updatedAt: "2026-02-01T10:00:00Z",
          },
        ],
      })
    );
    assert.equal(mapped.marketSituation.status, "OPORTUNIDADE");
  });

  it("mapeia cotação oficial na listagem monitorada", () => {
    const mapped = mapMonitoredMaterialListItem(
      row({
        id: "a",
        code: "MP-A",
        MaterialMarketQuote: [
          {
            id: "q-official",
            materialId: "a",
            supplierName: "Fornecedor Oficial",
            quoteDate: "2026-04-01",
            price: 50,
            currency: "BRL",
            unit: "KG",
            netPrice: 50,
            status: "ACTIVE",
            isOfficialReference: true,
            createdAt: "2026-04-01T10:00:00Z",
            updatedAt: "2026-04-01T10:00:00Z",
          },
        ],
      })
    );
    assert.ok(mapped.officialQuote);
    assert.equal(mapped.officialQuote?.priceBrl, 50);
    assert.equal(mapped.officialQuote?.supplierName, "Fornecedor Oficial");
  });
});
