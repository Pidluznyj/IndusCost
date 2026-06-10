import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  getProjectTabPath,
  parseProjectTabFromPath,
  PROJECTS_BASE_PATH,
} from "./projectsNavigation.js";

describe("projectsNavigation", () => {
  it("rota base /projects existe", () => {
    assert.equal(PROJECTS_BASE_PATH, "/projects");
  });

  it("resolve abas do detalhe do projeto", () => {
    assert.equal(parseProjectTabFromPath("/projects/abc"), "summary");
    assert.equal(parseProjectTabFromPath("/projects/abc/costs"), "costs");
    assert.equal(getProjectTabPath("abc", "molds"), "/projects/abc/molds");
    assert.equal(getProjectTabPath("abc", "summary"), "/projects/abc");
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
