import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import {
  resolveSalesOrderItemCostFromVersionedProduction,
  resolveSalesOrderItemCostsFromVersionedProduction,
} from "./salesOrderMarginResolver.js";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.js";
import { assembleSalesOrderMarginItemInput } from "./salesOrderMarginResolver.js";
import { buildOfficialSalesOrderMarginTooltipText } from "./salesOrderMarginDisplay.js";

function version(
  partial: Partial<ProductionCostTableVersionWithItems> &
    Pick<ProductionCostTableVersionWithItems, "id" | "code" | "revision" | "status" | "effectiveDate">
): ProductionCostTableVersionWithItems {
  return {
    name: `Custo ${partial.code}`,
    publishedAt: partial.status === "DRAFT" ? null : new Date("2026-06-02T10:00:00Z"),
    createdAt: new Date(),
    items: [],
    ...partial,
  };
}

function itemRow(
  versionId: string,
  productId: string,
  unitProductionCost: number
) {
  return {
    id: `item-${productId}-${versionId}`,
    costTableVersionId: versionId,
    productId,
    productCodeSnapshot: "PA",
    productNameSnapshot: "Produto A",
    unitProductionCost,
    currency: "BRL",
    calculationHash: "abc",
    calculationSnapshot: { costAnalysisPartial: false },
    createdAt: new Date(),
    breakdown: {
      materialCost: unitProductionCost * 0.5,
      processCost: 0,
      laborCost: unitProductionCost * 0.2,
      machineCost: unitProductionCost * 0.15,
      overheadCost: unitProductionCost * 0.15,
      otherCost: 0,
    },
  };
}

