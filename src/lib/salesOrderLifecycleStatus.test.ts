import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSalesOrderItemNomusStatus, buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";

const REF = new Date(2026, 5, 15);

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderId: "so-1",
    salesOrderNumber: "PD 02580",
    originalStatus: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 4, 10),
    expectedDeliveryDate: new Date(2026, 5, 20),
    referenceDate: REF,
    items: [
      {
        id: "item-1",
        externalProductId: 100,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto A",
        quantity: 10,
      },
    ],
    ...overrides,
  };
}

function rawItem(status: string, extra: Record<string, unknown> = {}) {
  return {
    itensPedido: [
      {
        idProduto: 100,
        codigoProduto: "SKU-1",
        status,
        quantidade: 10,
        ...extra,
      },
    ],
  };
}

describe("salesOrderLifecycleStatus", () => {
  it("normaliza todos os status originais dos itens", () => {
    const cases: Array<[string, string]> = [
      ["Aguardando liberação", "awaiting_release"],
      ["Liberado", "released"],
      ["Atendido com corte", "fulfilled_with_cut"],
      ["Atendido parcialmente", "partially_fulfilled"],
      ["Atendido totalmente", "fully_fulfilled"],
      ["Cancelado", "cancelled"],
      ["Devolvido parcialmente", "partially_returned"],
      ["Devolvido totalmente", "fully_returned"],
      ["Enviado", "shipped"],
      ["Entregue", "delivered"],
    ];
    for (const [input, expected] of cases) {
      assert.equal(normalizeSalesOrderItemNomusStatus(input), expected, input);
    }
  });

  it("pedido aguardando liberação", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Aguardando liberação") })
    );
    assert.equal(lifecycle.operationalStatus, "awaiting_release");
    assert.equal(lifecycle.itemsAwaitingRelease, 1);
  });

  it("pedido liberado dentro do prazo", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Liberado") })
    );
    assert.equal(lifecycle.operationalStatus, "released");
    assert.equal(lifecycle.deadlineStatus, "on_time");
  });

  it("pedido atrasado sem NF", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        expectedDeliveryDate: new Date(2026, 5, 1),
        nomusRawResponse: rawItem("Liberado"),
      })
    );
    assert.equal(lifecycle.deadlineStatus, "overdue");
    assert.ok(lifecycle.riskFlags.includes("overdue_without_invoice"));
    assert.match(lifecycle.executiveStatusLabel, /Atrasado sem NF/i);
  });

  it("pedido atendido parcialmente", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: rawItem("Atendido parcialmente", { quantidadeAtendida: 4 }),
      })
    );
    assert.equal(lifecycle.operationalStatus, "partially_fulfilled");
    assert.equal(lifecycle.completionStatus, "partial");
  });

  it("pedido com corte", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Atendido com corte", { quantidadeAtendida: 8 }) })
    );
    assert.equal(lifecycle.operationalStatus, "fulfilled_with_cut");
    assert.ok(lifecycle.riskFlags.includes("cut_fulfillment"));
  });

  it("pedido atendido totalmente", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: rawItem("Atendido totalmente", { quantidadeAtendida: 10 }),
      })
    );
    assert.equal(lifecycle.operationalStatus, "fully_fulfilled");
    assert.equal(lifecycle.completionStatus, "complete");
  });

  it("pedido faturado parcial", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: {
          ...rawItem("Atendido parcialmente", { quantidadeAtendida: 5, quantidadeFaturada: 5 }),
          nfes: [{ dataProcessamento: "10/06/2026", numero: "123" }],
        },
      })
    );
    assert.equal(lifecycle.billingStatus, "partially_invoiced");
    assert.equal(lifecycle.hasInvoice, true);
  });

  it("pedido faturado total no prazo", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: {
          ...rawItem("Atendido totalmente", { quantidadeAtendida: 10, quantidadeFaturada: 10 }),
          nfes: [{ dataProcessamento: "20/06/2026", numero: "456" }],
        },
      })
    );
    assert.equal(lifecycle.billingStatus, "fully_invoiced");
    assert.equal(lifecycle.deadlineStatus, "invoiced_on_time");
  });

  it("pedido faturado total com atraso", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        expectedDeliveryDate: new Date(2026, 5, 1),
        nomusRawResponse: {
          ...rawItem("Atendido totalmente", { quantidadeAtendida: 10, quantidadeFaturada: 10 }),
          nfes: [{ dataProcessamento: "15/06/2026", numero: "789" }],
        },
      })
    );
    assert.equal(lifecycle.deadlineStatus, "invoiced_late");
    assert.ok(lifecycle.riskFlags.includes("invoice_after_deadline"));
  });

  it("pedido enviado", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Enviado", { quantidadeEnviada: 10 }) })
    );
    assert.equal(lifecycle.operationalStatus, "shipped");
  });

  it("pedido entregue", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Entregue", { quantidadeEntregue: 10 }) })
    );
    assert.equal(lifecycle.operationalStatus, "delivered");
  });

  it("pedido cancelado", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        originalStatus: "CANCELLED",
        nomusRawResponse: rawItem("Cancelado"),
      })
    );
    assert.equal(lifecycle.operationalStatus, "cancelled");
  });

  it("pedido devolvido parcial", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Devolvido parcialmente") })
    );
    assert.equal(lifecycle.operationalStatus, "partially_returned");
  });

  it("pedido devolvido total", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Devolvido totalmente") })
    );
    assert.equal(lifecycle.operationalStatus, "fully_returned");
  });

  it("NF após prazo gera flag", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        expectedDeliveryDate: new Date(2026, 4, 1),
        nomusRawResponse: {
          nfes: [{ dataProcessamento: "15/06/2026", numero: "999" }],
          ...rawItem("Liberado"),
        },
      })
    );
    assert.ok(lifecycle.riskFlags.includes("invoice_after_deadline"));
  });

  it("sem prazo gera warning", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ expectedDeliveryDate: null, nomusRawResponse: rawItem("Liberado") })
    );
    assert.equal(lifecycle.deadlineStatus, "no_due_date");
    assert.ok(lifecycle.riskFlags.includes("missing_due_date"));
  });

  it("percentuais sem NaN", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: rawItem("Atendido parcialmente", { quantidadeAtendida: 5 }),
      })
    );
    if (lifecycle.fulfilledPercent != null) assert.ok(Number.isFinite(lifecycle.fulfilledPercent));
    if (lifecycle.invoicedPercent != null) assert.ok(Number.isFinite(lifecycle.invoicedPercent));
  });

  it("preserva status original Nomus sem sobrescrever", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ originalStatus: "SENT_TO_NOMUS" })
    );
    assert.equal(lifecycle.originalStatus, "SENT_TO_NOMUS");
  });
});
