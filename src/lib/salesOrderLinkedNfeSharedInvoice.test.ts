/**
 * Status de faturamento: evidência fiscal (NF válida) × cobertura da obrigação
 * ativa por item (`SalesOrderItemFlowSnapshot`).
 *
 * Casos reais de homologação:
 *   - PD 02959: NF 272.238,00 com itens de vários pedidos; pedido 107.508,00.
 *   - PD 02312: 13.620,00 com 4.120,00 de itens cancelados; NF 9.500,00.
 *   - PD 02207: 197.030,00 com 125.625,00 cancelados; NF 71.405,00.
 *   - PD 02123: pedido 3.513,57; vNF 3.753,57 (frete 240,00 + IPI 0,87).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderLinkedNfeContext,
  resolveSharedNfeExternalIds,
} from "./salesOrderLinkedNfe.js";
import {
  resolveItemizedBillingCoverage,
  resolveSalesOrderBillingDecision,
  type ItemizedBillingItemInput,
} from "./sales/salesOrderItemizedBillingCoverage.js";
import {
  resolveSalesOrderBillingStatusFromContext,
  type SalesOrderBillingStatus,
} from "./sales/salesOrderListBillingStatus.js";
import { mapSalesOrderDetailBillingStatus } from "./sales-orders/salesOrderDetailService.server.js";

const REF = new Date(2026, 8, 30);
const NFE_STATUS_AUTHORIZED = 100;
const NFE_STATUS_CANCELED = 7;

type NfeFixture = {
  externalId: number;
  /** Cabeçalho da NF (xmlVNF). */
  headerValue: number;
  status?: number;
};

type ItemFixture = {
  ordered: number;
  invoiced: number;
  /** Quantidade cortada (reduz a obrigação ativa). */
  cut?: number;
  /** Item cancelado no Nomus. */
  canceled?: boolean;
};

function itemSnapshots(items: ItemFixture[]): ItemizedBillingItemInput[] {
  return items.map((item, index) => ({
    salesOrderItemId: `item-${index + 1}`,
    isActiveForKanban: !item.canceled,
    currentStage: item.canceled ? "CANCELED" : "SHIPPED_COMPLETED",
    orderedQuantity: item.ordered,
    shipTargetQuantity: item.canceled ? 0 : item.ordered - (item.cut ?? 0),
    invoicedQuantity: item.invoiced,
  }));
}

function context(input: {
  totalNetValue: number;
  nfes: NfeFixture[];
  sharedNfeExternalIds?: number[];
  /** Snapshots por item; undefined = pedido sem snapshot. */
  items?: ItemFixture[];
  /** Quantidade de SalesOrderItem do pedido; padrão = itens informados. */
  expectedItemCount?: number;
}) {
  const processedAt = new Date(2026, 8, 10);
  return buildSalesOrderLinkedNfeContext({
    links: input.nfes.map((nfe) => ({
      id: `link-${nfe.externalId}`,
      nfeExternalId: nfe.externalId,
      nfeNumber: String(nfe.externalId),
      nfeKey: null,
      nfeStatus: nfe.status ?? NFE_STATUS_AUTHORIZED,
      tipoOperacao: 1,
      dataProcessamento: processedAt,
      presentInLastPayload: true,
      nomusNfeId: null,
    })),
    nomusNfesByExternalId: new Map(
      input.nfes.map((nfe) => [
        nfe.externalId,
        {
          id: `nomus-${nfe.externalId}`,
          externalId: nfe.externalId,
          numero: String(nfe.externalId),
          chave: null,
          status: nfe.status ?? NFE_STATUS_AUTHORIZED,
          tipoOperacao: 1,
          dataProcessamento: processedAt,
          xmlDhEmi: null,
          valorLiquido: nfe.headerValue,
          xmlVNF: nfe.headerValue,
        },
      ])
    ),
    totalNetValue: input.totalNetValue,
    issueDate: new Date(2026, 7, 31),
    expectedDeliveryDate: new Date(2026, 8, 15),
    referenceDate: REF,
    sharedNfeExternalIds: new Set(input.sharedNfeExternalIds ?? []),
    itemizedBilling: input.items
      ? {
          items: itemSnapshots(input.items),
          expectedItemCount: input.expectedItemCount ?? input.items.length,
        }
      : null,
  });
}

