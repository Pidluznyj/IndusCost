import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSalesOrderBiLogisticStatus } from "./salesOrderLogisticStatus.js";
import { buildSalesOrderLifecycleSummary } from "./salesOrderLifecycleStatus.js";
import {
  buildSalesOrderLinkedNfeContext,
  computeAverageLinkedNfeSlaDays,
  isInvoiceCoverageComplete,
} from "./salesOrderLinkedNfe.js";

const REF = new Date(2026, 5, 20);

function linkedContext(input: {
  links: Array<{
    id: string;
    nfeExternalId: number;
    nfeNumber?: string;
    dataProcessamento: Date;
    value: number;
  }>;
  totalNetValue: number;
  expectedDeliveryDate: Date;
  issueDate?: Date;
}) {
  return buildSalesOrderLinkedNfeContext({
    links: input.links.map((link) => ({
      id: link.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber ?? String(link.nfeExternalId),
      nfeKey: null,
      nfeStatus: 100,
      tipoOperacao: 1,
      dataProcessamento: link.dataProcessamento,
      presentInLastPayload: true,
      nomusNfeId: null,
      rawPayload: { valor: link.value },
    })),
    nomusNfesByExternalId: new Map(
      input.links.map((link) => [
        link.nfeExternalId,
        {
          id: `nomus-${link.nfeExternalId}`,
          externalId: link.nfeExternalId,
          numero: link.nfeNumber ?? String(link.nfeExternalId),
          chave: null,
          status: 100,
          tipoOperacao: 1,
          dataProcessamento: link.dataProcessamento,
          xmlDhEmi: null,
          valorLiquido: link.value,
          xmlVNF: link.value,
        },
      ])
    ),
    totalNetValue: input.totalNetValue,
    issueDate: input.issueDate ?? new Date(2026, 5, 1),
    expectedDeliveryDate: input.expectedDeliveryDate,
    referenceDate: REF,
  });
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    salesOrderId: "so-1",
    salesOrderNumber: "PD-001",
    originalStatus: "SENT_TO_NOMUS",
    issueDate: new Date(2026, 5, 1),
    expectedDeliveryDate: new Date(2026, 5, 25),
    totalNetValue: 1000,
    nomusRawResponse: {
      itensPedido: [{ status: 2, quantidade: 10 }],
      nfes: [],
    },
    items: [{ id: "item-1", skuSnapshot: "SKU-1", productNameSnapshot: "Produto", quantity: 10 }],
    referenceDate: REF,
    ...overrides,
  };
}

