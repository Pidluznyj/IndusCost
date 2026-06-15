import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSimulationsNewProductPath,
  parseSimulationsWorkspaceTabParam,
  SIMULATIONS_BASE_PATH,
  SIMULATIONS_NEW_PRODUCT_TAB_PARAM,
} from "./simulationsNavigation.js";
import { PROJECTS_BASE_PATH } from "./projectsNavigation.js";

describe("simulationsNavigation", () => {
  it("rota de simular novo produto usa query tab=new-product", () => {
    assert.equal(buildSimulationsNewProductPath(), "/simulations?tab=new-product");
    assert.equal(SIMULATIONS_BASE_PATH, "/simulations");
    assert.equal(SIMULATIONS_NEW_PRODUCT_TAB_PARAM, "new-product");
  });

  it("parse tab abre workspace NEW_PRODUCT", () => {
    assert.equal(parseSimulationsWorkspaceTabParam("new-product"), "NEW_PRODUCT");
    assert.equal(parseSimulationsWorkspaceTabParam("new_product"), "NEW_PRODUCT");
    assert.equal(parseSimulationsWorkspaceTabParam(null), "SCENARIOS");
    assert.equal(parseSimulationsWorkspaceTabParam("scenarios"), "SCENARIOS");
  });
});

describe("cross-module navigation shortcuts", () => {
  it("Projetos exibe atalho para Simular novo produto", () => {
    const home = readFileSync(
      join(process.cwd(), "src", "components", "projects", "ProjectHomeAssistant.tsx"),
      "utf8"
    );
    assert.match(home, /Simular novo produto/);
    assert.match(home, /buildSimulationsNewProductPath/);
    assert.match(home, /projects-go-to-simulations/);
    assert.match(home, /PROJECTS_TO_SIMULATIONS_HINT/);
    assert.equal(home.includes("Criar novo produto"), false);
  });

  it("Simulações exibe atalho Ver projetos", () => {
    const mod = readFileSync(
      join(process.cwd(), "src", "components", "SimulationModule.tsx"),
      "utf8"
    );
    assert.match(mod, /Ver projetos/);
    assert.match(mod, /PROJECTS_BASE_PATH/);
    assert.match(mod, /simulations-go-to-projects/);
    assert.match(mod, /parseSimulationsWorkspaceTabParam/);
    assert.match(mod, /SIMULATIONS_NEW_PRODUCT_TAB_PARAM/);
  });

  it("rotas de destino são válidas", () => {
    assert.equal(PROJECTS_BASE_PATH, "/projects");
    assert.match(buildSimulationsNewProductPath(), /^\/simulations\?tab=/);
  });
});
