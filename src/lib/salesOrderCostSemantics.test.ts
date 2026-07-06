import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE,
  classifyUnitCostFieldUsage,
} from "./salesOrderCostSemantics.js";
import { resolveSalesOrderItemCost } from "./salesOrderMarginResolver.js";
import { buildNomusSyncItemWritePlan } from "./salesOrderNomusSync.server.js";

describe("salesOrderCostSemantics", () => {
  it("documenta que unitCost Nomus é preço comercial", () => {
    assert.match(SALES_ORDER_ITEM_UNIT_COST_IS_SALE_PRICE, /preço unitário comercial/i);
  });

  it("margem não usa SalesOrderItem.unitCost como custo de produção", () => {
    const cost = resolveSalesOrderItemCost({
      salesOrderItemId: "i1",
      productId: "p1",
      storedUnitCost: 500,
      analysis: { summary: { totalIndustrialCost: 40 } },
      costPolicy: { allowLiveCostFallback: true, useFrozenUnitCostFirst: false },
    });
    assert.equal(cost.unitCost, 40);
    assert.notEqual(cost.costSource, "SALES_ORDER_ITEM_SNAPSHOT");
  });

  it("sync espelha preço comercial em unitCost sem afetar custo de produção", () => {
    const plan = buildNomusSyncItemWritePlan({
      salesOrderId: "so-1",
      plannedLines: [
        {
          externalLineId: 1,
          productId: "p1",
          externalProductId: 10,
          proposalItemId: null,
          skuSnapshot: "SKU",
          productNameSnapshot: "Produto",
          unit: "UN",
          quantity: 2,
          negotiatedPrice: 79_000,
          totalNetValue: 158_000,
          notes: null,
        },
      ],
      existingItems: [
        {
          id: "item-1",
          productId: "p1",
          externalProductId: 10,
          proposalItemId: null,
          skuSnapshot: "SKU",
          productNameSnapshot: "Produto",
          unit: "UN",
          unitCost: "275430.000000",
          totalCost: "100.000000",
          marginValue: "275330.000000",
          marginPerc: "99.000000",
          quantity: "9.000000",
          negotiatedPrice: "30500.000000",
          totalNetValue: "275430.000000",
          notes: null,
        },
      ],
    });

    assert.equal(plan.upserts.length, 1);
    assert.equal(plan.upserts[0]?.unitCost, "79000.000000");
    assert.equal(plan.upserts[0]?.negotiatedPrice, "79000.000000");
    assert.equal(plan.upserts[0]?.totalCost, "0.000000");
  });

  it("classifica contexto de negotiatedPrice como PRECO_VENDA", () => {
    assert.equal(
      classifyUnitCostFieldUsage("negotiatedPrice espelha preço unitário de venda Nomus"),
      "PRECO_VENDA"
    );
  });

  it("margin resolver não referencia storedUnitCost do item", () => {
    const src = readFileSync("src/lib/salesOrderMarginResolver.ts", "utf8");
    assert.doesNotMatch(src, /storedUnitCost: item\.unitCost/);
    assert.doesNotMatch(src, /Custo unitário congelado de SalesOrderItem\.unitCost/);
  });

  it("backfill apply está bloqueado", () => {
    const src = readFileSync("scripts/backfill-sales-order-unit-cost-snapshot.ts", "utf8");
    assert.match(src, /BLOQUEADO.*apply desabilitado/i);
    assert.match(src, /unitCost do Nomus é preço de venda, não custo de produção/i);
  });

  it("config margem Nomus não oferece priorizar unitCost como custo", () => {
    const src = readFileSync("src/components/settings/SalesMarginNomusConfigPanel.tsx", "utf8");
    assert.doesNotMatch(src, /useFrozenUnitCostFirst/i);
    assert.doesNotMatch(src, /custo congelado/i);
    assert.doesNotMatch(src, /Priorizar SalesOrderItem\.unitCost/i);
  });

  it("labels do motor não chamam unitCost Nomus de custo de produção", () => {
    const engineNote = readFileSync("src/lib/salesMarginRulesEngine.ts", "utf8");
    assert.match(engineNote, /tabela oficial de produção vigente/);
    assert.doesNotMatch(engineNote, /SalesOrderItem\.unitCost Nomus como custo/);
  });
});
