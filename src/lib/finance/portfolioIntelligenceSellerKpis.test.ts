import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSellerKpis,
  resolveSellerMainBottleneck,
  type PortfolioMaturityOrderRow,
} from "./portfolioMaturityAnalytics";
import {
  SELLER_KPI_EXPLANATIONS,
  SELLER_KPI_REQUIRED_EXPLAIN_KEYS,
} from "./portfolioIntelligenceSellerKpiExplanations";

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
    daysSinceExpected: partial.daysSinceExpected ?? null,
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
        daysSinceExpected: 40,
      }),
      row({
        orderCode: "PD 2",
        orderValue: 50_000,
        statusPrincipal: "CR_ABERTO",
        sellerName: "Ana",
        sellerExternalId: 10,
        receivableTotalValue: 50_000,
        receivedValue: 10_000,
        openReceivableValue: 40_000,
        confidenceScore: 90,
        confidenceLabel: "ALTA",
        operationalStatus: "OP_PARCIALMENTE_ATENDIDO",
        fulfillmentPercent: 60,
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
    assert.equal(ana.openReceivableValue, 40_000);
    assert.equal(ana.conversionCrQtyPct, 50);
    assert.equal(ana.partiallyAttendedCount, 1);
    assert.equal(ana.overdueWithoutDocumentCount, 1);
    assert.equal(ana.sellerSource, "SALES_ORDER");
    assert.match(ana.note ?? "", /SalesOrder|Nomus/i);
    assert.doesNotMatch(ana.note ?? "", /comiss/i);
    assert.ok(ana.mainBottleneck.length > 0);
    assert.ok(ana.mainBottleneckKey.length > 0);

    assert.equal(sem.sellerName, "Sem vendedor informado");
    assert.equal(sem.orderValue, 30_000);
    assert.equal(sem.futureProbableValue, 30_000);
    assert.equal(sem.sellerSource, "UNAVAILABLE");

    const sum = kpis.reduce((s, k) => s + k.orderValue, 0);
    assert.equal(sum, 180_000);
  });

  it("confiança média é ponderada por valor", () => {
    const kpis = buildSellerKpis([
      row({
        orderCode: "PD A",
        orderValue: 100,
        statusPrincipal: "CR_ABERTO",
        sellerName: "Bia",
        sellerExternalId: 1,
        confidenceScore: 100,
        confidenceLabel: "ALTA",
        evidenceFlags: {
          hasNfe: true,
          hasStockDocument: true,
          hasAllocatedStockDocument: true,
          hasReceivable: true,
          hasReceived: false,
          hasOpenReceivable: true,
        },
      }),
      row({
        orderCode: "PD B",
        orderValue: 300,
        statusPrincipal: "CARTEIRA_PRESENTE_ATENCAO",
        sellerName: "Bia",
        sellerExternalId: 1,
        confidenceScore: 0,
        confidenceLabel: "MUITO_BAIXA",
      }),
    ]);
    const bia = kpis[0]!;
    assert.equal(bia.averageConfidence, 25);
    assert.equal(bia.presentAttentionValue, 300);
  });

  it("principal gargalo segue prioridade fixa", () => {
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 5,
        overdueWithoutDocumentCount: 2,
        conversionCrValuePct: 10,
        docsWithoutCrCount: 3,
        partiallyAttendedCount: 4,
        ordersWithExcessCount: 1,
        ordersWithProductOutside: 1,
      }).key,
      "OVERDUE_WITHOUT_DOC"
    );
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 5,
        overdueWithoutDocumentCount: 0,
        conversionCrValuePct: 10,
        docsWithoutCrCount: 3,
        partiallyAttendedCount: 4,
        ordersWithExcessCount: 1,
        ordersWithProductOutside: 1,
      }).key,
      "LOW_CR_CONVERSION"
    );
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 5,
        overdueWithoutDocumentCount: 0,
        conversionCrValuePct: 80,
        docsWithoutCrCount: 2,
        partiallyAttendedCount: 4,
        ordersWithExcessCount: 1,
        ordersWithProductOutside: 1,
      }).key,
      "DOC_WITHOUT_CR"
    );
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 5,
        overdueWithoutDocumentCount: 0,
        conversionCrValuePct: 80,
        docsWithoutCrCount: 0,
        partiallyAttendedCount: 2,
        ordersWithExcessCount: 1,
        ordersWithProductOutside: 1,
      }).key,
      "PARTIAL_FULFILLMENT"
    );
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 5,
        overdueWithoutDocumentCount: 0,
        conversionCrValuePct: 80,
        docsWithoutCrCount: 0,
        partiallyAttendedCount: 0,
        ordersWithExcessCount: 1,
        ordersWithProductOutside: 0,
      }).key,
      "EXCESS_OR_OUTSIDE"
    );
    assert.equal(
      resolveSellerMainBottleneck({
        ordersCount: 2,
        overdueWithoutDocumentCount: 0,
        conversionCrValuePct: 90,
        docsWithoutCrCount: 0,
        partiallyAttendedCount: 0,
        ordersWithExcessCount: 0,
        ordersWithProductOutside: 0,
      }).label,
      "Sem gargalo relevante"
    );
  });

  it("excedentes e produto fora não somam carteira", () => {
    const kpis = buildSellerKpis([
      row({
        orderCode: "PD X",
        orderValue: 80_000,
        statusPrincipal: "CR_ABERTO",
        sellerName: "Ana",
        sellerExternalId: 10,
        estimatedExcessValue: 5_000,
        excessQuantity: 2,
        tagsAlerta: ["QUANTIDADE_EXCEDENTE_DOCUMENTO", "PRODUTO_FORA_DO_PEDIDO"],
        valueOutsideOrder: 1_200,
        evidenceFlags: {
          hasNfe: true,
          hasStockDocument: true,
          hasAllocatedStockDocument: true,
          hasReceivable: true,
          hasReceived: false,
          hasOpenReceivable: true,
        },
      }),
    ]);
    const ana = kpis[0]!;
    assert.equal(ana.orderValue, 80_000);
    assert.equal(ana.excessValue, 5_000);
    assert.equal(ana.ordersWithExcessCount, 1);
    assert.equal(ana.ordersWithProductOutside, 1);
    assert.ok(ana.orderValue !== ana.orderValue + ana.excessValue);
  });

  it("explica todos os KPIs sem mencionar comissão", () => {
    for (const key of SELLER_KPI_REQUIRED_EXPLAIN_KEYS) {
      const exp = SELLER_KPI_EXPLANATIONS[key];
      assert.ok(exp, key);
      assert.ok(exp.whatItMeans, key);
      assert.ok(exp.howWeCalculate, key);
      assert.ok(exp.howToInterpret, key);
      assert.doesNotMatch(
        exp.whatItMeans + exp.howWeCalculate + exp.howToInterpret,
        /comiss|comission/i
      );
    }
  });
});
