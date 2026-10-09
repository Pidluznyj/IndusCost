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
/** NF processada e vínculo visto em 10/09; snapshot gravado em 12/09. */
const NFE_PROCESSED_AT = new Date(2026, 8, 10);
const LINK_SEEN_AT = new Date(2026, 8, 10, 14, 0, 0);
const SNAPSHOT_COMPUTED_AT = new Date(2026, 8, 12, 9, 0, 0);

type NfeFixture = {
  externalId: number;
  /** Cabeçalho da NF (xmlVNF). */
  headerValue: number;
  status?: number;
  /** `SalesOrderNfeLink.firstSeenAt`; null = ausente. */
  firstSeenAt?: Date | null;
};

type ItemFixture = {
  ordered: number;
  invoiced: number;
  /** Quantidade cortada (reduz a obrigação ativa). */
  cut?: number;
  /** Item cancelado no Nomus. */
  canceled?: boolean;
  /** Saldo ativo do motor; padrão = obrigação ativa − faturado. */
  activeRemaining?: number | null;
};

function shipTarget(item: ItemFixture): number {
  return item.canceled ? 0 : Math.max(0, item.ordered - (item.cut ?? 0));
}

function itemSnapshots(
  items: ItemFixture[],
  computedAt: Date | null = SNAPSHOT_COMPUTED_AT,
  verifiedAt: Date | null = null
): ItemizedBillingItemInput[] {
  return items.map((item, index) => ({
    computedAt,
    verifiedAt,
    salesOrderItemId: `item-${index + 1}`,
    isActiveForKanban: !item.canceled,
    currentStage: item.canceled ? "CANCELED" : "SHIPPED_COMPLETED",
    orderedQuantity: item.ordered,
    shipTargetQuantity: shipTarget(item),
    activeRemainingQuantity:
      item.activeRemaining === undefined
        ? Math.max(0, shipTarget(item) - item.invoiced)
        : item.activeRemaining,
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
  /** `computedAt` dos snapshots; padrão = depois do vínculo da NF. */
  snapshotComputedAt?: Date | null;
  /** `verifiedAt` dos snapshots; padrão = ausente (snapshot legado). */
  snapshotVerifiedAt?: Date | null;
}) {
  const processedAt = NFE_PROCESSED_AT;
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
      firstSeenAt: nfe.firstSeenAt === undefined ? LINK_SEEN_AT : nfe.firstSeenAt,
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
          items: itemSnapshots(
            input.items,
            input.snapshotComputedAt === undefined ? SNAPSHOT_COMPUTED_AT : input.snapshotComputedAt,
            input.snapshotVerifiedAt ?? null
          ),
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

    const base = {
      salesOrderItemId: "i1",
      isActiveForKanban: true,
      currentStage: "INVOICED",
      computedAt: SNAPSHOT_COMPUTED_AT,
      activeRemainingQuantity: 0,
    };
    const inconsistent: ItemizedBillingItemInput[][] = [
      [{ ...base, orderedQuantity: null, shipTargetQuantity: 10, invoicedQuantity: 10 }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 12, invoicedQuantity: 12 }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: Number.NaN }],
      [{ ...base, orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: -1 }],
    ];
    for (const items of inconsistent) {
      const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT, items, expectedItemCount: 1 });
      assert.equal(result.coverage, "UNKNOWN");
      assert.equal(result.reason, "ITEM_SNAPSHOT_INCONSISTENT");
    }
    assert.equal(
      resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT, items: [], expectedItemCount: 0 }).reason,
      "NO_ITEM_SNAPSHOT"
    );
    assert.equal(
      resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
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


  it("pedido só com itens cancelados: sem obrigação ativa, usa a regra por valor", () => {
    const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
      items: itemSnapshots([{ ordered: 10, invoiced: 0, canceled: true }]),
      expectedItemCount: 1,
    });
    assert.equal(result.coverage, "UNKNOWN");
    assert.equal(result.reason, "NO_ACTIVE_OBLIGATION");
  });

  it("quantidade faturada acima da obrigação ativa conta como item total", () => {
    const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
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
      const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT, items, expectedItemCount });
      assert.equal(result.coverage, "UNKNOWN");
      assert.equal(result.reason, "ITEM_SNAPSHOT_INCOMPLETE");
    }
  });

  it("5. todos os snapshots completos + um item realmente parcial = PARTIAL", () => {
    const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
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
      latestFiscalEvidenceAt: LINK_SEEN_AT,
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

describe("frescor do snapshot e NONE — quando a cobertura por item é autoridade", () => {
  const valueCloses = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 1000 }] };
  const valueDoesNotClose = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 400 }] };
  const beforeLink = new Date(LINK_SEEN_AT.getTime() - 60_000);

  it("A. snapshot completo porém anterior à NF mais recente = UNKNOWN -> fallback", () => {
    // Itens dizem 40%, mas o snapshot é anterior ao vínculo da NF: não é autoridade.
    const closes = context({
      ...valueCloses,
      items: [{ ordered: 100, invoiced: 40 }],
      snapshotComputedAt: beforeLink,
    });
    const doesNotClose = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: beforeLink,
    });
    for (const ctx of [closes, doesNotClose]) {
      assert.equal(ctx.itemizedBillingCoverage, "UNKNOWN");
      assert.equal(ctx.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
      assert.equal(ctx.billingDecisionReason, "ITEMIZED_UNKNOWN_FALLBACK_VALUE");
      assert.equal(ctx.billingUsedLegacyFallback, true);
    }
    assert.equal(billingStatus(closes), "INVOICED");
    assert.equal(billingStatus(doesNotClose), "PARTIALLY_INVOICED");
  });

  it("A2. várias NFs: snapshot entre a primeira e a última NF é defasado", () => {
    const secondLinkSeenAt = new Date(2026, 8, 20, 10, 0, 0);
    const ctx = context({
      totalNetValue: 1000,
      nfes: [
        { externalId: 1, headerValue: 400 },
        { externalId: 2, headerValue: 600, firstSeenAt: secondLinkSeenAt },
      ],
      items: [{ ordered: 100, invoiced: 40 }],
    });
    assert.equal(ctx.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("A3. data de processamento da NF posterior ao snapshot também o torna defasado", () => {
    const ctx = buildSalesOrderLinkedNfeContext({
      links: [
        {
          id: "l1",
          nfeExternalId: 1,
          nfeNumber: "1",
          nfeKey: null,
          nfeStatus: NFE_STATUS_AUTHORIZED,
          tipoOperacao: 1,
          dataProcessamento: new Date(2026, 8, 25),
          presentInLastPayload: true,
          nomusNfeId: null,
          rawPayload: { valor: 400 },
          firstSeenAt: LINK_SEEN_AT,
        },
      ],
      totalNetValue: 1000,
      referenceDate: REF,
      itemizedBilling: {
        items: itemSnapshots([{ ordered: 100, invoiced: 100 }]),
        expectedItemCount: 1,
      },
    });
    assert.equal(ctx.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
  });

  it("B. snapshot completo e posterior à NF = autoridade por item", () => {
    const atSameInstant = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: LINK_SEEN_AT,
    });
    const later = context({ ...valueDoesNotClose, items: [{ ordered: 100, invoiced: 100 }] });
    for (const ctx of [atSameInstant, later]) {
      assert.equal(ctx.itemizedBillingCoverage, "FULL");
      assert.equal(ctx.billingUsedLegacyFallback, false);
      assert.equal(billingStatus(ctx), "INVOICED");
    }
  });

  it("vínculo sem firstSeenAt ou snapshot sem computedAt: frescor não atestável = UNKNOWN", () => {
    const withoutFirstSeen = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400, firstSeenAt: null }],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    assert.equal(
      withoutFirstSeen.itemizedBillingCoverageReason,
      "ITEM_SNAPSHOT_FRESHNESS_UNVERIFIABLE"
    );
    assert.equal(billingStatus(withoutFirstSeen), "PARTIALLY_INVOICED");

    const withoutComputedAt = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: null,
    });
    assert.equal(withoutComputedAt.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_INCONSISTENT");
    assert.equal(billingStatus(withoutComputedAt), "PARTIALLY_INVOICED");
  });

  it("C. NONE + valor fecha = fallback legado -> INVOICED", () => {
    const ctx = context({ ...valueCloses, items: [{ ordered: 100, invoiced: 0 }] });
    assert.equal(ctx.itemizedBillingCoverage, "NONE");
    assert.equal(ctx.itemizedBillingCoverageReason, "ACTIVE_ITEMS_NOT_INVOICED");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_NONE_FALLBACK_VALUE");
    assert.equal(ctx.billingUsedLegacyFallback, true);
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("D. NONE + valor não fecha = fallback legado -> PARTIALLY_INVOICED", () => {
    const ctx = context({ ...valueDoesNotClose, items: [{ ordered: 100, invoiced: 0 }] });
    assert.equal(ctx.itemizedBillingCoverage, "NONE");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_NONE_FALLBACK_VALUE");
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("E. PARTIAL confiável + valor fecha = continua PARTIALLY_INVOICED", () => {
    const ctx = context({ ...valueCloses, items: [{ ordered: 100, invoiced: 40 }] });
    assert.equal(ctx.legacyIsFullyInvoiced, true);
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_PARTIAL");
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("F. FULL confiável + valor diverge = continua INVOICED", () => {
    const below = context({ ...valueDoesNotClose, items: [{ ordered: 100, invoiced: 100 }] });
    const above = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1900 }],
      items: [{ ordered: 100, invoiced: 100 }],
    });
    for (const ctx of [below, above]) {
      assert.equal(ctx.legacyIsFullyInvoiced, false);
      assert.equal(ctx.billingDecisionReason, "ITEMIZED_FULL");
      assert.equal(billingStatus(ctx), "INVOICED");
    }
  });

  it("decisionReason distingue NONE de UNKNOWN", () => {
    const none = context({ ...valueCloses, items: [{ ordered: 100, invoiced: 0 }] });
    const unknown = context({ ...valueCloses });
    assert.notEqual(none.billingDecisionReason, unknown.billingDecisionReason);
    assert.equal(unknown.billingDecisionReason, "ITEMIZED_UNKNOWN_FALLBACK_VALUE");
  });
});

