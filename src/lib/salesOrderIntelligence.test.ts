import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildSalesOrderIntelligencePayload,
  buildSalesOrderRisksAndActions,
  isIntelligencePayloadFinite,
} from "./salesOrderIntelligence.js";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";

const REF = new Date(2026, 5, 15);

function orderFixture(overrides: {
  order?: Record<string, unknown>;
  referenceDate?: Date;
  requiresProduction?: boolean;
} = {}) {
  const baseOrder = {
    id: "so-1",
    orderCode: "PD 02580",
    status: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 4, 10),
    expectedDeliveryDate: new Date(2026, 5, 20),
    totalNetValue: 15000,
    responsible: "Vendedor A",
    companyIssuer: "Empresa 1",
    customer: { companyName: "Cliente X", taxId: "12.345.678/0001-99" },
    nomusRawResponse: {
      itensPedido: [
        {
          idProduto: 100,
          codigoProduto: "SKU-1",
          status: "Liberado",
          quantidade: 10,
          quantidadeAtendida: 8,
          quantidadeFaturada: 5,
        },
      ],
      nfes: [{ dataProcessamento: "12/06/2026", numero: "12345" }],
    },
    items: [
      {
        id: "item-1",
        externalProductId: 100,
        skuSnapshot: "SKU-1",
        productNameSnapshot: "Produto A",
        quantity: 10,
        unit: "UN",
      },
    ],
    ...(overrides.order ?? {}),
  };

  return {
    order: baseOrder,
    referenceDate: overrides.referenceDate ?? REF,
    requiresProduction: overrides.requiresProduction,
  };
}

