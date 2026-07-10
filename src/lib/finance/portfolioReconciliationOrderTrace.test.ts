import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { buildPortfolioReconciliationFacts } from "./portfolioReconciliationAllocationEngine.js";
import type { PortfolioReconciliationSnapshot, SnapshotOrder } from "./portfolioReconciliationAllocationEngine.js";
import {
  buildPortfolioOrderTraceViewModel,
  portfolioFactDraftToApiRow,
} from "./portfolioReconciliationOrderTrace.js";

function pd02339Snapshot(): PortfolioReconciliationSnapshot {
  const order: SnapshotOrder = {
    id: "3915fa28-1947-4388-bb27-2699c3cbb516",
    externalSalesOrderId: 2335,
    orderCode: "PD 02339",
    issueDate: new Date(2026, 4, 1),
    customerExternalId: 200,
    customerNameSnapshot: "Britânia",
    totalNetValue: 158000,
    items: [
      {
        id: "item-456",
        externalProductId: 456,
        quantity: 3000,
        unitPrice: 5.85,
        productSkuSnapshot: "456",
        productNameSnapshot: "Produto 456",
      },
      {
        id: "item-452",
        externalProductId: 452,
        quantity: 9000,
        unitPrice: 5.85,
        productSkuSnapshot: "452",
        productNameSnapshot: "Produto 452",
      },
      {
        id: "item-537",
        externalProductId: 537,
        quantity: 5000,
        unitPrice: 5.86,
        productSkuSnapshot: "537",
        productNameSnapshot: "Produto 537",
      },
      {
        id: "item-455",
        externalProductId: 455,
        quantity: 10000,
        unitPrice: 5.85,
        productSkuSnapshot: "455",
        productNameSnapshot: "Produto 455",
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

describe("portfolioReconciliationOrderTrace PD 02339", () => {
  it("explica pedido 158k, NFs, mismatch 4,92 vs 5,85, parcial 537 e não reconsome 7195", () => {
    const engine = buildPortfolioReconciliationFacts({
      runId: "run-pd02339",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const facts = engine.facts.map((draft, idx) =>
      portfolioFactDraftToApiRow(draft, `fact-${idx}`)
    );
    const detail = buildPortfolioOrderTraceViewModel(
      "3915fa28-1947-4388-bb27-2699c3cbb516",
      facts,
      {
        id: "run-pd02339",
        status: "SUCCESS",
        mode: "preview",
        startedAt: null,
        finishedAt: null,
        fromDate: null,
        toDate: null,
        customerExternalId: 200,
        filtersJson: null,
        summaryJson: null,
        errorMessage: null,
        createdAt: new Date("2026-07-10T12:00:00.000Z"),
      }
    );

    assert.equal(detail.order?.pedido, "PD 02339");
    assert.equal(detail.order?.valorPedido, 158000);
    assert.equal(detail.orderItems.length, 4);

    const nfeLabels = detail.documentLinks.map((d) => d.nfeNumber).sort();
    assert.deepEqual(nfeLabels, ["6845", "7052", "7195"]);

    const headerSum = detail.documentLinks.reduce(
      (s, d) => s + (d.nfeHeaderValue ?? 0),
      0
    );
    assert.equal(headerSum, 108240 + 168075 + 78975);
    assert.ok(headerSum > 158000);

    const nfe6845 = detail.documentLinks.find((d) => d.nfeNumber === "6845");
    assert.ok(nfe6845);
    assert.deepEqual(nfe6845!.productsAllocated.sort((a, b) => a - b), [452, 455, 456]);

    const mismatches6845 = detail.allocations.filter(
      (a) => a.nfeNumber === "6845" && a.status === "PRICE_MISMATCH"
    );
    assert.equal(mismatches6845.length, 3);
    assert.ok(
      mismatches6845.every(
        (a) => a.orderUnitPrice === 5.85 && a.documentUnitPrice === 4.92
      )
    );

    const alloc537 = detail.allocations.find(
      (a) =>
        a.externalProductId === 537 &&
        a.nfeNumber === "7052" &&
        (a.allocatedQuantity ?? 0) > 0
    );
    assert.ok(alloc537);
    assert.equal(alloc537!.allocatedQuantity, 5000);
    assert.equal(alloc537!.documentQuantity, 10000);
    assert.equal(alloc537!.orderQuantity, 5000);

    const allocated452After6845 = detail.allocations.filter(
      (a) =>
        a.externalProductId === 452 &&
        a.nfeNumber !== "6845" &&
        (a.allocatedQuantity ?? 0) > 0
    );
    assert.equal(allocated452After6845.length, 0);

    const surplus7195 = detail.allocations.filter(
      (a) => a.nfeNumber === "7195" && a.status === "QUANTITY_SURPLUS_IN_NFE"
    );
    assert.ok(surplus7195.length >= 2);

    const notes = detail.managerNotes.join(" | ");
    assert.match(notes, /158\.000,00|158000/);
    assert.match(notes, /6845/);
    assert.match(notes, /7052/);
    assert.match(notes, /7195/);
    assert.match(notes, /4\.92|4,92/);
    assert.match(notes, /5\.85|5,85/);
    assert.match(notes, /não consome novamente|não é o valor do pedido/i);

    assert.ok(detail.timeline.some((e) => e.kind === "ORDER_ISSUE"));
    assert.ok(detail.timeline.some((e) => e.kind === "NFE"));
    assert.ok(detail.timeline.some((e) => e.kind === "STOCK_DOCUMENT"));
    assert.ok(detail.technical.nfeExternalIds.includes(6937));
    assert.ok(detail.technical.links.length > 0);
    assert.ok(detail.alertas.length > 0 || detail.managerNotes.length > 0);
  });

  it("trace sanitizado omite raw e drawer restringe JSON a admin (contrato)", () => {
    const engine = buildPortfolioReconciliationFacts({
      runId: "run-pd02339",
      mode: "preview",
      snapshot: pd02339Snapshot(),
    });
    const facts = engine.facts.map((draft, idx) =>
      portfolioFactDraftToApiRow(
        {
          ...draft,
          traceJson: { ...draft.traceJson, raw: { secret: true } },
        },
        `fact-${idx}`
      )
    );
    const detail = buildPortfolioOrderTraceViewModel(
      "3915fa28-1947-4388-bb27-2699c3cbb516",
      facts,
      null
    );
    assert.ok(detail.technical.sanitizedTraces.length > 0);
    assert.ok(
      detail.technical.sanitizedTraces.every((t) => t.trace?.raw === "[omitido]")
    );

    const drawer = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/portfolio-reconciliation/PortfolioReconciliationOrderDrawer.tsx"
      ),
      "utf8"
    );
    assert.match(drawer, /canViewPortfolioReconciliationTechnicalTrace/);
    assert.match(drawer, /portfolio-drawer-trace-restricted/);
    assert.match(drawer, /somente leitura/);
    assert.doesNotMatch(drawer, /onSave|contentEditable|method:\s*"POST"/);
  });
});
