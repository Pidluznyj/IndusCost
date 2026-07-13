import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderToCashAuditFactRecord } from "./orderToCashAuditApi.js";
import {
  applyOrderStatusFilters,
  buildDrilldownCards,
  buildPortfolioOrderStatus,
  buildPrimaryCards,
  classifyOrderStatus,
  resolveFactLineBilledValue,
  sortOrderStatusRows,
  type PortfolioOrderStatusFact,
} from "./portfolioOrderStatusService.js";

const RUN_ID = "41c2470a-b685-4765-a954-77110fd8cf5c";
const TITLE_CR_02534 = 183_612;
const ORDER_VALUE_02339 = 158_000;

function baseFact(
  partial: Partial<PortfolioOrderStatusFact> & { id: string }
): PortfolioOrderStatusFact {
  const defaults: OrderToCashAuditFactRecord = {
    runId: RUN_ID,
    orderCode: "PD X",
    orderIssueDate: new Date(2026, 5, 1),
    orderExpectedDeliveryDate: new Date(2026, 7, 1),
    orderNetValue: 10_000,
    customerId: "cust",
    customerName: "Cliente",
    externalCustomerId: 100,
    sellerName: "Vendedor",
    sellerQualityStatus: "OK",
    productCode: "P1",
    sku: "P1",
    productName: "Produto",
    lineType: "ORDER_ITEM_ALLOCATED",
    orderedQuantity: 10,
    orderUnitPrice: 100,
    orderItemTotalValue: 1000,
    stockDocumentId: "doc-1",
    stockDocumentExternalId: 1,
    stockDocumentDate: new Date(2026, 5, 10),
    stockDocumentItemQuantity: 10,
    quantityUsedForOrder: 10,
    excessQuantity: 0,
    outsideOrderQuantity: 0,
    allocatedValueByOrderPrice: 1000,
    allocatedValueByDocumentPrice: 1000,
    stockDocumentItemUnitValue: 100,
    stockDocumentItemTotalValue: 1000,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    nfeNumber: "1000",
    nfeIssueDate: new Date(2026, 5, 11),
    nfeHeaderValue: 1000,
    receivableTotalValue: 1000,
    receivableOpenValue: 1000,
    receivableReceivedValue: 0,
    paymentDueDate: new Date(2026, 6, 1),
    paymentSettlementDate: null,
    paymentStatus: "OPEN",
    operationalStage: "FULLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "CR_ABERTO",
    temperature: "AMARELO",
    confidenceScore: 0.8,
    confidenceLabel: "ALTA",
    responsibleArea: "Financeiro",
    recommendedAction: "Acompanhar",
    alertsJson: [],
    blockingReasonsJson: [],
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
    salesOrderId: "order-x",
  };
  return { ...defaults, ...partial };
}

