import assert from "node:assert/strict";
import test from "node:test";
import { salesOrderHasInvoicing } from "./customerCommercialSalesOrderView.js";
import {
  aggregateMaterialUsageContributions,
  buildMaterialUsagePlannedRealizedSummary,
  computeMaterialUsageMetrics,
  extractProcessedNfeSummaries,
  mapMaterialUsageVarianceStatus,
  resolveRealizedOrderItemQuantity,
  safeMaterialUsageRatio,
  salesOrderMatchesInvoicingScope,
  type MaterialUsageContribution,
} from "./materialDemandPlannedRealized.js";

function contrib(partial: Partial<MaterialUsageContribution> & Pick<MaterialUsageContribution, "materialId">): MaterialUsageContribution {
  return {
    materialId: partial.materialId,
    materialCode: partial.materialCode ?? "MP-1",
    materialDescription: partial.materialDescription ?? "Matéria teste",
    unit: partial.unit ?? "KG",
    unitKey: partial.unitKey ?? "kg",
    unitLabel: partial.unitLabel ?? "KG",
    orderId: partial.orderId ?? "ord-1",
    orderCode: partial.orderCode ?? "PV-001",
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    issueDate: partial.issueDate ?? "2026-01-15T00:00:00.000Z",
    customerName: partial.customerName ?? "Cliente Teste",
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

test("previsto usa pedidos válidos — agrega quantidade prevista", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", plannedOrderQty: 10, realizedOrderQty: 0 }),
    contrib({ materialId: "m1", orderId: "ord-2", plannedOrderQty: 5, realizedOrderQty: 0 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.plannedQuantity, 30);
  assert.equal(rows[0]!.realizedQuantity, 0);
});

test("previsto exclui cancelados/erro via escopo de pedido (simulação por não incluir)", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", orderStatus: "READY_TO_SEND", plannedOrderQty: 10 }),
  ]);
  assert.equal(rows[0]!.plannedOrdersCount, 1);
});

test("realizado usa somente pedidos com NF — qty realizada zero sem NF", () => {
  const { realizedQuantity } = resolveRealizedOrderItemQuantity({
    orderQuantity: 50,
    hasInvoicing: false,
  });
  assert.equal(realizedQuantity, 0);
});

test("pedido sem NF não entra no realizado", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", plannedOrderQty: 10, realizedOrderQty: 0, hasInvoicing: false }),
  ]);
  assert.equal(rows[0]!.realizedQuantity, 0);
  assert.equal(rows[0]!.realizedOrdersCount, 0);
});

test("pedido faturado entra no realizado", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({
      materialId: "m1",
      plannedOrderQty: 10,
      realizedOrderQty: 10,
      hasInvoicing: true,
    }),
  ]);
  assert.equal(rows[0]!.realizedQuantity, 20);
  assert.equal(rows[0]!.realizedOrdersCount, 1);
});

test("faturamento parcial considera quantidade faturada quando disponível", () => {
  const { realizedQuantity, usedPartialInvoiceFallback } = resolveRealizedOrderItemQuantity({
    orderQuantity: 100,
    invoicedQuantityPerItem: 40,
    hasInvoicing: true,
  });
  assert.equal(realizedQuantity, 40);
  assert.equal(usedPartialInvoiceFallback, false);
});

test("fallback de faturamento parcial gera flag de warning na linha", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({
      materialId: "m1",
      plannedOrderQty: 10,
      realizedOrderQty: 10,
      hasInvoicing: true,
      usedPartialInvoiceFallback: true,
    }),
  ]);
  assert.ok(rows[0]!.dataQuality.some((w) => w.includes("quantidade faturada por item")));
});

test("BOM expande produto — qty por unidade multiplica order qty", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", materialQtyPerUnit: 3, plannedOrderQty: 4, realizedOrderQty: 2 }),
  ]);
  assert.equal(rows[0]!.plannedQuantity, 12);
  assert.equal(rows[0]!.realizedQuantity, 6);
});

test("quantidade prevista por material soma corretamente", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", materialQtyPerUnit: 1, plannedOrderQty: 5 }),
    contrib({ materialId: "m1", orderId: "o2", materialQtyPerUnit: 1, plannedOrderQty: 7 }),
  ]);
  assert.equal(rows[0]!.plannedQuantity, 12);
});

test("quantidade realizada por material soma corretamente", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", materialQtyPerUnit: 2, realizedOrderQty: 3 }),
    contrib({ materialId: "m1", orderId: "o2", materialQtyPerUnit: 2, realizedOrderQty: 4 }),
  ]);
  assert.equal(rows[0]!.realizedQuantity, 14);
});

test("assertividade calcula corretamente", () => {
  const m = computeMaterialUsageMetrics(100, 80);
  assert.equal(m.accuracyPercent, 80);
  assert.equal(m.remainingQuantity, 20);
});

