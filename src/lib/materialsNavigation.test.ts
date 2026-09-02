import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getMaterialMarketQuoteReliabilityApiPath,
  getMaterialsDefaultPath,
  isMaterialsCanonicalPath,
  MATERIALS_SECTION_PATHS,
  MATERIALS_SECTIONS,
  parseMaterialsSectionFromPath,
  resolveMaterialsCanonicalPath,
} from "./materialsNavigation.js";

const ROOT = process.cwd();

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

describe("materialsNavigation", () => {
  it("seções incluem Matérias-primas, Conferência e Inteligência de Mercado", () => {
    assert.deepEqual(
      MATERIALS_SECTIONS.map((s) => s.label),
      ["Matérias-primas", "Conferência de estoque", "Inteligência de Mercado"]
    );
  });

  it("rota canônica de conferência de estoque", () => {
    assert.equal(MATERIALS_SECTION_PATHS.stockConference, "/materials/stock-conference");
    assert.equal(
      parseMaterialsSectionFromPath("/materials/stock-conference"),
      "stockConference"
    );
    assert.equal(
      parseMaterialsSectionFromPath("/materials/stock-conference/abc"),
      "stockConference"
    );
    assert.equal(isMaterialsCanonicalPath("/materials/stock-conference"), true);
    assert.equal(isMaterialsCanonicalPath("/materials/stock-conference/abc"), true);
    assert.equal(
      resolveMaterialsCanonicalPath("/materials/stock-conference/abc"),
      "/materials/stock-conference/abc"
    );
  });

  it("rota canônica de inteligência de mercado", () => {
    assert.equal(MATERIALS_SECTION_PATHS.marketIntelligence, "/materials/market-intelligence");
    assert.equal(parseMaterialsSectionFromPath("/materials/market-intelligence"), "marketIntelligence");
    assert.equal(isMaterialsCanonicalPath("/materials/market-intelligence"), true);
  });

  it("rota padrão permanece /materials", () => {
    assert.equal(getMaterialsDefaultPath(), "/materials");
    assert.equal(parseMaterialsSectionFromPath("/materials"), "catalog");
    assert.equal(resolveMaterialsCanonicalPath("/materials/unknown"), "/materials");
  });

  it("App.tsx declara materials/* e MaterialsModule", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path=["']materials\/\*["']/);
    assert.match(app, /<MaterialsModule\s*\/>/);
  });

  it("página inicial exibe indicadores globais e lista de monitoradas", () => {
    const page = read("src/components/materials/MaterialsMarketIntelligencePage.tsx");
    const list = read("src/components/materials/MaterialsMarketIntelligenceMonitoredList.tsx");
    const indicators = read(
      "src/components/materials/MaterialsMarketGlobalIndicatorsSection.tsx"
    );
    assert.match(list, /MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE/);
    assert.match(page, /materials-market-intelligence-page/);
    assert.match(page, /MaterialsMarketGlobalIndicatorsSection/);
    assert.match(indicators, /Dólar PTAX venda/);
    assert.match(indicators, /Dólar PTAX compra/);
    assert.match(indicators, /Brent USD\/barril/);
    assert.match(indicators, /MARKET_GLOBAL_INDICATORS_EMPTY_MESSAGE/);
    assert.match(indicators, /MARKET_GLOBAL_INDICATORS_API/);
  });

  it("API agrega indicadores globais PTAX e Brent", () => {
    const server = read("server.ts");
    const routes = read("src/lib/marketGlobalIndicatorsRoutes.ts");
    assert.match(server, /registerMarketGlobalIndicatorsRoutes/);
    assert.match(routes, /\/api\/market-intelligence\/global-indicators/);
  });

  it("API expõe PATCH de monitoramento de mercado", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/materials\/:id\/market-monitoring/);
    assert.match(server, /parseMaterialMarketMonitoringInput/);
  });

  it("API lista matérias monitoradas com busca e criticidade", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/materials\/market-intelligence\/monitored/);
    assert.match(server, /buildMonitoredMaterialListResponse/);
  });

  it("rota individual de inteligência preparada", () => {
    const module = read("src/components/MaterialsModule.tsx");
    const list = read("src/components/materials/MaterialsMarketIntelligenceMonitoredList.tsx");
    const catalog = read("src/components/MaterialModule.tsx");
    assert.match(module, /market-intelligence\/:materialId/);
    assert.match(module, /MaterialsMarketIntelligenceDetailPage/);
    assert.match(list, /Ver Inteligência/);
    assert.match(catalog, /material-intelligence-link-/);
    assert.match(catalog, /Inteligência/);
  });

  it("relatório executivo de inteligência de mercado", () => {
    const module = read("src/components/MaterialsModule.tsx");
    const page = read("src/components/materials/MaterialsMarketIntelligenceReportsPage.tsx");
    const home = read("src/components/materials/MaterialsMarketIntelligencePage.tsx");
    const nav = read("src/lib/materialsNavigation.ts");
    const server = read("server.ts");
    assert.match(module, /market-intelligence\/reports/);
    assert.match(module, /MaterialsMarketIntelligenceReportsPage/);
    assert.match(page, /materials-market-intelligence-reports-page/);
    assert.match(home, /MATERIALS_MARKET_INTELLIGENCE_REPORTS_PATH/);
    assert.match(nav, /MATERIALS_MARKET_INTELLIGENCE_REPORTS_API/);
    assert.match(nav, /getMaterialMarketIntelligenceReportsApiPath/);
    assert.match(server, /\/api\/materials\/market-intelligence\/reports/);
    assert.match(server, /buildMaterialMarketIntelligenceReportForApi/);
    assert.equal(
      isMaterialsCanonicalPath("/materials/market-intelligence/reports"),
      true
    );
  });

  it("API de detalhe por matéria-prima", () => {
    const server = read("server.ts");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId/);
    assert.match(server, /mapMaterialIntelligenceDetail/);
  });

  it("detalhe preserva rota individual na canonicalização", () => {
    const detail = "/materials/market-intelligence/abc-123";
    assert.equal(isMaterialsCanonicalPath(detail), true);
    assert.equal(resolveMaterialsCanonicalPath(detail), detail);
  });

  it("visão 360º individual com seções preparadas", () => {
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    const header = read("src/components/materials/MaterialIntelligence360Header.tsx");
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(detail, /material-intelligence-360-page/);
    assert.match(detail, /MaterialIntelligence360Header/);
    assert.match(detail, /MaterialIntelligenceRecentQuotesSection/);
    assert.match(detail, /MaterialIntelligenceActivatePanel/);
    assert.match(header, /Observações estratégicas/);
    assert.match(header, /material-intelligence-360-header/);
    assert.match(detail, /MATERIAL_INTELLIGENCE_360_PLACEHOLDER_SECTIONS/);
    assert.match(quotes, /material-intelligence-360-recent-quotes-empty/);
  });

  it("schema Material possui campos de monitoramento", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /isMarketMonitored/);
    assert.match(schema, /marketCriticality/);
    assert.match(schema, /marketMonitoringFrequencyDays/);
    assert.match(schema, /marketNotes/);
  });

  it("API de cotações manuais de mercado", () => {
    const server = read("server.ts");
    const form = read("src/components/materials/MaterialIntelligenceMarketQuoteForm.tsx");
    const modal = read("src/components/materials/MaterialIntelligenceMarketQuoteModal.tsx");
    const supplierField = read("src/components/materials/MaterialMarketQuoteSupplierField.tsx");
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/quotes/);
    assert.match(server, /materialMarketQuote\.create/);
    assert.match(server, /parseMaterialMarketQuoteInput/);
    assert.match(form, /material-market-quote-submit/);
    assert.match(form, /MaterialMarketQuoteSupplierField/);
    assert.match(form, /supplierId/);
    assert.match(modal, /material-intelligence-market-quote-modal/);
    assert.match(supplierField, /material-market-quote-supplier-search/);
    assert.match(supplierField, /material-market-quote-supplier-free-text-option/);
    assert.match(detail, /MaterialIntelligenceMarketQuoteModal/);
    const header = read("src/components/materials/MaterialIntelligence360Header.tsx");
    assert.match(header, /material-intelligence-register-quote-header/);
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    assert.match(quotes, /material-intelligence-register-quote-section/);
  });

  it("API de impacto financeiro nos produtos vinculados", () => {
    const server = read("server.ts");
    const section = read("src/components/materials/MaterialIntelligenceFinancialImpactSection.tsx");
    const nav = read("src/lib/materialsNavigation.ts");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/financial-impact/);
    assert.match(server, /buildMaterialProductFinancialImpactForApi/);
    assert.match(nav, /financial-impact/);
    assert.match(section, /material-intelligence-financial-impact/);
    assert.match(section, /Simulação — não altera custo padrão/);
  });

  it("API de economia potencial e oportunidades", () => {
    const server = read("server.ts");
    const savings = read("src/components/materials/MaterialIntelligenceSavingsOpportunitySection.tsx");
    const home = read("src/components/materials/MaterialsMarketIntelligenceTopOpportunityCard.tsx");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/savings/);
    assert.match(server, /\/api\/materials\/market-intelligence\/opportunities/);
    assert.match(server, /rankMaterialMarketSavingsOpportunities/);
    assert.match(savings, /material-intelligence-savings-opportunity/);
    assert.match(home, /materials-market-intelligence-top-opportunity-card/);
  });

  it("schema possui MaterialMarketQuote append-only", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model MaterialMarketQuote/);
    assert.match(schema, /netPrice/);
    assert.match(schema, /supplierName/);
    assert.match(schema, /exchangeOrigin/);
    assert.match(schema, /manualExchangeJustification/);
  });

  it("API de câmbio manual PTAX com permissão e preview", () => {
    const server = read("server.ts");
    const form = read("src/components/materials/MaterialIntelligenceMarketQuoteForm.tsx");
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    const catalog = read("src/lib/permissionCatalog.ts");
    assert.match(server, /\/api\/materials\/market-intelligence\/ptax-preview/);
    assert.match(server, /resolveMaterialMarketQuoteExchange/);
    assert.match(catalog, /materials\.market_quote\.manual_exchange/);
    assert.match(form, /material-market-quote-manual-exchange-rate/);
    assert.match(form, /material-market-quote-manual-exchange-justification/);
    assert.match(quotes, /Câmbio informado manualmente/);
  });

  it("API de histórico de preços para gráfico 360º", () => {
    const server = read("server.ts");
    const chart = read("src/components/materials/MaterialIntelligencePriceHistoryChart.tsx");
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/price-history/);
    assert.match(server, /buildMaterialMarketPriceHistoryResponse/);
    assert.match(chart, /material-intelligence-price-history-chart/);
    assert.match(chart, /recharts/);
    assert.match(detail, /MaterialIntelligencePriceHistoryChart/);
  });

  it("API de gráfico comparativo de mercado 360º", () => {
    const server = read("server.ts");
    const chart = read("src/components/materials/MaterialIntelligenceComparativeChart.tsx");
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/comparative-chart/);
    assert.match(server, /buildMaterialMarketComparativeChartResponse/);
    assert.match(chart, /material-intelligence-comparative-chart/);
    assert.match(chart, /Comparativo de mercado/);
    assert.match(detail, /MaterialIntelligenceComparativeChart/);
  });

  it("API compara fornecedores por matéria-prima", () => {
    const server = read("server.ts");
    const section = read("src/components/materials/MaterialIntelligenceSuppliersSection.tsx");
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/suppliers/);
    assert.match(server, /buildMaterialMarketSupplierComparison/);
    assert.match(section, /material-intelligence-suppliers-table/);
    assert.match(section, /Sem cotação recente/);
    assert.match(detail, /MaterialIntelligenceSuppliersSection/);
  });

  it("API e seção de produtos impactados via BOM oficial", () => {
    const server = read("server.ts");
    const section = read("src/components/materials/MaterialIntelligenceImpactedProductsSection.tsx");
    const detail = read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx");
    const nav = read("src/lib/materialsNavigation.ts");
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/impacted-products/);
    assert.match(server, /buildMaterialBomImpactForApi/);
    assert.match(nav, /getMaterialMarketIntelligenceImpactedProductsApiPath/);
    assert.match(section, /material-intelligence-impacted-products-(table|empty)/);
    assert.match(section, /MATERIAL_BOM_IMPACT_EMPTY_MESSAGE/);
    assert.match(detail, /MaterialIntelligenceImpactedProductsSection/);
  });

  it("API de commodity Brent (coleta manual e último snapshot)", () => {
    const server = read("server.ts");
    const routes = read("src/lib/brentCommodityRoutes.ts");
    const nav = read("src/lib/materialsNavigation.ts");
    const schema = read("prisma/schema.prisma");
    assert.match(server, /registerBrentCommodityRoutes/);
    assert.match(routes, /\/api\/market-intelligence\/commodities\/brent\/latest/);
    assert.match(routes, /\/api\/market-intelligence\/commodities\/brent\/collect/);
    assert.match(nav, /BRENT_COMMODITY_LATEST_API/);
    assert.match(schema, /model CommoditySnapshot/);
    assert.match(schema, /variationFromPrevious/);
  });

  it("API de confiabilidade de cotação de mercado", () => {
    assert.equal(
      getMaterialMarketQuoteReliabilityApiPath("mat-1", "quote-1"),
      "/api/materials/market-intelligence/mat-1/quotes/quote-1/reliability"
    );
    const server = read("server.ts");
    assert.match(server, /registerMaterialMarketQuoteReliabilityRoutes/);
  });

  it("API de anexos de cotação com upload, listagem e download", () => {
    const server = read("server.ts");
    const routes = read("src/lib/materialMarketQuoteAttachmentRoutes.ts");
    const panel = read("src/components/materials/MaterialMarketQuoteAttachmentsPanel.tsx");
    const quotes = read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx");
    const schema = read("prisma/schema.prisma");
    const storage = read("src/lib/appLocalFileStorage.ts");
    assert.match(server, /registerMaterialMarketQuoteAttachmentRoutes/);
    assert.match(routes, /attachments/);
    assert.match(routes, /download/);
    assert.match(schema, /model MaterialMarketQuoteAttachment/);
    assert.match(schema, /suggestedReliabilityLevel/);
    assert.match(storage, /data\/uploads/);
    assert.match(panel, /material-market-quote-attachments/);
    assert.match(quotes, /MaterialMarketQuoteAttachmentsPanel/);
    assert.match(quotes, /attachmentCount/);
  });

  it("atalho Etiquetas / QR navega por SPA para a rota já existente", () => {
    const catalog = read("src/components/MaterialModule.tsx");
    assert.match(catalog, /Etiquetas \/ QR/);
    assert.match(catalog, /<Link\s+to="\/inventory-labels"/);
    assert.match(catalog, /QrCode/);
    // Navegação interna: nada de window.location / href cru para a tela.
    assert.doesNotMatch(catalog, /window\.location[\s\S]{0,40}inventory-labels/);
    assert.doesNotMatch(catalog, /href="\/inventory-labels"/);
  });

  it("atalho exige gestão de conferências, não edição de materiais", () => {
    const catalog = read("src/components/MaterialModule.tsx");
    assert.match(catalog, /useInventoryPermissions/);
    assert.match(catalog, /const \{ canManageCounts \} = useInventoryPermissions\(\);/);
    // O bloco do atalho é guardado por canManageCounts.
    const shortcut = /\{canManageCounts \? \([\s\S]*?Etiquetas \/ QR[\s\S]*?\) : null\}/.exec(
      catalog
    );
    assert.ok(shortcut, "atalho deve estar dentro de {canManageCounts ? ... : null}");
    assert.doesNotMatch(shortcut[0], /allowEditMaterials/);
  });

  it("Importar e Novo Material seguem em allowEditMaterials", () => {
    const catalog = read("src/components/MaterialModule.tsx");
    assert.match(catalog, /\{allowEditMaterials \? \([\s\S]{0,400}Importar/);
    assert.match(catalog, /\{allowEditMaterials \? \([\s\S]{0,400}Novo Material/);
  });

  it("a rota /inventory-labels continua única e standalone no App", () => {
    const app = read("src/App.tsx");
    const matches = app.match(/path="\/inventory-labels"/g) ?? [];
    assert.equal(matches.length, 1);
    assert.match(app, /path="\/inventory-labels" element=\{<InventoryCountLabelsPage \/>\}/);
  });
});
