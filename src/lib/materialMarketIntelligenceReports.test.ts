import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketIntelligenceReport,
  filterMaterialsForMarketReport,
  MATERIAL_MARKET_REPORT_EMPTY_MESSAGE,
  MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE,
  parseMaterialMarketReportQuery,
  type MaterialMarketReportMaterialInput,
} from "./materialMarketIntelligenceReports.js";

const REF = new Date("2026-07-08T12:00:00.000Z");

function quote(input: {
  id: string;
  materialId: string;
  netPrice: number;
  quoteDate: string;
  supplierName?: string;
  currency?: string;
  status?: string;
}): NonNullable<MaterialMarketReportMaterialInput["MaterialMarketQuote"]>[number] {
  return {
    id: input.id,
    materialId: input.materialId,
    supplierName: input.supplierName ?? "Fornecedor A",
    quoteDate: input.quoteDate,
    price: input.netPrice,
    currency: input.currency ?? "BRL",
    unit: "KG",
    netPrice: input.netPrice,
    status: input.status ?? "ACTIVE",
  };
}

function material(overrides: Partial<MaterialMarketReportMaterialInput> = {}): MaterialMarketReportMaterialInput {
  const id = overrides.id ?? "11111111-1111-1111-1111-111111111111";
  return {
    id,
    code: overrides.code ?? "MP-001",
    description: overrides.description ?? "Resina ABS",
    unit: overrides.unit ?? "KG",
    category: overrides.category ?? "MATERIA_PRIMA",
    currentCost: overrides.currentCost ?? 12,
    isMarketMonitored: overrides.isMarketMonitored ?? true,
    marketCriticality: overrides.marketCriticality ?? "HIGH",
    supplier: overrides.supplier ?? "Cadastro Fornecedor",
    marketMonitoringFrequencyDays: overrides.marketMonitoringFrequencyDays ?? 7,
    MaterialMarketQuote:
      overrides.MaterialMarketQuote ??
      [
        quote({
          id: "q1",
          materialId: id,
          netPrice: 10,
          quoteDate: "2026-07-01",
          supplierName: "Alpha Ltda",
        }),
        quote({
          id: "q2",
          materialId: id,
          netPrice: 11,
          quoteDate: "2026-06-01",
          supplierName: "Beta SA",
        }),
        quote({
          id: "q3",
          materialId: id,
          netPrice: 13,
          quoteDate: "2026-05-01",
          supplierName: "Alpha Ltda",
        }),
      ],
    purchaseLinks: overrides.purchaseLinks,
    bomImpactItems: overrides.bomImpactItems,
    ...overrides,
  };
}

