import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "../productionCostVersioning.js";

function version(
  overrides: Partial<ProductionCostTableVersionWithItems> &
    Pick<ProductionCostTableVersionWithItems, "id" | "effectiveDate" | "status">
): ProductionCostTableVersionWithItems {
  return {
    code: overrides.code ?? "PC",
    name: overrides.name ?? "Tabela",
    revision: overrides.revision ?? 1,
    publishedAt: overrides.publishedAt ?? overrides.effectiveDate,
    createdAt: overrides.createdAt ?? overrides.effectiveDate,
    items: overrides.items ?? [],
    ...overrides,
  };
}

describe("industrial result historical cost as-of issueDate", () => {
  it("usa tabela vigente na issueDate e ignora tabela posterior", () => {
    const versions = [
      version({
        id: "apr",
        code: "PC-APR",
        effectiveDate: new Date("2026-04-01"),
        status: "SUPERSEDED",
        revision: 1,
        items: [
          {
            id: "i1",
            costTableVersionId: "apr",
            productId: "p1",
            productCodeSnapshot: "SKU",
            productNameSnapshot: "Prod",
            unitProductionCost: 10,
            currency: "BRL",
            calculationHash: null,
            calculationSnapshot: null,
            createdAt: new Date("2026-04-01"),
            breakdown: {
              materialCost: 5,
              processCost: 1,
              laborCost: 2,
              machineCost: 1,
              overheadCost: 1,
              otherCost: 0,
            },
          },
        ],
      }),
      version({
        id: "jul",
        code: "PC-JUL",
        effectiveDate: new Date("2026-07-01"),
        status: "PUBLISHED",
        revision: 2,
        items: [
          {
            id: "i2",
            costTableVersionId: "jul",
            productId: "p1",
            productCodeSnapshot: "SKU",
            productNameSnapshot: "Prod",
            unitProductionCost: 99,
            currency: "BRL",
            calculationHash: null,
            calculationSnapshot: null,
            createdAt: new Date("2026-07-01"),
            breakdown: {
              materialCost: 90,
              processCost: 1,
              laborCost: 4,
              machineCost: 2,
              overheadCost: 2,
              otherCost: 0,
            },
          },
        ],
      }),
    ];

    const aprilOrder = resolveEffectiveProductProductionCostFromCatalog(
      versions,
      "p1",
      new Date("2026-04-15")
    );
    assert.equal(aprilOrder.status, "OK");
    if (aprilOrder.status === "OK") {
      assert.equal(aprilOrder.unitProductionCost, 10);
      assert.equal(aprilOrder.versionCode, "PC-APR");
    }

    const julyOrder = resolveEffectiveProductProductionCostFromCatalog(
      versions,
      "p1",
      new Date("2026-07-15")
    );
    assert.equal(julyOrder.status, "OK");
    if (julyOrder.status === "OK") {
      assert.equal(julyOrder.unitProductionCost, 99);
      assert.equal(julyOrder.versionCode, "PC-JUL");
    }
  });

  it("rascunho não é usado; ausência não inventa custo", () => {
    const versions = [
      version({
        id: "draft",
        effectiveDate: new Date("2026-01-01"),
        status: "DRAFT",
        items: [
          {
            id: "i1",
            costTableVersionId: "draft",
            productId: "p1",
            productCodeSnapshot: "SKU",
            productNameSnapshot: "Prod",
            unitProductionCost: 50,
            currency: "BRL",
            calculationHash: null,
            calculationSnapshot: null,
            createdAt: new Date("2026-01-01"),
            breakdown: {
              materialCost: 50,
              processCost: 0,
              laborCost: 0,
              machineCost: 0,
              overheadCost: 0,
              otherCost: 0,
            },
          },
        ],
      }),
    ];
    const result = resolveEffectiveProductProductionCostFromCatalog(
      versions,
      "p1",
      new Date("2026-04-15")
    );
    assert.equal(result.status, "SEM_CUSTO");
  });
});
