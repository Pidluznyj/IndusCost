import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { buildSalesOrderTimeline } from "./salesOrderLifecycleTimeline.js";

const REF = new Date(2026, 5, 15);

describe("salesOrderLifecycleTimeline", () => {
  it("monta timeline com eventos principais", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-1",
      salesOrderNumber: "PD 100",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 20),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [
          {
            idProduto: 1,
            status: "Liberado",
            quantidade: 5,
          },
        ],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "55" }],
      },
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "P1",
          productNameSnapshot: "Produto",
          quantity: 5,
        },
      ],
    });

    const timeline = buildSalesOrderTimeline({
      lifecycle,
      items,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 5 }],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "55" }],
      },
      referenceDate: REF,
    });

    const keys = timeline.map((e) => e.key);
    assert.ok(keys.includes("created"));
    assert.ok(keys.includes("released"));
    assert.ok(keys.includes("due_date"));
    assert.ok(keys.includes("invoiced"));
    assert.equal(timeline.find((e) => e.key === "created")?.status, "done");
  });

  it("marca NF como late quando após prazo", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-2",
      salesOrderNumber: "PD 200",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 1),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 1 }],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "10" }],
      },
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "P1",
          productNameSnapshot: "Produto",
          quantity: 1,
        },
      ],
    });

    const timeline = buildSalesOrderTimeline({ lifecycle, items, referenceDate: REF });
    const invoiced = timeline.find((e) => e.key === "invoiced");
    assert.equal(invoiced?.status, "late");
  });

  it("marca OP como warning quando ausente", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-3",
      salesOrderNumber: "PD 300",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 20),
      referenceDate: REF,
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "P1",
          productNameSnapshot: "Produto",
          quantity: 1,
        },
      ],
    });
    const timeline = buildSalesOrderTimeline({ lifecycle, items, referenceDate: REF });
    const op = timeline.find((e) => e.key === "production_order");
    assert.ok(op?.status === "warning" || op?.status === "pending");
  });

  it("inclui cancelado quando pedido cancelado", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-4",
      salesOrderNumber: "PD 400",
      originalStatus: "CANCELLED",
      issueDate: new Date(2026, 4, 1),
      referenceDate: REF,
      items: [],
    });
    const timeline = buildSalesOrderTimeline({ lifecycle, items, referenceDate: REF });
    assert.ok(timeline.some((e) => e.key === "cancelled"));
  });
});
