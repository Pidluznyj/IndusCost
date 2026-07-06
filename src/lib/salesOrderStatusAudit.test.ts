import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceBillingLink,
  buildIntelligenceInvoices,
  buildLifecycleRuleTrace,
  buildRawDataPreview,
  enrichIntelligenceItems,
  extractNomusHeaderStatusRaw,
  isAuditPayloadSerializable,
} from "./salesOrderStatusAudit.js";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import { buildSalesOrderIntelligencePayload } from "./salesOrderIntelligence.js";

const REF = new Date(2026, 5, 15);

describe("salesOrderStatusAudit", () => {
  it("extrai status de cabeçalho do raw Nomus", () => {
    assert.equal(extractNomusHeaderStatusRaw({ situacao: "Liberado" }), "Liberado");
    assert.equal(extractNomusHeaderStatusRaw({}), null);
  });

  it("buildLifecycleRuleTrace inclui regras de NF e prazo", () => {
    const { lifecycle, items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-1",
      salesOrderNumber: "PD 1",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 1),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 10 }],
      },
      items: [
        {
          id: "i1",
          externalProductId: 1,
          skuSnapshot: "A",
          productNameSnapshot: "Prod",
          quantity: 10,
        },
      ],
    });
    const trace = buildLifecycleRuleTrace({ lifecycle, items, hasInvoice: false });
    assert.ok(trace.some((t) => t.rule.includes("NF processada")));
    assert.ok(trace.some((t) => t.rule.includes("Previsão vencida")));
  });

  it("buildIntelligenceInvoices retorna chave, número e link faturamento", () => {
    const invoices = buildIntelligenceInvoices({
      nfes: [
        {
          numero: "555",
          serie: "1",
          chaveAcesso: "35260123456789012345678901234567890123456789",
          dataProcessamento: "15/06/2026",
          valor: 1000,
        },
      ],
    });
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].number, "555");
    assert.equal(invoices[0].accessKey?.length, 44);
    assert.ok(invoices[0].links.some((l) => l.label === "Ver no Faturamento"));
    assert.ok(invoices[0].links.some((l) => l.type === "copy"));
  });

  it("buildFinanceBillingLink inclui documentNumber quando informado", () => {
    assert.equal(buildFinanceBillingLink("123"), "/finance/billing?documentNumber=123");
    assert.equal(buildFinanceBillingLink(), "/finance/billing");
  });

  it("enrichIntelligenceItems retorna statusSource e rawMatchedBy", () => {
    const { items } = buildSalesOrderLifecycleSummary({
      salesOrderId: "so-1",
      salesOrderNumber: "PD 1",
      originalStatus: "SENT_TO_NOMUS",
      issueDate: new Date(2026, 4, 1),
      expectedDeliveryDate: new Date(2026, 5, 20),
      referenceDate: REF,
      nomusRawResponse: {
        itensPedido: [{ idProduto: 100, status: 6, quantidade: 1, quantidadeCancelada: 1 }],
      },
      items: [
        {
          id: "i1",
          externalProductId: 100,
          skuSnapshot: "SKU",
          productNameSnapshot: "Prod",
          quantity: 1,
        },
      ],
    });
    const enriched = enrichIntelligenceItems({
      items,
      dbItems: [
        {
          id: "i1",
          externalProductId: 100,
          skuSnapshot: "SKU",
          productNameSnapshot: "Prod",
        },
      ],
      nomusRawResponse: {
        itensPedido: [{ idProduto: 100, status: 6, quantidade: 1, quantidadeCancelada: 1 }],
      },
    });
    assert.equal(enriched[0].statusNormalized, "cancelled");
    assert.equal(enriched[0].rawMatchedBy, "external_id");
    assert.equal(enriched[0].statusSource, "item_raw");
    assert.ok(enriched[0].statusLabel?.includes("Cancelado"));
  });

  it("buildRawDataPreview limita e marca truncamento", () => {
    const big: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) big[`k${i}`] = i;
    const preview = buildRawDataPreview(big);
    assert.equal(preview.orderRawAvailable, true);
    assert.ok(preview.orderRawKeys.length >= 60);
    assert.ok(preview.previewTruncated);
  });

  it("payload de inteligência é serializável sem BigInt", () => {
    const payload = buildSalesOrderIntelligencePayload({
      order: {
        id: "so-1",
        orderCode: "PD 1",
        status: "SENT_TO_NOMUS",
        totalNetValue: 100,
        nomusRawResponse: {
          itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 1 }],
          nfes: [{ numero: "1", dataProcessamento: "12/06/2026" }],
        },
        items: [
          {
            id: "i1",
            externalProductId: 1,
            skuSnapshot: "A",
            productNameSnapshot: "P",
            quantity: 1,
          },
        ],
      },
      referenceDate: REF,
    });
    assert.ok(payload.lifecycle.ruleTrace.length > 0);
    assert.ok(payload.invoices.length > 0);
    assert.ok(payload.rawData.orderRawAvailable);
    assert.ok(payload.audit.generatedAt);
    assert.equal(isAuditPayloadSerializable(payload), true);
  });

  it("pedido sem NF mostra ausência na ruleTrace", () => {
    const payload = buildSalesOrderIntelligencePayload({
      order: {
        id: "so-2",
        orderCode: "PD 2",
        status: "SENT_TO_NOMUS",
        totalNetValue: 50,
        expectedDeliveryDate: new Date(2026, 5, 1),
        nomusRawResponse: {
          itensPedido: [{ idProduto: 1, status: "Liberado", quantidade: 2 }],
        },
        items: [
          {
            id: "i1",
            externalProductId: 1,
            skuSnapshot: "A",
            productNameSnapshot: "P",
            quantity: 2,
          },
        ],
      },
      referenceDate: REF,
    });
    const nfRule = payload.lifecycle.ruleTrace.find((r) => r.rule.includes("NF processada"));
    assert.equal(nfRule?.result, "Não");
    assert.equal(payload.invoices.length, 0);
  });
});
