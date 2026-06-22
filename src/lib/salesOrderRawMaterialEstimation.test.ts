import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG,
  RAW_MATERIAL_DEMAND_STATUS_LABELS,
  addDays,
  buildRawMaterialIntelligenceSummary,
  calculateRawMaterialDemandForItem,
  calculateWindowOverlapFactor,
  classifyRawMaterialDemandItem,
  differenceInDaysSafe,
  resolveEstimatedConsumptionWindow,
  resolveInvoicedQuantity,
  resolveOpenQuantity,
  type RawMaterialBomLine,
  type RawMaterialDemandOrderItemInput,
} from "./salesOrderRawMaterialEstimation.js";

const REF = new Date(2026, 5, 17);
const BOM: RawMaterialBomLine[] = [
  { materialCode: "MP-01", materialName: "Aço", unit: "KG", quantityPerUnit: 2 },
];

function item(
  partial: Partial<RawMaterialDemandOrderItemInput> &
    Pick<RawMaterialDemandOrderItemInput, "itemId" | "orderId">
): RawMaterialDemandOrderItemInput {
  return {
    orderNumber: partial.orderNumber ?? "PV-001",
    orderStatus: partial.orderStatus ?? "SENT_TO_NOMUS",
    issueDate: partial.issueDate ?? new Date(2026, 5, 10),
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
    isCancelled: partial.isCancelled ?? false,
    isItemCancelled: partial.isItemCancelled ?? false,
    productId: partial.productId ?? "prod-1",
    productCode: partial.productCode ?? "SKU-1",
    productName: partial.productName ?? "Produto A",
    quantity: partial.quantity ?? 100,
    invoicedQuantity: partial.invoicedQuantity ?? null,
    netAmount: partial.netAmount ?? 10_000,
    invoicedNetAmount: partial.invoicedNetAmount ?? null,
    hasInvoicing: partial.hasInvoicing ?? false,
    lastInvoiceDate: partial.lastInvoiceDate ?? null,
    ...partial,
  };
}

function demandRows(
  orderItem: RawMaterialDemandOrderItemInput,
  bomLines: RawMaterialBomLine[] = BOM,
  period?: { start: Date | null; end: Date | null }
) {
  return calculateRawMaterialDemandForItem(orderItem, bomLines, DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG, period, REF);
}

describe("salesOrderRawMaterialEstimation — datas", () => {
  it("addDays e differenceInDaysSafe são seguros", () => {
    const base = new Date(2026, 5, 1);
    const plus = addDays(base, 14);
    assert.equal(differenceInDaysSafe(plus, base), 14);
    assert.equal(differenceInDaysSafe(base, base), 0);
  });

  it("calculateWindowOverlapFactor calcula sobreposição parcial", () => {
    const windowStart = new Date(2026, 5, 1);
    const windowEnd = new Date(2026, 5, 14);
    const factor = calculateWindowOverlapFactor(
      windowStart,
      windowEnd,
      new Date(2026, 5, 10),
      new Date(2026, 5, 20)
    );
    assert.ok(factor > 0 && factor < 1);
    assert.equal(
      calculateWindowOverlapFactor(windowStart, windowEnd, null, null),
      1
    );
  });

  it("resolveEstimatedConsumptionWindow usa emissão sem NF", () => {
    const orderItem = item({
      itemId: "i1",
      orderId: "o1",
      issueDate: new Date(2026, 5, 1),
      hasInvoicing: false,
    });
    const window = resolveEstimatedConsumptionWindow(orderItem);
    assert.equal(window.basis, "issue_date");
    assert.equal(differenceInDaysSafe(window.windowEnd!, window.windowStart!), 14);
  });
});

