import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("pricingNavigation", () => {
  it("Formação de Preço não expõe Indicadores, Simular preço nem Nova Premissa no topo", () => {
    const app = read("src/App.tsx");
    const module = read("src/components/PricingModule.tsx");
    const grid = read("src/components/pricing/CommercialPublishedPricesGrid.tsx");

    const pricingRouteStart = app.indexOf('path="pricing"');
    assert.ok(pricingRouteStart >= 0);
    const pricingRouteBlock = app.slice(
      pricingRouteStart,
      app.indexOf('path="proposals/indicators"', pricingRouteStart)
    );
    assert.doesNotMatch(pricingRouteBlock, /ModuleIndicatorsButton/);
    assert.doesNotMatch(pricingRouteBlock, /pricing\/indicators/);
    assert.doesNotMatch(app, /path="pricing\/indicators"/);
    assert.doesNotMatch(app, /PricingFormationIndicatorsDashboard/);

    assert.doesNotMatch(module, /Simular preço/);
    assert.doesNotMatch(module, /Nova Premissa/);
    assert.doesNotMatch(grid, /Nova premissa para este produto/);
    assert.doesNotMatch(grid, /Simulação ao vivo \(premissa\)/);
    assert.doesNotMatch(grid, />Ações</);
  });

  it("remove Processamento em Lote e protege ferramentas na sanfona Super Admin", () => {
    const module = read("src/components/PricingModule.tsx");
    const tour = read("src/tours/pricingTourSteps.ts");

    assert.doesNotMatch(module, /Processamento em Lote/);
    assert.doesNotMatch(module, /pricing-mode-toggle/);
    assert.doesNotMatch(module, /pricing-batch-panel/);
    assert.doesNotMatch(module, /Gestão Unitária/);

    assert.match(module, /pricing-admin-tools-accordion/);
    assert.match(module, /isSuperAdminUser/);
    assert.match(module, /adminFormationToolsOpen/);
    assert.match(module, /Disponível apenas para Super administrador/);
    assert.match(module, /Gerar Tabelas Comerciais/);
    assert.match(module, /Custo oficial de produção/);
    assert.match(module, /Custo oficial de matéria-prima/);
    assert.match(module, /Auditoria de Custo, Preço e Margem/);

    // Ferramentas internas só renderizam com sanfona aberta + Super Admin.
    assert.match(
      module,
      /adminFormationToolsOpen && isSuperAdminUser \? \([\s\S]*Gerar Tabelas Comerciais/
    );

    assert.match(tour, /pricing-admin-tools-accordion/);
    assert.doesNotMatch(tour, /pricing-batch-panel/);
    assert.doesNotMatch(tour, /pricing-mode-toggle/);
  });
});
