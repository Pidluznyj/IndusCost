import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrdersNavigation", () => {
  it("botão Gestão de Pedidos existe", () => {
    const app = read("src/App.tsx");
    assert.match(app, /Gestão de Pedidos/);
    assert.match(app, /to="\/sales-orders\/management"/);
  });

  it("botão Inteligência de Matéria-Prima existe", () => {
    const app = read("src/App.tsx");
    assert.match(app, /Inteligência de Matéria-Prima/);
    assert.match(app, /to="\/sales-orders\/material-demand"/);
  });

  it("Estimativa de uso de MP não é o nome principal do botão", () => {
    const app = read("src/App.tsx");
    const salesOrdersBlock = app.slice(app.indexOf('path="sales-orders"'));
    assert.doesNotMatch(salesOrdersBlock.slice(0, 800), />Estimativa de uso de MP</);
  });

  it("rota /sales-orders/management existe", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/management"/);
    assert.match(app, /SalesOrderManagementPage/);
  });

  it("rota material-usage existe como alias", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/material-usage"/);
    assert.match(app, /sales-orders\/material-demand/);
  });

  it("rota material-demand com título Inteligência de Matéria-Prima", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="sales-orders\/material-demand"/);
    assert.match(app, /Pedidos de venda — Inteligência de Matéria-Prima/);
    const dashboard = read("src/components/contextual/ProductMaterialDemandDashboard.tsx");
    assert.match(dashboard, /Inteligência de Matéria-Prima/);
  });

  it("Gestão usa endpoint real /api/sales-orders/management", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /getSalesOrderManagementApiPath/);
    assert.doesNotMatch(page, /mock|fixture/i);
  });

  it("navegação usa paths absolutos", () => {
    const app = read("src/App.tsx");
    assert.match(app, /to="\/sales-orders\/management"/);
    assert.match(app, /to="\/sales-orders\/material-demand"/);
  });
});