describe("salesOrderRawMaterialEstimation — regras de negócio", () => {
  it("1. pedido faturado totalmente não entra na necessidade futura", () => {
    const rows = demandRows(
      item({
        itemId: "i1",
        orderId: "o1",
        quantity: 50,
        hasInvoicing: true,
        invoicedQuantity: 50,
        lastInvoiceDate: new Date(2026, 5, 1),
      })
    );
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.conservativeDemand, 0);
    assert.equal(rows[0]!.status, "FULLY_INVOICED");
  });

  it("2. pedido sem NF dentro de 14 dias entra em recomendado", () => {
    const rows = demandRows(
      item({
        itemId: "i2",
        orderId: "o2",
        issueDate: new Date(2026, 5, 10),
        quantity: 40,
        hasInvoicing: false,
      })
    );
    assert.equal(rows[0]!.status, "OPEN_WITHIN_CYCLE");
    assert.equal(rows[0]!.recommendedDemand, 80);
    assert.equal(rows[0]!.classification.includeInRecommended, true);
  });

  it("3. pedido sem NF com mais de 14 dias vai para revisão, não recomendado", () => {
    const rows = demandRows(
      item({
        itemId: "i3",
        orderId: "o3",
        issueDate: new Date(2026, 4, 20),
        quantity: 30,
        hasInvoicing: false,
      })
    );
    assert.equal(rows[0]!.status, "OPEN_OVERDUE_WITHOUT_INVOICE");
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.classification.reviewRequired, true);
  });

  it("4. pedido parcial com última NF recente entra recomendado pelo saldo", () => {
    const rows = demandRows(
      item({
        itemId: "i4",
        orderId: "o4",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 60,
        lastInvoiceDate: new Date(2026, 5, 10),
      })
    );
    assert.equal(rows[0]!.status, "PARTIALLY_INVOICED_LIVE_BALANCE");
    assert.equal(rows[0]!.recommendedDemand, 80);
    assert.equal(rows[0]!.classification.openQuantity, 40);
  });

  it("5. pedido parcial com última NF antiga não entra recomendado", () => {
    const rows = demandRows(
      item({
        itemId: "i5",
        orderId: "o5",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 60,
        lastInvoiceDate: new Date(2026, 4, 1),
      })
    );
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.ok(
      rows[0]!.status === "PARTIALLY_INVOICED_STALE_BALANCE" ||
        rows[0]!.status === "CRITICAL_UNSERVED_BALANCE_30D"
    );
  });

  it("6. pedido parcial antigo entra como saldo envelhecido", () => {
    const classification = classifyRawMaterialDemandItem({
      item: item({
        itemId: "i6",
        orderId: "o6",
        quantity: 80,
        hasInvoicing: true,
        invoicedQuantity: 30,
        lastInvoiceDate: new Date(2026, 4, 20),
      }),
      referenceDate: REF,
      hasValidBom: true,
    });
    assert.equal(classification.status, "PARTIALLY_INVOICED_STALE_BALANCE");
    assert.equal(classification.includeInRecommended, false);
  });

  it("7. saldo com mais de 30 dias fora da janela entra no potencial não realizado", () => {
    const rows = demandRows(
      item({
        itemId: "i7",
        orderId: "o7",
        issueDate: new Date(2026, 3, 1),
        quantity: 20,
        netAmount: 5_000,
        hasInvoicing: false,
      })
    );
    const summary = buildRawMaterialIntelligenceSummary(rows);
    assert.equal(rows[0]!.status, "CRITICAL_UNSERVED_BALANCE_30D");
    assert.equal(rows[0]!.classification.includeInUnservedRevenue, true);
    assert.ok(summary.unservedRevenuePotential > 0);
    assert.ok(summary.criticalBalanceOver30Days > 0);
  });

  it("8. sem BOM vai para revisão", () => {
    const rows = demandRows(
      item({
        itemId: "i8",
        orderId: "o8",
        quantity: 10,
        hasInvoicing: false,
      }),
      []
    );
    assert.equal(rows[0]!.status, "MISSING_BOM");
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.reviewDemand, 10);
    const summary = buildRawMaterialIntelligenceSummary(rows);
    assert.equal(summary.missingBomItemsCount, 1);
  });

  it("9. cancelado não gera necessidade", () => {
    const rows = demandRows(
      item({
        itemId: "i9",
        orderId: "o9",
        orderStatus: "CANCELLED",
        quantity: 100,
        hasInvoicing: false,
      })
    );
    assert.equal(rows[0]!.status, "CANCELLED_OR_CLOSED");
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.conservativeDemand, 0);
  });

  it("10. necessidade recomendada usa saldo aberto, não quantidade total", () => {
    const rows = demandRows(
      item({
        itemId: "i10",
        orderId: "o10",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 70,
        lastInvoiceDate: new Date(2026, 5, 12),
      })
    );
    assert.equal(rows[0]!.recommendedDemand, 60);
    assert.notEqual(rows[0]!.recommendedDemand, 200);
  });

  it("11. necessidade conservadora considera saldo aberto com risco", () => {
    const rows = demandRows(
      item({
        itemId: "i11",
        orderId: "o11",
        issueDate: new Date(2026, 4, 20),
        quantity: 50,
        hasInvoicing: false,
      })
    );
    assert.equal(rows[0]!.recommendedDemand, 0);
    assert.equal(rows[0]!.conservativeDemand, 100);
    assert.ok(rows[0]!.uncertaintyDemand > 0);
  });

  it("12. fator de sobreposição do período funciona", () => {
    const orderItem = item({
      itemId: "i12",
      orderId: "o12",
      issueDate: new Date(2026, 5, 10),
      quantity: 100,
      hasInvoicing: false,
    });
    const full = demandRows(orderItem);
    const partial = demandRows(orderItem, BOM, {
      start: new Date(2026, 5, 10),
      end: new Date(2026, 5, 14),
    });
    assert.equal(full[0]!.status, "OPEN_WITHIN_CYCLE");
    assert.ok(partial[0]!.recommendedDemand < full[0]!.recommendedDemand);
    assert.ok(partial[0]!.factorUsed < 1);
  });

  it("13. data de entrega não é usada como única base", () => {
    const rows = demandRows(
      item({
        itemId: "i13",
        orderId: "o13",
        quantity: 100,
        hasInvoicing: true,
        invoicedQuantity: 100,
        lastInvoiceDate: new Date(2026, 5, 1),
        expectedDeliveryDate: new Date(2026, 7, 1),
      })
    );
    assert.equal(rows[0]!.status, "FULLY_INVOICED");
    assert.equal(rows[0]!.recommendedDemand, 0);

    const overdueItem = item({
      itemId: "i13b",
      orderId: "o13b",
      issueDate: new Date(2026, 4, 1),
      quantity: 100,
      hasInvoicing: false,
      expectedDeliveryDate: new Date(2026, 7, 1),
    });
    const openRows = demandRows(overdueItem);
    const consumption = resolveEstimatedConsumptionWindow(overdueItem);
    assert.equal(consumption.basis, "issue_date");
    assert.equal(consumption.logisticsHintDate?.getMonth(), 7);
    assert.equal(differenceInDaysSafe(consumption.windowEnd!, consumption.windowStart!), 14);
    assert.equal(openRows[0]!.recommendedDemand, 0);
    assert.notEqual(openRows[0]!.status, "OPEN_WITHIN_CYCLE");
  });

  it("14. fallback por valor reduz confiança", () => {
    const invoiced = resolveInvoicedQuantity(
      item({
        itemId: "i14",
        orderId: "o14",
        quantity: 100,
        netAmount: 10_000,
        invoicedNetAmount: 4_000,
        hasInvoicing: true,
        invoicedQuantity: null,
      })
    );
    assert.equal(invoiced.usedValueFallback, true);
    assert.equal(invoiced.confidence, "LOW");
    const classification = classifyRawMaterialDemandItem({
      item: item({
        itemId: "i14",
        orderId: "o14",
        quantity: 100,
        netAmount: 10_000,
        invoicedNetAmount: 4_000,
        hasInvoicing: true,
        invoicedQuantity: null,
        lastInvoiceDate: new Date(2026, 5, 10),
      }),
      referenceDate: REF,
      hasValidBom: true,
    });
    assert.equal(classification.confidence, "LOW");
    assert.ok(classification.warnings.length > 0);
  });

  it("15. não retorna NaN/Infinity", () => {
    const rows = demandRows(
      item({
        itemId: "i15",
        orderId: "o15",
        quantity: NaN,
        netAmount: Infinity,
        hasInvoicing: true,
        invoicedQuantity: undefined,
        invoicedNetAmount: NaN,
      })
    );
    const summary = buildRawMaterialIntelligenceSummary(rows);
    const nums = [
      rows[0]!.recommendedDemand,
      rows[0]!.conservativeDemand,
      rows[0]!.uncertaintyDemand,
      summary.recommendedDemandTotal,
      summary.conservativeDemandTotal,
      summary.reliability.overallScore,
      resolveOpenQuantity(
        item({ itemId: "x", orderId: "y", quantity: NaN })
      ).quantity,
    ];
    for (const n of nums) {
      assert.ok(Number.isFinite(n));
    }
  });

  it("16. labels são amigáveis para UI", () => {
    for (const status of [
      "FULLY_INVOICED",
      "OPEN_WITHIN_CYCLE",
      "OPEN_OVERDUE_WITHOUT_INVOICE",
      "PARTIALLY_INVOICED_LIVE_BALANCE",
      "PARTIALLY_INVOICED_STALE_BALANCE",
      "CRITICAL_UNSERVED_BALANCE_30D",
      "MISSING_BOM",
      "CANCELLED_OR_CLOSED",
      "REVIEW_DATA",
    ] as const) {
      const label = RAW_MATERIAL_DEMAND_STATUS_LABELS[status];
      assert.ok(label.length > 3);
      assert.ok(!label.includes("_"));
    }

    const rows = demandRows(
      item({
        itemId: "i16",
        orderId: "o16",
        issueDate: new Date(2026, 5, 10),
        quantity: 10,
        hasInvoicing: false,
      })
    );
    assert.equal(rows[0]!.classification.statusLabel, "Aberto dentro do ciclo");
  });
});

describe("salesOrderRawMaterialEstimation — configuração padrão", () => {
  it("usa billingCycleDays=14 e staleBalanceDays=30", () => {
    assert.equal(DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.billingCycleDays, 14);
    assert.equal(DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.partialBillingLiveDays, 14);
    assert.equal(DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.staleBalanceDays, 30);
    assert.equal(DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.veryCriticalDays, 60);
    assert.equal(DEFAULT_RAW_MATERIAL_ESTIMATION_CONFIG.probableLossDays, 90);
  });
});
