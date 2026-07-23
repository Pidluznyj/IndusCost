import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateSalesOrderListCostBreakdown,
  buildSalesOrderListCostBreakdownTooltipText,
} from "./salesOrderListCostBreakdown.js";
import type { SalesOrderMarginItemResult } from "./salesOrderMarginTypes.js";

function item(
  partial: Partial<SalesOrderMarginItemResult> &
    Pick<SalesOrderMarginItemResult, "quantity" | "totalCost">
): SalesOrderMarginItemResult {
  return {
    quantity: partial.quantity,
    netUnitRevenue: null,
    netRevenue: 0,
    unitCost: partial.unitCost ?? null,
    totalCost: partial.totalCost,
    marginValue: null,
    marginPercent: null,
    markup: null,
    status: "OK",
    statusLabel: "OK",
    statusSeverity: "success",
    costSource: "VERSIONED_PRODUCTION_COST",
    costConfidence: "HIGH",
    productionCost: partial.productionCost ?? null,
    notes: [],
    ...partial,
  };
}

describe("salesOrderListCostBreakdown", () => {
  it("agrega MP/HH/HM × quantidade e impostos", () => {
    const breakdown = aggregateSalesOrderListCostBreakdown({
      marginByOrder: [
        {
          itemResults: [
            item({
              quantity: 10,
              totalCost: 100,
              unitCost: 10,
              productionCost: {
                costTableVersionId: "v1",
                costTableItemId: "i1",
                versionCode: "CT-1",
                versionName: "V1",
                revision: 1,
                effectiveDate: "2026-01-01",
                publishedAt: null,
                orderIssueDate: "2026-07-01",
                unitBreakdown: {
                  materialCost: 5,
                  laborCost: 2,
                  machineCost: 2,
                  otherCost: 1,
                },
              },
            }),
            item({
              quantity: 2,
              totalCost: 40,
              unitCost: 20,
              productionCost: {
                costTableVersionId: "v1",
                costTableItemId: "i2",
                versionCode: "CT-1",
                versionName: "V1",
                revision: 1,
                effectiveDate: "2026-01-01",
                publishedAt: null,
                orderIssueDate: "2026-07-01",
                unitBreakdown: {
                  materialCost: 10,
                  laborCost: 5,
                  machineCost: 3,
                  otherCost: 2,
                },
              },
            }),
          ],
        },
      ],
      totalIndustrialCost: 140,
      taxAmount: 25.5,
    });

    assert.equal(breakdown.hasIndustrialBreakdown, true);
    assert.equal(breakdown.materialCost, 70); // 5*10 + 10*2
    assert.equal(breakdown.laborCost, 30); // 2*10 + 5*2
    assert.equal(breakdown.machineCost, 26); // 2*10 + 3*2
    assert.equal(breakdown.otherIndustrialCost, 14); // 1*10 + 2*2
    assert.equal(breakdown.totalIndustrialCost, 140);
    assert.equal(breakdown.taxAmount, 25.5);
    assert.equal(breakdown.residualCost, 0);
    assert.equal(breakdown.itemsWithBreakdown, 2);
  });

  it("tooltip lista discriminação e impostos", () => {
    const text = buildSalesOrderListCostBreakdownTooltipText({
      materialCost: 70,
      laborCost: 30,
      machineCost: 26,
      otherIndustrialCost: 14,
      taxAmount: 25.5,
      totalIndustrialCost: 140,
      residualCost: 0,
      hasIndustrialBreakdown: true,
      itemsWithBreakdown: 2,
      itemsWithoutBreakdown: 0,
    });
    assert.match(text, /Custo industrial total/);
    assert.match(text, /MP \(materiais\)/);
    assert.match(text, /HH \(mão de obra\)/);
    assert.match(text, /HM \(máquina\)/);
    assert.match(text, /Impostos \(dedução da margem\)/);
  });
});
