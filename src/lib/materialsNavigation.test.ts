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
    assert.match(page, /Nenhuma matéria-prima monitorada ainda/);
    assert.match(page, /materials-market-intelligence-page/);
    assert.doesNotMatch(page, /\bBrent\b/i);
    assert.doesNotMatch(page, /\bdólar\b/i);
  });
});
