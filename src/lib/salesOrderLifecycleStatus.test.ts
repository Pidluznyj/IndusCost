import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  normalizeSalesOrderItemNomusStatus,
  normalizeSalesOrderItemStatus,
  buildSalesOrderLifecycleSummary,
} from "./salesOrderLifecycleStatus.js";
import {
  extractSalesOrderItemRawField,
  extractSalesOrderRawField,
} from "./salesOrderNomusRaw.js";

const REF = new Date(2026, 5, 15);

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderId: "so-1",
    salesOrderNumber: "PD 02580",
    originalStatus: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 4, 10),
    expectedDeliveryDate: new Date(2026, 5, 20),
    referenceDate: REF,
    requiresProduction: false,
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

function rawTwoItems(
  a: { status: string; id?: number; extra?: Record<string, unknown> },
  b: { status: string; id?: number; extra?: Record<string, unknown> }
) {
  return {
    itensPedido: [
      {
        idProduto: a.id ?? 100,
        codigoProduto: "SKU-1",
        status: a.status,
        quantidade: 10,
        ...(a.extra ?? {}),
      },
      {
        idProduto: b.id ?? 200,
        codigoProduto: "SKU-2",
        status: b.status,
        quantidade: 5,
        ...(b.extra ?? {}),
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
      assert.equal(normalizeSalesOrderItemStatus(input), expected, input);
    }
  });

  it("aceita variações de acento, caixa e espaços extras", () => {
    assert.equal(normalizeSalesOrderItemStatus("  LIBERADO  "), "released");
    assert.equal(normalizeSalesOrderItemStatus("aguardando   liberacao"), "awaiting_release");
    assert.equal(normalizeSalesOrderItemStatus("ATENDIDO COM CORTE"), "fulfilled_with_cut");
    assert.equal(normalizeSalesOrderItemStatus(null), "unknown");
    assert.equal(normalizeSalesOrderItemStatus(undefined), "unknown");
    assert.equal(normalizeSalesOrderItemStatus(""), "unknown");
  });

  it("pedido aguardando liberação", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Aguardando liberação") })
    );
    assert.equal(lifecycle.operationalStatus, "awaiting_release");
    assert.equal(lifecycle.executiveStatusLabel, "Aguardando liberação");
    assert.equal(lifecycle.itemsAwaitingRelease, 1);
  });

  it("pedido liberado dentro do prazo", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Liberado") })
    );
    assert.equal(lifecycle.operationalStatus, "released");
    assert.equal(lifecycle.deadlineStatus, "on_time");
    assert.equal(lifecycle.executiveStatusLabel, "Liberado");
  });

  it("pedido liberado vencido sem NF = atrasado sem NF", () => {
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
    assert.ok(lifecycle.riskFlags.includes("partial_fulfillment"));
  });

  it("pedido atendido com corte", () => {
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

  it("pedido faturado parcialmente", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: {
          ...rawItem("Atendido parcialmente", { quantidadeAtendida: 5, quantidadeFaturada: 5 }),
          nfes: [{ dataProcessamento: "10/06/2026", numero: "123" }],
        },
      })
    );
    assert.equal(lifecycle.billingStatus, "partially_invoiced");
    assert.equal(lifecycle.operationalStatus, "partially_invoiced");
    assert.equal(lifecycle.hasInvoice, true);
    assert.match(lifecycle.executiveStatusLabel, /Faturado parcialmente/i);
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
    assert.equal(lifecycle.executiveStatusLabel, "Faturado total no prazo");
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
    assert.equal(lifecycle.executiveStatusLabel, "Faturado total com atraso");
  });

  it("pedido enviado", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Enviado", { quantidadeEnviada: 10 }) })
    );
    assert.equal(lifecycle.operationalStatus, "shipped");
    assert.equal(lifecycle.executiveStatusLabel, "Enviado");
  });

  it("pedido entregue", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Entregue", { quantidadeEntregue: 10 }) })
    );
    assert.equal(lifecycle.operationalStatus, "delivered");
    assert.equal(lifecycle.executiveStatusLabel, "Entregue");
  });

  it("pedido cancelado", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        originalStatus: "CANCELLED",
        nomusRawResponse: rawItem("Cancelado"),
      })
    );
    assert.equal(lifecycle.operationalStatus, "cancelled");
    assert.equal(lifecycle.completionStatus, "cancelled");
    assert.equal(lifecycle.executiveStatusLabel, "Cancelado");
  });

  it("pedido devolvido parcialmente", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Devolvido parcialmente") })
    );
    assert.equal(lifecycle.operationalStatus, "partially_returned");
    assert.equal(lifecycle.completionStatus, "mixed");
    assert.ok(lifecycle.riskFlags.includes("returned_items"));
  });

  it("pedido devolvido totalmente", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ nomusRawResponse: rawItem("Devolvido totalmente") })
    );
    assert.equal(lifecycle.operationalStatus, "fully_returned");
    assert.equal(lifecycle.completionStatus, "returned");
    assert.equal(lifecycle.executiveStatusLabel, "Devolvido totalmente");
  });

  it("pedido misto gera flag mixed_item_status", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        items: [
          {
            id: "item-1",
            externalProductId: 100,
            skuSnapshot: "SKU-1",
            productNameSnapshot: "Produto A",
            quantity: 10,
          },
          {
            id: "item-2",
            externalProductId: 200,
            skuSnapshot: "SKU-2",
            productNameSnapshot: "Produto B",
            quantity: 5,
          },
        ],
        nomusRawResponse: rawTwoItems(
          { status: "Liberado" },
          { status: "Atendido totalmente", extra: { quantidadeAtendida: 5 } }
        ),
      })
    );
    assert.ok(lifecycle.riskFlags.includes("mixed_item_status"));
    assert.equal(lifecycle.completionStatus, "mixed");
  });

  it("sem prazo gera warning", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ expectedDeliveryDate: null, nomusRawResponse: rawItem("Liberado") })
    );
    assert.equal(lifecycle.deadlineStatus, "no_due_date");
    assert.ok(lifecycle.riskFlags.includes("missing_due_date"));
    assert.equal(lifecycle.dataQuality.missingDueDate, true);
  });

  it("sem item status gera unknown_item_status", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: {
          itensPedido: [{ idProduto: 100, codigoProduto: "SKU-1", status: "XYZ desconhecido" }],
        },
      })
    );
    assert.ok(lifecycle.riskFlags.includes("unknown_item_status"));
    assert.equal(lifecycle.operationalStatus, "divergent");
  });

  it("percentuais não retornam NaN/Infinity", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        nomusRawResponse: rawItem("Atendido parcialmente", { quantidadeAtendida: 5 }),
      })
    );
    for (const n of [lifecycle.fulfilledPercent, lifecycle.invoicedPercent]) {
      if (n != null) {
        assert.ok(Number.isFinite(n));
        assert.ok(!Number.isNaN(n));
      }
    }
    const empty = buildSalesOrderLifecycleSummary(
      baseOrder({ items: [], nomusRawResponse: {} })
    ).lifecycle;
    assert.equal(empty.fulfilledPercent, null);
    assert.equal(empty.invoicedPercent, null);
  });

  it("não usa Proposal como fonte principal", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/salesOrderLifecycleStatus.ts"), "utf8");
    assert.doesNotMatch(src, /proposalId/i);
    assert.doesNotMatch(src, /Proposal/);
    const { lifecycle } = buildSalesOrderLifecycleSummary(baseOrder());
    assert.equal(lifecycle.salesOrderId, "so-1");
  });

  it("não usa hardcode por cliente, produto ou pedido", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/salesOrderLifecycleStatus.ts"), "utf8");
    assert.doesNotMatch(src, /PD 02580|Britania|Cliente X/i);
    const a = buildSalesOrderLifecycleSummary(
      baseOrder({ salesOrderNumber: "PD 99999", salesOrderId: "x-1" })
    ).lifecycle;
    const b = buildSalesOrderLifecycleSummary(
      baseOrder({ salesOrderNumber: "PD 00001", salesOrderId: "x-2" })
    ).lifecycle;
    assert.equal(a.operationalStatus, b.operationalStatus);
  });

  it("preserva status original Nomus sem sobrescrever", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({ originalStatus: "SENT_TO_NOMUS" })
    );
    assert.equal(lifecycle.originalStatus, "SENT_TO_NOMUS");
  });

  it("extractSalesOrderRawField e extractSalesOrderItemRawField são seguros", () => {
    const raw = {
      dataPrevisaoEntrega: "20/06/2026",
      itensPedido: [{ situacaoItem: "Liberado", quantidadeAtendida: 3 }],
    };
    assert.equal(extractSalesOrderRawField(raw, "expectedDeliveryDate"), "20/06/2026");
    assert.equal(
      extractSalesOrderItemRawField(raw.itensPedido[0], "status"),
      "Liberado"
    );
    assert.equal(extractSalesOrderItemRawField(raw.itensPedido[0], "quantityFulfilled"), 3);
    assert.equal(extractSalesOrderRawField(null, "status"), undefined);
    assert.equal(normalizeSalesOrderItemNomusStatus, normalizeSalesOrderItemStatus);
  });
});
