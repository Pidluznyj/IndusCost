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
});