describe("salesOrderLinkedNfe motor", () => {
  it("preserva status existentes quando dados equivalentes via raw fallback", () => {
    const raw = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 25),
      nomusRawResponse: {
        nfes: [{ id: 1, dataProcessamento: "20/06/2026", numero: "100" }],
        itensPedido: [{ status: 2, quantidade: 10 }],
      },
      referenceDate: REF,
      totalNetValue: 1000,
    });
    const linked = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 25),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
      linkedNfeContext: linkedContext({
        links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 1000 }],
        totalNetValue: 1000,
        expectedDeliveryDate: new Date(2026, 5, 25),
      }),
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(raw.label, "Entregue no Prazo");
    assert.equal(linked.label, "Entregue no Prazo");
  });

  it("pedido sem NF e prazo futuro = pendente no prazo", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 6, 1),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 5 }] },
      linkedNfeContext: linkedContext({
        links: [],
        totalNetValue: 500,
        expectedDeliveryDate: new Date(2026, 6, 1),
      }),
      referenceDate: REF,
      totalNetValue: 500,
    });
    assert.equal(result.label, "No Prazo (Pendente)");
  });

  it("pedido sem NF e prazo passado = atrasado pendente", () => {
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 10),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 5 }] },
      linkedNfeContext: linkedContext({
        links: [],
        totalNetValue: 500,
        expectedDeliveryDate: new Date(2026, 5, 10),
      }),
      referenceDate: REF,
      totalNetValue: 500,
    });
    assert.equal(result.label, "Atrasado (Pendente)");
  });

  it("pedido com NF total até o prazo = entregue/faturado no prazo", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 24), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 25),
      linkedNfeContext: ctx,
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(result.label, "Entregue no Prazo");
  });

  it("pedido com NF total depois do prazo = entrega/faturamento com atraso", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 26), value: 1000 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 25),
      linkedNfeContext: ctx,
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(result.label, "Entregue com Atraso");
  });

  it("pedido com NF parcial antes do prazo = pendente no prazo", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 18), value: 400 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 25),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
      linkedNfeContext: ctx,
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(result.label, "No Prazo (Pendente)");
    assert.equal(ctx.isPartiallyInvoiced, true);
  });

  it("pedido com NF parcial depois do prazo = atrasado pendente", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 12), value: 400 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 10),
    });
    const result = buildSalesOrderBiLogisticStatus({
      expectedDeliveryDate: new Date(2026, 5, 10),
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
      linkedNfeContext: ctx,
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(result.label, "Atrasado (Pendente)");
  });

  it("pedido cancelado não entra como atraso operacional", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        originalStatus: "CANCELLED",
        nomusRawResponse: { itensPedido: [{ status: 6, quantidade: 10 }] },
        linkedNfeContext: linkedContext({
          links: [],
          totalNetValue: 1000,
          expectedDeliveryDate: new Date(2026, 5, 1),
        }),
      })
    );
    assert.equal(lifecycle.operationalStatus, "cancelled");
    assert.equal(lifecycle.deadlineStatus, "unknown");
  });

  it("pedido sem data planejada vai para revisar dados", () => {
    const result = buildSalesOrderBiLogisticStatus({
      nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
      referenceDate: REF,
      totalNetValue: 1000,
    });
    assert.equal(result.label, "Revisar dados");
  });

  it("pedido com múltiplas NF-es soma valor sem duplicar pedido", () => {
    const ctx = linkedContext({
      links: [
        { id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 600 },
        { id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 22), value: 400 },
      ],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    assert.equal(ctx.nfeCount, 2);
    assert.equal(ctx.nfeTotalValue, 1000);
    assert.equal(ctx.isFullyInvoiced, true);
    assert.equal(ctx.lastNfeProcessingDate?.getDate(), 22);
  });

  it("percentual de faturamento não multiplica por itens", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        linkedNfeContext: linkedContext({
          links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 500 }],
          totalNetValue: 1000,
          expectedDeliveryDate: new Date(2026, 5, 25),
        }),
      })
    );
    assert.equal(lifecycle.invoiceCoveragePercent, 50);
    assert.equal(lifecycle.invoicedPercent, 50);
  });

  it("NF maior que pedido gera alerta/revisar divergência", () => {
    const ctx = linkedContext({
      links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 20), value: 1500 }],
      totalNetValue: 1000,
      expectedDeliveryDate: new Date(2026, 5, 25),
    });
    assert.equal(ctx.hasValueDivergence, true);
    assert.ok(ctx.reviewReasons.some((reason) => reason.includes("excede")));
  });

  it("SLA médio consegue ser calculado com base nos campos derivados", () => {
    const contexts = [
      linkedContext({
        links: [{ id: "l1", nfeExternalId: 1, dataProcessamento: new Date(2026, 5, 10), value: 1000 }],
        totalNetValue: 1000,
        expectedDeliveryDate: new Date(2026, 5, 25),
        issueDate: new Date(2026, 5, 1),
      }),
      linkedContext({
        links: [{ id: "l2", nfeExternalId: 2, dataProcessamento: new Date(2026, 5, 15), value: 800 }],
        totalNetValue: 800,
        expectedDeliveryDate: new Date(2026, 5, 25),
        issueDate: new Date(2026, 5, 1),
      }),
    ];
    const avg = computeAverageLinkedNfeSlaDays(contexts);
    assert.equal(avg, 11.5);
  });

  it("OP inexistente não quebra cálculo", () => {
    const { lifecycle } = buildSalesOrderLifecycleSummary(
      baseOrder({
        requiresProduction: true,
        nomusRawResponse: { itensPedido: [{ status: 2, quantidade: 10 }] },
        linkedNfeContext: linkedContext({
          links: [],
          totalNetValue: 1000,
          expectedDeliveryDate: new Date(2026, 6, 1),
        }),
      })
    );
    assert.equal(lifecycle.hasLinkedProductionOrder, false);
    assert.ok(lifecycle.riskFlags.includes("missing_production_order"));
  });

  it("tolerância de 100% considera cobertura completa", () => {
    assert.equal(isInvoiceCoverageComplete(1000, 1000), true);
    assert.equal(isInvoiceCoverageComplete(999.5, 1000), true);
    assert.equal(isInvoiceCoverageComplete(900, 1000), false);
  });
});
