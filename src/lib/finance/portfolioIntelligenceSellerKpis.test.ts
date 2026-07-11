import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSellerKpis, type PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics";
import { SELLER_KPI_EXPLANATIONS } from "./portfolioIntelligenceSellerKpiExplanations";

function row(
  partial: Partial<PortfolioMaturityOrderRow> &
    Pick<PortfolioMaturityOrderRow, "orderCode" | "orderValue" | "statusPrincipal">
): PortfolioMaturityOrderRow {
  return {
    salesOrderId: partial.salesOrderId ?? partial.orderCode,
    orderCode: partial.orderCode,
    externalSalesOrderId: null,
    customerName: "Cliente",
    customerExternalId: 200,
    customerId: null,
    sellerName: partial.sellerName ?? null,
    sellerExternalId: partial.sellerExternalId ?? null,
    sellerId: partial.sellerId ?? null,
    companyId: null,
    issueDate: null,
    expectedDeliveryDate: null,
    nfeDate: null,
    stockDocumentDate: null,
    receivableDueDate: null,
    receivableSettlementDate: null,
    forecastDate: null,
    updatedAt: null,
    orderValue: partial.orderValue,
    receivableTotalValue: partial.receivableTotalValue ?? 0,
    receivedValue: partial.receivedValue ?? 0,
    openReceivableValue: partial.openReceivableValue ?? 0,
    nfeHeaderValue: 0,
    stockDocumentValue: 0,
    itemizedAllocatedValue: 0,
    statusPrincipal: partial.statusPrincipal,
    tagsAlerta: partial.tagsAlerta ?? [],
    confidenceScore: partial.confidenceScore ?? 50,
    confidenceLabel: partial.confidenceLabel ?? "BAIXA",
    confidenceReasons: [],
    recommendedAction: "",
    executiveSummary: "",
    daysSinceIssue: null,
    daysSinceExpected: null,
    nextRelevantDate: null,
    mainReason: "",
    evidenceFlags: partial.evidenceFlags ?? {
      hasNfe: false,
      hasStockDocument: false,
      hasAllocatedStockDocument: false,
      hasReceivable: false,
      hasReceived: false,
      hasOpenReceivable: false,
    },
    forecastSource: "ORDER",
    factStatus: "ORDER_ONLY",
    productExternalIds: [],
    financialStatus: partial.financialStatus ?? null,
    operationalStatus: partial.operationalStatus ?? null,
    fulfillmentPercent: partial.fulfillmentPercent ?? null,
    excessQuantity: partial.excessQuantity ?? 0,
    estimatedExcessValue: partial.estimatedExcessValue ?? 0,
    valueOutsideOrder: partial.valueOutsideOrder ?? 0,
    nfeHeaderNotAttributed: partial.nfeHeaderNotAttributed ?? 0,
    fulfillmentAvailable: partial.fulfillmentAvailable ?? false,
  };
}

describe("buildSellerKpis", () => {
  it("não duplica valor e mantém Sem vendedor informado", () => {
    const kpis = buildSellerKpis([
      row({
        orderCode: "PD 1",
        orderValue: 100_000,
        statusPrincipal: "CARTEIRA_VENCIDA_BLOQUEADA",
        sellerName: "Ana",
        sellerExternalId: 10,
        confidenceScore: 20,
        confidenceLabel: "MUITO_BAIXA",
      }),
      row({
        orderCode: "PD 2",
        orderValue: 50_000,
        statusPrincipal: "CR_ABERTO",
        sellerName: "Ana",
        sellerExternalId: 10,
        receivableTotalValue: 50_000,
        receivedValue: 10_000,
        confidenceScore: 90,
        confidenceLabel: "ALTA",
        evidenceFlags: {
          hasNfe: true,
          hasStockDocument: true,
          hasAllocatedStockDocument: true,
          hasReceivable: true,
          hasReceived: true,
          hasOpenReceivable: true,
        },
      }),
      row({
        orderCode: "PD 3",
        orderValue: 30_000,
        statusPrincipal: "CARTEIRA_FUTURA_PROVAVEL",
      }),
    ]);

    assert.equal(kpis.length, 2);
    const ana = kpis.find((k) => k.sellerExternalId === 10)!;
    const sem = kpis.find((k) => k.sellerKey === "seller:unavailable")!;
    assert.equal(ana.orderValue, 150_000);
    assert.equal(ana.ordersCount, 2);
    assert.equal(ana.blockedValue, 100_000);
    assert.equal(ana.receivableValue, 50_000);
    assert.equal(ana.conversionCrQtyPct, 50);
    assert.equal(ana.sellerSource, "SALES_ORDER");
    assert.match(ana.note ?? "", /SalesOrder|Nomus/i);
    assert.doesNotMatch(ana.note ?? "", /comiss/i);

    assert.equal(sem.sellerName, "Sem vendedor informado");
    assert.equal(sem.orderValue, 30_000);
    assert.equal(sem.sellerSource, "UNAVAILABLE");

    const sum = kpis.reduce((s, k) => s + k.orderValue, 0);
    assert.equal(sum, 180_000);
  });

  it("explica todos os KPIs sem mencionar comissão", () => {
    for (const [key, exp] of Object.entries(SELLER_KPI_EXPLANATIONS)) {
      assert.ok(exp.whatItMeans, key);
      assert.ok(exp.howWeCalculate, key);
      assert.doesNotMatch(exp.whatItMeans + exp.howWeCalculate, /comiss/i);
    }
  });
});
