import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketPriceHistoryResponse,
  buildMaterialMarketPriceHistorySupplierSeries,
  computeMaterialQuotePriceBRL,
  parseMaterialMarketPriceHistoryQuery,
  resolveMaterialMarketPriceHistoryPeriodRange,
  type MaterialMarketPriceHistoryPoint,
} from "./materialMarketPriceHistory.js";
import type { MaterialMarketSupplierComparisonRow } from "./materialMarketSupplierComparison.js";

const REF = new Date("2026-07-08T12:00:00Z");

describe("materialMarketPriceHistory", () => {
  it("resolve períodos predefinidos", () => {
    const r30 = resolveMaterialMarketPriceHistoryPeriodRange("30d", undefined, undefined, REF);
    assert.ok(r30);
    assert.equal(r30.dateTo, "2026-07-08");
    assert.equal(r30.dateFrom, "2026-06-08");

    const r6m = resolveMaterialMarketPriceHistoryPeriodRange("6m", undefined, undefined, REF);
    assert.ok(r6m);
    assert.equal(r6m.dateFrom, "2026-01-08");
  });

  it("período personalizado exige intervalo válido", () => {
    assert.equal(
      resolveMaterialMarketPriceHistoryPeriodRange("custom", "2026-01-01", "", REF),
      null
    );
    assert.equal(
      resolveMaterialMarketPriceHistoryPeriodRange("custom", "2026-02-01", "2026-01-01", REF),
      null
    );

    const ok = resolveMaterialMarketPriceHistoryPeriodRange(
      "custom",
      "2026-01-01",
      "2026-06-30",
      REF
    );
    assert.ok(ok);
    assert.equal(ok.dateFrom, "2026-01-01");
    assert.equal(ok.dateTo, "2026-06-30");
  });

  it("parseMaterialMarketPriceHistoryQuery usa 12m como padrão", () => {
    const parsed = parseMaterialMarketPriceHistoryQuery({ period: "invalid" }, REF);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.range.preset, "12m");
      assert.equal(parsed.range.dateTo, "2026-07-08");
    }
  });

  it("parseMaterialMarketPriceHistoryQuery falha em custom incompleto", () => {
    const parsed = parseMaterialMarketPriceHistoryQuery({ period: "custom" }, REF);
    assert.equal(parsed.ok, false);
  });

  it("converte BRL e USD para série do gráfico", () => {
    const brl = computeMaterialQuotePriceBRL({ netPrice: 100, currency: "BRL" });
    assert.equal(brl.priceBRL, 100);
    assert.equal(brl.exchangeRateUsed, null);

    const usd = computeMaterialQuotePriceBRL({
      netPrice: 10,
      currency: "USD",
      exchangeRateUsed: 5.5,
    });
    assert.equal(usd.priceBRL, 55);
    assert.equal(usd.exchangeRateUsed, 5.5);
  });

  it("mapeia DTO da série com filtro de período", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketPriceHistoryResponse({
      range,
      exchangeRatesByDate: new Map([["2026-06-15", 5.2]]),
      rows: [
        {
          id: "q1",
          materialId: "m1",
          quoteDate: "2026-05-10",
          price: 80,
          currency: "BRL",
          unit: "kg",
          netPrice: 85,
          status: "ACTIVE",
          supplierName: "Fornecedor A",
          notes: "Lote piloto",
          createdAt: "2026-05-11T10:00:00Z",
          updatedAt: "2026-05-11T10:00:00Z",
        },
        {
          id: "q2",
          materialId: "m1",
          quoteDate: "2026-06-15",
          price: 12,
          currency: "USD",
          unit: "kg",
          netPrice: 13,
          status: "ACTIVE",
          supplierName: "Fornecedor B",
          createdAt: "2026-06-16T10:00:00Z",
          updatedAt: "2026-06-16T10:00:00Z",
        },
        {
          id: "q3",
          materialId: "m1",
          quoteDate: "2025-01-01",
          price: 50,
          currency: "BRL",
          unit: "kg",
          netPrice: 50,
          status: "ACTIVE",
          createdAt: "2025-01-02T10:00:00Z",
          updatedAt: "2025-01-02T10:00:00Z",
        },
      ],
    });

    assert.equal(response.total, 2);
    assert.deepEqual(
      response.points.map((p) => p.id),
      ["q1", "q2"]
    );
    assert.equal(response.points[0]?.priceBRL, 85);
    assert.equal(response.points[1]?.originalCurrency, "USD");
    assert.equal(response.points[1]?.priceBRL, 67.6);
    assert.equal(response.points[1]?.exchangeRateUsed, 5.2);
    assert.equal(response.points[1]?.supplierName, "Fornecedor B");
    assert.equal(response.points[0]?.supplierKey, "name:fornecedor a");
    assert.equal(response.points[1]?.supplierKey, "name:fornecedor b");
  });

  it("cotação sem fornecedor cai numa chave estável 'unknown'", () => {
    const range = resolveMaterialMarketPriceHistoryPeriodRange("90d", undefined, undefined, REF)!;
    const response = buildMaterialMarketPriceHistoryResponse({
      range,
      rows: [
        {
          id: "q1",
          materialId: "m1",
          quoteDate: "2026-06-01",
          price: 10,
          currency: "BRL",
          unit: "kg",
          netPrice: 10,
          status: "ACTIVE",
          createdAt: "2026-06-02T10:00:00Z",
          updatedAt: "2026-06-02T10:00:00Z",
        },
      ],
    });
    assert.equal(response.points[0]?.supplierKey, "unknown");
    assert.equal(response.points[0]?.supplierId, null);
  });
});

