import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import {
  BRITANIA_INTELLIGENCE_EXPECTED,
  buildPortfolioMaturityAnalytics,
} from "./portfolioMaturityAnalytics.js";

function fact(
  partial: Partial<PortfolioReconciliationFactApiRow> & { id: string }
): PortfolioReconciliationFactApiRow {
  return {
    runId: BRITANIA_INTELLIGENCE_EXPECTED.runId,
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Britânia",
    salesOrderId: "order-1",
    externalSalesOrderId: 1,
    orderCode: "PD 00001",
    orderIssueDate: "2026-01-01",
    expectedDeliveryDate: null,
    salesOrderItemId: null,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: null,
    orderUnitPrice: null,
    orderItemValue: null,
    nomusNfeId: null,
    nfeExternalId: null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: null,
    stockUnitValue: null,
    stockItemValue: null,
    allocatedQuantity: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation: null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: null,
    priceDifferenceTotal: null,
    receivableIdsJson: null,
    receivableTotalValue: null,
    receivedValue: null,
    openReceivableValue: null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastSource: "ORDER",
    forecastDate: null,
    forecastValue: null,
    confidenceLevel: "LOW",
    status: "ORDER_ONLY",
    alertsJson: [],
    traceJson: { rule: "ORDER_ONLY" },
    ...partial,
  };
}

const AS_OF = "2026-07-10";

