import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateStockQuantityToOrderBalances,
  buildPortfolioReconciliationFacts,
  pricesMismatch,
  type PortfolioReconciliationSnapshot,
  type SnapshotOrder,
} from "./portfolioReconciliationAllocationEngine.js";

function pd02339Snapshot(): PortfolioReconciliationSnapshot {
  const order: SnapshotOrder = {
    id: "3915fa28-1947-4388-bb27-2699c3cbb516",
    externalSalesOrderId: 2335,
    orderCode: "PD 02339",
    issueDate: new Date(2026, 4, 1),
    customerNameSnapshot: "Britania",
    totalNetValue: 158000,
    items: [
      {
        id: "item-456",
        externalProductId: 456,
        quantity: 3000,
        unitPrice: 5.85,
        productSkuSnapshot: "456",
      },
      {
        id: "item-452",
        externalProductId: 452,
        quantity: 9000,
        unitPrice: 5.85,
        productSkuSnapshot: "452",
      },
      {
        id: "item-537",
        externalProductId: 537,
        quantity: 5000,
        unitPrice: 5.86,
        productSkuSnapshot: "537",
      },
      {
        id: "item-455",
        externalProductId: 455,
        quantity: 10000,
        unitPrice: 5.85,
        productSkuSnapshot: "455",
      },
    ],
  };

  return {
    orders: [order],
    nfeLinks: [
      {
        salesOrderId: order.id,
        nfeExternalId: 6937,
        nfeNumber: "6845",
        dataProcessamento: new Date(2026, 4, 13, 8, 10, 33),
      },
      {
        salesOrderId: order.id,
        nfeExternalId: 7188,
        nfeNumber: "7052",
        dataProcessamento: new Date(2026, 5, 8, 14, 58, 10),
      },
      {
        salesOrderId: order.id,
        nfeExternalId: 7377,
        nfeNumber: "7195",
        dataProcessamento: new Date(2026, 5, 26, 15, 6, 10),
      },
    ],
    nfes: [
      { id: "nfe-6937", externalId: 6937, numero: "6845", valorLiquido: 108240 },
      { id: "nfe-7188", externalId: 7188, numero: "7052", valorLiquido: 168075 },
      { id: "nfe-7377", externalId: 7377, numero: "7195", valorLiquido: 78975 },
    ],
    stockDocuments: [
      {
        id: "doc-7951",
        externalId: 7951,
        idNfe: 6937,
        dataDocumento: new Date(2026, 4, 13, 8, 10, 33),
        items: [
          { id: "si-456", externalProductId: 456, quantity: 3000, unitValue: 4.92 },
          { id: "si-452", externalProductId: 452, quantity: 9000, unitValue: 4.92 },
          { id: "si-455", externalProductId: 455, quantity: 10000, unitValue: 4.92 },
        ],
      },
      {
        id: "doc-8175",
        externalId: 8175,
        idNfe: 7188,
        dataDocumento: new Date(2026, 5, 8, 14, 58, 10),
        items: [
          { id: "si-537", externalProductId: 537, quantity: 10000, unitValue: 5.86 },
          { id: "si-452b", externalProductId: 452, quantity: 4500, unitValue: 5.85 },
          { id: "si-538", externalProductId: 538, quantity: 6200, unitValue: 5.85 },
          { id: "si-453", externalProductId: 453, quantity: 8000, unitValue: 5.86 },
        ],
      },
      {
        id: "doc-8422",
        externalId: 8422,
        idNfe: 7377,
        dataDocumento: new Date(2026, 5, 26, 15, 6, 10),
        items: [
          { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
          { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
        ],
      },
    ],
  };
}

describe("portfolioReconciliationAllocationEngine", () => {
  it("não aloca cabeçalho inteiro da NF", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const allocated = result.facts.filter(
      (f) => f.allocatedQuantity != null && f.allocatedQuantity > 0
    );
    for (const fact of allocated) {
      assert.notEqual(fact.allocatedValueByOrderPrice, fact.nfeHeaderValue);
      assert.equal(fact.traceJson.neverAssumesFullNfeHeader, true);
    }
    const overLinked = result.facts.find((f) => f.status === "OVER_LINKED_BY_HEADER");
    assert.ok(overLinked);
    assert.ok((overLinked!.traceJson.headerSum as number) > 158000);
  });

  it("aloca por produto e quantidade (PD 02339)", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });

    const a456 = result.facts.find(
      (f) =>
        f.externalProductId === 456 &&
        f.nfeExternalId === 6937 &&
        (f.allocatedQuantity ?? 0) > 0
    );
    assert.ok(a456);
    assert.equal(a456!.allocatedQuantity, 3000);
    assert.equal(a456!.status, "PRICE_MISMATCH");

    const a452 = result.facts.find(
      (f) =>
        f.externalProductId === 452 &&
        f.nfeExternalId === 6937 &&
        (f.allocatedQuantity ?? 0) > 0
    );
    assert.ok(a452);
    assert.equal(a452!.allocatedQuantity, 9000);

    const a455 = result.facts.find(
      (f) =>
        f.externalProductId === 455 &&
        f.nfeExternalId === 6937 &&
        (f.allocatedQuantity ?? 0) > 0
    );
    assert.ok(a455);
    assert.equal(a455!.allocatedQuantity, 10000);

    const a537 = result.facts.find(
      (f) =>
        f.externalProductId === 537 &&
        f.nfeExternalId === 7188 &&
        (f.allocatedQuantity ?? 0) > 0
    );
    assert.ok(a537);
    assert.equal(a537!.allocatedQuantity, 5000);
    assert.equal(a537!.status, "ITEM_ALLOCATED");
  });

  it("limita alocação ao saldo do pedido", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const allocated537 = result.facts
      .filter((f) => f.externalProductId === 537 && (f.allocatedQuantity ?? 0) > 0)
      .reduce((s, f) => s + (f.allocatedQuantity ?? 0), 0);
    assert.equal(allocated537, 5000);
    assert.ok(allocated537 < 10000);
  });

  it("marca PRICE_MISMATCH", () => {
    assert.equal(pricesMismatch(5.85, 4.92), true);
    assert.equal(pricesMismatch(5.86, 5.86), false);
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const mismatches = result.facts.filter((f) => f.status === "PRICE_MISMATCH");
    assert.equal(mismatches.length, 3);
    assert.ok(mismatches.every((f) => f.nfeExternalId === 6937));
  });

  it("marca QUANTITY_SURPLUS_IN_NFE", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const surplus537 = result.facts.find(
      (f) =>
        f.status === "QUANTITY_SURPLUS_IN_NFE" &&
        f.externalProductId === 537 &&
        f.nfeExternalId === 7188
    );
    assert.ok(surplus537);
    assert.equal(surplus537!.traceJson.surplusQuantity, 5000);
  });

  it("não duplica item já atendido em NF posterior", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });

    const allocated452Later = result.facts.filter(
      (f) =>
        f.externalProductId === 452 &&
        f.nfeExternalId !== 6937 &&
        (f.allocatedQuantity ?? 0) > 0
    );
    assert.equal(allocated452Later.length, 0);

    const surplus7195 = result.facts.filter(
      (f) =>
        f.nfeExternalId === 7377 &&
        f.status === "QUANTITY_SURPLUS_IN_NFE" &&
        (f.externalProductId === 452 || f.externalProductId === 455)
    );
    assert.equal(surplus7195.length, 2);

    const foreign7052 = result.facts.filter(
      (f) =>
        f.nfeExternalId === 7188 &&
        f.status === "DATA_QUALITY_ISSUE" &&
        (f.externalProductId === 538 || f.externalProductId === 453)
    );
    assert.equal(foreign7052.length, 2);
  });

  it("pedido sem documento/NF vira ORDER_ONLY", () => {
    const snapshot: PortfolioReconciliationSnapshot = {
      orders: [
        {
          id: "o1",
          orderCode: "PD X",
          items: [{ id: "i1", externalProductId: 1, quantity: 10, unitPrice: 2 }],
        },
      ],
      nfeLinks: [],
      nfes: [],
      stockDocuments: [],
    };
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot,
    });
    assert.equal(result.facts.length, 1);
    assert.equal(result.facts[0]!.status, "ORDER_ONLY");
    assert.equal(result.summary.orderOnlyLines, 1);
  });

  it("NF sem itemização vira HEADER_ONLY_LINK", () => {
    const snapshot: PortfolioReconciliationSnapshot = {
      orders: [
        {
          id: "o1",
          orderCode: "PD Y",
          items: [{ id: "i1", externalProductId: 1, quantity: 10, unitPrice: 2 }],
        },
      ],
      nfeLinks: [{ salesOrderId: "o1", nfeExternalId: 99, nfeNumber: "1" }],
      nfes: [{ externalId: 99, numero: "1", valorLiquido: 100 }],
      stockDocuments: [],
    };
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot,
    });
    assert.ok(result.facts.some((f) => f.status === "HEADER_ONLY_LINK"));
    assert.equal(result.summary.headerOnlyLinks, 1);
    assert.ok(!result.facts.some((f) => (f.allocatedQuantity ?? 0) > 0));
  });

  it("PD 02339 fica FULLY_ALLOCATED em quantidade com divergência de preço", () => {
    const result = buildPortfolioReconciliationFacts({
      runId: "run-1",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const rollup = result.facts.find((f) => f.status === "FULLY_ALLOCATED");
    assert.ok(rollup);
    assert.ok(
      rollup!.alertsJson.some((a) => a.includes("divergência de preço"))
    );
    assert.equal(result.summary.fullyAllocatedOrders, 1);
  });

  it("bloqueia alocação ambígua de produto duplicado no pedido", () => {
    const result = allocateStockQuantityToOrderBalances(
      [
        { item: { id: "a", externalProductId: 1, quantity: 5, unitPrice: 1 }, remainingQty: 5 },
        { item: { id: "b", externalProductId: 1, quantity: 5, unitPrice: 1 }, remainingQty: 5 },
      ],
      1,
      3
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, "AMBIGUOUS_ALLOCATION");
  });
});
