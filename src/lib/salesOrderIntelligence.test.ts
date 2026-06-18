import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderIntelligencePayload } from "./salesOrderIntelligence.js";

const REF = new Date(2026, 5, 15);

function orderFixture(overrides: {
  order?: Record<string, unknown>;
  referenceDate?: Date;
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
    customer: {
      companyName: "Cliente X",
      taxId: "12.345.678/0001-99",
    },
    nomusRawResponse: {
      itensPedido: [
        {
          idProduto: 100,
          codigoProduto: "SKU-1",
          nomeProduto: "Produto A",
          status: "Liberado",
          quantidade: 10,
          quantidadeAtendida: 8,
          quantidadeFaturada: 5,
        },
      ],
      nfes: [{ dataProcessamento: "12/06/2026", numero: "12345", serie: "1" }],
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
  };
}

describe("salesOrderIntelligence", () => {
  it("monta payload básico", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.order.id, "so-1");
    assert.equal(payload.order.number, "PD 02580");
    assert.equal(payload.order.customerName, "Cliente X");
    assert.ok(payload.lifecycle);
    assert.ok(Array.isArray(payload.timeline));
  });

  it("inclui itens com status normalizado", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].normalizedStatus, "released");
    assert.equal(payload.items[0].orderedQuantity, 10);
  });

  it("inclui NF quando presente no raw", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    assert.equal(payload.invoicing.hasInvoice, true);
    assert.ok(payload.invoicing.invoiceNumbers.includes("12345"));
    assert.equal(payload.invoicing.invoiceCount, 1);
  });

  it("OP encontrada no raw", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }],
            ordensProducao: [
              {
                numero: "OP-100",
                status: "Em produção",
                quantidadePlanejada: 10,
                quantidadeProduzida: 4,
              },
            ],
          },
        },
      })
    );
    assert.equal(payload.production.hasLinkedProductionOrder, true);
    assert.equal(payload.production.productionOrders.length, 1);
    assert.equal(payload.production.productionOrders[0].number, "OP-100");
    assert.equal(payload.production.dataQuality.source, "nomus_raw");
  });

  it("OP indisponível gera warning", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({ order: { nomusRawResponse: {} } })
    );
    assert.equal(payload.production.hasLinkedProductionOrder, false);
    assert.equal(payload.production.dataQuality.source, "not_available");
    assert.ok(
      payload.production.dataQuality.warnings.some((w) => /OP não sincronizada/i.test(w))
    );
  });

  it("gera riscos para pedido atrasado sem NF", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          expectedDeliveryDate: new Date(2026, 5, 1),
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }],
          },
        },
      })
    );
    assert.ok(payload.risks.some((r) => r.code === "overdue_without_invoice"));
  });

  it("gera ações sugeridas", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: {
          expectedDeliveryDate: new Date(2026, 5, 1),
          nomusRawResponse: {
            itensPedido: [{ idProduto: 100, status: "Liberado", quantidade: 10 }],
          },
        },
      })
    );
    assert.ok(payload.suggestedActions.length > 0);
    assert.ok(payload.suggestedActions.every((a) => a.priority >= 1));
  });

  it("não usa Proposal como base principal", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({ order: { proposalId: "prop-1" } as Record<string, unknown> })
    );
    assert.equal(payload.order.id, "so-1");
    assert.ok(!("proposal" in payload));
  });

  it("não inventa dados ausentes", () => {
    const payload = buildSalesOrderIntelligencePayload(
      orderFixture({
        order: { nomusRawResponse: null, expectedDeliveryDate: null },
      })
    );
    assert.equal(payload.invoicing.hasInvoice, false);
    assert.equal(payload.production.hasLinkedProductionOrder, false);
    assert.ok(payload.dataQuality.warnings.length > 0);
  });

  it("percentuais sem NaN/Infinity", () => {
    const payload = buildSalesOrderIntelligencePayload(orderFixture());
    const nums = [
      payload.lifecycle.fulfilledPercent,
      payload.lifecycle.invoicedPercent,
      payload.invoicing.invoicedPercent,
    ];
    for (const n of nums) {
      if (n != null) {
        assert.ok(Number.isFinite(n));
        assert.ok(!Number.isNaN(n));
      }
    }
  });
});