describe("salesOrderMarginVersionedCost", () => {
  const catalog: ProductionCostTableVersionWithItems[] = [
    version({
      id: "v1",
      code: "2026-05",
      revision: 1,
      status: "SUPERSEDED",
      effectiveDate: civilDateToLocalDate("2026-05-01"),
      items: [itemRow("v1", "prod-a", 10)],
    }),
    version({
      id: "v2",
      code: "2026-06",
      revision: 1,
      status: "PUBLISHED",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      items: [itemRow("v2", "prod-a", 12)],
    }),
    version({
      id: "v2b",
      code: "2026-06",
      revision: 2,
      status: "PUBLISHED",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      items: [itemRow("v2b", "prod-a", 11.5)],
    }),
    version({
      id: "draft",
      code: "2026-07",
      revision: 1,
      status: "DRAFT",
      effectiveDate: civilDateToLocalDate("2026-07-01"),
      items: [itemRow("draft", "prod-a", 99)],
    }),
  ];

  it("pedido antes da vigência usa custo anterior", () => {
    const ref = civilDateToLocalDate("2026-05-15");
    const effective = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-a", ref);
    assert.equal(effective.status, "OK");
    if (effective.status === "OK") assert.equal(effective.unitProductionCost, 10);
  });

  it("pedido depois da vigência usa custo novo (revisão mais alta)", () => {
    const ref = civilDateToLocalDate("2026-06-10");
    const effective = resolveEffectiveProductProductionCostFromCatalog(catalog, "prod-a", ref);
    assert.equal(effective.status, "OK");
    if (effective.status === "OK") {
      assert.equal(effective.unitProductionCost, 11.5);
      assert.equal(effective.revision, 2);
    }
  });

  it("DRAFT não entra no resolver — produto só em DRAFT retorna SEM_CUSTO", () => {
    const draftOnlyCatalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "draft-only",
        code: "2026-07",
        name: "Jul draft",
        revision: 1,
        status: "DRAFT",
        effectiveDate: civilDateToLocalDate("2026-07-01"),
        items: [itemRow("draft-only", "prod-draft-only", 99)],
      }),
    ];
    const ref = civilDateToLocalDate("2026-07-15");
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      draftOnlyCatalog,
      "prod-draft-only",
      ref
    );
    assert.equal(effective.status, "SEM_CUSTO");
  });

  it("produto sem custo vira SEM_CUSTO na margem", () => {
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "item-1",
      productId: "prod-b",
      referenceDate: civilDateToLocalDate("2026-06-10"),
      effectiveCost: { status: "SEM_CUSTO", productId: "prod-b", referenceDate: civilDateToLocalDate("2026-06-10") },
    });
    assert.equal(cost.unitCost, null);
    assert.equal(cost.costSource, "MISSING_COST");

    const margin = calculateSalesOrderItemMargin(
      assembleSalesOrderMarginItemInput(
        {
          salesOrderItemId: "item-1",
          productId: "prod-b",
          quantity: 2,
          totalNetValue: 200,
        },
        {
          salesOrderItemId: "item-1",
          productId: "prod-b",
          productSku: "PB",
          productName: "B",
          resolutionSource: "LOCAL_PRODUCT_ID",
          confidence: "HIGH",
          notes: [],
        },
        cost
      )
    );
    assert.equal(margin.status, "SEM_CUSTO");
    assert.equal(margin.totalCost, null);
  });

  it("unitCost Nomus não entra — só tabela versionada", () => {
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      civilDateToLocalDate("2026-06-10")
    );
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "item-1",
      productId: "prod-a",
      referenceDate: civilDateToLocalDate("2026-06-10"),
      effectiveCost: effective,
    });
    assert.equal(cost.costSource, "VERSIONED_PRODUCTION_COST");
    assert.equal(cost.unitCost, 11.5);
  });

  it("componente com custo publicado resolve margem pela tabela vigente", () => {
    const componentCatalog: ProductionCostTableVersionWithItems[] = [
      version({
        id: "v-comp",
        code: "2026-06",
        revision: 1,
        status: "PUBLISHED",
        effectiveDate: civilDateToLocalDate("2026-06-01"),
        items: [
          {
            ...itemRow("v-comp", "comp-309", 0.537299),
            productCodeSnapshot: "309.86AA",
            productNameSnapshot: "Mangote Azul - Esmaltec",
          },
        ],
      }),
    ];
    const ref = civilDateToLocalDate("2026-06-10");
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      componentCatalog,
      "comp-309",
      ref
    );
    assert.equal(effective.status, "OK");
    if (effective.status === "OK") {
      assert.ok(Math.abs(effective.unitProductionCost - 0.537299) < 0.000001);
    }

    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "so-item-1",
      productId: "comp-309",
      referenceDate: ref,
      effectiveCost: effective,
    });
    assert.equal(cost.costSource, "VERSIONED_PRODUCTION_COST");
    assert.ok(cost.unitCost != null && Math.abs(cost.unitCost - 0.537299) < 0.000001);
  });

  it("tooltip mostra tabela e vigência", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: {
        netRevenue: 100,
        totalCost: 23,
        marginValue: 77,
        marginPercent: 77,
        markup: 4.35,
        itemsCount: 1,
        validItemsCount: 1,
        ignoredItemsCount: 0,
        hasMissingCost: false,
        hasMissingProduct: false,
        hasNegativeMargin: false,
        hasInvalidRevenue: false,
        status: "OK",
        statusLabel: "OK",
        statusSeverity: "success",
        totalSalesRevenueInScope: 100,
        marginRevenueCovered: 100,
        marginRevenueUncovered: 0,
        marginCoveragePercent: 100,
        itemsTotal: 1,
        itemsWithCost: 1,
        itemsWithoutCost: 0,
        costCoverageStatus: "FULL",
        taxMode: "deductFromGross",
        grossSalesAmount: 130,
        taxAmount: 30,
        netSalesAmountAfterTax: 100,
        taxRuleName: "ICMS+PIS",
        taxRulePercent: 23,
        fiscalConfigComplete: true,
      },
      orderIssueDate: "2026-06-10",
      itemMargins: [
        {
          costSource: "VERSIONED_PRODUCTION_COST",
          unitCost: 11.5,
          totalCost: 23,
          productionCost: {
            costTableVersionId: "v2b",
            costTableItemId: "item-prod-a-v2b",
            versionCode: "2026-06",
            versionName: "Custo 2026-06",
            revision: 2,
            effectiveDate: "2026-06-01",
            publishedAt: "2026-06-02T10:00:00.000Z",
            orderIssueDate: "2026-06-10",
          },
        },
      ],
    });
    assert.match(text, /Tabela de custo vigente/);
    assert.match(text, /2026-06 \(rev\. 2\)/);
    assert.match(text, /Vigência: 01\/06\/2026/);
    assert.match(text, /Data do pedido: 10\/06\/2026/);
    assert.doesNotMatch(text, /unitCost/);
    assert.doesNotMatch(text, /getProductCostAnalysis/);
  });
});