describe("materialMarketIntelligenceReports", () => {
  it("parseia filtros de query com defaults seguros", () => {
    const filters = parseMaterialMarketReportQuery({
      materialId: " mat-1 ",
      supplier: " Alpha ",
      family: "MATERIA_PRIMA",
      period: "30d",
      criticality: "HIGH",
      situation: "CRITICO",
      alertStatus: "OPEN",
      reportType: "opportunities,risks",
    });

    assert.equal(filters.materialId, "mat-1");
    assert.equal(filters.supplier, "Alpha");
    assert.equal(filters.category, "MATERIA_PRIMA");
    assert.equal(filters.period, "30d");
    assert.equal(filters.criticality, "HIGH");
    assert.equal(filters.situation, "CRITICO");
    assert.equal(filters.alertStatus, "OPEN");
    assert.deepEqual(filters.reportTypes, ["opportunities", "risks"]);
  });

  it("filtra matérias por criticidade, categoria, material e fornecedor", () => {
    const rows = [
      material({ id: "a", category: "MATERIA_PRIMA", marketCriticality: "HIGH" }),
      material({
        id: "b",
        code: "MP-002",
        category: "EMBALAGEM",
        marketCriticality: "LOW",
        MaterialMarketQuote: [
          quote({
            id: "qb",
            materialId: "b",
            netPrice: 5,
            quoteDate: "2026-07-01",
            supplierName: "Zeta",
          }),
        ],
      }),
      material({ id: "c", isMarketMonitored: false }),
    ];

    const filtered = filterMaterialsForMarketReport(rows, {
      materialId: null,
      supplier: "alpha",
      category: "MATERIA_PRIMA",
      period: "90d",
      criticality: "HIGH",
      situation: null,
      alertStatus: "ALL",
      reportTypes: null,
    });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, "a");
  });

  it("agrega relatório geral com oportunidades, evolução e fornecedores", () => {
    const report = buildMaterialMarketIntelligenceReport({
      referenceDate: REF,
      materials: [
        material({
          id: "11111111-1111-1111-1111-111111111111",
          currentCost: 15,
          bomImpactItems: [
            {
              productId: "p1",
              productSku: "SKU-1",
              productName: "Produto A",
              quantityConsumed: 2,
              unit: "KG",
              estimatedCurrentCost: 30,
              potentialImpact: 4,
            },
          ],
          purchaseLinks: [
            {
              id: "pl1",
              materialId: "11111111-1111-1111-1111-111111111111",
              quoteId: "q1",
              supplierName: "Alpha Ltda",
              quantityPurchased: 10,
              negotiatedPrice: 9,
              purchaseDate: "2026-07-02",
              estimatedSavings: 10,
              referenceUnitPriceBrl: 10,
              createdAt: "2026-07-02T10:00:00.000Z",
            },
          ],
        }),
      ],
      alerts: [
        {
          id: "al1",
          materialId: "11111111-1111-1111-1111-111111111111",
          alertType: "PRICE_UP_PCT",
          status: "OPEN",
          title: "Alta",
          message: "Preço subiu",
          severity: "WARNING",
          triggeredAt: REF,
          Material: { code: "MP-001", description: "Resina ABS" },
        },
      ],
      globalIndicators: {
        ptax: null,
        brent: {
          price: 75.5,
          currency: "USD",
          unit: "barril",
          variationFromPrevious: 1.2,
          source: "Yahoo Finance",
          lastUpdate: REF.toISOString(),
        },
        lastUpdate: REF.toISOString(),
        sourcesLabel: "Yahoo Finance",
        hasData: true,
      },
    });

    assert.equal(report.empty, false);
    assert.equal(report.summary.monitoredCount, 1);
    assert.equal(report.summary.opportunitiesCount, 1);
    assert.ok(report.summary.potentialSavingsTotal > 0);
    assert.equal(report.summary.obtainedSavingsTotal, 10);
    assert.equal(report.sections.priceEvolution.items.length, 1);
    assert.equal(report.sections.supplierComparison.items[0].comparison.total, 2);
    assert.equal(report.sections.opportunities.items.length, 1);
    assert.equal(report.sections.savingsObtained.items.length, 1);
    assert.equal(report.sections.impactedProducts.totalProducts, 1);
    assert.equal(report.sections.brentImpact.brentPrice, 75.5);
    assert.equal(report.sections.risks.alerts.length, 1);
  });

  it("filtra relatório por matéria-prima específica", () => {
    const report = buildMaterialMarketIntelligenceReport({
      referenceDate: REF,
      filters: { materialId: "22222222-2222-2222-2222-222222222222" },
      materials: [
        material({ id: "11111111-1111-1111-1111-111111111111", code: "MP-001" }),
        material({
          id: "22222222-2222-2222-2222-222222222222",
          code: "MP-002",
          description: "Polietileno",
          currentCost: 20,
          MaterialMarketQuote: [
            quote({
              id: "q21",
              materialId: "22222222-2222-2222-2222-222222222222",
              netPrice: 14,
              quoteDate: "2026-07-01",
            }),
            quote({
              id: "q22",
              materialId: "22222222-2222-2222-2222-222222222222",
              netPrice: 16,
              quoteDate: "2026-06-01",
            }),
          ],
        }),
      ],
    });

    assert.equal(report.materials.length, 1);
    assert.equal(report.materials[0].code, "MP-002");
    assert.equal(report.sections.priceEvolution.items[0].code, "MP-002");
  });

  it("lista matérias sem cotação recente com o mesmo motor de alertas", () => {
    const report = buildMaterialMarketIntelligenceReport({
      referenceDate: REF,
      filters: { reportType: "materials_without_recent_quotes" },
      materials: [
        material({
          id: "33333333-3333-3333-3333-333333333333",
          MaterialMarketQuote: [
            quote({
              id: "old",
              materialId: "33333333-3333-3333-3333-333333333333",
              netPrice: 10,
              quoteDate: "2025-12-01",
            }),
          ],
        }),
      ],
    });

    assert.equal(report.sections.materialsWithoutRecentQuotes.empty, false);
    assert.equal(report.sections.materialsWithoutRecentQuotes.items.length, 1);
    assert.ok((report.sections.materialsWithoutRecentQuotes.items[0].daysSinceLatest ?? 0) > 90);
  });

  it("retorna empty state amigável quando não há dados", () => {
    const report = buildMaterialMarketIntelligenceReport({
      referenceDate: REF,
      materials: [],
    });

    assert.equal(report.empty, true);
    assert.equal(report.emptyMessage, MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE);
    assert.equal(report.sections.opportunities.message, MATERIAL_MARKET_REPORT_EMPTY_MONITORED_MESSAGE);
  });

  it("retorna empty de filtros quando monitoradas existem mas seções ficam vazias", () => {
    const report = buildMaterialMarketIntelligenceReport({
      referenceDate: REF,
      filters: { reportType: "opportunities", period: "7d" },
      materials: [
        material({
          currentCost: 8,
          MaterialMarketQuote: [
            quote({
              id: "cheap",
              materialId: "11111111-1111-1111-1111-111111111111",
              netPrice: 9,
              quoteDate: "2026-07-07",
            }),
          ],
        }),
      ],
    });

    assert.equal(report.sections.opportunities.empty, true);
    assert.equal(report.sections.opportunities.message, MATERIAL_MARKET_REPORT_EMPTY_MESSAGE);
  });
});
