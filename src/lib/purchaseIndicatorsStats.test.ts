import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PurchaseRequestRow } from "@/src/types/purchase";
import {
  purchaseStatusCounts,
  purchaseStatusChartData,
  topMaterialsByFrequency,
  totalPurchaseLines,
} from "./purchaseIndicatorsStats";

function row(partial: Partial<PurchaseRequestRow> & { id: string }): PurchaseRequestRow {
  return {
    number: 1,
    requester: "a",
    department: "b",
    requestCategory: null,
    priority: "NORMAL",
    status: "ABERTA",
    justification: "j",
    defaultCostCenterId: "cc",
    notes: null,
    createdAt: "",
    updatedAt: "",
    defaultCostCenter: {} as PurchaseRequestRow["defaultCostCenter"],
    items: [],
    ...partial,
  };
}

describe("purchaseIndicatorsStats", () => {
  it("conta status e linhas", () => {
    const rows: PurchaseRequestRow[] = [
      row({ id: "1", status: "ABERTA", items: [{ id: "i" } as any] }),
      row({ id: "2", status: "RASCUNHO", items: [{ id: "i2" } as any, { id: "i3" } as any] }),
    ];
    const c = purchaseStatusCounts(rows);
    assert.equal(c.ABERTA, 1);
    assert.equal(c.RASCUNHO, 1);
    assert.equal(totalPurchaseLines(rows), 3);
  });

  it("purchaseStatusChartData soma 100% quando há dados", () => {
    const c = purchaseStatusCounts([row({ id: "1", status: "ENCERRADA" })]);
    const chart = purchaseStatusChartData(c);
    const sum = chart.reduce((s, x) => s + x.pct, 0);
    assert.ok(Math.abs(sum - 100) < 0.001);
  });

  it("topMaterialsByFrequency agrega MP", () => {
    const rows: PurchaseRequestRow[] = [
      row({
        id: "1",
        status: "ABERTA",
        items: [
          {
            id: "a",
            lineType: "MATERIA_PRIMA",
            materialId: "m1",
            description: "x",
            quantity: 1,
            unit: "kg",
            material: { code: "MP1", description: "Resina" } as any,
          } as any,
          {
            id: "b",
            lineType: "MATERIA_PRIMA",
            materialId: "m1",
            description: "x",
            quantity: 1,
            unit: "kg",
            material: { code: "MP1", description: "Resina" } as any,
          } as any,
        ],
      }),
    ];
    const top = topMaterialsByFrequency(rows, 5);
    assert.equal(top[0]?.code, "MP1");
    assert.equal(top[0]?.count, 2);
  });
});
