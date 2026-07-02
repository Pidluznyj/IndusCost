import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  assertProductionCostTableVersionEditable,
  compareProductionCostTableVersionsForResolver,
  isProductionCostTableVersionEditable,
  nextProductionCostTableRevision,
  resolveEffectiveProductProductionCostFromCatalog,
  resolveEffectiveProductProductionCostsFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import { resolveSalesOrderItemCostFromVersionedProduction } from "./salesOrderMarginResolver.js";

function d(iso: string): Date {
  return civilDateToLocalDate(iso);
}

function version(
  partial: Partial<ProductionCostTableVersionWithItems> &
    Pick<
      ProductionCostTableVersionWithItems,
      "id" | "code" | "name" | "effectiveDate" | "status" | "revision"
    >
): ProductionCostTableVersionWithItems {
  return {
    publishedAt: null,
    createdAt: d("2026-06-01"),
    items: [],
    ...partial,
  };
}

function item(
  productId: string,
  unitProductionCost: number,
  versionId: string,
  createdAt = d("2026-06-01")
) {
  return {
    id: `${versionId}-${productId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: productId.toUpperCase(),
    productNameSnapshot: `Produto ${productId}`,
    unitProductionCost,
    currency: "BRL",
    calculationHash: null,
    calculationSnapshot: null,
    createdAt,
    breakdown: {
      materialCost: 0,
      processCost: 0,
      laborCost: 0,
      machineCost: 0,
      overheadCost: 0,
      otherCost: 0,
    },
  };
}

describe("productionCostVersioning", () => {
  it("DRAFT é editável; PUBLISHED/SUPERSEDED/ARCHIVED são imutáveis", () => {
    assert.equal(isProductionCostTableVersionEditable("DRAFT"), true);
    assert.equal(isProductionCostTableVersionEditable("PUBLISHED"), false);
    assert.throws(() => assertProductionCostTableVersionEditable("PUBLISHED", "editar"));
  });

  it("nextProductionCostTableRevision incrementa revisão", () => {
    assert.equal(nextProductionCostTableRevision(null), 1);
    assert.equal(nextProductionCostTableRevision(2), 3);
  });

  it("resolve custo vigente por produto/data — versão mais recente aplicável", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-06",
        name: "Jun/2026 v1",
        effectiveDate: d("2026-06-01"),
        status: "SUPERSEDED",
        revision: 1,
        publishedAt: d("2026-06-02"),
        items: [item("prod-a", 10, "v1"), item("prod-b", 20, "v1")],
      }),
      version({
        id: "v2",
        code: "2026-06",
        name: "Jun/2026 v2",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 2,
        publishedAt: d("2026-06-15"),
        items: [item("prod-a", 11.5, "v2")],
      }),
    ];

    const ref = d("2026-06-20");
    const costA = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-a", ref);
    const costB = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-b", ref);

    assert.equal(costA.status, "OK");
    if (costA.status === "OK") {
      assert.equal(costA.unitProductionCost, 11.5);
      assert.equal(costA.costTableVersionId, "v2");
      assert.equal(costA.revision, 2);
    }

    assert.equal(costB.status, "OK");
    if (costB.status === "OK") {
      assert.equal(costB.unitProductionCost, 20);
      assert.equal(costB.costTableVersionId, "v1");
    }
  });

  it("PUBLISHED prevalece sobre SUPERSEDED com mesma vigência e revisão", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "sup",
        code: "2026-06",
        name: "Jun superseded",
        effectiveDate: d("2026-06-01"),
        status: "SUPERSEDED",
        revision: 2,
        publishedAt: d("2026-06-20"),
        items: [item("prod-a", 99, "sup")],
      }),
      version({
        id: "pub",
        code: "2026-06",
        name: "Jun published",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 2,
        publishedAt: d("2026-06-15"),
        items: [item("prod-a", 11.5, "pub")],
      }),
    ];

    const result = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      d("2026-06-25")
    );
    assert.equal(result.status, "OK");
    if (result.status === "OK") {
      assert.equal(result.unitProductionCost, 11.5);
      assert.equal(result.costTableVersionId, "pub");
    }
  });

  it("produto sem custo retorna SEM_CUSTO — nunca zero silencioso", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-06",
        name: "Jun/2026",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [],
      }),
    ];
    const result = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "missing",
      d("2026-06-10")
    );
    assert.equal(result.status, "SEM_CUSTO");
  });

  it("DRAFT não entra no resolver", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "draft",
        code: "2026-07",
        name: "Jul draft",
        effectiveDate: d("2026-07-01"),
        status: "DRAFT",
        revision: 1,
        items: [item("prod-a", 99, "draft")],
      }),
      version({
        id: "pub",
        code: "2026-06",
        name: "Jun pub",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("prod-a", 10, "pub")],
      }),
    ];
    const result = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      d("2026-07-15")
    );
    assert.equal(result.status, "OK");
    if (result.status === "OK") assert.equal(result.unitProductionCost, 10);
  });

  it("effectiveDate posterior à referência não aplica", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "future",
        code: "2026-08",
        name: "Ago",
        effectiveDate: d("2026-08-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("prod-a", 50, "future")],
      }),
    ];
    const result = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      d("2026-06-15")
    );
    assert.equal(result.status, "SEM_CUSTO");
  });

  it("compareProductionCostTableVersionsForResolver prioriza revision mais alta", () => {
    const a = version({
      id: "a",
      code: "X",
      name: "A",
      effectiveDate: d("2026-06-01"),
      status: "PUBLISHED",
      revision: 1,
      publishedAt: d("2026-06-01"),
    });
    const b = version({
      id: "b",
      code: "X",
      name: "B",
      effectiveDate: d("2026-06-01"),
      status: "PUBLISHED",
      revision: 2,
      publishedAt: d("2026-06-01"),
    });
    assert.ok(compareProductionCostTableVersionsForResolver(b, a) > 0);
  });

  it("resolveEffectiveProductProductionCostsFromCatalog retorna mapa por produto", () => {
    const catalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v1",
        code: "2026-06",
        name: "Jun",
        effectiveDate: d("2026-06-01"),
        status: "PUBLISHED",
        revision: 1,
        items: [item("p1", 5, "v1"), item("p2", 7, "v1")],
      }),
    ];
    const map = resolveEffectiveProductProductionCostsFromCatalog(
      catalog,
      ["p1", "p2", "p3"],
      d("2026-06-10")
    );
    assert.equal(map.get("p1")?.status, "OK");
    assert.equal(map.get("p2")?.status, "OK");
    assert.equal(map.get("p3")?.status, "SEM_CUSTO");
  });

  it("unitCost Nomus não é considerado — margem usa tabela versionada, não storedUnitCost", () => {
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "i1",
      productId: "p1",
      referenceDate: civilDateToLocalDate("2026-06-10"),
      effectiveCost: {
        status: "OK",
        productId: "p1",
        unitProductionCost: 42,
        costTableVersionId: "v1",
        costTableItemId: "i1",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        versionName: "Jun",
        versionCode: "2026-06",
        revision: 1,
        publishedAt: new Date(),
        currency: "BRL",
        breakdown: {
          materialCost: 21,
          processCost: 0,
          laborCost: 10,
          machineCost: 6,
          overheadCost: 5,
          otherCost: 0,
        },
        calculationSnapshot: null,
      },
    });
    assert.equal(cost.unitCost, 42);
    assert.equal(cost.costSource, "VERSIONED_PRODUCTION_COST");
  });
});