/** Fixture PD 02534 — parcial + CR aberto; 309.86AA PENDING. */
function fixturePd02534(): PortfolioOrderStatusFact[] {
  const salesOrderId = "order-pd-02534";
  const shared = {
    salesOrderId,
    orderCode: "PD 02534",
    customerName: "Esmaltec",
    externalCustomerId: 500,
    orderNetValue: 120_000,
    orderIssueDate: new Date(2026, 5, 1),
    orderExpectedDeliveryDate: new Date(2026, 5, 20),
    hasPartialFulfillment: true,
    hasFullFulfillment: false,
    operationalStage: "PARTIALLY_FULFILLED",
    financialStage: "CR_OPEN",
    orderToCashStage: "PEDIDO_PARCIALMENTE_ATENDIDO",
    receivableTotalValue: TITLE_CR_02534,
    receivableOpenValue: 50_000,
    receivableReceivedValue: 133_612,
    nfeNumber: "7228",
    nfeHeaderValue: TITLE_CR_02534,
  } as const;

  const allocated = (
    id: string,
    productCode: string,
    qty: number,
    unit: number,
    extra?: Partial<PortfolioOrderStatusFact>
  ): PortfolioOrderStatusFact =>
    baseFact({
      id,
      ...shared,
      productCode,
      sku: productCode,
      quantityUsedForOrder: qty,
      stockDocumentItemUnitValue: unit,
      allocatedValueByOrderPrice: qty * unit,
      allocatedValueByDocumentPrice: qty * unit,
      orderItemTotalValue: qty * unit,
      alertsJson: ["DOCUMENTO_PARCIAL"],
      ...extra,
    });

  const pending309 = baseFact({
    id: "pending-30986",
    ...shared,
    productCode: "309.86AA",
    sku: "309.86AA",
    productName: "309.86AA",
    lineType: "ORDER_ITEM_PENDING",
    orderedQuantity: 100,
    orderUnitPrice: 10,
    orderItemTotalValue: 1_000,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentDate: null,
    stockDocumentItemQuantity: null,
    stockDocumentItemUnitValue: null,
    stockDocumentItemTotalValue: null,
    quantityUsedForOrder: null,
    allocatedValueByOrderPrice: null,
    allocatedValueByDocumentPrice: null,
    nfeNumber: null,
    nfeHeaderValue: null,
    receivableTotalValue: null,
    receivableOpenValue: null,
    receivableReceivedValue: null,
    operationalStage: "NOT_FULFILLED",
    financialStage: "NO_CR",
    alertsJson: ["DOCUMENTO_PARCIAL"],
  });

  // 17 facts com o mesmo CR título (não pode somar 17×)
  const manyCrLines = Array.from({ length: 14 }, (_, i) =>
    allocated(`alloc-extra-${i}`, `SKU-${i}`, 10, 3.35, {
      hasExcessQuantity: i === 0,
      alertsJson:
        i === 0
          ? ["DOCUMENTO_PARCIAL", "DOCUMENTO_COM_EXCEDENTE"]
          : ["DOCUMENTO_PARCIAL"],
    })
  );

  return [
    allocated("alloc-61203", "612.03AA", 12_200, 3.35, {
      hasExcessQuantity: true,
      alertsJson: ["DOCUMENTO_PARCIAL", "DOCUMENTO_COM_EXCEDENTE"],
    }),
    allocated("alloc-61202", "612.02AA", 10_000, 3.35),
    allocated("alloc-61921", "619.21AA", 10_000, 2.89),
    pending309,
    ...manyCrLines,
  ];
}

/** Fixture PD 02339 — valor pedido 158k; NF cabeçalho maior não infla. */
function fixturePd02339(): PortfolioOrderStatusFact[] {
  const salesOrderId = "order-pd-02339";
  const shared = {
    salesOrderId,
    orderCode: "PD 02339",
    customerName: "Britânia",
    externalCustomerId: 200,
    orderNetValue: ORDER_VALUE_02339,
    orderIssueDate: new Date(2026, 4, 1),
    hasFullFulfillment: true,
    hasPartialFulfillment: false,
    hasExcessQuantity: true,
    hasNfeHeaderGreaterThanOrder: true,
    operationalStage: "FULLY_FULFILLED_WITH_EXCESS",
    financialStage: "CR_OPEN",
    orderToCashStage: "PEDIDO_ATENDIDO_COM_EXCEDENTE",
    receivableTotalValue: 158_000,
    receivableOpenValue: 158_000,
    receivableReceivedValue: 0,
    nfeHeaderValue: 250_000,
    alertsJson: ["DOCUMENTO_COM_EXCEDENTE", "NF_CABECALHO_MAIOR_PEDIDO"],
  } as const;

  return [
    baseFact({
      id: "a1",
      ...shared,
      productCode: "A",
      quantityUsedForOrder: 1000,
      stockDocumentItemUnitValue: 80,
      allocatedValueByOrderPrice: 80_000,
      allocatedValueByDocumentPrice: 80_000,
      orderItemTotalValue: 80_000,
      nfeNumber: "6845",
    }),
    baseFact({
      id: "a2",
      ...shared,
      productCode: "B",
      quantityUsedForOrder: 1000,
      stockDocumentItemUnitValue: 78,
      allocatedValueByOrderPrice: 78_000,
      allocatedValueByDocumentPrice: 90_000,
      orderItemTotalValue: 78_000,
      nfeNumber: "6846",
      nfeHeaderValue: 250_000,
    }),
    // Excedente — não deve empurrar allocated acima do pedido
    baseFact({
      id: "surplus",
      ...shared,
      productCode: "B",
      lineType: "QUANTITY_SURPLUS",
      quantityUsedForOrder: 0,
      excessQuantity: 200,
      stockDocumentItemUnitValue: 78,
      allocatedValueByOrderPrice: 15_600,
      allocatedValueByDocumentPrice: 15_600,
      orderItemTotalValue: 78_000,
    }),
  ];
}

