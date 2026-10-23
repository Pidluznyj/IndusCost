/**
 * B5 — alocação do pedido por item × NF-e a partir da evidência oficial do documento
 * de saída. Regras puras do alocador e integração com a montagem do snapshot.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateItemAmountByQuantity,
  resolveOrderInvoiceAllocation,
  resolveSingleNfeBillingProof,
  type InvoiceAllocationLineInput,
  type InvoiceAllocationNfeInput,
} from "./commissionInvoiceAllocation.js";
import { loadOrderInvoiceAllocation, loadSingleNfeBillingProof } from "./commissionInvoiceAllocation.server.js";
import { buildCommissionOrderSnapshotDraft } from "./commissionOrderMaterializer.js";
import { deriveReceivableScheduleStatus } from "./commissionReceivableScheduler.js";
import type { CommissionOrderSourceBundle } from "./commission-types.js";
import type { CommissionOrderItemCalculationResult } from "./commissionOrderCalculation.js";
import type { CommissionSellerIdentityResolution } from "./commissionSellerIdentity.js";
import { SELLER_464, orderBundle, seededRandom, shuffled, sum } from "./commissionNnCardinality.fixtures.js";

const ITEMS = [
  { salesOrderItemId: "i1", orderedQuantity: 30 },
  { salesOrderItemId: "i2", orderedQuantity: 10 },
];
const nfe = (id: number, day: number, valid = true): InvoiceAllocationNfeInput => ({
  nfeExternalId: id,
  processedAt: new Date(Date.UTC(2026, 9, day)),
  valid,
});
const line = (partial: Partial<InvoiceAllocationLineInput> & Pick<InvoiceAllocationLineInput, "stockDocumentItemId" | "nfeExternalId" | "quantity">): InvoiceAllocationLineInput => ({
  stockDocumentExternalId: Number(partial.nfeExternalId) + 100000,
  documentValid: true,
  belongsToOrder: true,
  salesOrderItemId: "i1",
  sourceType: "DIRECT_ORDER_ITEM_REFERENCE",
  itemCoverage: "RESOLVED",
  claimedByOtherOrders: false,
  ...partial,
});

describe("alocador por item × NF-e", () => {
  it("três NF-e com idItemPedido oficial: parcelas, acumulado e saldo por item", () => {
    const result = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 10), nfe(3, 20)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 12 }),
        line({ stockDocumentItemId: "c", nfeExternalId: 3, quantity: 6 }),
        line({ stockDocumentItemId: "d", nfeExternalId: 3, quantity: 10, salesOrderItemId: "i2" }),
      ],
    });
    assert.deepEqual(
      [1, 2, 3].map((id) => result.byNfe.get(id)!.basis),
      ["INVOICED_ALLOCATION", "INVOICED_ALLOCATION", "INVOICED_ALLOCATION"]
    );
    assert.deepEqual(
      [1, 2, 3].map((id) => {
        const item = result.byNfe.get(id)!.items.get("i1")!;
        return [item.invoicedQuantity, item.cumulativeBefore, item.cumulativeAfter];
      }),
      [
        [8, 0, 8],
        [12, 8, 20],
        [6, 20, 26],
      ]
    );
    assert.deepEqual(result.items.get("i1"), { orderedQuantity: 30, invoicedQuantity: 26, pendingQuantity: 4 });
    assert.deepEqual(result.items.get("i2"), { orderedQuantity: 10, invoicedQuantity: 10, pendingQuantity: 0 });
    assert.deepEqual(result.conflicts, []);
  });

  it("pedido com uma NF-e e sem evidência por item: pedido inteiro (comportamento histórico)", () => {
    const none = resolveOrderInvoiceAllocation({ items: ITEMS, nfes: [nfe(1, 1)], lines: [] });
    assert.equal(none.byNfe.get(1)!.basis, "FULL_ORDER_LEGACY");
    const weak = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1)],
      lines: [line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8, sourceType: "SALES_ORDER_NFE_LINK" })],
    });
    assert.equal(weak.byNfe.get(1)!.basis, "FULL_ORDER_LEGACY");
    assert.match(weak.byNfe.get(1)!.reason ?? "", /sem referência oficial do item/);
  });

  it("NF-e única com evidência: fatura tudo → histórico (mesmo hash); fatura parte → só o faturado", () => {
    const full = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 30 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 1, quantity: 10, salesOrderItemId: "i2" }),
      ],
    });
    assert.equal(full.byNfe.get(1)!.basis, "FULL_ORDER_LEGACY");
    assert.match(full.byNfe.get(1)!.reason ?? "", /pedido inteiro/);
    const partial = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1)],
      lines: [line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 30 })],
    });
    assert.equal(partial.byNfe.get(1)!.basis, "INVOICED_ALLOCATION");
    assert.deepEqual(partial.items.get("i2"), { orderedQuantity: 10, invoicedQuantity: 0, pendingQuantity: 10 });
  });

  it("pedido em duas NF-e sem evidência: ambas retidas (nunca o pedido inteiro duas vezes)", () => {
    const result = resolveOrderInvoiceAllocation({ items: ITEMS, nfes: [nfe(1, 1), nfe(2, 2)], lines: [] });
    assert.deepEqual([1, 2].map((id) => result.byNfe.get(id)!.basis), ["ALLOCATION_PENDING", "ALLOCATION_PENDING"]);
  });

  it("produto inequívoco no pedido NÃO é evidência suficiente quando há mais de uma NF-e", () => {
    const result = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 12, sourceType: "SALES_ORDER_NFE_LINK" }),
      ],
    });
    assert.equal(result.byNfe.get(1)!.basis, "INVOICED_ALLOCATION");
    assert.equal(result.byNfe.get(2)!.basis, "ALLOCATION_PENDING");
  });

  it("linha reivindicada por outro pedido da mesma NF-e: NF-e retida para este pedido", () => {
    const result = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 12 }),
        line({ stockDocumentItemId: "x", nfeExternalId: 2, quantity: 3, claimedByOtherOrders: true }),
      ],
    });
    assert.equal(result.byNfe.get(2)!.basis, "ALLOCATION_PENDING");
    assert.match(result.byNfe.get(2)!.reason ?? "", /reivindicada/);
  });

  it("faturado acumulado acima do pedido (I3): conflito e retenção desta NF-e e das seguintes", () => {
    const result = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2), nfe(3, 3)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 20 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 15 }),
        line({ stockDocumentItemId: "c", nfeExternalId: 3, quantity: 1 }),
      ],
    });
    assert.deepEqual(
      [1, 2, 3].map((id) => result.byNfe.get(id)!.basis),
      ["INVOICED_ALLOCATION", "ALLOCATION_PENDING", "ALLOCATION_PENDING"]
    );
    assert.equal(result.conflicts.length, 1);
    assert.ok((result.items.get("i1")!.invoicedQuantity) <= 30);
  });

  it("cancelamento e reemissão: NF-e cancelada retida; a reemitida, única válida, mede o pedido", () => {
    const result = resolveOrderInvoiceAllocation({ items: ITEMS, nfes: [nfe(1, 1, false), nfe(2, 3)], lines: [] });
    assert.equal(result.byNfe.get(1)!.basis, "ALLOCATION_PENDING");
    assert.equal(result.byNfe.get(2)!.basis, "FULL_ORDER_LEGACY");
  });

  it("documento de devolução/cancelado não conta como faturamento", () => {
    const result = resolveOrderInvoiceAllocation({
      items: ITEMS,
      nfes: [nfe(1, 1), nfe(2, 2)],
      lines: [
        line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8 }),
        line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 12 }),
        line({ stockDocumentItemId: "r", nfeExternalId: 2, quantity: 5, documentValid: false }),
      ],
    });
    assert.equal(result.byNfe.get(2)!.items.get("i1")!.invoicedQuantity, 12);
  });

  it("ordem das linhas e das NF-e não altera a alocação (seed fixa)", () => {
    const nfes = [nfe(1, 1), nfe(2, 10), nfe(3, 20)];
    const lines = [
      line({ stockDocumentItemId: "a", nfeExternalId: 1, quantity: 8 }),
      line({ stockDocumentItemId: "b", nfeExternalId: 2, quantity: 12 }),
      line({ stockDocumentItemId: "c", nfeExternalId: 3, quantity: 10 }),
    ];
    const base = resolveOrderInvoiceAllocation({ items: ITEMS, nfes, lines });
    const random = seededRandom(42);
    for (let round = 0; round < 10; round += 1) {
      const other = resolveOrderInvoiceAllocation({ items: shuffled(ITEMS, random), nfes: shuffled(nfes, random), lines: shuffled(lines, random) });
      for (const id of [1, 2, 3]) {
        assert.deepEqual(other.byNfe.get(id)!.items.get("i1"), base.byNfe.get(id)!.items.get("i1"));
      }
    }
  });

  it("arredondamento por acumulado: Σ das parcelas = valor do item para qualquer partição", () => {
    const random = seededRandom(7);
    for (let round = 0; round < 200; round += 1) {
      const ordered = 1 + Math.floor(random() * 97);
      const full = Math.round(random() * 100000) / 100;
      let before = 0;
      const parts: number[] = [];
      while (before < ordered) {
        const step = Math.min(ordered - before, 1 + Math.floor(random() * ordered));
        parts.push(allocateItemAmountByQuantity({ fullAmount: full, orderedQuantity: ordered, cumulativeBefore: before, cumulativeAfter: before + step }));
        before += step;
      }
      assert.equal(sum(parts), full, `ordered=${ordered} full=${full}`);
      assert.ok(parts.every((part) => part >= 0));
    }
  });
});

describe("snapshot por NF-e a partir do alocador (NF-e posterior não recria comissão)", () => {
  const ORDER = { id: "so-b5", code: "08001", nomusOrderId: 8001, seller: SELLER_464, commission: 1234.56, sold: 41152 };
  const NFES = [
    { id: 9801, number: "9801", titles: [{ id: 98011, nominal: 10000, due: "2026-11-01" }] },
    { id: 9802, number: "9802", titles: [{ id: 98021, nominal: 15000, due: "2026-11-15" }] },
    { id: 9803, number: "9803", titles: [{ id: 98031, nominal: 16152, due: "2026-12-01" }] },
  ];
  const seller = {
    canonicalSellerId: SELLER_464.personId,
    canonicalSellerName: SELLER_464.name,
    rawSellerId: SELLER_464.nomusId,
    rawSellerName: SELLER_464.name,
    resolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    warnings: [],
  } as unknown as CommissionSellerIdentityResolution;
  const calc = (itemId: string, sold: number, commission: number): CommissionOrderItemCalculationResult => ({
    salesOrderId: ORDER.id,
    nfeId: null,
    itemId,
    productId: `p-${itemId}`,
    soldAmount: sold,
    soldUnitPrice: 1,
    marginPercent: null,
    commissionRatePercent: 3,
    grossCommissionAmount: commission,
    netCommissionAmount: commission,
    ruleId: null,
    ruleSnapshot: null,
    exclusionStatus: "NONE",
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    canonicalSellerId: SELLER_464.personId,
    canonicalSellerName: SELLER_464.name,
    referenceDate: "2026-10-01T00:00:00.000Z",
    tierMetadata: null,
  });
  const lines = [calc("i1", 30000, 900), calc("i2", 11152, 334.56)];
  const allocation = resolveOrderInvoiceAllocation({
    items: [
      { salesOrderItemId: "i1", orderedQuantity: 30 },
      { salesOrderItemId: "i2", orderedQuantity: 7 },
    ],
    nfes: [nfe(9801, 1), nfe(9802, 2), nfe(9803, 3)],
    lines: [
      line({ stockDocumentItemId: "a", nfeExternalId: 9801, quantity: 10 }),
      line({ stockDocumentItemId: "b", nfeExternalId: 9802, quantity: 10 }),
      line({ stockDocumentItemId: "c", nfeExternalId: 9802, quantity: 3, salesOrderItemId: "i2" }),
      line({ stockDocumentItemId: "d", nfeExternalId: 9803, quantity: 10 }),
      line({ stockDocumentItemId: "e", nfeExternalId: 9803, quantity: 4, salesOrderItemId: "i2" }),
    ],
  });

  it("Σ comissão das três NF-e = comissão do pedido; cada NF-e só com o seu faturado", () => {
    const bundle = orderBundle(ORDER, NFES);
    const drafts = NFES.map((row) =>
      buildCommissionOrderSnapshotDraft({
        order: bundle,
        customerId: "c",
        customerNameSnapshot: "C",
        lines,
        sellerResolution: seller,
        nfeId: row.id,
        invoiceAllocation: allocation.byNfe.get(row.id) ?? null,
      })
    );
    assert.equal(sum(drafts.map((draft) => draft.totalFinalCommissionAmount)), 1234.56);
    assert.equal(sum(drafts.map((draft) => draft.totalSoldAmount)), 41152);
    assert.deepEqual(drafts.map((draft) => draft.items.map((item) => item.salesOrderItemId)), [["i1"], ["i1", "i2"], ["i1", "i2"]]);
    // Rematerializar a 1ª NF-e depois da 3ª: mesmo snapshot (idempotente), nada recriado.
    const again = buildCommissionOrderSnapshotDraft({
      order: bundle,
      customerId: "c",
      customerNameSnapshot: "C",
      lines,
      sellerResolution: seller,
      nfeId: 9801,
      invoiceAllocation: allocation.byNfe.get(9801) ?? null,
    });
    assert.equal(again.sourceHash, drafts[0]!.sourceHash);
    assert.equal(again.totalFinalCommissionAmount, drafts[0]!.totalFinalCommissionAmount);
  });

  it("snapshot da base histórica mantém exatamente o hash de antes (sem rematerialização em massa)", () => {
    const bundle = orderBundle(ORDER, [NFES[0]!]);
    const without = buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "c", customerNameSnapshot: "C", lines, sellerResolution: seller, nfeId: 9801 });
    const legacy = buildCommissionOrderSnapshotDraft({
      order: bundle,
      customerId: "c",
      customerNameSnapshot: "C",
      lines,
      sellerResolution: seller,
      nfeId: 9801,
      invoiceAllocation: { basis: "FULL_ORDER_LEGACY", nfeExternalId: 9801, reason: null, items: new Map() },
    });
    assert.equal(legacy.sourceHash, without.sourceHash);
    assert.equal(legacy.totalFinalCommissionAmount, 1234.56);
  });

  it("NF-e única sem item oficial: integral comprovado mantém o histórico; parcial ou sem prova retém (nunca antecipa)", () => {
    const bundle = orderBundle(ORDER, [NFES[0]!]);
    const without = buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "c", customerNameSnapshot: "C", lines, sellerResolution: seller, nfeId: 9801 });
    const items = [
      { salesOrderItemId: "i1", orderedQuantity: 30 },
      { salesOrderItemId: "i2", orderedQuantity: 7 },
    ];
    const decide = (status: "FULL" | "PARTIAL" | "UNPROVEN") =>
      resolveOrderInvoiceAllocation({
        items,
        nfes: [nfe(9801, 1)],
        lines: [],
        singleNfeBillingProof: { status, source: status === "UNPROVEN" ? "NONE" : "NFE_PRODUCTS_VALUE", reason: "teste" },
      }).byNfe.get(9801)!;
    const draftOf = (allocationForNfe: ReturnType<typeof decide>) =>
      buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "c", customerNameSnapshot: "C", lines, sellerResolution: seller, nfeId: 9801, invoiceAllocation: allocationForNfe });

    const full = decide("FULL");
    assert.equal(full.basis, "FULL_ORDER_LEGACY");
    assert.equal(draftOf(full).sourceHash, without.sourceHash, "integral comprovado: mesmo snapshot e hash de antes");

    for (const status of ["PARTIAL", "UNPROVEN"] as const) {
      const held = decide(status);
      assert.equal(held.basis, "ALLOCATION_PENDING");
      assert.match(held.reason ?? "", status === "PARTIAL" ? /fatura só parte do pedido/ : /sem comprovação de faturamento integral/);
      const draft = draftOf(held);
      assert.equal(draft.totalFinalCommissionAmount, 0);
      assert.ok(draft.items.every((item) => item.status === "ERROR"));
      assert.equal(
        deriveReceivableScheduleStatus({ itemStatuses: draft.items.map((item) => item.status), totalFinalCommissionAmount: 0 }),
        "ERROR",
        "schedule retido (não final): o recebimento fica pendente, nada é perdido"
      );
    }
  });
});

describe("prova de faturamento integral da NF-e única (sem evidência por item)", () => {
  it("cobertura por item decide; sem ela, valor de produtos da NF-e × pedidos com a tolerância do faturamento", () => {
    const proof = (itemizedCoverage: "FULL" | "PARTIAL" | "NONE" | "UNKNOWN", nfeProductsValue: number | null, ordersNetTotal: number | null) =>
      resolveSingleNfeBillingProof({ itemizedCoverage, itemizedReason: "R", nfeProductsValue, ordersNetTotal }).status;
    assert.equal(proof("FULL", 10, 1000), "FULL", "item cobre: valor não sobrepõe");
    assert.equal(proof("PARTIAL", 1000, 1000), "PARTIAL", "item parcial: valor não sobrepõe");
    assert.equal(proof("UNKNOWN", 1000, 1000), "FULL");
    assert.equal(proof("NONE", 995, 1000), "FULL", "dentro de 1%");
    assert.equal(proof("UNKNOWN", 989.99, 1000), "PARTIAL", "fora de 1%");
    assert.equal(proof("UNKNOWN", 99.5, 100), "FULL", "R$ 1 de tolerância absoluta");
    assert.equal(proof("UNKNOWN", 98.9, 100), "PARTIAL");
    assert.equal(proof("UNKNOWN", null, 1000), "UNPROVEN");
    assert.equal(proof("UNKNOWN", 0, 1000), "UNPROVEN");
    assert.equal(proof("UNKNOWN", 1000, null), "UNPROVEN");
  });

  const flow = (invoicedQuantity: number, verifiedAt = new Date("2026-10-10T00:00:00Z")) => ({
    salesOrderItemId: "it-1",
    isActiveForKanban: true,
    currentStage: "INVOICED",
    orderedQuantity: 10,
    shipTargetQuantity: 10,
    activeRemainingQuantity: 10 - invoicedQuantity,
    invoicedQuantity,
    computedAt: verifiedAt,
    verifiedAt,
  });
  const proofDb = (input: { flowRows: ReturnType<typeof flow>[]; valorLiquido: number | null; orders: number[] }) =>
    ({
      nomusNfe: { findUnique: async () => ({ valorLiquido: input.valorLiquido, xmlVProd: null, xmlVDesc: null }) },
      salesOrderNfeLink: {
        findMany: async () =>
          input.orders.map((_, index) => ({
            salesOrderId: "so-" + index,
            firstSeenAt: new Date("2026-10-05T00:00:00Z"),
            dataProcessamento: new Date("2026-10-04T00:00:00Z"),
          })),
      },
      salesOrderItemFlowSnapshot: { findMany: async () => input.flowRows },
      salesOrderItem: { count: async () => 1 },
      salesOrder: { findMany: async () => input.orders.map((total) => ({ totalNetValue: total })) },
    }) as unknown as Parameters<typeof loadSingleNfeBillingProof>[0];
  const load = (db: ReturnType<typeof proofDb>) =>
    loadSingleNfeBillingProof(db, { salesOrderId: "so-0", nfeExternalId: 1, nfeProcessedAt: new Date("2026-10-04T00:00:00Z") });

  it("carga: snapshot do motor operacional fresco decide; defasado cai no valor; sem valor não prova", async () => {
    assert.equal((await load(proofDb({ flowRows: [flow(4)], valorLiquido: 1000, orders: [1000] }))).status, "PARTIAL");
    assert.equal((await load(proofDb({ flowRows: [flow(10)], valorLiquido: 10, orders: [1000] }))).status, "FULL");
    // Snapshot gravado antes da NF-e ser conhecida: não é autoridade (mesma regra do Faturamento).
    const stale = await load(proofDb({ flowRows: [flow(10, new Date("2026-10-01T00:00:00Z"))], valorLiquido: 400, orders: [1000] }));
    assert.deepEqual([stale.status, stale.source], ["PARTIAL", "NFE_PRODUCTS_VALUE"]);
    // NF-e compartilhada: o valor de produtos precisa cobrir TODOS os pedidos dela.
    assert.equal((await load(proofDb({ flowRows: [], valorLiquido: 1500, orders: [1000, 500] }))).status, "FULL");
    assert.equal((await load(proofDb({ flowRows: [], valorLiquido: 1000, orders: [1000, 500] }))).status, "PARTIAL");
    assert.equal((await load(proofDb({ flowRows: [], valorLiquido: null, orders: [1000] }))).status, "UNPROVEN");
  });
});

describe("carga da evidência: NF-e compartilhada por pedidos do mesmo produto", () => {
  // NF-e 1 = pedido A (idItemPedido 111, 2 un.) + pedido B (idItemPedido 221, 3 un.), mesmo
  // produto; NF-e 2 = só A (5 un.). O resolvedor canônico liga a linha de B ao pedido A
  // pelo vínculo pedido × NF-e — ela não pode virar evidência (fraca) de A.
  const docLine = (id: string, idPedido: number, idItemPedido: number | null, quantidade: number) => ({
    id,
    externalProductId: 900,
    quantity: quantidade,
    estimatedTotalValue: quantidade * 10,
    rawJson: idItemPedido == null ? { idPedido, idProduto: 900, quantidade } : { idPedido, idItemPedido, idProduto: 900, quantidade },
  });
  const fakeDb = (nfe1Lines: ReturnType<typeof docLine>[]) =>
    ({
      nomusStockDocument: {
        findMany: async () => [
          { id: "d1", externalId: 501, idNfe: 1, isCancelled: false, statusRaw: "Emitido", tipoDocumentoEstoque: "Saída por venda", rawJson: {}, items: nfe1Lines },
          { id: "d2", externalId: 502, idNfe: 2, isCancelled: false, statusRaw: "Emitido", tipoDocumentoEstoque: "Saída por venda", rawJson: {}, items: [docLine("l3", 11, 111, 5)] },
        ],
      },
      salesOrderNfeLink: {
        findMany: async () => [
          { salesOrderId: "A", nfeExternalId: 1 },
          { salesOrderId: "B", nfeExternalId: 1 },
          { salesOrderId: "A", nfeExternalId: 2 },
        ],
      },
      salesOrder: {
        findMany: async () => [
          { id: "A", orderCode: "0011", externalSalesOrderId: 11, items: [{ id: "a1", nomusItemExternalId: 111, nomusItemSequence: "00001", externalProductId: 900 }] },
          { id: "B", orderCode: "0022", externalSalesOrderId: 22, items: [{ id: "b1", nomusItemExternalId: 221, nomusItemSequence: "00001", externalProductId: 900 }] },
        ],
      },
    }) as unknown as Parameters<typeof loadOrderInvoiceAllocation>[0];
  const linkedNfe = (id: number, day: number) => ({ nfeExternalId: id, dataProcessamento: new Date(Date.UTC(2026, 9, day)), isAuthorized: true, isOutputOperation: true, isCancelled: false });
  const bundleA = { localOrderId: "A", items: [{ localItemId: "a1", quantity: 10 }], linkedNfes: [linkedNfe(1, 1), linkedNfe(2, 5)] } as unknown as CommissionOrderSourceBundle;

  it("linha com idItemPedido oficial de outro pedido fica com esse pedido: A aloca 2 + 5", async () => {
    const result = await loadOrderInvoiceAllocation(fakeDb([docLine("l1", 11, 111, 2), docLine("l2", 22, 221, 3)]), bundleA);
    assert.deepEqual([1, 2].map((id) => result.byNfe.get(id)!.basis), ["INVOICED_ALLOCATION", "INVOICED_ALLOCATION"]);
    assert.deepEqual([1, 2].map((id) => result.byNfe.get(id)!.items.get("a1")!.invoicedQuantity), [2, 5]);
    assert.deepEqual(result.items.get("a1"), { orderedQuantity: 10, invoicedQuantity: 7, pendingQuantity: 3 });
  });

  it("linha sem idItemPedido que nenhum pedido reivindica pelo item oficial segue retendo a NF-e", async () => {
    const result = await loadOrderInvoiceAllocation(fakeDb([docLine("l1", 11, 111, 2), docLine("l2", 22, null, 3)]), bundleA);
    assert.equal(result.byNfe.get(1)!.basis, "ALLOCATION_PENDING");
    assert.equal(result.byNfe.get(2)!.basis, "INVOICED_ALLOCATION");
  });
});