function point(supplierKey: string, date: string, priceBRL: number): MaterialMarketPriceHistoryPoint {
  return {
    id: `${supplierKey}-${date}`,
    date,
    dateLabel: date,
    supplierId: null,
    supplierKey,
    supplierName: supplierKey,
    originalCurrency: "BRL",
    originalPrice: priceBRL,
    priceBRL,
    exchangeRateUsed: null,
    notes: null,
  };
}

function rankRow(
  supplierKey: string,
  averagePrice: number,
  isStale: boolean
): Pick<
  MaterialMarketSupplierComparisonRow,
  "supplierKey" | "supplierId" | "supplierName" | "averagePrice" | "isStale"
> {
  return { supplierKey, supplierId: null, supplierName: supplierKey, averagePrice, isStale };
}

describe("buildMaterialMarketPriceHistorySupplierSeries — seleção das linhas do gráfico", () => {
  it("com 3 fornecedores ou menos, mostra todos (mesmo com algum desatualizado)", () => {
    const points = [point("a", "2026-01-01", 10), point("b", "2026-01-01", 8)];
    // ranking já vem ordenado ascendente por preço médio (contrato real do caller).
    const ranking = [rankRow("b", 8, true), rankRow("a", 10, false)];
    const { series, totalSuppliers } = buildMaterialMarketPriceHistorySupplierSeries(
      points,
      ranking
    );
    assert.equal(totalSuppliers, 2);
    assert.deepEqual(
      series.map((s) => s.supplierKey),
      ["b", "a"] // ordem do ranking recebido, preservada — nenhum corte com só 2 fornecedores
    );
  });

  it("com mais de 3, corta para os 3 com melhor preço médio E cotação atualizada", () => {
    const points = [
      point("a", "2026-01-01", 10),
      point("b", "2026-01-01", 8),
      point("c", "2026-01-01", 6),
      point("d", "2026-01-01", 5),
      point("e", "2026-01-01", 4),
    ];
    // ranking já ordenado por menor preço médio: e < d < c < b < a
    const ranking = [
      rankRow("e", 4, true), // mais barato, mas desatualizado — não pode entrar
      rankRow("d", 5, false),
      rankRow("c", 6, false),
      rankRow("b", 8, false),
      rankRow("a", 10, false),
    ];
    const { series, totalSuppliers } = buildMaterialMarketPriceHistorySupplierSeries(
      points,
      ranking
    );
    assert.equal(totalSuppliers, 5);
    assert.deepEqual(
      series.map((s) => s.supplierKey),
      ["d", "c", "b"] // pula "e" (desatualizado), pega os 3 seguintes mais baratos
    );
  });

  it("se sobrarem menos de 3 atualizados após o corte, mostra só esses (nunca completa com desatualizado)", () => {
    const points = [
      point("a", "2026-01-01", 10),
      point("b", "2026-01-01", 8),
      point("c", "2026-01-01", 6),
      point("d", "2026-01-01", 5),
    ];
    const ranking = [
      rankRow("d", 5, true),
      rankRow("c", 6, true),
      rankRow("b", 8, false),
      rankRow("a", 10, false),
    ];
    const { series } = buildMaterialMarketPriceHistorySupplierSeries(points, ranking);
    assert.deepEqual(
      series.map((s) => s.supplierKey),
      ["b", "a"]
    );
  });

  it("ignora do ranking fornecedores sem cotação no período filtrado dos pontos", () => {
    const points = [point("a", "2026-01-01", 10)];
    const ranking = [rankRow("a", 10, false), rankRow("z", 1, false)];
    const { series, totalSuppliers } = buildMaterialMarketPriceHistorySupplierSeries(
      points,
      ranking
    );
    assert.equal(totalSuppliers, 1);
    assert.deepEqual(series.map((s) => s.supplierKey), ["a"]);
  });
});
