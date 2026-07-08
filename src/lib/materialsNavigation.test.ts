import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
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
  it("seções incluem Matérias-primas e Inteligência de Mercado", () => {
    assert.deepEqual(
      MATERIALS_SECTIONS.map((s) => s.label),
      ["Matérias-primas", "Inteligência de Mercado"]
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

  it("página inicial exibe estado vazio amigável", () => {
    const page = read("src/components/materials/MaterialsMarketIntelligencePage.tsx");
    const list = read("src/components/materials/MaterialsMarketIntelligenceMonitoredList.tsx");
    assert.match(list, /MATERIALS_MARKET_INTELLIGENCE_EMPTY_MESSAGE/);
    assert.match(page, /materials-market-intelligence-page/);
    assert.doesNotMatch(page, /\bBrent\b/i);
    assert.doesNotMatch(page, /\bdólar\b/i);
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
    assert.match(server, /\/api\/materials\/market-intelligence\/:materialId\/quotes/);
    assert.match(server, /materialMarketQuote\.create/);
    assert.match(server, /parseMaterialMarketQuoteInput/);
    assert.match(form, /material-market-quote-submit/);
  });

  it("schema possui MaterialMarketQuote append-only", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /model MaterialMarketQuote/);
    assert.match(schema, /netPrice/);
    assert.match(schema, /supplierName/);
  });
});
