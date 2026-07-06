import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCommercialPublishedPricesSearchParams,
  COMMERCIAL_PUBLISHED_PRICES_ENDPOINT,
  filterCommercialPublishedRows,
  mapPricingSortToPublishedApiSort,
  NO_PUBLISHED_COMMERCIAL_TABLES_EMPTY_MESSAGE,
  NO_PUBLISHED_PRODUCTS_FILTER_EMPTY_MESSAGE,
  resolveCommercialPublishedEmptyMessage,
} from "./commercialPublishedPricesUi.js";
import type { CommercialPublishedPriceGridRow } from "./commercialPublishedPrices.types.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function sampleRow(overrides?: Partial<CommercialPublishedPriceGridRow>): CommercialPublishedPriceGridRow {
  return {
    productId: "p1",
    sku: "SKU-001",
    productName: "Produto Teste",
    taxInfo: { fiscalRuleId: "tax-1", fiscalRuleName: "Mercado Interno", taxPercent: 10 },
    prices: [
      {
        tableId: "t1",
        tableName: "Atacado",
        versionId: "v1",
        priceItemId: "i1",
        salePrice: 100,
        marginPercent: 25,
        markup: 50,
        commissionPercent: 2,
        taxPercent: 10,
        status: "PUBLISHED",
      },
      {
        tableId: "t2",
        tableName: "Varejo 1",
        versionId: "v2",
        priceItemId: null,
        salePrice: null,
        marginPercent: null,
        markup: null,
        commissionPercent: null,
        taxPercent: null,
        status: "NO_PRICE",
      },
    ],
    lastPublishedAt: "2026-06-01T10:00:00.000Z",
    status: "PARTIAL",
    ...overrides,
  };
}

describe("commercialPublishedPricesUi", () => {
  it("monta URL do endpoint único", () => {
    const qs = buildCommercialPublishedPricesSearchParams({
      search: "iris",
      taxRuleId: "tax-1",
      sort: "SKU_ASC",
      page: 2,
      pageSize: 25,
    });
    assert.equal(`${COMMERCIAL_PUBLISHED_PRICES_ENDPOINT}${qs}`.includes("search=iris"), true);
    assert.equal(`${COMMERCIAL_PUBLISHED_PRICES_ENDPOINT}${qs}`.includes("taxRuleId=tax-1"), true);
    assert.equal(`${COMMERCIAL_PUBLISHED_PRICES_ENDPOINT}${qs}`.includes("sort=SKU_ASC"), true);
  });

  it("sem tabela publicada mostra empty state correto", () => {
    const message = resolveCommercialPublishedEmptyMessage(
      {
        referenceDate: "2026-07-01",
        tables: [],
        rows: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
        totals: { tableCount: 0, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
        message: "Nenhuma tabela comercial publicada vigente encontrada.",
      },
      0,
      false
    );
    assert.equal(message, NO_PUBLISHED_COMMERCIAL_TABLES_EMPTY_MESSAGE);
  });

  it("sem produtos para filtros mostra empty state correto", () => {
    const message = resolveCommercialPublishedEmptyMessage(
      {
        referenceDate: "2026-07-01",
        tables: [{ tableId: "t1", tableName: "Atacado", tableCode: "ATACADO", versionId: "v1", versionNumber: 1, publishedAt: null, effectiveFrom: null, taxRuleId: null, taxRuleName: null, status: "PUBLISHED" }],
        rows: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
        totals: { tableCount: 1, rowCount: 0, pricedCellCount: 0, emptyCellCount: 0 },
        message: null,
      },
      0,
      true
    );
    assert.equal(message, NO_PUBLISHED_PRODUCTS_FILTER_EMPTY_MESSAGE);
  });

  it("filtra por faixa de margem publicada", () => {
    const publishedCell = { ...sampleRow().prices[0]!, status: "PUBLISHED" as const };
    const rows = [
      sampleRow({ productId: "p1", prices: [{ ...publishedCell, marginPercent: 15 }] }),
      sampleRow({ productId: "p2", prices: [{ ...publishedCell, marginPercent: 5 }] }),
    ];
    const filtered = filterCommercialPublishedRows(rows, { marginBand: "FROM_10_TO_20", commissionBand: "ALL" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.productId, "p1");
  });

  it("mapeia ordenação da tela para API", () => {
    assert.equal(mapPricingSortToPublishedApiSort("SKU_ASC"), "SKU_ASC");
    assert.equal(mapPricingSortToPublishedApiSort("NAME_ASC"), "NAME_ASC");
  });
});

describe("pricingModulePublishedGrid", () => {
  const moduleSrc = () => read("src/components/PricingModule.tsx");
  const gridSrc = () => read("src/components/pricing/CommercialPublishedPricesGrid.tsx");
  const hookSrc = () => read("src/components/pricing/useCommercialPublishedPrices.ts");

  it("tela carrega endpoint único de preços publicados", () => {
    assert.match(moduleSrc(), /useCommercialPublishedPrices/);
    assert.match(hookSrc(), /COMMERCIAL_PUBLISHED_PRICES_ENDPOINT/);
    assert.doesNotMatch(hookSrc(), /getProductCostAnalysis/);
  });

  it("grid mostra SKU, produto e colunas dinâmicas de tabela", () => {
    const src = gridSrc();
    assert.match(src, />SKU</);
    assert.match(src, />Produto</);
    assert.match(src, /table\.tableName/);
    assert.match(src, /Sem preço/);
  });

  it("remove mensagem incorreta de premissa do grid principal", () => {
    const src = moduleSrc();
    assert.doesNotMatch(src, /Nenhuma premissa configurada/);
    assert.match(src, /CommercialPublishedPricesGrid/);
    assert.match(src, /Premissas de formação de preço/);
  });

  it("frontend não recalcula preço publicado", () => {
    const src = gridSrc();
    assert.doesNotMatch(src, /calculatePriceTableItemFromFrozenCost/);
    assert.doesNotMatch(src, /suggestedPrice/);
    assert.match(src, /formatCurrency\(price\.salePrice/);
  });

  it("publicação comercial recarrega o grid publicado", () => {
    const module = moduleSrc();
    assert.match(module, /COMMERCIAL_TABLE_PUBLISHED_GRID_SUCCESS_MESSAGE/);
    assert.match(module, /setPublishedGridPage\(1\)/);
    assert.match(module, /await reloadPublishedPrices\(\)/);
  });

  it("reload manual do grid usa cache-bust", () => {
    const src = hookSrc();
    assert.match(src, /_r=\$\{Date\.now\(\)\}/);
  });
});