describe("itens sem obrigação ativa (FULFILLED_WITH_CUT) — PD 02809, 02120, 02068, 02231", () => {
  function coverage(items: ItemFixture[]) {
    return resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
      items: itemSnapshots(items),
      expectedItemCount: items.length,
    });
  }

  it("A. pedido 4, saldo ativo 0, faturado 4, corte 4 = FULL", () => {
    const result = coverage([{ ordered: 4, invoiced: 4, cut: 4 }]);
    assert.equal(result.coverage, "FULL");
    assert.equal(result.reason, "NO_ACTIVE_OBLIGATION_WITH_INVOICE_COVERAGE");
    assert.equal(result.activeItems, 0);
    assert.equal(result.resolvedItemsWithInvoice, 1);
  });

  it("B. PD 02231: pedido 50.000, saldo ativo 0, faturado 26.000, corte 50.000 = FULL", () => {
    const items = [{ ordered: 50_000, invoiced: 26_000, cut: 50_000 }];
    const result = coverage(items);
    assert.equal(result.coverage, "FULL");
    assert.equal(result.reason, "NO_ACTIVE_OBLIGATION_WITH_INVOICE_COVERAGE");

    // Valor da NF (26.000 un.) fica abaixo do pedido original: legado diria parcial.
    const ctx = context({
      totalNetValue: 50_000,
      nfes: [{ externalId: 1, headerValue: 26_000 }],
      items,
    });
    assert.equal(ctx.legacyIsPartiallyInvoiced, true);
    assert.equal(ctx.itemizedBillingCoverageReason, "NO_ACTIVE_OBLIGATION_WITH_INVOICE_COVERAGE");
    assert.equal(ctx.billingDecisionReason, "ITEMIZED_FULL");
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("C. saldo ativo 0, faturado 0, item apenas cortado = não é FULL; fallback por valor", () => {
    const items = [{ ordered: 100, invoiced: 0, cut: 100 }];
    const result = coverage(items);
    assert.equal(result.coverage, "UNKNOWN");
    assert.equal(result.reason, "NO_ACTIVE_OBLIGATION");

    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items,
    });
    assert.equal(ctx.billingUsedLegacyFallback, true);
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("D. saldo ativo 0, faturado 0, item cancelado = não inventa faturamento", () => {
    const canceledOnly = coverage([{ ordered: 100, invoiced: 0, canceled: true }]);
    assert.equal(canceledOnly.coverage, "UNKNOWN");
    assert.equal(canceledOnly.reason, "NO_ACTIVE_OBLIGATION");

    const canceledAndCut = coverage([
      { ordered: 100, invoiced: 0, canceled: true },
      { ordered: 50, invoiced: 0, cut: 50 },
    ]);
    assert.equal(canceledAndCut.coverage, "UNKNOWN");
    assert.equal(canceledAndCut.resolvedItemsWithInvoice, 0);
  });

  it("E. item resolvido com faturamento + item com obrigação ativa pendente = PARTIAL", () => {
    const pendingNotInvoiced = coverage([
      { ordered: 4, invoiced: 4, cut: 4 },
      { ordered: 100, invoiced: 0 },
    ]);
    const pendingPartiallyInvoiced = coverage([
      { ordered: 50_000, invoiced: 26_000, cut: 50_000 },
      { ordered: 100, invoiced: 30 },
    ]);
    for (const result of [pendingNotInvoiced, pendingPartiallyInvoiced]) {
      assert.equal(result.coverage, "PARTIAL");
      assert.equal(result.reason, "ACTIVE_ITEMS_PARTIALLY_INVOICED");
    }
  });

  it("F. todos os itens resolvidos, sem obrigação ativa e com cobertura faturada = FULL", () => {
    const allResolved = coverage([
      { ordered: 4, invoiced: 4, cut: 4 },
      { ordered: 50_000, invoiced: 26_000, cut: 50_000 },
      { ordered: 10, invoiced: 10, cut: 10 },
    ]);
    assert.equal(allResolved.coverage, "FULL");
    assert.equal(allResolved.resolvedItemsWithInvoice, 3);

    // Item apenas cortado ou cancelado ao lado não muda a conclusão.
    const withCutAndCanceled = coverage([
      { ordered: 4, invoiced: 4, cut: 4 },
      { ordered: 20, invoiced: 0, cut: 20 },
      { ordered: 30, invoiced: 0, canceled: true },
    ]);
    assert.equal(withCutAndCanceled.coverage, "FULL");

    // Item com obrigação ativa coberta + item resolvido por corte.
    const mixedFull = coverage([
      { ordered: 100, invoiced: 100 },
      { ordered: 4, invoiced: 4, cut: 4 },
    ]);
    assert.equal(mixedFull.coverage, "FULL");
    assert.equal(mixedFull.reason, "ACTIVE_ITEMS_FULLY_INVOICED");
  });

  it("sem NF válida, snapshot resolvido com faturamento não torna o pedido faturado", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 1000, status: NFE_STATUS_CANCELED }],
      items: [{ ordered: 4, invoiced: 4, cut: 4 }],
    });
    assert.equal(ctx.hasNfe, false);
    assert.equal(billingStatus(ctx), "NOT_INVOICED");
  });

  it("pedido cancelado continua CANCELED", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items: [{ ordered: 4, invoiced: 4, cut: 4 }],
    });
    assert.equal(billingStatus(ctx, "CANCELLED"), "CANCELED");
  });

  it("snapshot defasado continua UNKNOWN (checagem de frescor preservada)", () => {
    const ctx = context({
      totalNetValue: 1000,
      nfes: [{ externalId: 1, headerValue: 400 }],
      items: [{ ordered: 4, invoiced: 4, cut: 4 }],
      snapshotComputedAt: new Date(LINK_SEEN_AT.getTime() - 60_000),
    });
    assert.equal(ctx.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("obrigação ativa zero com saldo ativo positivo ou ausente = inconsistente", () => {
    for (const activeRemaining of [5, null]) {
      const result = coverage([{ ordered: 4, invoiced: 4, cut: 4, activeRemaining }]);
      assert.equal(result.coverage, "UNKNOWN");
      assert.equal(result.reason, "ITEM_SNAPSHOT_INCONSISTENT");
    }
  });
});

describe("frescor por verifiedAt (última verificação) com fallback para computedAt", () => {
  const valueDoesNotClose = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 400 }] };
  const beforeLink = new Date(LINK_SEEN_AT.getTime() - 86_400_000);
  const afterLink = new Date(LINK_SEEN_AT.getTime() + 3_600_000);

  it("verifiedAt posterior à NF = snapshot confiável, mesmo com computedAt anterior", () => {
    // Snapshot já estava correto antes de o vínculo da NF existir; o recompute
    // seguinte não mudou nada (computedAt antigo), mas registrou a verificação.
    const ctx = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: beforeLink,
      snapshotVerifiedAt: afterLink,
    });
    assert.equal(ctx.itemizedBillingCoverage, "FULL");
    assert.equal(ctx.itemizedBillingFreshness?.freshnessSource, "VERIFIED_AT");
    assert.equal(ctx.itemizedBillingFreshness?.snapshotVerifiedAt?.getTime(), afterLink.getTime());
    assert.equal(ctx.itemizedBillingFreshness?.snapshotComputedAt?.getTime(), beforeLink.getTime());
    assert.equal(ctx.itemizedBillingFreshness?.fiscalEvidenceAt?.getTime(), LINK_SEEN_AT.getTime());
    assert.equal(billingStatus(ctx), "INVOICED");
  });

  it("verifiedAt anterior à NF = stale, mesmo com computedAt posterior", () => {
    const ctx = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: afterLink,
      snapshotVerifiedAt: beforeLink,
    });
    assert.equal(ctx.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
    assert.equal(ctx.itemizedBillingFreshness?.freshnessSource, "VERIFIED_AT");
    assert.equal(ctx.billingUsedLegacyFallback, true);
    assert.equal(billingStatus(ctx), "PARTIALLY_INVOICED");
  });

  it("verifiedAt ausente (legado) = usa computedAt, com a regra anterior", () => {
    const fresh = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: afterLink,
    });
    const stale = context({
      ...valueDoesNotClose,
      items: [{ ordered: 100, invoiced: 100 }],
      snapshotComputedAt: beforeLink,
    });
    for (const ctx of [fresh, stale]) {
      assert.equal(ctx.itemizedBillingFreshness?.freshnessSource, "COMPUTED_AT_LEGACY");
      assert.equal(ctx.itemizedBillingFreshness?.snapshotVerifiedAt, null);
    }
    assert.equal(billingStatus(fresh), "INVOICED");
    assert.equal(stale.itemizedBillingCoverageReason, "ITEM_SNAPSHOT_STALE");
    assert.equal(billingStatus(stale), "PARTIALLY_INVOICED");
  });

  it("itens mistos: cada item usa verifiedAt quando tem, computedAt quando não", () => {
    const items: ItemizedBillingItemInput[] = [
      ...itemSnapshots([{ ordered: 100, invoiced: 100 }], beforeLink, afterLink),
      {
        ...itemSnapshots([{ ordered: 50, invoiced: 50 }], beforeLink, null)[0]!,
        salesOrderItemId: "item-legado",
      },
    ];
    const result = resolveItemizedBillingCoverage({
      latestFiscalEvidenceAt: LINK_SEEN_AT,
      items,
      expectedItemCount: 2,
    });
    assert.equal(result.freshnessSource, "COMPUTED_AT_LEGACY");
    assert.equal(result.reason, "ITEM_SNAPSHOT_STALE");
  });

  it("verifiedAt confiável não altera FULL / PARTIAL / NONE", () => {
    const base = { snapshotComputedAt: beforeLink, snapshotVerifiedAt: afterLink };
    const valueCloses = { totalNetValue: 1000, nfes: [{ externalId: 1, headerValue: 1000 }] };
    const full = context({ ...valueDoesNotClose, ...base, items: [{ ordered: 100, invoiced: 100 }] });
    const partial = context({ ...valueCloses, ...base, items: [{ ordered: 100, invoiced: 40 }] });
    const none = context({ ...valueCloses, ...base, items: [{ ordered: 100, invoiced: 0 }] });
    assert.equal(full.billingDecisionReason, "ITEMIZED_FULL");
    assert.equal(billingStatus(full), "INVOICED");
    assert.equal(partial.billingDecisionReason, "ITEMIZED_PARTIAL");
    assert.equal(billingStatus(partial), "PARTIALLY_INVOICED");
    assert.equal(none.billingDecisionReason, "ITEMIZED_NONE_FALLBACK_VALUE");
    assert.equal(billingStatus(none), "INVOICED");
  });

  it("os quatro casos sem obrigação ativa seguem FULL com verifiedAt e em legado", () => {
    const cases: ItemFixture[][] = [
      [{ ordered: 4, invoiced: 4, cut: 4 }],
      [{ ordered: 120, invoiced: 120, cut: 120 }],
      [{ ordered: 10, invoiced: 10, cut: 10 }],
      [{ ordered: 50_000, invoiced: 26_000, cut: 50_000 }],
    ];
    for (const items of cases) {
      const verified = context({
        ...valueDoesNotClose,
        items,
        snapshotComputedAt: beforeLink,
        snapshotVerifiedAt: afterLink,
      });
      const legacy = context({ ...valueDoesNotClose, items });
      for (const ctx of [verified, legacy]) {
        assert.equal(
          ctx.itemizedBillingCoverageReason,
          "NO_ACTIVE_OBLIGATION_WITH_INVOICE_COVERAGE"
        );
        assert.equal(billingStatus(ctx), "INVOICED");
      }
    }
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

  it("valor fechado nunca sobrepõe PARTIAL por item", () => {
    const decision = resolveSalesOrderBillingDecision({
      ...base,
      legacyIsFullyInvoiced: true,
      legacyIsPartiallyInvoiced: false,
      itemizedCoverage: "PARTIAL",
    });
    assert.equal(decision.isFullyInvoiced, false);
    assert.equal(decision.isPartiallyInvoiced, true);
    assert.equal(decision.usedLegacyFallback, false);
  });

  it("NONE devolve os flags legados com motivo próprio", () => {
    for (const legacyIsFullyInvoiced of [true, false]) {
      const decision = resolveSalesOrderBillingDecision({
        ...base,
        legacyIsFullyInvoiced,
        legacyIsPartiallyInvoiced: !legacyIsFullyInvoiced,
        itemizedCoverage: "NONE",
      });
      assert.equal(decision.isFullyInvoiced, legacyIsFullyInvoiced);
      assert.equal(decision.usedLegacyFallback, true);
      assert.equal(decision.reason, "ITEMIZED_NONE_FALLBACK_VALUE");
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
