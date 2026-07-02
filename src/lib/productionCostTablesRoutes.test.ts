import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS,
  PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS,
  PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
} from "./productionCostTablesUi.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("productionCostTablesRoutes", () => {
  const server = () => read("server.ts");
  const panel = () => read("src/components/pricing/ProductionCostTablesPanel.tsx");

  it("GET /api/production-cost-tables/versions exige permissão de visualização", () => {
    const src = server();
    assert.match(src, /\/api\/production-cost-tables\/versions/);
    assert.match(src, /PRODUCTION_COST_TABLE_VIEW_PERMISSIONS/);
    assert.match(src, /listProductionCostTableVersions/);
    assert.match(src, /supersedesVersion/);
  });

  it("GET /api/production-cost-tables/effective-cost consulta produto/data", () => {
    const src = server();
    assert.match(src, /\/api\/production-cost-tables\/effective-cost/);
    assert.match(src, /getEffectiveProductProductionCost/);
    assert.match(src, /formatEffectiveProductionCostSummary/);
    assert.match(src, /referenceDate/);
  });

  it("GET /api/production-cost-table-versions/:id retorna itens", () => {
    const src = server();
    assert.match(src, /\/api\/production-cost-table-versions\/:id/);
    assert.match(src, /getProductionCostTableVersionById/);
    assert.match(src, /unitProductionCost/);
    assert.match(src, /calculationHash/);
  });

  it("gerar DRAFT restrito a perfil autorizado", () => {
    const src = server();
    assert.match(src, /\/api\/production-cost-tables\/versions\/generate-draft/);
    assert.match(src, /pricing\.generate_tables/);
    assert.match(src, /settings\.price_tables\.manage/);
    for (const perm of PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS) {
      assert.match(src, new RegExp(perm.replace(".", "\\.")));
    }
  });

  it("publicar versão restrito a perfil autorizado", () => {
    const src = server();
    assert.match(src, /\/api\/production-cost-table-versions\/:id\/publish/);
    assert.match(src, /pricing\.publish_tables/);
    for (const perm of PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS) {
      assert.match(src, new RegExp(perm.replace(".", "\\.")));
    }
  });

  it("GET publication-status por produto consulta DRAFT vs oficial", () => {
    const src = server();
    assert.match(src, /\/api\/products\/:id\/production-cost-publication-status/);
    assert.match(src, /getProductProductionCostPublicationStatus/);
  });

  it("UI consome APIs sem cálculo paralelo no React", () => {
    const src = panel();
    assert.match(src, /\/api\/production-cost-tables\/versions/);
    assert.match(src, /\/api\/production-cost-table-versions\//);
    assert.match(src, /\/api\/production-cost-tables\/effective-cost/);
    assert.doesNotMatch(src, /getProductCostAnalysis/);
    assert.doesNotMatch(src, /computeProductionCost/);
  });

  it("view permissions incluem financeiro/comercial", () => {
    assert.ok(PRODUCTION_COST_TABLE_VIEW_PERMISSIONS.includes("pricing.view"));
    assert.ok(PRODUCTION_COST_TABLE_VIEW_PERMISSIONS.includes("costs.view"));
    assert.ok(PRODUCTION_COST_TABLE_VIEW_PERMISSIONS.includes("products.tab.cost"));
  });
});
