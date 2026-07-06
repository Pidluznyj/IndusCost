import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesMaterialUsagePage", () => {
  it("rota sales-orders/material-demand carrega dashboard", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/material-demand"/);
    assert.match(app, /ProductMaterialDemandDashboard context="sales-orders"/);
  });

  it("título da tela é Inteligência de Matéria-Prima", () => {
    const app = read("src/App.tsx");
    assert.match(app, /Pedidos de venda — Inteligência de Matéria-Prima/);
    const dashboard = read("src/components/contextual/ProductMaterialDemandDashboard.tsx");
    assert.match(dashboard, /title: "Pedidos de venda — Inteligência de Matéria-Prima"/);
  });

  it("alias material-usage redireciona para material-demand", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/material-usage"/);
    assert.match(app, /Navigate to="\/sales-orders\/material-demand"/);
  });

  it("dashboard sales-orders tem subtítulo previsto x realizado", () => {
    const dashboard = read("src/components/contextual/ProductMaterialDemandDashboard.tsx");
    assert.match(dashboard, /Uso previsto x realizado/);
  });
});
