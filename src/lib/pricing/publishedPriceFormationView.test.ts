import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { CommercialPublishedPriceGridRow } from "./commercialPublishedPrices.types.js";
import {
  isPublishedPriceCellClickable,
  mapPublishedPriceApiToFormationResult,
  NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE,
  PUBLISHED_DETAIL_UNAVAILABLE_NOTE,
  PUBLISHED_FIELD_UNAVAILABLE_LABEL,
  resolveDefaultPublishedTableSelection,
  resolvePublishedPriceCellSelection,
  resolvePublishedPriceSelectionForRow,
} from "./publishedPriceFormationView.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function sampleRow(overrides?: Partial<CommercialPublishedPriceGridRow>): CommercialPublishedPriceGridRow {
  return {
    productId: "prod-1",
    sku: "SKU-001",
    productName: "Produto A",
    taxInfo: { fiscalRuleId: "tax-1", fiscalRuleName: "Mercado Interno", taxPercent: 10 },
    prices: [
      {
        tableId: "t-atacado",
        tableName: "Atacado",
        versionId: "v1",
        priceItemId: "item-1",
        salePrice: 100,
        marginPercent: 20,
        markup: 50,
        commissionPercent: 2,
        taxPercent: 10,
        status: "PUBLISHED",
      },
      {
        tableId: "t-varejo",
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

describe("publishedPriceFormationView", () => {
  const tables = [
    {
      tableId: "t-atacado",
      tableName: "Atacado",
      tableCode: "ATACADO",
      versionId: "v1",
      versionNumber: 3,
      publishedAt: "2026-06-01T10:00:00.000Z",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      taxRuleId: "tax-1",
      taxRuleName: "Mercado Interno",
      status: "PUBLISHED",
    },
    {
      tableId: "t-varejo",
      tableName: "Varejo 1",
      tableCode: "VAREJO_1",
      versionId: "v2",
      versionNumber: 2,
      publishedAt: "2026-06-02T10:00:00.000Z",
      effectiveFrom: "2026-01-01T00:00:00.000Z",
      taxRuleId: "tax-1",
      taxRuleName: "Mercado Interno",
      status: "PUBLISHED",
    },
  ];

  it("usa tabela principal quando marcada", () => {
    const selected = resolveDefaultPublishedTableSelection(
      [
        { tableId: "t-varejo", tableCode: "VAREJO_1", tableName: "Varejo 1" },
        { tableId: "t-atacado", tableCode: "ATACADO", tableName: "Atacado", isPrimary: true },
      ],
      { primaryTableId: null }
    );
    assert.equal(selected?.tableId, "t-atacado");
  });

  it("usa primeira tabela vigente quando não há principal", () => {
    const selected = resolveDefaultPublishedTableSelection(tables);
    assert.equal(selected?.tableId, "t-atacado");
  });

  it("seleciona preço da tabela principal ou primeira com preço publicado", () => {
    const selection = resolvePublishedPriceSelectionForRow(sampleRow(), tables);
    assert.equal(selection?.table.tableId, "t-atacado");
    assert.equal(selection?.price.priceItemId, "item-1");
  });

  it("respeita tabela preferida ao clicar na célula", () => {
    const row = sampleRow({
      prices: [
        {
          tableId: "t-atacado",
          tableName: "Atacado",
          versionId: "v1",
          priceItemId: "item-1",
          salePrice: 100,
          marginPercent: 20,
          markup: 50,
          commissionPercent: 2,
          taxPercent: 10,
          status: "PUBLISHED",
        },
        {
          tableId: "t-varejo",
          tableName: "Varejo 1",
          versionId: "v2",
          priceItemId: "item-2",
          salePrice: 120,
          marginPercent: 25,
          markup: 60,
          commissionPercent: 3,
          taxPercent: 10,
          status: "PUBLISHED",
        },
      ],
    });
    const atacado = resolvePublishedPriceCellSelection(row, tables, "t-atacado");
    const varejo = resolvePublishedPriceCellSelection(row, tables, "t-varejo");
    assert.equal(atacado?.table.tableId, "t-atacado");
    assert.equal(atacado?.price.salePrice, 100);
    assert.equal(varejo?.table.tableId, "t-varejo");
    assert.equal(varejo?.price.salePrice, 120);
  });

  it("clique na linha usa tabela padrão sem preferredTableId", () => {
    const row = sampleRow({
      prices: [
        {
          tableId: "t-atacado",
          tableName: "Atacado",
          versionId: "v1",
          priceItemId: "item-1",
          salePrice: 28.97,
          marginPercent: 20,
          markup: 50,
          commissionPercent: 2,
          taxPercent: 10,
          status: "PUBLISHED",
        },
        {
          tableId: "t-varejo",
          tableName: "Varejo 1",
          versionId: "v2",
          priceItemId: "item-2",
          salePrice: 31.5,
          marginPercent: 25,
          markup: 60,
          commissionPercent: 3,
          taxPercent: 10,
          status: "PUBLISHED",
        },
      ],
    });
    const selection = resolvePublishedPriceSelectionForRow(row, tables, {
      primaryTableId: null,
    });
    assert.equal(selection?.table.tableId, "t-atacado");
    assert.equal(selection?.price.salePrice, 28.97);
  });

  it("célula sem preço não é clicável", () => {
    const price = sampleRow().prices[1];
    assert.equal(isPublishedPriceCellClickable(price), false);
    assert.equal(resolvePublishedPriceCellSelection(sampleRow(), tables, "t-varejo"), null);
  });

  it("produto sem preço publicado não retorna seleção", () => {
    const selection = resolvePublishedPriceSelectionForRow(
      sampleRow({
        prices: sampleRow().prices.map((price) => ({
          ...price,
          status: "NO_PRICE" as const,
          salePrice: null,
          priceItemId: null,
        })),
        status: "NO_PRICE",
      }),
      tables
    );
    assert.equal(selection, null);
  });

  it("mapeia resposta publicada sem recalcular preço sugerido", () => {
    const mapped = mapPublishedPriceApiToFormationResult(
      {
        item: {
          priceTableItemId: "item-1",
          frozenTotalCost: 50,
          frozenMaterialCost: 30,
          frozenHhCost: 10,
          frozenHmCost: 10,
          frozenTaxCost: 10,
          frozenOtherCost: 5,
          marginPct: 20,
          salePrice: 100,
          commissionPerc: 2,
          commissionValue: 2,
          formulaSnapshotJson: {
            rates: { taxRate: 0.1, commissionRate: 0.02, otherRate: 0 },
            freight: 0,
            divisor: 0.68,
          },
          costSnapshotJson: { costSource: "VERSIONED_PRODUCTION_COST_TABLE" },
        },
        proposalDefaults: { freightValue: 0 },
      },
      {
        table: tables[0]!,
        priceItemId: "item-1",
        clickedSalePrice: 100,
        sku: "SKU-001",
        productName: "Produto A",
        productId: "prod-1",
        taxRuleName: "Mercado Interno",
        taxRuleId: "tax-1",
      }
    );

    assert.equal(mapped.viewMode, "PUBLISHED");
    assert.equal(mapped.resultados.suggestedPrice, 100);
    assert.equal(mapped.publishedMeta.clickedSalePrice, 100);
    assert.equal(mapped.publishedMeta.source, "PUBLISHED_PRICE_TABLE");
    assert.equal(mapped.publishedMeta.tableName, "Atacado");
    assert.equal(mapped.publishedMeta.versionNumber, 3);
    assert.equal(mapped.pricingBreakdown, null);
    assert.equal(mapped.publishedMeta.hasDetailedComposition, false);
    assert.equal(mapped.publishedMeta.detailUnavailableNote, PUBLISHED_DETAIL_UNAVAILABLE_NOTE);
    assert.equal(mapped.resultados.totalTaxes, 10);
    assert.equal(mapped.resultados.totalCommission, 2);
    assert.equal(mapped.premissas.marginRate, 20);
  });

  it("valor do modal publicado coincide com a célula do grid", () => {
    const cellPrice = 28.97;
    const mapped = mapPublishedPriceApiToFormationResult(
      {
        item: {
          priceTableItemId: "item-1",
          frozenTotalCost: 19.31,
          frozenMaterialCost: 12,
          frozenHhCost: 4,
          frozenHmCost: 3.31,
          frozenTaxCost: 2.9,
          frozenOtherCost: 1.2,
          marginPct: 20,
          salePrice: cellPrice,
          commissionPerc: 2,
          commissionValue: 0.58,
          formulaSnapshotJson: {
            rates: { taxRate: 0.1, commissionRate: 0.02, otherRate: 0 },
            freight: 0,
          },
          costSnapshotJson: { costSource: "VERSIONED_PRODUCTION_COST_TABLE" },
        },
      },
      {
        table: tables[0]!,
        priceItemId: "item-1",
        clickedSalePrice: cellPrice,
        sku: "SKU-001",
        productName: "Produto A",
        productId: "prod-1",
      }
    );

    assert.equal(mapped.resultados.suggestedPrice, cellPrice);
    assert.equal(mapped.publishedMeta.clickedSalePrice, cellPrice);
    assert.equal(mapped.publishedMeta.publishedSummary.salePrice, cellPrice);
  });

  it("não monta pricingBreakdown nem chama motor de cálculo ao vivo", () => {
    const viewSrc = read("src/lib/pricing/publishedPriceFormationView.ts");
    assert.doesNotMatch(viewSrc, /buildPricingUnitCalculationBreakdown/);
    assert.doesNotMatch(viewSrc, /getProductCostAnalysis/);
    assert.doesNotMatch(viewSrc, /\/api\/pricing\//);
  });

  it("campos ausentes no snapshot ficam marcados como indisponíveis", () => {
    const mapped = mapPublishedPriceApiToFormationResult(
      {
        item: {
          priceTableItemId: "item-legacy",
          frozenTotalCost: 50,
          frozenMaterialCost: 30,
          frozenHhCost: 10,
          frozenHmCost: 10,
          frozenTaxCost: 10,
          frozenOtherCost: 5,
          marginPct: 20,
          salePrice: 100,
          commissionPerc: 2,
          commissionValue: 2,
          formulaSnapshotJson: null,
          costSnapshotJson: null,
        },
      },
      {
        table: tables[0]!,
        priceItemId: "item-legacy",
        clickedSalePrice: 100,
        sku: "SKU-001",
        productName: "Produto A",
        productId: "prod-1",
      }
    );

    assert.ok(mapped.publishedMeta.unavailableFields.includes("taxRatePercent"));
    assert.ok(mapped.publishedMeta.unavailableFields.includes("freight"));
    assert.ok(mapped.publishedMeta.unavailableFields.includes("detailedComposition"));
    assert.ok(mapped.publishedMeta.unavailableFields.includes("productionCostReference"));
    assert.equal(mapped.premissas.taxRate, null);
    assert.equal(mapped.premissas.freight, null);
    assert.equal(mapped.pricingBreakdown, null);
  });
});

describe("pricingModulePublishedFormationModal", () => {
  const moduleSrc = () => read("src/components/PricingModule.tsx");
  const gridSrc = () => read("src/components/pricing/CommercialPublishedPricesGrid.tsx");

  it("clique na linha abre formação publicada", () => {
    assert.match(moduleSrc(), /handleOpenPublishedFormation/);
    assert.match(moduleSrc(), /onRowClick=\{\(row\) => void handleOpenPublishedFormation\(row\)\}/);
    assert.match(gridSrc(), /onClick=\{\(\) => onRowClick\(row\)\}/);
  });

  it("produto sem preço mostra aviso e não abre modal diretamente", () => {
    assert.match(moduleSrc(), /NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE/);
    assert.match(moduleSrc(), /window\.alert\(NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE\)/);
  });

  it("modal mantém abas existentes e exibe metadados publicados", () => {
    const src = moduleSrc();
    assert.match(src, /Resumo da Formação/);
    assert.match(src, /Composição do Preço/);
    assert.match(src, /Composição Detalhada do Preço/);
    assert.match(src, /publishedFormationMeta/);
    assert.match(src, /Preço publicado/);
    assert.match(src, /Simulação ao vivo/);
    assert.match(src, /PUBLISHED_DETAIL_UNAVAILABLE_NOTE/);
    assert.match(src, /PUBLISHED_FIELD_UNAVAILABLE_LABEL/);
  });

  it("modal publicado não recalcula composição detalhada", () => {
    const src = moduleSrc();
    assert.match(src, /calculationResult\.pricingBreakdown == null/);
    assert.match(src, /PUBLISHED_DETAIL_UNAVAILABLE_NOTE/);
  });

  it("modal publicado inclui aba Fonte do Preço", () => {
    const src = moduleSrc();
    assert.match(src, /Fonte do Preço/);
    assert.match(src, /PublishedPriceSourceTraceTab/);
    assert.match(src, /buildPublishedPriceSourceTraceUrl/);
  });

  it("simulação ao vivo continua separada do clique publicado", () => {
    const src = moduleSrc();
    assert.match(src, /setPublishedFormationMeta\(null\)/);
    assert.match(src, /handleCalculateUnit/);
    assert.doesNotMatch(src, /handleCalculateUnit[\s\S]{0,120}handleOpenPublishedFormation/);
  });

  it("célula de preço não propaga clique para a linha", () => {
    assert.match(gridSrc(), /event\.stopPropagation\(\)/);
    assert.match(gridSrc(), /onPriceCellClick\(row, table\.tableId\)/);
    assert.match(gridSrc(), /isPublishedPriceCellClickable/);
  });

  it("sem preço não é clicável no grid", () => {
    const src = gridSrc();
    assert.match(src, /Sem preço/);
    assert.match(src, /clickable \? handleCellOpen : undefined/);
    assert.match(src, /cursor-default/);
  });

  it("handleOpenPublishedFormation usa seleção por célula quando tableId é informado", () => {
    const src = moduleSrc();
    assert.match(src, /resolvePublishedPriceCellSelection/);
    assert.match(src, /preferredTableId != null && preferredTableId\.trim\(\) !== ""/);
    assert.match(src, /clickedSalePrice: selection\.price\.salePrice/);
  });

  it("mensagem de ausência de preço documentada", () => {
    assert.equal(
      NO_PUBLISHED_PRICE_FOR_ROW_MESSAGE,
      "Este produto não possui preço publicado em nenhuma tabela comercial vigente."
    );
  });
});
