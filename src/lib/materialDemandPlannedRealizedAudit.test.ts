import assert from "node:assert/strict";
import test from "node:test";
import { aggregateMaterialUsageContributions } from "./materialDemandPlannedRealized.js";
import {
  buildMaterialUsageAuditPayload,
  classifyMaterialUsageLine,
  computeMaterialUsageDifferenceBridge,
  explainMaterialUsageCostDifference,
  resolveMaterialUsageProductStatus,
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
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
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

test("buildMaterialUsageAuditPayload monta resumo comparativo", () => {
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
  assert.equal(audit!.summary.pendingQuantity, 144);
  assert.equal(audit!.summary.plannedCost, 1100);
  assert.equal(audit!.summary.realizedCost, 308);
  assert.equal(audit!.summary.pendingCost, 792);
  assert.equal(audit!.summary.costDifference, -792);
});

test("diferença negativa explica consumo previsto não faturado", () => {
  assert.equal(explainMaterialUsageCostDifference(-100), MATERIAL_USAGE_AUDIT_DIFF_NEGATIVE);
});

test("classifica pedido não faturado, parcial e faturado", () => {
  assert.equal(classifyMaterialUsageLine(contrib({ materialId: "m1", hasInvoicing: false })), "not_invoiced");
  assert.equal(
    classifyMaterialUsageLine(
      contrib({ materialId: "m1", plannedOrderQty: 10, realizedOrderQty: 4, hasInvoicing: true })
    ),
    "partial"
  );
  assert.equal(
    classifyMaterialUsageLine(
      contrib({ materialId: "m1", plannedOrderQty: 10, realizedOrderQty: 10, hasInvoicing: true })
    ),
    "invoiced"
  );
});

test("auditoria separa pedidos não faturados, parciais e faturados", () => {
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
    contrib({
      materialId: "m1",
      orderId: "o3",
      productId: "p3",
      plannedOrderQty: 8,
      realizedOrderQty: 8,
      hasInvoicing: true,
    }),
  ];
  const nfe = new Map([
    ["o1", [{ dataProcessamento: "15/01/2026", numero: "NF-1", serie: null }]],
    ["o3", [{ dataProcessamento: "16/01/2026", numero: "NF-2", serie: null }]],
  ]);
  const audit = buildMaterialUsageAuditPayload("m1", contributions, nfe);
  assert.ok(audit);
  assert.equal(audit!.notInvoicedOrders.length, 1);
  assert.equal(audit!.partiallyInvoicedOrders.length, 1);
  assert.equal(audit!.realizedOrders.length, 2);
  assert.equal(audit!.summary.notInvoicedOrdersCount, 1);
  assert.equal(audit!.summary.partiallyInvoicedOrdersCount, 1);
});

test("ponte da diferença reconcilia saldo com não faturado + parcial", () => {
  const contributions = [
    contrib({
      materialId: "m1",
      orderId: "o1",
      plannedOrderQty: 10,
      realizedOrderQty: 0,
      materialQtyPerUnit: 1,
    }),
    contrib({
      materialId: "m1",
      orderId: "o2",
      plannedOrderQty: 10,
      realizedOrderQty: 5,
      hasInvoicing: true,
      materialQtyPerUnit: 1,
    }),
  ];
  const audit = buildMaterialUsageAuditPayload("m1", contributions, new Map());
  assert.ok(audit);
  assert.equal(audit!.differenceBridge.totalBalanceQuantity, 15);
  assert.equal(audit!.differenceBridge.notInvoicedOrdersQuantity, 10);
  assert.equal(audit!.differenceBridge.partiallyInvoicedOrdersQuantity, 5);
  assert.equal(audit!.differenceBridge.reconciles, true);
});

test("produto com previsto e realizado zero não gera NaN", () => {
  const status = resolveMaterialUsageProductStatus({
    plannedMaterialQuantity: 0,
    realizedMaterialQuantity: 0,
    pendingMaterialQuantity: 0,
    partiallyInvoicedOrdersCount: 0,
    notInvoicedOrdersCount: 0,
    hasWarning: false,
  });
  assert.equal(status, "ok");
  const audit = buildMaterialUsageAuditPayload(
    "m1",
    [contrib({ materialId: "m1", plannedOrderQty: 0, realizedOrderQty: 0, valuePerUnit: null, unitCost: null })],
    new Map()
  );
  assert.ok(audit);
  assert.ok(Number.isFinite(audit!.summary.plannedQuantity));
  assert.ok(Number.isFinite(audit!.summary.realizedQuantity));
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
  assert.ok(audit!.dataQuality.warnings.some((w) => w.includes("fallback")));
});

test("realizado é fiscal — texto de alerta presente", () => {
  const audit = buildMaterialUsageAuditPayload("m1", [contrib({ materialId: "m1" })], new Map());
  assert.ok(audit!.dataQuality.warnings.some((w) => w.includes(MATERIAL_USAGE_AUDIT_FISCAL_NOTE.slice(0, 15))));
});

test("computeMaterialUsageDifferenceBridge detecta saldo não explicado", () => {
  const bridge = computeMaterialUsageDifferenceBridge({
    totalBalanceQuantity: 100,
    notInvoicedOrdersQuantity: 60,
    partiallyInvoicedOrdersQuantity: 20,
    invoiceLinkWarningQuantity: 0,
  });
  assert.equal(bridge.unexplainedQuantity, 20);
  assert.equal(bridge.reconciles, false);
});

test("tabela agrega ped. não fat. e % faturado", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", orderId: "o1", plannedOrderQty: 10, realizedOrderQty: 10, hasInvoicing: true }),
    contrib({ materialId: "m1", orderId: "o2", plannedOrderQty: 5, realizedOrderQty: 0, hasInvoicing: false }),
    contrib({ materialId: "m1", orderId: "o3", plannedOrderQty: 8, realizedOrderQty: 0, hasInvoicing: false }),
  ]);
  assert.equal(rows[0]!.plannedOrdersCount, 3);
  assert.equal(rows[0]!.realizedOrdersCount, 1);
  assert.equal(rows[0]!.notInvoicedOrdersCount, 2);
  assert.equal(rows[0]!.invoicedPercent, 33.333333);
});
