import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getProjectTabPath,
  LEGACY_PROJECT_TAB_ALIASES,
  parseLegacyTabSegment,
  parseProjectTabFromPath,
  PROJECT_TABS,
  PROJECTS_BASE_PATH,
} from "./projectsNavigation.js";

describe("projectsNavigation", () => {
  it("rota base /projects existe", () => {
    assert.equal(PROJECTS_BASE_PATH, "/projects");
  });

  it("resolve abas do fluxo guiado", () => {
    assert.equal(parseProjectTabFromPath("/projects/abc"), "home");
    assert.equal(parseProjectTabFromPath("/projects/abc/items"), "items");
    assert.equal(parseProjectTabFromPath("/projects/abc/costs"), "costs");
    assert.equal(parseProjectTabFromPath("/projects/abc/documents"), "documents");
    assert.equal(parseProjectTabFromPath("/projects/abc/history"), "history");
    assert.equal(getProjectTabPath("abc", "home"), "/projects/abc");
    assert.equal(getProjectTabPath("abc", "items"), "/projects/abc/items");
  });

  it("rotas legadas redirecionam para abas do fluxo guiado", () => {
    assert.equal(parseProjectTabFromPath("/projects/x/engineering"), "home");
    assert.equal(parseProjectTabFromPath("/projects/x/structure"), "items");
    assert.equal(parseProjectTabFromPath("/projects/x/materials"), "items");
    assert.equal(parseProjectTabFromPath("/projects/x/versions"), "history");
    assert.equal(parseLegacyTabSegment("/projects/x/products"), "products");
    assert.equal(LEGACY_PROJECT_TAB_ALIASES.products, "home");
    assert.equal(LEGACY_PROJECT_TAB_ALIASES.engineering, "home");
  });

  it("menu possui 5 abas enxutas", () => {
    assert.deepEqual(PROJECT_TABS.map((t) => t.label), [
      "Início",
      "Itens do Projeto",
      "Custos do Projeto",
      "Documentos",
      "Histórico",
    ]);
    assert.equal(PROJECT_TABS.some((t) => t.label.includes("Engenharia")), false);
    assert.equal(PROJECT_TABS.some((t) => t.label.includes("Árvore")), false);
  });

  it("App.tsx registra rotas /projects", () => {
    const app = readFileSync(join(process.cwd(), "src", "App.tsx"), "utf8");
    assert.match(app, /path="projects"/);
    assert.match(app, /path="projects\/:projectId"/);
    assert.match(app, /ProjectsModule/);
  });

  it("ProjectsModule exibe botão de conversão como ação futura", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "ProjectsModule.tsx"),
      "utf8"
    );
    assert.match(mod, /Converter em cadastro oficial/);
    assert.match(mod, /Em breve/);
    assert.match(mod, /disabled/);
  });
});