function billingStatus(
  ctx: ReturnType<typeof context>,
  status = "SENT_TO_NOMUS"
): SalesOrderBillingStatus {
  return resolveSalesOrderBillingStatusFromContext(status, ctx);
}

describe("status de faturamento — NF válida × cobertura por item", () => {
  it("A. pedido normal: NF exclusiva, valor bate, item 100% faturado = INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(billingStatus(ctx), "INVOICED");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_FULL");
    assert.equal(ctx.legacyIsFullyInvoiced, true);
  });

  it("B. parcial real: item ativo pedido 100, faturado 40 = PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items: [{ ordered: 100, invoiced: 40 }],
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_PARTIAL");
    assert.equal(ctx.itemizedBillingCoverage, "PARTIAL");
  });

  it("C. sem NF = NOT_INVOICED, mesmo com itens marcados como faturados", () => {
    const withoutSnapshot = context({ totalNetValue: 1000, nfes: [] });
    const withSnapshot = context({
      totalNetValue: 1000,
      nfes: [],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(billingStatus(withoutSnapshot), "NOT_INVOICED");
    assert.equal(billingStatus(withSnapshot), "NOT_INVOICED");
    assert.equal(withSnapshot.billingDecisionReason, "NO_VALID_NFE");
  });

  it("D. pedido cancelado = CANCELED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(billingStatus(ctx, "CANCELLED"), "CANCELED");
  });

  it("E. PD 02959: NF compartilhada 272.238 > pedido 107.508, itens 100% = INVOICED", () => {
    const ctx = context({
      totalNetValue: 107_508,
      nfes: [{ externalId: 7863, headerValue: 272_238 }],
      sharedNfeExternalIds: [7863],
      items: [
        { ordered: 2200, invoiced: 2200 },
        { ordered: 5000, invoiced: 5000 },
        { ordered: 30_000, invoiced: 30_000 },
      ],
    });
    assert.equal(billingStatus(ctx), "INVOICED");
    assert.equal(ctx.billingDecisionReason, "SHARED_NFE_ITEMIZED_FULL");
    assert.equal(ctx.legacyIsPartiallyInvoiced, true);
    assert.equal(ctx.hasNfeSharedAcrossOrders, true);
    // Excesso do cabeçalho é esperado em NF compartilhada — não é divergência.
    assert.equal(ctx.hasValueDivergence, false);
    assert.equal(ctx.slaStatus, "on_time");
  });

  it("E2. NF compartilhada em que o pedido recebeu só metade = PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      sharedNfeExternalIds: [1],
      items: [{ ordered: 100, invoiced: 50 }],
    });
    assert.equal(ctx.legacyIsFullyInvoiced, true);
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_PARTIAL");
  });

  it("F. PD 02312: 13.620 com 4.120 cancelados, item ativo 9.500 faturado = INVOICED", () => {
    const ctx = context({
      totalNetValue: 13_620,
      nfes: [{ externalId: 1, headerValue: 9500 }],
      items: [
        { ordered: 5000, invoiced: 5000 },
        { ordered: 20, invoiced: 0, canceled: true },
        { ordered: 20, invoiced: 0, canceled: true },
      ],
    });
    assert.equal(ctx.legacyIsPartiallyInvoiced, true);
    assert.equal(billingStatus(ctx), "INVOICED");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_FULL");
  });

  it("G. PD 02207: 197.030 com obrigação ativa 71.405 e NF 71.405 = INVOICED", () => {
    const ctx = context({
      totalNetValue: 197_030,
      nfes: [{ externalId: 1, headerValue: 71_405 }],
      items: [
        { ordered: 800, invoiced: 800 },
        { ordered: 650, invoiced: 650 },
        { ordered: 1500, invoiced: 0, canceled: true },
        { ordered: 900, invoiced: 0, canceled: true },
      ],
    });
    assert.equal(ctx.legacyIsPartiallyInvoiced, true);
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("H. PD 02123: pedido 3.513,57 × vNF 3.753,57 (frete/IPI), itens 100% = INVOICED", () => {
    const ctx = context({
      totalNetValue: 3513.57,
      nfes: [{ externalId: 1, headerValue: 3753.57 }],
      items: [
        { ordered: 10, invoiced: 10 },
        { ordered: 3, invoiced: 3 },
      ],
    });
    assert.equal(ctx.legacyIsPartiallyInvoiced, true);
    assert.equal(billingStatus(ctx), "INVOICED");
    // NF exclusiva acima do pedido continua sinalizada como divergência de valor.
    assert.equal(ctx.hasValueDivergence, true);
  });

  it("I. snapshot ausente: usa a regra legada por valor", () => {
    const full = context({ totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 1000 }] });
    const partial = context({ totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 400 }] });
    assert.equal(billingStatus(full), "INVOICED");
    assert.equal(billingStatus(partial), "PARTIALLY_INVOICED");
    for (const ctx of [full, partial]) {
      assert.equal(ctx.itemizedBillingCoverage, "UNKNOWN");
      assert.equal(ctx.billingDecisionReason, "ITEMIZED_UNKNOWN_FALLBACK_VALUE");
      assert.equal(ctx.billingUsedLegacyFallback, true);
    }
  });

  it("J. snapshot incompleto ou inconsistente: fallback legado, não inventa FULL", () => {
    const missingItem = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items: [{ ordered: 100, invoiced: 100 }],
      expectedItemCount: 2,
    });
    assert.equal(missingItem.itemizedBillingCoverage, "UNKNOWN");
    assert.equal(billingStatus(missingItem), "PARTIALLY_INVOICED");

    const base = { salesOrderItemId: "i1", isActiveForKanban: true, currentStage: "INVOICED" };
    const inconsistent: ItemizedBillingItemInput[][] = [
      [{ ...base, orderedQuantity: null, shipTargetQuantity: 10, invoicedQuantity: 10 }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 12, invoicedQuantity: 12 }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: Number.NaN }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: -1 }],
    ];
    for (const items of inconsistent) {
      const result = resolveItemizedBillingCoverage({ items, expectedItemCount: 1 });
      assert.equal(result.coverage, "UNKNOWN");
      assert.equal(result.reason, "ITEM_SNAPSHOT_INCONSISTENT");
    }
    assert.equal(
      resolveItemizedBillingCoverage({ items: [], expectedItemCount: 0 }).reason,
      "NO_ITEM_SNAPSHOT"
    );
    assert.equal(
      resolveItemizedBillingCoverage({
        items: itemSnapshots([{ ordered: 10, invoiced: 10 }]),
        expectedItemCount: null,
      }).reason,
      "ITEM_SNAPSHOT_INCOMPLETE"
    );
  });

  it("K. NF cancelada não conta como faturamento válido", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000, status: NFE_STATUS_CANCELED }],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(ctx.hasNfe, false);
    assert.equal(billingStatus(ctx), "NOT_INVOICED");
  });

  it("L. multi-item: 1 item total + 1 item parcial = PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 700 }],
      items: [
        { ordered: 50, invoiced: 50 },
        { ordered: 50, invoiced: 20 },
      ],
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("L2. multi-item: 1 item total + 1 item sem faturamento = PARTIALLY_INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 500 }],
      items: [
        { ordered: 50, invoiced: 50 },
        { ordered: 50, invoiced: 0 },
      ],
    });
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("M. item totalmente cancelado + outro item total = INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 600 }],
      items: [
        { ordered: 60, invoiced: 60 },
        { ordered: 40, invoiced: 0, canceled: true },
      ],
    });
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("N. corte: obrigação ativa reduzida pelo corte e restante faturado = INVOICED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 700 }],
      items: [
        { ordered: 100, invoiced: 70, cut: 30 },
        { ordered: 10, invoiced: 0, cut: 10 },
      ],
    });
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("NF válida sem quantidade atribuída aos itens: parcial, nunca faturado pelo valor", () => {
    const valueDoesNotClose = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 3000 }],
      sharedNfeExternalIds: [1],
      items: [{ ordered: 100, invoiced: 0 }],
    });
    const valueCloses = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000 }],
      items: [{ ordered: 100, invoiced: 0 }],
    });
    assert.equal(valueCloses.legacyIsFullyInvoiced, true);
    for (const ctx of [valueDoesNotClose, valueCloses]) {
      assert.equal(ctx.itemizedBillingCoverage, "NONE");
      assert.equal(ctx.billingDecisionReason, "ITEMIZED_NONE_WITH_VALID_NFE");
      assert.equal(ctx.billingUsedLegacyFallback, false);
      assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
    }
  });

  it("pedido só com itens cancelados: sem obrigação ativa, usa a regra por valor", () => {
    const result = resolveItemizedBillingCoverage({
      items: itemSnapshots([{ ordered: 10, invoiced: 0, canceled: true }]),
      expectedItemCount: 1,
    });
    assert.equal(result.coverage, "UNKNOWN");
    assert.equal(result.reason, "NO_ACTIVE_OBLIGATION");
  });

  it("quantidade faturada acima da obrigação ativa conta como item total", () => {
    const result = resolveItemizedBillingCoverage({
      items: itemSnapshots([{ ordered: 100, invoiced: 130 }]),
      expectedItemCount: 1,
    });
    assert.equal(result.coverage, "FULL");
  });
});

