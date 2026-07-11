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
    assert.equal(risco.isAlertCard, true);
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
    const expected = BRITANIA_INTELLIGENCE_EXPECTED;

    // 18 com CR — valor restante após 1.380.296
    const crPool = expected.valorTotalPedidos - expected.valorSemNfDocCr;
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

    for (const [i, o] of expected.futurePresentOrders.entries()) {
      const id = `fut-${i}`;
      orderTotals.set(id, o.orderValue);
      facts.push(
        fact({
          id: `f-fut-${i}`,
          salesOrderId: id,
          orderCode: o.orderCode,
          salesOrderItemId: `item-fut-${i}`,
          orderItemValue: o.orderValue,
          forecastSource: "ORDER",
          forecastDate:
            o.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO"
              ? "2026-07-20"
              : "2026-09-15",
          forecastValue: o.orderValue,
          status: "ORDER_ONLY",
          orderIssueDate: "2026-06-01",
        })
      );
    }

    for (const [i, o] of expected.blockedOrders.entries()) {
      const id = `blk-${i}`;
      orderTotals.set(id, o.orderValue);
      facts.push(
        fact({
          id: `f-blk-${i}`,
          salesOrderId: id,
          orderCode: o.orderCode,
          salesOrderItemId: `item-blk-${i}`,
          orderItemValue: o.orderValue,
          forecastSource: "ORDER",
          forecastDate: "2025-11-01",
          forecastValue: o.orderValue,
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

    assert.equal(result.totals.totalPedidos, expected.totalPedidos);
    assert.equal(result.totals.valorTotalPedidos, expected.valorTotalPedidos);
    assert.equal(result.totals.pedidosSemNfDocCr, expected.pedidosSemNfDocCr);
    assert.equal(result.totals.valorSemNfDocCr, expected.valorSemNfDocCr);
    assert.equal(
      result.totals.valorFuturoPresentePlausivel,
      expected.valorFuturoPresentePlausivel
    );
    assert.equal(result.totals.valorVencidoBloqueado, expected.valorVencidoBloqueado);

    for (const o of expected.futurePresentOrders) {
      const row = result.rows.find((r) => r.orderCode === o.orderCode);
      assert.equal(row?.statusPrincipal, o.statusPrincipal, o.orderCode);
      assert.equal(row?.orderValue, o.orderValue, o.orderCode);
    }
    for (const o of expected.blockedOrders) {
      const row = result.rows.find((r) => r.orderCode === o.orderCode);
      assert.equal(row?.statusPrincipal, "CARTEIRA_VENCIDA_BLOQUEADA", o.orderCode);
      assert.equal(row?.orderValue, o.orderValue, o.orderCode);
      assert.ok(
        row!.confidenceLabel === "MUITO_BAIXA" || row!.confidenceScore < 30,
        o.orderCode
      );
    }

    const blockedGroup = result.statusGroups.find(
      (g) => g.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA"
    );
    assert.equal(blockedGroup?.ordersCount, 10);
    const futura = result.statusGroups.find(
      (g) => g.statusPrincipal === "CARTEIRA_FUTURA_PROVAVEL"
    );
    const presente = result.statusGroups.find(
      (g) => g.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO"
    );
    assert.equal((futura?.ordersCount ?? 0) + (presente?.ordersCount ?? 0), 3);
  });

  it("excesso / produto fora / cabeçalho não aumentam carteira total", () => {
    const orderValue = 1000;
    const facts = [
      fact({
        id: "base",
        salesOrderId: "pd02339",
        orderCode: "PD 02339",
        salesOrderItemId: "item-1",
        externalProductId: 10,
        orderQuantity: 100,
        orderUnitPrice: 10,
        orderItemValue: orderValue,
        allocatedQuantity: 100,
        allocatedValueByOrderPrice: orderValue,
        nfeExternalId: 1,
        nfeHeaderValue: 5000,
        stockDocumentId: "s1",
        stockDocumentExternalId: 1,
        stockDocumentItemId: "si1",
        stockDocumentItemExternalId: 1,
        stockQuantity: 100,
        stockUnitValue: 10,
        stockItemValue: 1000,
        receivableTotalValue: 1000,
        openReceivableValue: 1000,
        receivedValue: 0,
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        forecastSource: "RECEIVABLE",
        alertsJson: [],
      }),
      fact({
        id: "surplus",
        salesOrderId: "pd02339",
        orderCode: "PD 02339",
        salesOrderItemId: "item-1",
        externalProductId: 10,
        orderQuantity: 100,
        orderUnitPrice: 10,
        orderItemValue: orderValue,
        nfeExternalId: 1,
        nfeHeaderValue: 5000,
        stockDocumentId: "s1",
        stockDocumentExternalId: 1,
        stockDocumentItemId: "si-surplus",
        stockDocumentItemExternalId: 2,
        stockQuantity: 15,
        stockUnitValue: 10,
        stockItemValue: 150,
        status: "QUANTITY_SURPLUS_IN_NFE",
        confidenceLevel: "MEDIUM",
        alertsJson: ["QUANTIDADE_EXCEDENTE_DOCUMENTO"],
        traceJson: { surplusQuantity: 15 },
      }),
      fact({
        id: "outside",
        salesOrderId: "pd02339",
        orderCode: "PD 02339",
        externalProductId: 99,
        nfeExternalId: 1,
        nfeHeaderValue: 5000,
        stockDocumentId: "s1",
        stockDocumentExternalId: 1,
        stockDocumentItemId: "si-out",
        stockDocumentItemExternalId: 3,
        stockQuantity: 20,
        stockUnitValue: 10,
        stockItemValue: 200,
        status: "STOCK_PRODUCT_NOT_IN_ORDER",
        confidenceLevel: "MEDIUM",
        alertsJson: ["PRODUTO_FORA_DO_PEDIDO"],
        traceJson: { rule: "STOCK_PRODUCT_NOT_IN_ORDER" },
      }),
    ];

    const result = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId: new Map([["pd02339", orderValue]]),
      filters: { asOfDate: AS_OF, pageSize: 50 },
    });

    const total = result.summaryCards.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA")!;
    assert.equal(total.value, orderValue);

    const statusSum = result.statusGroups.reduce((s, g) => s + g.orderValue, 0);
    assert.equal(statusSum, orderValue);

    const row = result.rows.find((r) => r.orderCode === "PD 02339")!;
    assert.equal(row.orderValue, orderValue);
    assert.equal(row.statusPrincipal, "CR_ABERTO");
    assert.ok(row.tagsAlerta.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(
      row.tagsAlerta.includes("QUANTIDADE_EXCEDENTE_DOCUMENTO") ||
        row.excessQuantity > 0
    );
    assert.ok(
      row.tagsAlerta.includes("PRODUTO_FORA_DO_PEDIDO") || row.valueOutsideOrder > 0
    );

    const excessQtyCard = result.summaryCards.find((c) => c.key === "QTD_EXCEDENTE_TOTAL")!;
    assert.ok(excessQtyCard.isAlertCard);
    assert.ok(excessQtyCard.value > 0);
    assert.ok(excessQtyCard.value + orderValue !== total.value || excessQtyCard.value > 0);
    // Excesso não entra na carteira
    assert.equal(total.value, orderValue);

    const outsideCard = result.summaryCards.find(
      (c) => c.key === "VALOR_DOCUMENTO_FORA_PEDIDO"
    )!;
    assert.ok(outsideCard.isAlertCard);
    assert.ok(outsideCard.value > 0);

    const headerCard = result.summaryCards.find(
      (c) => c.key === "VALOR_CABECALHO_NAO_ATRIBUIDO"
    )!;
    assert.ok(headerCard.isAlertCard);
    assert.ok(headerCard.value > 0);

    assert.ok(result.operationalGroups.some((g) => g.ordersCount > 0));
    assert.ok(
      result.alertGroups.some(
        (g) => g.alertKey === "QUANTIDADE_EXCEDENTE_DOCUMENTO" && g.ordersCount >= 1
      )
    );

    for (const key of [
      "OP_PCT_TOTALMENTE_ATENDIDO",
      "QTD_EXCEDENTE_TOTAL",
      "VALOR_ESTIMADO_EXCEDENTE",
      "VALOR_DOCUMENTO_FORA_PEDIDO",
      "VALOR_CABECALHO_NAO_ATRIBUIDO",
    ]) {
      const card = result.summaryCards.find((c) => c.key === key)!;
      assert.ok(card.explanation.whatItMeans.length > 20, key);
      assert.match(card.explanation.howWeCalculate + card.explanation.whatItMeans, /excede|fora|cabeçalho|atendid/i);
    }

    const seller = result.sellerKpis[0]!;
    assert.ok("operationalFulfillmentPct" in seller);
    assert.ok("excessValue" in seller);
    assert.ok("ordersWithProductOutside" in seller);
  });
});

function round2(n: number): number {
  return Number(n.toFixed(2));
}
