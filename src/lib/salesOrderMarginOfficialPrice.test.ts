import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderMarginCommercialReference } from "./salesOrderMarginOfficialPrice.js";
import { calculateSalesOrderItemMargin } from "./salesOrderMarginMath.js";
import { assembleSalesOrderMarginItemInput } from "./salesOrderMarginResolver.js";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  resolveEffectiveProductProductionCostFromCatalog,
  type ProductionCostTableVersionWithItems,
} from "./productionCostVersioning.js";
import {
  mapEffectiveProductionCostToMarginMeta,
  resolveSalesOrderItemCostFromVersionedProduction,
} from "./salesOrderMarginResolver.js";

describe("salesOrderMarginOfficialPrice", () => {
  it("sold price below official price shows discount and margin leakage", () => {
    const item = calculateSalesOrderItemMargin({
      salesOrderItemId: "i1",
      productId: "p1",
      quantity: 10,
      netUnitPrice: 90,
      netTotalValue: 900,
      unitCost: 50,
      costSource: "VERSIONED_PRODUCTION_COST",
      costConfidence: "HIGH",
    });
    assert.equal(item.status, "OK");

    const ref = buildSalesOrderMarginCommercialReference({
      item,
      officialPrice: {
        priceTableId: "pt-1",
        priceTableCode: "ATACADO",
        priceTableName: "Atacado",
        priceTableVersionId: "ptv-1",
        versionNumber: 3,
        effectiveFrom: "2026-06-01",
        effectiveTo: null,
        priceTableItemId: "pti-1",
        orderIssueDate: "2026-06-10",
      },
      officialPriceItem: { priceTableItemId: "pti-1", salePrice: 100, frozenTotalCost: 50 },
      productType: "PRODUCT",
    });

    assert.equal(ref.soldUnitPrice, 90);
    assert.equal(ref.officialUnitPrice, 100);
    assert.equal(ref.discountVsOfficialPrice, 10);
    assert.equal(ref.discountPercentVsOfficialPrice, 10);
    assert.equal(ref.realizedMarginAmount, 400);
    assert.equal(ref.tableMarginAmount, 500);
    assert.equal(ref.marginLeakageAmount, 100);
    assert.equal(ref.referenceStatus, "OK");
  });

  it("missing official price does not break realized margin", () => {
    const item = calculateSalesOrderItemMargin({
      salesOrderItemId: "i1",
      productId: "p1",
      quantity: 2,
      netTotalValue: 200,
      unitCost: 60,
      costSource: "VERSIONED_PRODUCTION_COST",
      costConfidence: "HIGH",
    });
    const ref = buildSalesOrderMarginCommercialReference({
      item,
      officialPrice: null,
      officialPriceItem: null,
    });
    assert.equal(ref.realizedMarginAmount, 80);
    assert.equal(ref.referenceStatus, "SEM_PRECO_TABELA");
    assert.equal(ref.officialUnitPrice, null);
    assert.equal(ref.tableMarginAmount, null);
  });

  it("missing cost does not become zero — SEM_CUSTO", () => {
    const item = calculateSalesOrderItemMargin({
      salesOrderItemId: "i1",
      productId: "p1",
      quantity: 1,
      netTotalValue: 100,
      unitCost: null,
      costSource: "MISSING_COST",
      costConfidence: "MISSING",
    });
    assert.equal(item.status, "SEM_CUSTO");
    const ref = buildSalesOrderMarginCommercialReference({
      item,
      officialPriceItem: { priceTableItemId: "x", salePrice: 120, frozenTotalCost: 50 },
      officialPrice: {
        priceTableId: "pt",
        priceTableCode: "ATACADO",
        priceTableName: "Atacado",
        priceTableVersionId: "v",
        versionNumber: 1,
        effectiveFrom: null,
        effectiveTo: null,
        priceTableItemId: "x",
        orderIssueDate: null,
      },
    });
    assert.equal(ref.referenceStatus, "SEM_CUSTO");
    assert.equal(ref.officialCost, null);
  });
});

describe("salesOrderMarginOfficialPrice — integração custo versionado", () => {
  const catalog: ProductionCostTableVersionWithItems[] = [
    {
      id: "v1",
      code: "2026-06",
      name: "Jun",
      effectiveDate: civilDateToLocalDate("2026-06-01"),
      status: "PUBLISHED",
      revision: 1,
      publishedAt: new Date(),
      createdAt: new Date(),
      items: [
        {
          id: "pci-1",
          costTableVersionId: "v1",
          productId: "prod-a",
          productCodeSnapshot: "PA",
          productNameSnapshot: "Produto",
          unitProductionCost: 40,
          currency: "BRL",
          calculationHash: "h",
          calculationSnapshot: {},
          createdAt: new Date(),
          breakdown: {
            materialCost: 20,
            processCost: 0,
            laborCost: 10,
            machineCost: 5,
            overheadCost: 5,
            otherCost: 0,
          },
        },
      ],
    },
  ];

  it("product order uses production cost by issueDate", () => {
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      civilDateToLocalDate("2026-06-15")
    );
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "i1",
      productId: "prod-a",
      referenceDate: civilDateToLocalDate("2026-06-15"),
      effectiveCost: effective,
    });
    assert.equal(cost.costSource, "VERSIONED_PRODUCTION_COST");
    assert.equal(cost.unitCost, 40);
  });

  it("component order uses production cost by issueDate", () => {
    const compCatalog: ProductionCostTableVersionWithItems[] = [
      {
        ...catalog[0]!,
        items: [
          {
            ...catalog[0]!.items[0]!,
            productId: "comp-1",
            productCodeSnapshot: "309.86AA",
            unitProductionCost: 0.55,
            breakdown: {
              materialCost: 0.2,
              processCost: 0,
              laborCost: 0.15,
              machineCost: 0.1,
              overheadCost: 0.1,
              otherCost: 0,
            },
          },
        ],
      },
    ];
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      compCatalog,
      "comp-1",
      civilDateToLocalDate("2026-06-15")
    );
    assert.equal(effective.status, "OK");
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "i1",
      productId: "comp-1",
      referenceDate: civilDateToLocalDate("2026-06-15"),
      effectiveCost: effective,
    });
    assert.ok(Math.abs((cost.unitCost ?? 0) - 0.55) < 0.000001);
  });

  it("margin does not use unitCost from SalesOrderItem", () => {
    const effective = resolveEffectiveProductProductionCostFromCatalog(
      catalog,
      "prod-a",
      civilDateToLocalDate("2026-06-15")
    );
    const cost = resolveSalesOrderItemCostFromVersionedProduction({
      salesOrderItemId: "i1",
      productId: "prod-a",
      referenceDate: civilDateToLocalDate("2026-06-15"),
      effectiveCost: effective,
    });
    const margin = calculateSalesOrderItemMargin(
      assembleSalesOrderMarginItemInput(
        {
          salesOrderItemId: "i1",
          productId: "prod-a",
          quantity: 1,
          totalNetValue: 100,
          unitCost: 999,
        },
        {
          salesOrderItemId: "i1",
          productId: "prod-a",
          productSku: "PA",
          productName: "Produto",
          resolutionSource: "LOCAL_PRODUCT_ID",
          confidence: "HIGH",
          notes: [],
        },
        cost
      )
    );
    assert.equal(margin.unitCost, 40);
    assert.notEqual(margin.unitCost, 999);
  });
});