describe("conclusão por item confiável vence a regra por valor; UNKNOWN cai no legado", () => {
  const valueCloses = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 1000 }] };
  const valueDoesNotClose = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 400 }] };

  it("1. valor fecha + itemizado confiável PARTIAL = PARTIALLY_INVOICED", () => {
    const ctx = context({ ...valueCloses, items: [{ ordered: 100, invoiced: 40 }] });
    assert.equal(ctx.legacyIsFullyInvoiced, true);
    assert.equal(ctx.itemizedBillingCoverage, "PARTIAL");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_PARTIAL");
    assert.equal(ctx.billingUsedLegacyFallback, false);
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("2. valor fecha + snapshots incompletos = UNKNOWN -> legado -> INVOICED", () => {
    const ctx = context({
      ...valueCloses,
      items: [{ ordered: 100, invoiced: 40 }],
      expectedItemCount: 2,
    });
    assert.equal(ctx.itemizedBillingCoverage, "UNKNOWN");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_UNKNOWN_FALLBACK_VALUE");
    assert.equal(ctx.billingUsedLegacyFallback, true);
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("3. valor não fecha + snapshots incompletos = UNKNOWN -> legado -> PARTIALLY_INVOICED", () => {
    const ctx = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      expectedItemCount: 2,
    });
    assert.equal(ctx.itemizedBillingCoverage, "UNKNOWN");
    assert.equal(ctx.billingUsedLegacyFallback, true);
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("4. menos snapshots que itens esperados = UNKNOWN (também com mais, ou sem contagem)", () => {
    const items = itemSnapshots([
      { ordered: 100, invoiced: 100 },
      { ordered: 50, invoiced: 50 },
    ]);
    for (const expectedItemCount of [3, 1, null, undefined]) {
      const result = resolveItemizedBillingCoverage({ items, expectedItemCount });
      assert.equal(result.coverage, "UNKNOWN");
      assert.equal(result.reason, "ITEM_SNAPSHOT_INCOMPLETE");
    }
  });

  it("5. todos os snapshots completos + um item realmente parcial = PARTIAL", () => {
    const result = resolveItemizedBillingCoverage({
      items: itemSnapshots([
        { ordered: 100, invoiced: 100 },
        { ordered: 50, invoiced: 20 },
        { ordered: 10, invoiced: 0, canceled: true },
      ]),
      expectedItemCount: 3,
    });
    assert.equal(result.coverage, "PARTIAL");
    assert.equal(result.activeItems, 2);
    assert.equal(result.fullyInvoicedItems, 1);
    assert.equal(result.partiallyInvoicedItems, 1);
  });

  it("6. todos completos + obrigação ativa integralmente coberta = FULL", () => {
    const result = resolveItemizedBillingCoverage({
      items: itemSnapshots([
        { ordered: 100, invoiced: 100 },
        { ordered: 50, invoiced: 30, cut: 20 },
        { ordered: 10, invoiced: 0, canceled: true },
      ]),
      expectedItemCount: 3,
    });
    assert.equal(result.coverage, "FULL");
    assert.equal(result.reason, "ACTIVE_ITEMS_FULLY_INVOICED");
    assert.equal(result.activeItems, 2);
  });
});

describe("métricas de valor permanecem de valor", () => {
  it("invoiceCoveragePercent e nfeTotalValue seguem o cabeçalho da NF", () => {
    const shared = context({
      totalNetValue: 107_508,
      nfes: [{ externalId: 7863, headerValue: 272_238 }],
      sharedNfeExternalIds: [7863],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(shared.nfeTotalValue, 272_238);
    assert.equal(shared.nfeProductsValue, 272_238);
    assert.equal(
      Math.round((shared.invoiceCoveragePercent ?? 0) * 100) / 100,
      Math.round((272_238 / 107_508) * 10_000) / 100
    );

    const canceledItems = context({
      totalNetValue: 13_620,
      nfes: [{ externalId: 1, headerValue: 9500 }],
      items: [{ ordered: 5000, invoiced: 5000 }],
    });
    assert.equal(canceledItems.nfeTotalValue, 9500);
    assert.equal(
      Math.round((canceledItems.invoiceCoveragePercent ?? 0) * 100) / 100,
      Math.round((9500 / 13_620) * 10_000) / 100
    );
  });
});

describe("resolveSalesOrderBillingDecision", () => {
  const base = {
    hasValidNfe: true,
    legacyIsFullyInvoiced: false,
    legacyIsPartiallyInvoiced: true,
    hasNfeSharedAcrossOrders: false,
  };

  it("sem NF válida nunca fatura, mesmo com cobertura FULL", () => {
    const decision = resolveSalesOrderBillingDecision({
      ...base,
      hasValidNfe: false,
      legacyIsPartiallyInvoiced: false,
      itemizedCoverage: "FULL",
    });
    assert.deepEqual(decision, {
      isFullyInvoiced: false,
      isPartiallyInvoiced: false,
      usedLegacyFallback: true,
      reason: "NO_VALID_NFE",
    });
  });

  it("só UNKNOWN devolve os flags legados", () => {
    for (const legacyIsFullyInvoiced of [true, false]) {
      const decision = resolveSalesOrderBillingDecision({
        ...base,
        legacyIsFullyInvoiced,
        legacyIsPartiallyInvoiced: !legacyIsFullyInvoiced,
        itemizedCoverage: "UNKNOWN",
      });
      assert.equal(decision.isFullyInvoiced, legacyIsFullyInvoiced);
      assert.equal(decision.isPartiallyInvoiced, !legacyIsFullyInvoiced);
      assert.equal(decision.usedLegacyFallback, true);
    }
  });

  it("valor fechado nunca sobrepõe PARTIAL ou NONE por item", () => {
    for (const itemizedCoverage of ["PARTIAL", "NONE"] as const) {
      const decision = resolveSalesOrderBillingDecision({
        ...base,
        legacyIsFullyInvoiced: true,
        legacyIsPartiallyInvoiced: false,
        itemizedCoverage,
      });
      assert.equal(decision.isFullyInvoiced, false);
      assert.equal(decision.isPartiallyInvoiced, true);
      assert.equal(decision.usedLegacyFallback, false);
    }
  });
});

describe("detalhe do pedido usa o mesmo status da grade", () => {
  const audit = { nfes: [{}], salesOrder: { status: "SENT_TO_NOMUS" } } as never;

  it("pedido parcial não aparece como Faturado só por ter NF", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items: [{ ordered: 100, invoiced: 40 }],
    });
    assert.equal(mapSalesOrderDetailBillingStatus(audit, ctx), "PARTIALLY_INVOICED");
    assert.equal(mapSalesOrderDetailBillingStatus(audit, ctx), billingStatus(ctx));
  });

  it("sem contexto oficial mantém o comportamento anterior (tem NF = Faturado)", () => {
    assert.equal(mapSalesOrderDetailBillingStatus(audit, null), "INVOICED");
  });
});

describe("resolveSharedNfeExternalIds", () => {
  it("marca apenas NF vinculada a mais de um pedido", () => {
    const shared = resolveSharedNfeExternalIds([
      { salesOrderId: "pd-02959", nfeExternalId: 7863 },
      { salesOrderId: "pd-02920", nfeExternalId: 7863 },
      { salesOrderId: "pd-02918", nfeExternalId: 7863 },
      { salesOrderId: "pd-02959", nfeExternalId: 7900 },
      { salesOrderId: "pd-02959", nfeExternalId: 7900 },
    ]);
    assert.deepEqual([...shared], [7863]);
  });
});
