import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { buildSalesOrderTimeline } from "./salesOrderLifecycleTimeline.js";

const REF = new Date(2026, 5, 15);

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderId: "so-1",
    salesOrderNumber: "PD 100",
    originalStatus: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 4, 1),
    expectedDeliveryDate: new Date(2026, 5, 20),
    referenceDate: REF,
    requiresProduction: false,
    items: [
      {
        id: "i1",
        externalProductId: 1,
        skuSnapshot: "P1",
        productNameSnapshot: "Produto",
        quantity: 5,
      },
    ],
    ...overrides,
  };
}

function buildTimeline(overrides: Record<string, unknown> = {}) {
  const input = { ...baseInput(), ...overrides };
  const ref = (input.referenceDate as Date | undefined) ?? REF;
  const { lifecycle, items } = buildSalesOrderLifecycleSummary({ ...input, referenceDate: ref });
  return buildSalesOrderTimeline({
    lifecycle,
    items,
    nomusRawResponse: overrides.nomusRawResponse,
    referenceDate: ref,
    requiresProduction: input.requiresProduction as boolean | undefined,
  });
}

describe("salesOrderLifecycleTimeline", () => {
  it("pedido emitido cria evento created", () => {
    const timeline = buildTimeline();
    const created = timeline.find((e) => e.key === "created");
    assert.equal(created?.status, "done");
    assert.ok(created?.date);
  });

  it("pedido com prazo cria evento due_date", () => {
    const timeline = buildTimeline();
    const due = timeline.find((e) => e.key === "due_date");
    assert.ok(due);
    assert.equal(due?.date, "2026-06-20");
  });

  it("prazo vencido sem NF marca late", () => {
    const timeline = buildTimeline({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 5 }],
      },
    });
    const due = timeline.find((e) => e.key === "due_date");
    assert.equal(due?.status, "late");
  });

  it("NF antes do prazo marca done", () => {
    const timeline = buildTimeline({
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 5 }],
        nfes: [{ dataProcessamento: "10/06/2026", numero: "55" }],
      },
    });
    const invoiced = timeline.find((e) => e.key === "invoiced");
    assert.equal(invoiced?.status, "done");
  });

  it("NF depois do prazo marca late", () => {
    const timeline = buildTimeline({
      expectedDeliveryDate: new Date(2026, 5, 1),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 1 }],
        nfes: [{ dataProcessamento: "15/06/2026", numero: "10" }],
      },
    });
    const invoiced = timeline.find((e) => e.key === "invoiced");
    assert.equal(invoiced?.status, "late");
  });

  it("pedido entregue cria evento delivered", () => {
    const timeline = buildTimeline({
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Entregue", quantidade: 5, quantidadeEntregue: 5 }],
      },
    });
    const delivered = timeline.find((e) => e.key === "delivered");
    assert.equal(delivered?.status, "done");
  });

  it("pedido cancelado cria evento cancelled", () => {
    const timeline = buildTimeline({
      originalStatus: "CANCELLED",
      items: [],
    });
    assert.ok(timeline.some((e) => e.key === "cancelled"));
  });

  it("OP existente cria evento production_order", () => {
    const timeline = buildTimeline({
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 5 }],
        ordensProducao: [{ numero: "OP-10", dataAbertura: "05/06/2026" }],
      },
    });
    const op = timeline.find((e) => e.key === "production_order");
    assert.equal(op?.status, "done");
  });

  it("OP atrasada cria evento late", () => {
    const timeline = buildTimeline({
      referenceDate: new Date(2026, 5, 20),
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 5 }],
        ordensProducao: [
          {
            numero: "OP-20",
            dataPrazo: "01/06/2026",
            status: "Em produção",
          },
        ],
      },
    });
    const op = timeline.find((e) => e.key === "production_order");
    assert.equal(op?.status, "late");
  });

  it("sem OP disponível gera warning quando exige produção", () => {
    const timeline = buildTimeline({ requiresProduction: true });
    const op = timeline.find((e) => e.key === "production_order");
    assert.equal(op?.status, "warning");
  });
});
