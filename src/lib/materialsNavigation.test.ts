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

  it("schema Material possui campos de monitoramento", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /isMarketMonitored/);
    assert.match(schema, /marketCriticality/);
    assert.match(schema, /marketMonitoringFrequencyDays/);
    assert.match(schema, /marketNotes/);
  });
});
