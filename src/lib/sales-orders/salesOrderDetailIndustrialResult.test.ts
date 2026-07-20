import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildIndustrialResultNarrative,
  buildSalesOrderDetailIndustrialResultBlock,
  mergeIndustrialMaterialLines,
  resolveIndustrialResultVerdict,
  scaleBomMaterialLineForOrderItem,
  scaleOpenBookExplosionRowForOrderItem,
} from "./salesOrderDetailIndustrialResult.js";
import type { SalesOrderIndustrialResultReportRow } from "@/src/lib/sales/salesOrderIndustrialResultReport.js";

function baseRow(
  overrides: Partial<SalesOrderIndustrialResultReportRow> = {}
): SalesOrderIndustrialResultReportRow {
  return {
    salesOrderId: "o1",
    orderCode: "PV-1",
    issueDate: "2026-01-15T00:00:00.000Z",
    customerName: "Cliente",
    sellerName: "Vendedor",
    orderStatus: "SENT_TO_NOMUS",
    orderStatusLabel: "Enviado",
    invoiceStatus: "not_invoiced",
    invoiceStatusLabel: "Sem NF",
    orderCommercialValue: 1000,
    materialCost: 200,
    laborHourCost: 50,
    machineHourCost: 30,
    otherIndustrialCost: 20,
    totalIndustrialCost: 300,
    icms: 100,
    ipi: 0,
    pis: 10,
    cofins: 20,
    icmsSt: 0,
    difal: 0,
    fcp: 0,
    otherTaxes: 0,
    totalTaxes: 130,
    revenueAfterTaxes: 870,
    industrialResult: 570,
    industrialMarginPercent: 65.52,
    taxSource: "ESTIMATED",
    taxSourceLabel: "Estimado",
    costSourceStatus: "OK",
    costSourceStatusLabel: "OK",
    costTableVersionLabel: "v1",
    costBaseDate: "2026-01-15",
    costTableReferences: ["v1"],
    priceTableReference: null,
    warnings: [],
    includedInConsolidation: true,
    ...overrides,
  };
}

describe("salesOrderDetailIndustrialResult", () => {
  it("veredito positivo / negativo / incompleto", () => {
    assert.equal(resolveIndustrialResultVerdict(baseRow()), "POSITIVE");
    assert.equal(
      resolveIndustrialResultVerdict(baseRow({ industrialResult: -10 })),
      "NEGATIVE"
    );
    assert.equal(
      resolveIndustrialResultVerdict(
        baseRow({ includedInConsolidation: false, industrialResult: null })
      ),
      "INCOMPLETE"
    );
  });

  it("narrativa descreve sobra após custos e impostos", () => {
    const text = buildIndustrialResultNarrative(baseRow());
    assert.match(text, /restam R\$ 570/);
    assert.match(text, /impostos/);
    assert.match(text, /custos industriais/);
  });

  it("escala BOM × quantidade do item", () => {
    const line = scaleBomMaterialLineForOrderItem({
      line: {
        materialId: "m1",
        sku: "MP-01",
        name: "Resina",
        unit: "KG",
        requiredQty: 2,
        unitCostUsed: 10,
        lineTotalCost: 20,
        lineType: "MATERIAL",
        excludedFromCost: false,
      },
      orderItemQuantity: 5,
      sourceProductSku: "PROD-A",
      sourceProductName: "Produto A",
    });
    assert.ok(line);
    assert.equal(line!.quantityInOrder, 10);
    assert.equal(line!.unitCostUsed, 10);
    assert.equal(line!.totalCost, 100);
  });

  it("escala explosão Open Book × quantidade do item", () => {
    const line = scaleOpenBookExplosionRowForOrderItem({
      row: {
        materialId: "m1",
        code: "MP-01",
        description: "Resina",
        unit: "KG",
        quantity: 2,
        totalCost: 20,
      },
      orderItemQuantity: 5,
      sourceProductSku: "618.10AA",
      sourceProductName: "Produto A",
    });
    assert.ok(line);
    assert.equal(line!.quantityInOrder, 10);
    assert.equal(line!.unitCostUsed, 10);
    assert.equal(line!.totalCost, 100);
    assert.equal(line!.sku, "MP-01");
  });

  it("consolida materiais iguais e monta bloco", () => {
    const a = scaleBomMaterialLineForOrderItem({
      line: {
        materialId: "m1",
        sku: "MP-01",
        name: "Resina",
        unit: "KG",
        requiredQty: 1,
        unitCostUsed: 10,
        lineTotalCost: 10,
        lineType: "MATERIAL",
        excludedFromCost: false,
      },
      orderItemQuantity: 2,
      sourceProductSku: "A",
      sourceProductName: "A",
    })!;
    const b = scaleBomMaterialLineForOrderItem({
      line: {
        materialId: "m1",
        sku: "MP-01",
        name: "Resina",
        unit: "KG",
        requiredQty: 1,
        unitCostUsed: 10,
        lineTotalCost: 10,
        lineType: "MATERIAL",
        excludedFromCost: false,
      },
      orderItemQuantity: 3,
      sourceProductSku: "B",
      sourceProductName: "B",
    })!;
    const merged = mergeIndustrialMaterialLines([a, b]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]!.quantityInOrder, 5);
    assert.equal(merged[0]!.totalCost, 50);

    const block = buildSalesOrderDetailIndustrialResultBlock({
      row: baseRow(),
      materials: [a, b],
    });
    assert.equal(block.verdict, "POSITIVE");
    assert.equal(block.materials.length, 1);
    assert.equal(block.materialsTotalCost, 50);
    assert.match(block.resultNarrative, /restam/);
  });
});
