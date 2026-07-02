import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  formatEffectiveProductionCostSummary,
  formatProductionCostVersionStatusLabel,
  isProductionCostVersionReadOnly,
  PRODUCTION_COST_DISPLAY_LABELS,
  PRODUCTION_COST_IMMUTABLE_NOTICE,
  PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS,
  PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS,
  PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
} from "./productionCostTablesUi.js";

describe("productionCostTablesUi", () => {
  it("labels oficiais de custo de produção", () => {
    assert.equal(PRODUCTION_COST_DISPLAY_LABELS.saleUnitPrice, "Preço unitário de venda");
    assert.equal(PRODUCTION_COST_DISPLAY_LABELS.productionUnitCost, "Custo de produção IndusCost");
    assert.equal(PRODUCTION_COST_DISPLAY_LABELS.costTableSource, "Tabela de custo vigente");
    assert.equal(PRODUCTION_COST_DISPLAY_LABELS.costUnresolved, "Custo não resolvido");
  });

  it("status visual DRAFT/PUBLISHED/SUPERSEDED/ARCHIVED", () => {
    assert.equal(formatProductionCostVersionStatusLabel("DRAFT"), "Rascunho");
    assert.equal(formatProductionCostVersionStatusLabel("PUBLISHED"), "Publicada");
    assert.equal(formatProductionCostVersionStatusLabel("SUPERSEDED"), "Substituída");
    assert.equal(formatProductionCostVersionStatusLabel("ARCHIVED"), "Arquivada");
  });

  it("versão publicada é somente leitura", () => {
    assert.equal(isProductionCostVersionReadOnly("DRAFT"), false);
    assert.equal(isProductionCostVersionReadOnly("PUBLISHED"), true);
    assert.equal(isProductionCostVersionReadOnly("SUPERSEDED"), true);
  });

  it("resumo de custo vigente por produto/data", () => {
    const ok = formatEffectiveProductionCostSummary({
      productCode: "618.08AA",
      referenceDate: "2026-06-10",
      result: {
        status: "OK",
        productId: "p1",
        versionCode: "2026-06",
        versionName: "Tabela de Custo 2026-06",
        revision: 2,
        effectiveDate: new Date("2026-06-01"),
        unitProductionCost: 11.5,
        costTableVersionId: "v1",
        costTableItemId: "i1",
        publishedAt: new Date("2026-06-02T10:00:00.000Z"),
        currency: "BRL",
        breakdown: {
          materialCost: 5,
          processCost: 1,
          laborCost: 2,
          machineCost: 2,
          overheadCost: 1,
          otherCost: 0.5,
        },
        calculationSnapshot: null,
      },
    });
    assert.match(ok, /Item 618\.08AA em 10\/06\/2026 usa Tabela de Custo 2026-06 v2/);
    assert.match(ok, /vigência 01\/06\/2026/);

    const sem = formatEffectiveProductionCostSummary({
      productCode: "618.08AA",
      referenceDate: "2026-06-10",
      result: {
        status: "SEM_CUSTO",
        productId: "p1",
        referenceDate: new Date("2026-06-10"),
      },
    });
    assert.match(sem, /Custo não resolvido/);
  });

  it("aviso de imutabilidade na UI", () => {
    const panel = readFileSync(
      join(process.cwd(), "src/components/pricing/ProductionCostTablesPanel.tsx"),
      "utf8"
    );
    assert.match(panel, /PRODUCTION_COST_IMMUTABLE_NOTICE/);
    assert.match(panel, /production-cost-view-items-/);
    assert.match(panel, /Consulta de custo vigente|effective-cost/);
    assert.match(panel, /isProductionCostVersionReadOnly/);
  });

  it("permissões view/manage/publish definidas", () => {
    assert.ok(PRODUCTION_COST_TABLE_VIEW_PERMISSIONS.includes("pricing.view"));
    assert.ok(PRODUCTION_COST_TABLE_VIEW_PERMISSIONS.includes("costs.view"));
    assert.ok(PRODUCTION_COST_TABLE_MANAGE_PERMISSIONS.includes("pricing.generate_tables"));
    assert.ok(PRODUCTION_COST_TABLE_PUBLISH_PERMISSIONS.includes("pricing.publish_tables"));
    assert.match(PRODUCTION_COST_IMMUTABLE_NOTICE, /não podem ser editadas/);
  });
});
