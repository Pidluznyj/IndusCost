import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { aggregateMaterialUsageContributions } from "./materialDemandPlannedRealized.js";
import {
  buildMaterialUsageAuditPayload,
  explainMaterialUsageCostDifference,
} from "./materialDemandPlannedRealizedAudit.js";
import {
  MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE,
  MATERIAL_USAGE_AUDIT_FISCAL_NOTE,
} from "./materialDemandPlannedRealizedAuditCopy.js";
import type { MaterialUsageContribution } from "./materialDemandPlannedRealizedTypes.js";

function contrib(
  partial: Partial<MaterialUsageContribution> & Pick<MaterialUsageContribution, "materialId">
): MaterialUsageContribution {
  return {
    materialId: partial.materialId,
    materialCode: partial.materialCode ?? "115.01",
    materialDescription: partial.materialDescription ?? "Polipropileno",
    unit: partial.unit ?? "KG",
    unitKey: partial.unitKey ?? "kg",
    unitLabel: partial.unitLabel ?? "KG",
    orderId: partial.orderId ?? "ord-1",
    orderCode: partial.orderCode ?? "PV-001",
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    issueDate: partial.issueDate ?? "2026-01-15T00:00:00.000Z",
    customerName: partial.customerName ?? "Cliente A",
    productId: partial.productId ?? "prod-1",
    productSku: partial.productSku ?? "SKU1",
    productName: partial.productName ?? "Produto A",
    productSoldUnit: partial.productSoldUnit ?? "UN",
    materialQtyPerUnit: partial.materialQtyPerUnit ?? 2,
    valuePerUnit: partial.valuePerUnit ?? 10,
    unitCost: partial.unitCost ?? 5,
    plannedOrderQty: partial.plannedOrderQty ?? 100,
    realizedOrderQty: partial.realizedOrderQty ?? 0,
    hasInvoicing: partial.hasInvoicing ?? false,
    usedPartialInvoiceFallback: partial.usedPartialInvoiceFallback ?? false,
    missingCost: partial.missingCost ?? false,
  };
}

test("buildMaterialUsageAuditPayload monta resumo com equações", () => {
  const contributions = [
    contrib({
      materialId: "m1",
      plannedOrderQty: 100,
      realizedOrderQty: 28,
      hasInvoicing: true,
      valuePerUnit: 11,
    }),
  ];
  const rows = aggregateMaterialUsageContributions(contributions);
  const audit = buildMaterialUsageAuditPayload("m1", contributions, new Map(), rows[0]);
  assert.ok(audit);
  assert.equal(audit!.summary.plannedQuantity, 200);
  assert.equal(audit!.summary.realizedQuantity, 56);
  assert.equal(audit!.summary.balanceQuantity, 144);
  assert.equal(audit!.summary.plannedCost, 1100);
  assert.equal(audit!.summary.realizedCost, 308);
  assert.equal(audit!.summary.costDifference, -792);
  assert.equal(audit!.summary.plannedOrdersCount, 1);
  assert.equal(audit!.summary.realizedOrdersCount, 1);
  assert.equal(audit!.summary.pendingOrdersCount, 0);
});

test("diferença negativa explica consumo previsto não faturado", () => {
  assert.equal(explainMaterialUsageCostDifference(-100), MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE);
});

test("auditoria inclui produtos, pedidos previstos e faturados", () => {
  const contributions = [
    contrib({
      materialId: "m1",
      orderId: "o1",
      productId: "p1",
      plannedOrderQty: 10,
      realizedOrderQty: 4,
      hasInvoicing: true,
    }),
    contrib({
      materialId: "m1",
      orderId: "o2",
      productId: "p2",
      plannedOrderQty: 5,
      realizedOrderQty: 0,
      hasInvoicing: false,
    }),
  ];
  const nfe = new Map([
    ["o1", [{ dataProcessamento: "15/01/2026", numero: "NF-1", serie: null }]],
  ]);
  const audit = buildMaterialUsageAuditPayload("m1", contributions, nfe);
  assert.ok(audit);
  assert.equal(audit!.products.length, 2);
  assert.equal(audit!.plannedOrders.length, 2);
  assert.equal(audit!.realizedOrders.length, 1);
  assert.equal(audit!.summary.pendingOrdersCount, 1);
  assert.equal(audit!.productVarianceRanking.length, 2);
});

test("alertas: matéria-prima sem custo e fallback parcial", () => {
  const audit = buildMaterialUsageAuditPayload(
    "m1",
    [
      contrib({
        materialId: "m1",
        missingCost: true,
        usedPartialInvoiceFallback: true,
        hasInvoicing: true,
        realizedOrderQty: 5,
      }),
    ],
    new Map()
  );
  assert.ok(audit);
  assert.ok(audit!.dataQuality.missingCosts > 0);
  assert.ok(audit!.dataQuality.partialInvoiceFallbacks > 0);
  assert.ok(audit!.dataQuality.warnings.some((w) => w.includes(MATERIAL_USAGE_AUDIT_FISCAL_NOTE.slice(0, 20))));
});

test("valores de auditoria não retornam NaN/Infinity", () => {
  const audit = buildMaterialUsageAuditPayload(
    "m1",
    [contrib({ materialId: "m1", valuePerUnit: null, unitCost: null })],
    new Map()
  );
  assert.ok(audit);
  for (const key of [
    "plannedQuantity",
    "realizedQuantity",
    "balanceQuantity",
    "plannedCost",
    "realizedCost",
    "costDifference",
  ] as const) {
    assert.ok(Number.isFinite(audit!.summary[key]));
  }
});

test("realizado é fiscal — texto de alerta presente", () => {
  const audit = buildMaterialUsageAuditPayload("m1", [contrib({ materialId: "m1" })], new Map());
  assert.ok(
    audit!.dataQuality.warnings.some((w) => w.includes("comercial/fiscal") || w.includes("nota fiscal"))
  );
});
