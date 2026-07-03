import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProductCostAnalysisEngine } from "./productCostAnalysisEngine.server.js";
import {
  evaluateProductEngineeringCost,
  previewBootstrapProductionCostTableFromEngineering,
} from "./productEngineeringCostSnapshot.server.js";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  type: string;
  status: string;
};

function createMockDb(products: ProductRow[], activeMaterialCount = 0) {
  const db = {
    product: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        products.find((p) => p.id === where.id) ?? null,
      findMany: async ({
        where,
      }: {
        where: {
          status?: string;
          type?: string | { in: string[] };
          sku?: string;
        };
      }) => {
        let rows = [...products];
        if (where.status) rows = rows.filter((p) => p.status === where.status);
        if (where.sku) rows = rows.filter((p) => p.sku === where.sku);
        if (where.type && typeof where.type === "object" && Array.isArray(where.type.in)) {
          rows = rows.filter((p) => where.type.in.includes(p.type));
        }
        return rows.map(({ id, sku, name, type, status }) => ({ id, sku, name, type, status }));
      },
      count: async ({
        where,
      }: {
        where?: { status?: string; type?: string | { in: string[] } };
      }) => {
        if (where?.type === "MATERIAL") {
          throw new Error("Product.type MATERIAL is invalid for ItemType");
        }
        return 0;
      },
    },
    material: {
      count: async ({ where }: { where?: { status?: string } }) =>
        where?.status === "ACTIVE" ? activeMaterialCount : 0,
    },
  };
  return db;
}

function createMockEngine(
  costs: Record<string, { total: number; partial?: boolean } | "FAIL">
): ProductCostAnalysisEngine {
  return {
    initAnalysisCache: async () => ({} as never),
    getProductCostAnalysis: async (productId: string) => {
      const entry = costs[productId];
      if (entry === "FAIL") return { error: "CONFIG_MISSING", message: "Config ausente." };
      if (!entry) return null;
      return {
        productId,
        sku: productId,
        summary: {
          totalIndustrialCost: entry.total,
          totalMaterialCost: entry.total * 0.5,
          totalHH_Unit: entry.total * 0.2,
          totalHM_Unit: entry.total * 0.15,
          costAnalysisPartial: entry.partial ?? false,
        },
      };
    },
    isCostAnalysisFailure: (x: unknown): x is { error: string; message?: string } =>
      !!x && typeof x === "object" && "error" in x,
    describeCostAnalysisFailure: (failure: unknown) =>
      String((failure as { message?: string }).message ?? "Erro"),
  };
}

describe("productEngineeringCostSnapshot.server", () => {
  const products: ProductRow[] = [
    { id: "prod-a", sku: "619.24AA", name: "Produto A", type: "PRODUCT", status: "ACTIVE" },
    {
      id: "comp-309",
      sku: "309.86AA",
      name: "Mangote Azul - Esmaltec",
      type: "COMPONENT",
      status: "ACTIVE",
    },
    { id: "mat-1", sku: "MP-001", name: "Material puro", type: "MATERIAL", status: "ACTIVE" },
  ];

  it("avalia componente calculável como elegível", async () => {
    const db = createMockDb(products);
    const engine = createMockEngine({ "comp-309": { total: 0.537299 } });
    const evaluated = await evaluateProductEngineeringCost(db as never, engine, "comp-309");
    assert.equal(evaluated.calculable, true);
    assert.equal(evaluated.resolved.ok, true);
    if (evaluated.resolved.ok) {
      assert.ok(Math.abs(evaluated.resolved.finalUnitCost - 0.537299) < 0.000001);
    }
  });

  it("rejeita material na avaliação de elegibilidade", async () => {
    const db = createMockDb(products);
    const engine = createMockEngine({ "mat-1": { total: 1 } });
    const evaluated = await evaluateProductEngineeringCost(db as never, engine, "mat-1");
    assert.equal(evaluated.calculable, false);
    assert.equal(evaluated.errorCode, "NOT_ELIGIBLE_MATERIAL");
  });

  it("preview inclui produto e componente, ignora material", async () => {
    const db = createMockDb(products, 1);
    const engine = createMockEngine({
      "prod-a": { total: 10 },
      "comp-309": { total: 0.537299 },
      "mat-1": { total: 1 },
    });
    const preview = await previewBootstrapProductionCostTableFromEngineering(db as never, engine);
    assert.equal(preview.itemsEvaluated, 2);
    assert.equal(preview.productsEvaluated, 1);
    assert.equal(preview.componentsEvaluated, 1);
    assert.equal(preview.materialsIgnored, 1);
    assert.equal(preview.calculableCount, 2);
    const componentRow = preview.topByCost.find((r) => r.sku === "309.86AA");
    assert.ok(componentRow);
    assert.equal(componentRow?.itemType, "COMPONENT");
    assert.equal(componentRow?.calculable, true);
  });

  it("preview com onlyProductCode encontra componente 309.86AA", async () => {
    const db = createMockDb(products);
    const engine = createMockEngine({ "comp-309": { total: 0.537299 } });
    const preview = await previewBootstrapProductionCostTableFromEngineering(db as never, engine, {
      onlyProductCode: "309.86AA",
    });
    assert.equal(preview.itemsEvaluated, 1);
    assert.equal(preview.componentsEvaluated, 1);
    assert.ok(preview.sampleProduct);
    assert.equal(preview.sampleProduct?.sku, "309.86AA");
    assert.equal(preview.sampleProduct?.calculable, true);
  });
});
