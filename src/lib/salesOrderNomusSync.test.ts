import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildNomusSyncItemWritePlan,
  buildNomusSyncUpdatePreview,
  canonicalNomusOrderCodeKey,
  detectSalesOrderHeaderItemDrift,
  expandNomusOrderCodeLookupVariants,
  findExistingSalesOrderForNomusSync,
  indexExistingSalesOrdersByNomusKey,
  mergeNomusSyncHeaderPreservingHistoricalCosts,
  normalizeNomusOrderCodeForStorage,
  type NomusSyncExistingSalesOrder,
} from "./salesOrderNomusSync.server.js";
import { resolveSalesOrderItemUnitCostSnapshot } from "./salesOrderNomusSyncCost.server.js";

describe("salesOrderNomusSync", () => {
  it("canonicalNomusOrderCodeKey normaliza variantes PD 02339", () => {
    assert.equal(canonicalNomusOrderCodeKey("PD 02339"), "PD:2339");
    assert.equal(canonicalNomusOrderCodeKey("PD02339"), "PD:2339");
    assert.equal(canonicalNomusOrderCodeKey("02339"), "PD:2339");
    assert.equal(canonicalNomusOrderCodeKey("PD-02339"), "PD:2339");
  });

  it("normalizeNomusOrderCodeForStorage usa formato PD 02339", () => {
    assert.equal(normalizeNomusOrderCodeForStorage("PD02339"), "PD 02339");
    assert.equal(normalizeNomusOrderCodeForStorage("02339"), "PD 02339");
  });

  it("expandNomusOrderCodeLookupVariants inclui formatos comuns", () => {
    const variants = expandNomusOrderCodeLookupVariants("PD02339");
    assert.ok(variants.includes("PD 02339"));
    assert.ok(variants.includes("PD02339"));
    assert.ok(variants.includes("02339"));
  });

  it("findExistingSalesOrderForNomusSync encontra pedido por orderCode variant", () => {
    const existing: NomusSyncExistingSalesOrder = {
      id: "so-1",
      orderCode: "PD 02339",
      externalSalesOrderId: null,
      externalSalesOrderCode: null,
      sourceSystem: null,
      totalNetValue: "275430.000000",
      totalItems: 9,
      totalCost: "100.000000",
      totalMarginValue: "275330.000000",
      totalMarginPerc: "99.000000",
    };
    const indexes = indexExistingSalesOrdersByNomusKey([existing]);
    const found = findExistingSalesOrderForNomusSync(indexes, {
      externalSalesOrderId: 999,
      codigoPedido: "PD02339",
    });
    assert.equal(found?.id, "so-1");
  });

  it("mergeNomusSyncHeaderPreservingHistoricalCosts preserva margem do cabeçalho", () => {
    const merged = mergeNomusSyncHeaderPreservingHistoricalCosts(
      {
        totalNetValue: "158000.000000",
        totalCost: "0.000000",
        totalMarginValue: "158000.000000",
        totalMarginPerc: "100.000000",
      },
      {
        totalCost: "50000.000000",
        totalMarginValue: "225430.000000",
        totalMarginPerc: "81.850000",
      },
      true
    );
    assert.equal(merged.totalNetValue, "158000.000000");
    assert.equal(merged.totalCost, "50000.000000");
    assert.equal(merged.totalMarginValue, "225430.000000");
    assert.equal(merged.totalMarginPerc, "81.850000");
  });

  it("buildNomusSyncUpdatePreview detecta mudança de totalNetValue", () => {
    const preview = buildNomusSyncUpdatePreview(
      {
        id: "so-1",
        orderCode: "PD 02339",
        externalSalesOrderId: 1,
        externalSalesOrderCode: "PD 02339",
        sourceSystem: "NOMUS",
        totalNetValue: "275430.000000",
        totalItems: 9,
        totalCost: "0",
        totalMarginValue: "0",
        totalMarginPerc: "0",
      },
      {
        externalSalesOrderId: 1,
        codigoPedido: "PD 02339",
        totalNetValue: 158_000,
        lineCount: 4,
      }
    );
    assert.equal(preview.changedHeaderTotals, true);
    assert.equal(preview.changedItems, true);
    assert.equal(preview.totalNetValueBefore, 275_430);
    assert.equal(preview.totalNetValueAfter, 158_000);
  });

  it("buildNomusSyncItemWritePlan preserva unitCost histórico ao mudar valor comercial", () => {
    const preservationMap = new Map([["100|p1|", 77]]);
    const plan = buildNomusSyncItemWritePlan({
      salesOrderId: "so-1",
      plannedLines: [
        {
          externalLineId: 501,
          productId: "p1",
          externalProductId: 100,
          proposalItemId: null,
          skuSnapshot: "SKU-1",
          productNameSnapshot: "Produto 1",
          unit: "UN",
          quantity: 2,
          negotiatedPrice: 50_000,
          totalNetValue: 100_000,
          notes: null,
        },
      ],
      existingItems: [
        {
          id: "item-1",
          productId: "p1",
          externalProductId: 100,
          proposalItemId: null,
          skuSnapshot: "SKU-1",
          productNameSnapshot: "Produto 1",
          unit: "UN",
          unitCost: "77.000000",
          totalCost: "770.000000",
          marginValue: "274660.000000",
          marginPerc: "99.721773",
          quantity: "9.000000",
          negotiatedPrice: "30500.000000",
          totalNetValue: "274430.000000",
          notes: null,
        },
      ],
      resolveUnitCost: (line) =>
        resolveSalesOrderItemUnitCostSnapshot({
          productId: line.productId,
          externalProductId: line.externalProductId,
          proposalItemId: line.proposalItemId,
          preservationMap,
          unitCostIndex: new Map(),
        }),
    });

    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.creates.length, 0);
    assert.equal(plan.upserts[0]?.unitCost, "77.000000");
    assert.equal(plan.upserts[0]?.negotiatedPrice, "50000.000000");
    assert.equal(plan.upserts[0]?.totalNetValue, "100000.000000");
    assert.equal(plan.upserts[0]?.totalCost, "154.000000");
  });

  it("buildNomusSyncItemWritePlan marca linha removida no Nomus sem delete físico", () => {
    const plan = buildNomusSyncItemWritePlan({
      salesOrderId: "so-1",
      plannedLines: [],
      existingItems: [
        {
          id: "item-old",
          productId: "p9",
          externalProductId: 900,
          proposalItemId: null,
          skuSnapshot: "SKU-9",
          productNameSnapshot: "Legado",
          unit: "UN",
          unitCost: "12.000000",
          totalCost: "120.000000",
          marginValue: "100.000000",
          marginPerc: "45.000000",
          quantity: "10.000000",
          negotiatedPrice: "22.000000",
          totalNetValue: "220.000000",
          notes: null,
        },
      ],
      resolveUnitCost: () => ({ unitCost: null, outcome: "unresolved", warning: null }),
    });

    assert.equal(plan.staleUpdates.length, 1);
    assert.equal(plan.staleUpdates[0]?.quantity, "0.000000");
    assert.equal(plan.staleUpdates[0]?.unitCost, "12.000000");
    assert.match(plan.staleUpdates[0]?.notes ?? "", /removida ou substituída no Nomus/);
  });

  it("detectSalesOrderHeaderItemDrift identifica divergência cabeçalho vs itens", () => {
    const drift = detectSalesOrderHeaderItemDrift("275430", [
      { totalNetValue: "100000" },
      { totalNetValue: "58000" },
    ]);
    assert.equal(drift.hasDrift, true);
    assert.equal(drift.itemsSum, 158_000);
    assert.equal(drift.headerTotal, 275_430);
  });
});