describe("portfolioMaturityAnalytics", () => {
  it("não duplica valor entre cards de status principal", () => {
    const facts = [
      fact({
        id: "r1",
        salesOrderId: "a",
        orderCode: "PD A",
        salesOrderItemId: "ia",
        orderItemValue: 100,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 100,
        receivableTotalValue: 100,
        receivedValue: 100,
        openReceivableValue: 0,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-06-01",
        status: "RECEIVED",
        confidenceLevel: "HIGH",
        nfeExternalId: 1,
        stockDocumentId: "s1",
        stockDocumentExternalId: 1,
      }),
      fact({
        id: "r2",
        salesOrderId: "b",
        orderCode: "PD B",
        salesOrderItemId: "ib",
        orderItemValue: 200,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 200,
        receivableTotalValue: 200,
        receivedValue: 0,
        openReceivableValue: 200,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-08-01",
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        nfeExternalId: 2,
        stockDocumentId: "s2",
        stockDocumentExternalId: 2,
      }),
      fact({
        id: "r3",
        salesOrderId: "c",
        orderCode: "PD C",
        salesOrderItemId: "ic",
        orderItemValue: 50,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 50,
        forecastSource: "NFE",
        forecastDate: "2026-07-15",
        status: "ITEM_ALLOCATED",
        confidenceLevel: "MEDIUM",
        nfeExternalId: 3,
        stockDocumentId: "s3",
        stockDocumentExternalId: 3,
        stockDocumentItemId: "si3",
        stockItemValue: 50,
      }),
      fact({
        id: "r4",
        salesOrderId: "d",
        orderCode: "PD D",
        orderItemValue: 300,
        salesOrderItemId: "id",
        forecastSource: "ORDER",
        forecastDate: "2026-09-20",
        forecastValue: 300,
        status: "ORDER_ONLY",
        confidenceLevel: "LOW",
        orderIssueDate: "2026-06-01",
      }),
      fact({
        id: "r5",
        salesOrderId: "e",
        orderCode: "PD E",
        orderItemValue: 80,
        salesOrderItemId: "ie",
        forecastSource: "ORDER",
        forecastDate: "2026-07-20",
        forecastValue: 80,
        status: "ORDER_ONLY",
        orderIssueDate: "2026-06-01",
      }),
      fact({
        id: "r6",
        salesOrderId: "f",
        orderCode: "PD F",
        orderItemValue: 400,
        salesOrderItemId: "if",
        forecastSource: "ORDER",
        forecastDate: "2025-12-01",
        forecastValue: 400,
        status: "ORDER_ONLY",
        orderIssueDate: "2025-01-01",
      }),
    ];
    const totals = new Map([
      ["a", 100],
      ["b", 200],
      ["c", 50],
      ["d", 300],
      ["e", 80],
      ["f", 400],
    ]);
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: totals,
      filters: { asOfDate: AS_OF, pageSize: 50 },
    });

    const statusCards = result.summaryCards.filter(
      (c) =>
        !c.isAlertCard &&
        [
          "RECEBIDO",
          "CR_ABERTO",
          "FATURADO_SEM_CR",
          "CARTEIRA_FUTURA_PROVAVEL",
          "CARTEIRA_PRESENTE_ATENCAO",
          "CARTEIRA_VENCIDA_BLOQUEADA",
          "SEM_EVIDENCIA",
        ].includes(c.key)
    );
    const sumStatus = round2(statusCards.reduce((s, c) => s + c.value, 0));
    const total = result.summaryCards.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA")!;
    assert.equal(sumStatus, total.value);
    assert.equal(total.value, 1130);
    assert.equal(result.warnings.filter((w) => /não duplicidade/i.test(w)).length, 0);
  });

  it("calcula conversão em CR (qtd e valor)", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "cr1",
        orderCode: "PD CR1",
        salesOrderItemId: "i1",
        orderItemValue: 1000,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 1000,
        receivableTotalValue: 1000,
        openReceivableValue: 1000,
        receivedValue: 0,
        forecastSource: "RECEIVABLE",
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        nfeExternalId: 1,
        stockDocumentExternalId: 1,
        stockDocumentId: "s1",
      }),
      fact({
        id: "2",
        salesOrderId: "oo1",
        orderCode: "PD OO1",
        salesOrderItemId: "i2",
        orderItemValue: 1000,
        forecastSource: "ORDER",
        forecastDate: "2026-09-01",
        forecastValue: 1000,
        status: "ORDER_ONLY",
      }),
    ];
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([
        ["cr1", 1000],
        ["oo1", 1000],
      ]),
      filters: { asOfDate: AS_OF },
    });
    const qtd = result.summaryCards.find((c) => c.key === "CONVERSAO_PEDIDOS_CR_QTD")!;
    const valor = result.summaryCards.find((c) => c.key === "CONVERSAO_PEDIDOS_CR_VALOR")!;
    assert.equal(qtd.percentage, 50);
    assert.equal(valor.percentage, 50);
  });

  it("calcula conversão em documento de saída", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "d1",
        orderCode: "PD D1",
        salesOrderItemId: "i1",
        orderItemValue: 300,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 300,
        forecastSource: "NFE",
        status: "ITEM_ALLOCATED",
        nfeExternalId: 1,
        stockDocumentId: "s1",
        stockDocumentExternalId: 10,
        stockDocumentItemId: "si1",
        stockItemValue: 300,
      }),
      fact({
        id: "2",
        salesOrderId: "d2",
        orderCode: "PD D2",
        salesOrderItemId: "i2",
        orderItemValue: 100,
        forecastSource: "ORDER",
        forecastDate: "2026-09-01",
        forecastValue: 100,
        status: "ORDER_ONLY",
      }),
    ];
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([
        ["d1", 300],
        ["d2", 100],
      ]),
      filters: { asOfDate: AS_OF },
    });
    const qtd = result.summaryCards.find((c) => c.key === "CONVERSAO_DOC_SAIDA_QTD")!;
    const valor = result.summaryCards.find((c) => c.key === "CONVERSAO_DOC_SAIDA_VALOR")!;
    assert.equal(qtd.count, 1);
    assert.equal(qtd.percentage, 50);
    assert.equal(valor.percentage, 75);
  });

  it("risco de superestimação = carteira vencida/bloqueada", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "old",
        orderCode: "PD OLD",
        salesOrderItemId: "i1",
        orderItemValue: 884_836,
        forecastSource: "ORDER",
        forecastDate: "2025-10-01",
        forecastValue: 884_836,
        status: "ORDER_ONLY",
        orderIssueDate: "2025-01-01",
      }),
      fact({
        id: "2",
        salesOrderId: "fut",
        orderCode: "PD FUT",
        salesOrderItemId: "i2",
        orderItemValue: 100,
        forecastSource: "ORDER",
        forecastDate: "2026-10-01",
        forecastValue: 100,
        status: "ORDER_ONLY",
        orderIssueDate: "2026-06-01",
      }),
    ];
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([
        ["old", 884_836],
        ["fut", 100],
      ]),
      filters: { asOfDate: AS_OF },
    });
    const risco = result.summaryCards.find((c) => c.key === "RISCO_SUPERESTIMACAO")!;
    assert.equal(risco.value, 884_836);
    assert.equal(result.totals.valorVencidoBloqueado, 884_836);
  });

  it("confiança média ponderada por valor", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "hi",
        orderCode: "PD HI",
        salesOrderItemId: "i1",
        orderItemValue: 1000,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: 1000,
        receivableTotalValue: 1000,
        receivedValue: 1000,
        openReceivableValue: 0,
        forecastSource: "RECEIVABLE",
        status: "RECEIVED",
        confidenceLevel: "HIGH",
        nfeExternalId: 1,
        stockDocumentExternalId: 1,
        stockDocumentId: "s",
      }),
      fact({
        id: "2",
        salesOrderId: "lo",
        orderCode: "PD LO",
        salesOrderItemId: "i2",
        orderItemValue: 1000,
        forecastSource: "ORDER",
        forecastDate: "2025-01-01",
        forecastValue: 1000,
        status: "ORDER_ONLY",
        orderIssueDate: "2024-01-01",
        confidenceLevel: "LOW",
      }),
    ];
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([
        ["hi", 1000],
        ["lo", 1000],
      ]),
      enrichmentsBySalesOrderId: new Map([
        ["hi", { salesOrderId: "hi", paymentTerms: "30 DDL" }],
        ["lo", { salesOrderId: "lo", paymentTerms: "30 DDL" }],
      ]),
      filters: { asOfDate: AS_OF },
    });
    const conf = result.summaryCards.find((c) => c.key === "CONFIANCA_MEDIA_CARTEIRA")!;
    const hi = result.statusGroups.find((g) => g.statusPrincipal === "RECEBIDO")!;
    const lo = result.statusGroups.find(
      (g) => g.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA"
    )!;
    assert.equal(hi.averageConfidence, 100);
    assert.ok(lo.averageConfidence <= 30);
    // média ponderada entre 100 e score baixo
    assert.ok(conf.value > lo.averageConfidence && conf.value < 100);
    const loRow = result.rows.find((r) => r.orderCode === "PD LO")!;
    assert.equal(
      conf.value,
      Number(((100 * 1000 + loRow.confidenceScore * 1000) / 2000).toFixed(2))
    );
  });

  it("todos os cards têm explanation completa", () => {
    const facts = [
      fact({
        id: "1",
        salesOrderId: "x",
        orderCode: "PD X",
        salesOrderItemId: "i",
        orderItemValue: 10,
        forecastDate: "2026-09-01",
        forecastValue: 10,
      }),
    ];
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([["x", 10]]),
      filters: { asOfDate: AS_OF },
    });
    assert.ok(result.summaryCards.length >= 16);
    for (const card of result.summaryCards) {
      assert.ok(card.explanation.whatItMeans.length > 0, card.key);
      assert.ok(card.explanation.howWeCalculate.length > 0, card.key);
      assert.ok(card.explanation.whatIsIncluded.length > 0, card.key);
      assert.ok(card.explanation.whatIsExcluded.length > 0, card.key);
      assert.ok(card.explanation.howToInterpret.length > 0, card.key);
      assert.ok(result.metricExplanations[card.key], card.key);
    }
  });

  it("fixture Britânia-shaped: totais e split futuro/presente vs bloqueada", () => {
    const orderTotals = new Map<string, number>();
    const facts: PortfolioReconciliationFactApiRow[] = [];

    // 18 com CR — valor restante após 1.380.296
    const crPool = 3_324_636.5 - 1_380_296;
    const crEach = round2(crPool / 18);
    let crAssigned = 0;
    for (let i = 0; i < 18; i++) {
      const id = `cr-${i}`;
      const value = i === 17 ? round2(crPool - crAssigned) : crEach;
      crAssigned = round2(crAssigned + value);
      orderTotals.set(id, value);
      facts.push(
        fact({
          id: `f-cr-${i}`,
          salesOrderId: id,
          orderCode: `PD CR ${i}`,
          salesOrderItemId: `item-cr-${i}`,
          orderItemValue: value,
          allocatedQuantity: 1,
          allocatedValueByOrderPrice: value,
          receivableTotalValue: value,
          openReceivableValue: value,
          receivedValue: 0,
          forecastSource: "RECEIVABLE",
          forecastDate: "2026-08-10",
          status: "RECEIVABLE_CONFIRMED",
          confidenceLevel: "HIGH",
          nfeExternalId: 1000 + i,
          stockDocumentId: `s-${i}`,
          stockDocumentExternalId: 2000 + i,
        })
      );
    }

    // Futuro+presente = 495.460 (ex.: 2 futuros + 1 presente)
    const futureParts = [200_000, 200_000, 95_460];
    const futureCodes = ["PD 02607", "PD 02740", "PD 02739"];
    const futureDates = ["2026-09-15", "2026-10-01", "2026-07-20"];
    for (let i = 0; i < 3; i++) {
      const id = `fut-${i}`;
      orderTotals.set(id, futureParts[i]!);
      facts.push(
        fact({
          id: `f-fut-${i}`,
          salesOrderId: id,
          orderCode: futureCodes[i]!,
          salesOrderItemId: `item-fut-${i}`,
          orderItemValue: futureParts[i]!,
          forecastSource: "ORDER",
          forecastDate: futureDates[i]!,
          forecastValue: futureParts[i]!,
          status: "ORDER_ONLY",
          orderIssueDate: "2026-06-01",
        })
      );
    }

    // Bloqueados = 884.836 em 10 pedidos críticos
    const blockedCodes = [
      "PD 02159",
      "PD 01604",
      "PD 01953",
      "PD 02092",
      "PD 01954",
      "PD 01955",
      "PD 02080",
      "PD 01603",
      "PD 02158",
      "PD 01562",
    ];
    const blockedBase = Math.floor(884_836 / 10);
    let blockedAssigned = 0;
    for (let i = 0; i < 10; i++) {
      const id = `blk-${i}`;
      const value = i === 9 ? 884_836 - blockedAssigned : blockedBase;
      blockedAssigned += value;
      orderTotals.set(id, value);
      facts.push(
        fact({
          id: `f-blk-${i}`,
          salesOrderId: id,
          orderCode: blockedCodes[i]!,
          salesOrderItemId: `item-blk-${i}`,
          orderItemValue: value,
          forecastSource: "ORDER",
          forecastDate: "2025-11-01",
          forecastValue: value,
          status: "ORDER_ONLY",
          orderIssueDate: "2025-01-01",
          confidenceLevel: "LOW",
        })
      );
    }

    assert.equal(facts.length, 31);
    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: orderTotals,
      filters: {
        asOfDate: AS_OF,
        customerExternalId: 200,
        pageSize: 50,
      },
    });

    assert.equal(result.totals.totalPedidos, 31);
    assert.equal(result.totals.valorTotalPedidos, 3_324_636.5);
    assert.equal(result.totals.pedidosSemNfDocCr, 13);
    assert.equal(result.totals.valorSemNfDocCr, 1_380_296);
    assert.equal(result.totals.valorFuturoPresentePlausivel, 495_460);
    assert.equal(result.totals.valorVencidoBloqueado, 884_836);

    const pd02739 = result.rows.find((r) => r.orderCode === "PD 02739");
    assert.equal(pd02739?.statusPrincipal, "CARTEIRA_PRESENTE_ATENCAO");
    const pd02607 = result.rows.find((r) => r.orderCode === "PD 02607");
    assert.equal(pd02607?.statusPrincipal, "CARTEIRA_FUTURA_PROVAVEL");
    const pd02159 = result.rows.find((r) => r.orderCode === "PD 02159");
    assert.equal(pd02159?.statusPrincipal, "CARTEIRA_VENCIDA_BLOQUEADA");
  });
});

function round2(n: number): number {
  return Number(n.toFixed(2));
}