describe("portfolioOrderStatusService", () => {
  it("PD 02534: PARCIAL_CR_ABERTO; 309.86AA não faturado; CR não soma 17×", () => {
    const facts = fixturePd02534();
    assert.ok(facts.length >= 17, "fixture com múltiplas facts do mesmo CR");

    const result = buildPortfolioOrderStatus({ facts });
    assert.equal(result.rows.length, 1);
    const row = result.rows[0]!;

    assert.equal(row.orderCode, "PD 02534");
    assert.equal(row.consolidatedOrderStatus, "PARCIAL_CR_ABERTO");
    assert.equal(row.hasPendingItems, true);
    assert.equal(row.hasOpenCr, true);
    assert.equal(row.hasDivergences, true);
    assert.ok(row.alerts.includes("DOCUMENTO_PARCIAL"));
    assert.ok(
      row.alerts.includes("DOCUMENTO_COM_EXCEDENTE") || row.hasDivergences
    );

    assert.equal(row.receivableTotalValue, TITLE_CR_02534);
    assert.notEqual(row.receivableTotalValue, TITLE_CR_02534 * facts.length);
    assert.equal(row.totalOrderValue, 120_000);

    const pendingBilled = resolveFactLineBilledValue(
      facts.find((f) => f.productCode === "309.86AA")!
    );
    assert.equal(pendingBilled, 0);

    // Valor cobrado do pedido não inclui CR título nem PENDING
    assert.ok(row.lineBilledValue < TITLE_CR_02534);
    assert.ok(row.lineBilledValue > 0);
    assert.ok(row.pendingOrderValue > 0);

    const cards = result.primaryCards;
    assert.equal(cards.find((c) => c.id === "total")?.count, 1);
    assert.equal(cards.find((c) => c.id === "parciais")?.count, 1);
    assert.equal(cards.find((c) => c.id === "cr_aberto")?.count, 1);
    assert.equal(result.summary.totalOrders, 1);
    assert.equal(result.summary.totalReceivableValue, TITLE_CR_02534);
  });

  it("PD 02339: valor pedido único 158k; alocado capped; NF cabeçalho não infla", () => {
    const facts = fixturePd02339();
    const result = buildPortfolioOrderStatus({ facts });
    assert.equal(result.rows.length, 1);
    const row = result.rows[0]!;

    assert.equal(row.totalOrderValue, ORDER_VALUE_02339);
    assert.ok(row.allocatedOrderValue <= ORDER_VALUE_02339);
    assert.ok(row.nfeHeaderMaxValue > ORDER_VALUE_02339);
    assert.notEqual(row.totalOrderValue, row.nfeHeaderMaxValue);
    assert.ok(row.alerts.includes("NF_CABECALHO_MAIOR_PEDIDO"));
    assert.ok(row.hasDivergences);
    // Completo com excedente + CR aberto
    assert.equal(row.consolidatedOrderStatus, "COMPLETO_CR_ABERTO");
    assert.equal(row.hasPendingItems, false);
  });

  it("múltiplas facts do mesmo CR não duplicam valores no summary", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "o1",
        orderCode: "PD A",
        orderNetValue: 500,
        receivableTotalValue: 500,
        receivableOpenValue: 200,
        receivableReceivedValue: 300,
        productCode: "X",
      }),
      baseFact({
        id: "2",
        salesOrderId: "o1",
        orderCode: "PD A",
        orderNetValue: 500,
        receivableTotalValue: 500,
        receivableOpenValue: 200,
        receivableReceivedValue: 300,
        productCode: "Y",
        allocatedValueByOrderPrice: 200,
        quantityUsedForOrder: 2,
        stockDocumentItemUnitValue: 100,
      }),
      baseFact({
        id: "3",
        salesOrderId: "o2",
        orderCode: "PD B",
        orderNetValue: 100,
        receivableTotalValue: 100,
        receivableOpenValue: 0,
        receivableReceivedValue: 100,
        financialStage: "CR_RECEIVED",
        orderToCashStage: "RECEBIDO",
        paymentStatus: "SETTLED",
      }),
    ];
    const { summary, rows } = buildPortfolioOrderStatus({ facts });
    assert.equal(rows.length, 2);
    assert.equal(summary.totalOrders, 2);
    assert.equal(summary.totalOrderValue, 600);
    assert.equal(summary.totalReceivableValue, 600);
    assert.equal(summary.totalOpenValue, 200);
    assert.equal(summary.totalReceivedValue, 400);
  });

  it("pedido completo recebido", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "c1",
        orderCode: "PD COMP REC",
        receivableOpenValue: 0,
        receivableReceivedValue: 1000,
        receivableTotalValue: 1000,
        financialStage: "CR_RECEIVED",
        orderToCashStage: "RECEBIDO",
        hasPartialFulfillment: false,
        hasFullFulfillment: true,
      }),
    ];
    const { consolidatedOrderStatus } = classifyOrderStatus(facts);
    assert.equal(consolidatedOrderStatus, "COMPLETO_RECEBIDO");
  });

  it("pedido completo com CR aberto", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "c2",
        orderCode: "PD COMP CR",
        receivableOpenValue: 500,
        receivableReceivedValue: 500,
        receivableTotalValue: 1000,
        financialStage: "CR_OPEN",
        hasPartialFulfillment: false,
      }),
    ];
    assert.equal(classifyOrderStatus(facts).consolidatedOrderStatus, "COMPLETO_CR_ABERTO");
  });

  it("pedido parcial sem CR", () => {
    const facts = [
      baseFact({
        id: "a",
        salesOrderId: "p1",
        orderCode: "PD PARC",
        receivableTotalValue: 0,
        receivableOpenValue: 0,
        receivableReceivedValue: 0,
        hasPartialFulfillment: true,
      }),
      baseFact({
        id: "b",
        salesOrderId: "p1",
        orderCode: "PD PARC",
        lineType: "ORDER_ITEM_PENDING",
        productCode: "PEND",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
        nfeNumber: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        nfeHeaderValue: null,
        hasPartialFulfillment: true,
      }),
    ];
    assert.equal(classifyOrderStatus(facts).consolidatedOrderStatus, "PARCIAL_SEM_CR");
  });

  it("pedido sem atendimento futuro", () => {
    const asOf = new Date(2026, 5, 1);
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "f1",
        orderCode: "PD FUT",
        lineType: "ORDER_ITEM_PENDING",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
        nfeNumber: null,
        nfeHeaderValue: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        orderExpectedDeliveryDate: new Date(2026, 8, 1),
        hasFullFulfillment: false,
        hasPartialFulfillment: false,
      }),
    ];
    assert.equal(
      classifyOrderStatus(facts, { asOf }).consolidatedOrderStatus,
      "SEM_ATENDIMENTO_FUTURO"
    );
  });

  it("pedido sem atendimento atrasado", () => {
    const asOf = new Date(2026, 8, 1);
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "a1",
        orderCode: "PD ATR",
        lineType: "ORDER_ITEM_PENDING",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
        nfeNumber: null,
        nfeHeaderValue: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        orderExpectedDeliveryDate: new Date(2026, 5, 1),
        hasFullFulfillment: false,
        hasPartialFulfillment: false,
      }),
    ];
    assert.equal(
      classifyOrderStatus(facts, { asOf }).consolidatedOrderStatus,
      "SEM_ATENDIMENTO_ATRASADO"
    );
  });

  it("pedido com produto fora", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "out1",
        orderCode: "PD FORA",
        hasProductOutsideOrder: true,
        alertsJson: ["PRODUTO_FORA_DO_PEDIDO"],
        receivableOpenValue: 100,
      }),
    ];
    const row = buildPortfolioOrderStatus({ facts }).rows[0]!;
    assert.equal(row.hasDivergences, true);
    assert.ok(row.alerts.includes("PRODUTO_FORA_DO_PEDIDO"));
    assert.equal(
      buildPrimaryCards([row]).find((c) => c.id === "com_divergencia")?.count,
      1
    );
  });

  it("pedido com excedente", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "ex1",
        orderCode: "PD EXC",
        hasExcessQuantity: true,
        alertsJson: ["DOCUMENTO_COM_EXCEDENTE"],
      }),
    ];
    const row = buildPortfolioOrderStatus({ facts }).rows[0]!;
    assert.ok(row.alerts.includes("DOCUMENTO_COM_EXCEDENTE"));
    assert.equal(row.hasDivergences, true);
  });

  it("pedido com NF sem CR", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "nf1",
        orderCode: "PD NF",
        receivableTotalValue: 0,
        receivableOpenValue: 0,
        receivableReceivedValue: 0,
        hasDocumentWithoutReceivable: true,
        alertsJson: ["DOCUMENTO_SEM_CR"],
        financialStage: "INVOICED_WITHOUT_CR",
        orderToCashStage: "NF_SEM_CR",
        nfeNumber: "9999",
        hasPartialFulfillment: false,
        hasFullFulfillment: true,
      }),
    ];
    assert.equal(classifyOrderStatus(facts).consolidatedOrderStatus, "NF_SEM_CR");
  });

  it("bloqueado por estágio / alerta antigo", () => {
    const facts = [
      baseFact({
        id: "1",
        salesOrderId: "bl1",
        orderCode: "PD BLOQ",
        orderToCashStage: "BLOQUEADO_REVISAO",
        alertsJson: ["PEDIDO_ANTIGO_SEM_EVOLUCAO"],
        lineType: "ORDER_ITEM_PENDING",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
      }),
    ];
    assert.equal(
      classifyOrderStatus(facts).consolidatedOrderStatus,
      "BLOQUEADO_REVISAO"
    );
  });

  it("filters, sort e drilldowns", () => {
    const facts = [
      ...fixturePd02534(),
      ...fixturePd02339(),
      baseFact({
        id: "fut",
        salesOrderId: "fut",
        orderCode: "PD FUT2",
        lineType: "ORDER_ITEM_PENDING",
        quantityUsedForOrder: null,
        allocatedValueByOrderPrice: null,
        nfeNumber: null,
        receivableTotalValue: null,
        receivableOpenValue: null,
        receivableReceivedValue: null,
        nfeHeaderValue: null,
        orderExpectedDeliveryDate: new Date(2027, 0, 1),
        hasFullFulfillment: false,
        hasPartialFulfillment: false,
      }),
    ];
    const asOf = new Date(2026, 5, 15);
    const built = buildPortfolioOrderStatus({
      facts,
      asOf,
      filters: { selectedCard: "parciais" },
      sort: { sortBy: "orderCode", sortDirection: "asc" },
    });
    assert.ok(built.rows.every((r) => r.consolidatedOrderStatus.startsWith("PARCIAL_")));
    assert.equal(built.primaryCards.find((c) => c.id === "parciais")?.count, built.rows.length);
    // Cards permanecem no universo base (não colapsam com selectedCard)
    assert.equal(built.primaryCards.find((c) => c.id === "total")?.count, 3);
    assert.ok(
      (built.primaryCards.find((c) => c.id === "total")?.count ?? 0) >
        built.rows.length
    );
    const parcialCard = built.primaryCards.find((c) => c.id === "parciais");
    assert.ok(parcialCard);
    assert.equal(typeof parcialCard!.totalOrderValue, "number");
    assert.equal(parcialCard!.percentOfTotal, Math.round((1 / 3) * 1000) / 10);
    assert.match(parcialCard!.hint, /item atendido/i);

    const drills = built.drilldownCards;
    assert.ok(drills.some((d) => d.id === "parcial_cr_aberto"));

    const sorted = sortOrderStatusRows(built.rows, {
      sortBy: "totalOrderValue",
      sortDirection: "desc",
    });
    if (sorted.length >= 2) {
      assert.ok(sorted[0]!.totalOrderValue >= sorted[1]!.totalOrderValue);
    }

    const filtered = applyOrderStatusFilters(built.rows, {
      consolidatedStatus: "PARCIAL_CR_ABERTO",
    });
    assert.ok(filtered.every((r) => r.consolidatedOrderStatus === "PARCIAL_CR_ABERTO"));
  });

  it("cards contam pedidos distintos, não facts", () => {
    const facts = fixturePd02534();
    const { primaryCards, summary } = buildPortfolioOrderStatus({ facts });
    assert.equal(summary.totalOrders, 1);
    assert.notEqual(summary.totalOrders, facts.length);
    const total = primaryCards.find((c) => c.id === "total");
    assert.equal(total?.count, 1);
    assert.equal(total?.percentOfTotal, 100);
    assert.ok((total?.totalOrderValue ?? 0) > 0);
    assert.equal(
      total?.hint,
      "Total de pedidos distintos dentro do filtro."
    );
  });
});