describe("salesOrderIntelligence", () => {
  it("retorna payload básico do pedido", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.order.id, "so-1");
    assert.equal(payload.order.number, "PD 02580");
    assert.equal(payload.order.customerName, "Cliente X");
    assert.equal(payload.order.totalNetValue, 15000);
  });

  it("inclui lifecycle", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.ok(payload.lifecycle.operationalStatus);
    assert.equal(payload.lifecycle.salesOrderNumber, "PD 02580");
  });

  it("inclui timeline", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.ok(payload.timeline.length > 0);
    assert.ok(payload.timeline.some((e) => e.key === "created"));
  });

  it("inclui itens normalizados", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.items[0].normalizedStatus, "released");
    assert.equal(payload.items[0].orderedQuantity, 10);
  });

  it("inclui NF/faturamento", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.invoicing.hasInvoice, true);
    assert.ok(payload.invoicing.invoiceNumbers.includes("12345"));
    assert.equal(payload.invoicing.invoiceCount, 1);
    assert.equal(payload.invoices.length, 1);
    assert.equal(payload.invoices[0].number, "12345");
    assert.ok(payload.invoices[0].links.some((l) => l.label === "Ver no Faturamento"));
  });

  it("inclui status IndusCost e Nomus no pedido", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.order.statusIndusCost, "SENT_TO_NOMUS");
    assert.ok(payload.order.orderCode);
    assert.ok(payload.lifecycle.ruleTrace.length > 0);
  });

  it("itens incluem origem e quantidades auditadas", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.items[0].quantityOrdered, 10);
    assert.equal(payload.items[0].statusSource, "item_raw");
    assert.equal(payload.items[0].rawMatchedBy, "external_id");
  });

  it("inclui OP quando encontrada no raw", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }],
            ordensProducao: [{ numero: "OP-100", quantidadePlanejada: 10, quantidadeProduzida: 4 }],
          },
        },
      })
    );
    assert.equal(payload.production.hasLinkedProductionOrder, true);
    assert.equal(payload.production.productionOrders[0].source, "nomus_raw");
  });

  it("OP ausente gera warning", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture({ order: { nomusRawResponse: {} } }));
    assert.equal(payload.production.hasLinkedProductionOrder, false);
    assert.equal(payload.production.dataQuality.source, "not_available");
    assert.ok(
      payload.production.dataQuality.warnings.some((w) =>
        /OP não sincronizada\/disponível/i.test(w)
      )
    );
  });

  it("risco atrasado sem NF", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          expectedDeliveryDate: new Date(2026, 5, 1),
          nomusRawResponse: { itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }] },
        },
      })
    );
    assert.ok(payload.risks.some((r) => r.code === "overdue_without_invoice"));
  });

  it("risco NF após prazo", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          expectedDeliveryDate: new Date(2026, 5, 1),
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Atendido totalmente", quantidade: 10, quantidadeAtendida: 10, quantidadeFaturada: 10 }],
            nfes: [{ dataProcessamento: "15/06/2026", numero: "999" }],
          },
        },
      })
    );
    assert.ok(payload.risks.some((r) => r.code === "invoice_after_deadline"));
    const rule = payload.lifecycle.ruleTrace.find((r) => r.rule.includes("NF foi após prazo"));
    assert.equal(rule?.result, "Sim");
  });

  it("risco pedido parcial", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Atendido parcialmente", quantidade: 10, quantidadeAtendida: 4 }],
          },
        },
      })
    );
    assert.ok(payload.risks.some((r) => r.code === "partial_fulfillment"));
  });

  it("risco corte", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Atendido com corte", quantidade: 10 }],
          },
        },
      })
    );
    assert.ok(payload.risks.some((r) => r.code === "cut_fulfillment"));
  });

  it("risco sem OP quando exige produção", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({ requiresProduction: true, order: { nomusRawResponse: {} } })
    );
    assert.ok(payload.risks.some((r) => r.code === "missing_production_order"));
  });

  it("ações sugeridas ordenadas por prioridade", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          expectedDeliveryDate: new Date(2026, 5, 1),
          nomusRawResponse: { itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }] },
        },
      })
    );
    assert.ok(payload.suggestedActions.length > 0);
    for (let i = 1; i < payload.suggestedActions.length; i += 1) {
      assert.ok(payload.suggestedActions[i].priority >= payload.suggestedActions[i - 1].priority);
    }
  });

  it("não retorna NaN/Infinity", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(isIntelligencePayloadFinite(payload), true);
  });

  it("não usa Proposal", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/salesOrderIntelligence.ts"), "utf8");
    assert.doesNotMatch(src, /proposalId|Proposal/);
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.ok(!("proposal" in payload));
  });

  it("não inventa dados ausentes", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({ order: { nomusRawResponse: null, expectedDeliveryDate: null } })
    );
    assert.equal(payload.invoicing.hasInvoice, false);
    assert.equal(payload.production.hasLinkedProductionOrder, false);
    assert.ok(payload.dataQuality.warnings.length > 0);
  });

  it("buildSalesOrderRisksAndActions detecta divergência NF sem avanço do item", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-x",
      salesOrderNumber: "PD X",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 20),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }],
        nfes: [{ dataProcessamento: "12/06/2026", numero: "1" }],
      },
      items: [
        {
          id: "item-1",
          externalProductId: 100,
          skuSnapshot: "SKU-1",
          productNameSnapshot: "Produto",
          quantity: 10,
        },
      ],
    });
    const { risks } = buildSalesOrderRisksAndActions({ lifecycle, items });
    assert.ok(risks.some((r) => r.code === "invoice_without_item_progress"));
  });

  it("payload inclui status logístico e comparação com gerencial", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.ok(payload.logisticStatus.label);
    assert.ok(payload.logisticStatus.evidence);
    assert.equal(typeof payload.logisticVsExecutive.diverges, "boolean");
  });

  it("pedido com status item 6 mostra cancelado", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: 6, quantidade: 1, quantidadeCancelada: 1 }],
          },
        },
      })
    );
    assert.equal(payload.items[0].statusNormalized, "cancelled");
    assert.ok(payload.items[0].statusLabel?.includes("Cancelado"));
    assert.equal(payload.logisticStatus.label, "Finalizado/Cancelado");
  });

  it("pedido cancelado não sugere validar faturamento", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-2130",
      salesOrderNumber: "PD 02130",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 0, 23),
      expectedDeliveryDate: new Date(2026, 0, 23),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [
          {
            codigoProduto: "630.01AA",
            descricaoStatus: "Cancelado",
            quantidade: 1,
            quantidadeCancelada: 1,
          },
        ],
        nfes: [],
      },
      items: [
        {
          id: "item-1",
          externalProductId: 1,
          skuSnapshot: "630.01AA",
          productNameSnapshot: "Filtro",
          quantity: 1,
        },
      ],
    });
    const { risks, suggestedActions } = buildSalesOrderRisksAndActions({ lifecycle, items });
    assert.equal(risks.length, 0);
    assert.equal(suggestedActions[0]?.label, "Nenhuma ação necessária");
    assert.ok(!suggestedActions.some((a) => a.label === "Validar faturamento"));
  });
});
