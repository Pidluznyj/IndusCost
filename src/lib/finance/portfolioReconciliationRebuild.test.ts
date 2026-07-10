import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPortfolioReconciliationFacts } from "./portfolioReconciliationAllocationEngine.js";
import { enrichPortfolioFactsWithReceivables } from "./portfolioReconciliationReceivables.js";
import {
  buildPortfolioRebuildSummary,
  buildRebuildFilterKey,
  filtersMatchRebuildKey,
  formatPortfolioRebuildExplain,
  parseRebuildPortfolioCli,
  shouldWritePortfolioRebuild,
} from "./portfolioReconciliationRebuild.js";
import type { PortfolioReconciliationSnapshot } from "./portfolioReconciliationAllocationEngine.js";

function pd02339Snapshot(): PortfolioReconciliationSnapshot {
  const orderId = "3915fa28-1947-4388-bb27-2699c3cbb516";
  return {
    orders: [
      {
        id: orderId,
        externalSalesOrderId: 2335,
        orderCode: "PD 02339",
        issueDate: new Date(2026, 4, 1),
        customerExternalId: 200,
        customerNameSnapshot: "Britânia",
        totalNetValue: 158000,
        items: [
          { id: "item-456", externalProductId: 456, quantity: 3000, unitPrice: 5.85 },
          { id: "item-452", externalProductId: 452, quantity: 9000, unitPrice: 5.85 },
          { id: "item-537", externalProductId: 537, quantity: 5000, unitPrice: 5.86 },
          { id: "item-455", externalProductId: 455, quantity: 10000, unitPrice: 5.85 },
        ],
      },
    ],
    nfeLinks: [
      { salesOrderId: orderId, nfeExternalId: 6937, nfeNumber: "6845" },
      { salesOrderId: orderId, nfeExternalId: 7188, nfeNumber: "7052" },
      { salesOrderId: orderId, nfeExternalId: 7377, nfeNumber: "7195" },
    ],
    nfes: [
      { externalId: 6937, numero: "6845", valorLiquido: 108240 },
      { externalId: 7188, numero: "7052", valorLiquido: 168075 },
      { externalId: 7377, numero: "7195", valorLiquido: 78975 },
    ],
    stockDocuments: [
      {
        id: "doc-7951",
        externalId: 7951,
        idNfe: 6937,
        dataDocumento: new Date(2026, 4, 13),
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
        dataDocumento: new Date(2026, 5, 8),
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
        dataDocumento: new Date(2026, 5, 26),
        items: [
          { id: "si-452c", externalProductId: 452, quantity: 3500, unitValue: 5.85 },
          { id: "si-455b", externalProductId: 455, quantity: 10000, unitValue: 5.85 },
        ],
      },
    ],
  };
}

describe("portfolioReconciliationRebuild", () => {
  it("preview não habilita escrita; apply habilita", () => {
    assert.equal(shouldWritePortfolioRebuild("preview"), false);
    assert.equal(shouldWritePortfolioRebuild("apply"), true);
  });

  it("parse CLI com orderCode e explain", () => {
    const options = parseRebuildPortfolioCli([
      "preview",
      '--orderCode=PD 02339',
      "--explain",
    ]);
    assert.equal(options.mode, "preview");
    assert.equal(options.orderCode, "PD 02339");
    assert.equal(options.explain, true);
    assert.equal(options.replaceLatest, false);
  });

  it("resumo PD 02339 não usa soma de cabeçalhos como valor do pedido", () => {
    const snapshot = pd02339Snapshot();
    const built = buildPortfolioReconciliationFacts({
      runId: "run-preview",
      mode: "preview",
      snapshot,
    });
    const facts = enrichPortfolioFactsWithReceivables({
      facts: built.facts,
      receivables: [],
      nfes: snapshot.nfes,
      applyPaymentCalendar: false,
    });
    const summary = buildPortfolioRebuildSummary(facts, snapshot);

    assert.equal(summary.ordersAnalyzed, 1);
    assert.equal(summary.ordersWithNfe, 1);
    assert.equal(summary.ordersWithStockDocument, 1);
    assert.equal(summary.totalOrderValue, 158000);
    assert.ok(summary.totalAllocatedValue > 0);
    assert.ok(summary.totalAllocatedValue < 355290);
    assert.notEqual(summary.totalOrderValue, 355290);
    assert.ok(summary.divergenceCount > 0);
    assert.ok((summary.statusCounts.PRICE_MISMATCH ?? 0) >= 3);
  });

  it("explain PD 02339 mostra alocações, mismatch e excedentes", () => {
    const snapshot = pd02339Snapshot();
    const built = buildPortfolioReconciliationFacts({
      runId: "run-preview",
      mode: "preview",
      snapshot,
    });
    const facts = enrichPortfolioFactsWithReceivables({
      facts: built.facts,
      receivables: [],
      nfes: snapshot.nfes,
      applyPaymentCalendar: false,
    });
    const text = formatPortfolioRebuildExplain(facts, snapshot, "PD 02339");

    assert.match(text, /Pedido PD 02339: R\$\s*158\.000,00/);
    assert.match(text, /NF vinculadas: 6845, 7052, 7195/);
    assert.match(text, /PRICE_MISMATCH/);
    assert.match(text, /Excedentes/);
    assert.match(text, /355\.290,00/);
    assert.match(text, /NÃO é o valor do pedido/i);
    assert.doesNotMatch(text, /consumir R\$\s*355\.290,00 como valor do pedido/i);
  });

  it("filterKey bate para replace-latest", () => {
    const options = parseRebuildPortfolioCli([
      "apply",
      "--orderCode=PD 02339",
      "--replace-latest",
    ]);
    const key = buildRebuildFilterKey(options);
    assert.equal(options.replaceLatest, true);
    assert.equal(
      filtersMatchRebuildKey({ filterKey: key }, key),
      true
    );
    assert.equal(
      filtersMatchRebuildKey({ filterKey: { ...key, orderCode: "OTHER" } }, key),
      false
    );
  });
});