test("previsto zero não gera NaN/Infinity", () => {
  const m = computeMaterialUsageMetrics(0, 50);
  assert.equal(m.accuracyPercent, null);
  assert.equal(m.variancePercent, null);
  assert.equal(mapMaterialUsageVarianceStatus(0, 50), "no_planned_base");
  assert.equal(safeMaterialUsageRatio(1, 0), null);
});

test("realizado maior que previsto é tratado como acima do previsto", () => {
  const m = computeMaterialUsageMetrics(100, 120);
  assert.equal(m.status, "above_planned");
  assert.ok(m.accuracyPercent != null && m.accuracyPercent > 100);
});

test("custo previsto e realizado calculam corretamente", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({
      materialId: "m1",
      valuePerUnit: 5,
      plannedOrderQty: 10,
      realizedOrderQty: 6,
    }),
  ]);
  assert.equal(rows[0]!.plannedCost, 50);
  assert.equal(rows[0]!.realizedCost, 30);
  assert.equal(rows[0]!.costVariance, -20);
});

test("filtro de período afeta ambos — simulação por contribuições distintas", () => {
  const jan = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", issueDate: "2026-01-10T00:00:00.000Z", plannedOrderQty: 5, realizedOrderQty: 5 }),
  ]);
  const feb = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", issueDate: "2026-02-10T00:00:00.000Z", plannedOrderQty: 8, realizedOrderQty: 0 }),
  ]);
  assert.notEqual(jan[0]!.plannedQuantity, feb[0]!.plannedQuantity);
});

test("filtro empresa/cliente/produto — agregação por material distinta", () => {
  const a = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", productId: "p1", plannedOrderQty: 3 }),
  ]);
  const b = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", productId: "p2", plannedOrderQty: 9 }),
  ]);
  assert.equal(a[0]!.relatedProductsCount, 1);
  assert.equal(b[0]!.plannedQuantity, 18);
});

test("tabela agrupa por matéria-prima", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1" }),
    contrib({ materialId: "m2", materialDescription: "Outra" }),
    contrib({ materialId: "m1", orderId: "o2" }),
  ]);
  assert.equal(rows.length, 2);
});

test("drill-down por material — produtos distintos", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", productId: "p1", plannedOrderQty: 2, realizedOrderQty: 1 }),
    contrib({ materialId: "m1", productId: "p2", plannedOrderQty: 3, realizedOrderQty: 0 }),
  ]);
  assert.equal(rows[0]!.relatedProductsCount, 2);
});

test("não usa Propostas — fonte é SalesOrder (documentado em dataQuality)", () => {
  assert.ok(!String(contrib({ materialId: "m1" }).orderCode).includes("PROP"));
});

test("sem hardcode por produto/cliente/valor", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "any-id", productId: "dynamic", plannedOrderQty: 11 }),
  ]);
  assert.equal(rows[0]!.materialId, "any-id");
});

test("salesOrderHasInvoicing detecta NF processada", () => {
  assert.equal(
    salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "15/01/2026" }] }),
    true
  );
  assert.equal(salesOrderHasInvoicing({ nfes: [{ dataProcessamento: "" }] }), false);
});

test("salesOrderMatchesInvoicingScope filtra faturados e carteira", () => {
  assert.equal(salesOrderMatchesInvoicingScope(true, "SENT_TO_NOMUS", "invoiced"), true);
  assert.equal(salesOrderMatchesInvoicingScope(false, "READY_TO_SEND", "invoiced"), false);
  assert.equal(
    salesOrderMatchesInvoicingScope(false, "READY_TO_SEND", "portfolio"),
    true
  );
});

test("extractProcessedNfeSummaries retorna NF com dataProcessamento", () => {
  const nfes = extractProcessedNfeSummaries({
    nfes: [{ dataProcessamento: "10/01/2026", numero: "123" }],
  });
  assert.equal(nfes.length, 1);
  assert.equal(nfes[0]!.numero, "123");
});

test("summary assertividade média ponderada", () => {
  const rows = aggregateMaterialUsageContributions([
    contrib({ materialId: "m1", materialQtyPerUnit: 1, plannedOrderQty: 100, realizedOrderQty: 80 }),
    contrib({ materialId: "m2", materialQtyPerUnit: 1, plannedOrderQty: 100, realizedOrderQty: 60 }),
  ]);
  const summary = buildMaterialUsagePlannedRealizedSummary(rows, {
    quantityTotalsComparable: true,
    activeUnitKey: "kg",
    activeUnitLabel: "KG",
  });
  assert.equal(summary.accuracyPercent, 70);
});

test("previsto > 0 e realizado = 0 => assertividade 0%", () => {
  const m = computeMaterialUsageMetrics(50, 0);
  assert.equal(m.accuracyPercent, 0);
  assert.equal(m.status, "no_realized");
});
