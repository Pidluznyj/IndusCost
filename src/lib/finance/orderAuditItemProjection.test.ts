/**
 * CARACTERIZAÇÃO — `projectOrderAuditItems` × mapper inline antigo.
 *
 * `referencia()` é transcrição literal do `order.items.map(...)` que vivia em
 * `loadOrderFullAuditUncached` antes da extração. Divergência aqui significa
 * mudança de regra do auditor 360º, não teste desatualizado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decimalToNumber,
  projectOrderAuditItems,
  readNomusRawNumber,
  readNomusRawString,
  round2,
  toIso,
  type OrderAuditItemSource,
} from "@/src/lib/finance/orderAuditItemProjection.js";

function referencia(
  items: ReadonlyArray<OrderAuditItemSource>,
  expectedDeliveryDate: Date | string | null | undefined
) {
  return items.map((item, index) => {
    const qty = decimalToNumber(item.quantity);
    const unitPrice = decimalToNumber(item.negotiatedPrice);
    const totalNet = decimalToNumber(item.totalNetValue);
    const fulfilled = decimalToNumber(item.nomusQuantityFulfilled);
    const pending = decimalToNumber(item.nomusQuantityPending);
    const isCanceled = item.nomusIsCanceled === true;
    const isCut = item.nomusIsCut === true;
    const isStale = item.nomusIsStale === true;
    const canceledQty = isCanceled || isStale ? (qty ?? 0) : 0;
    const cutQty =
      isCut && qty != null && fulfilled != null
        ? Math.max(0, qty - fulfilled)
        : 0;
    const activeQty =
      qty != null ? Math.max(0, qty - canceledQty - cutQty) : null;
    const activePending =
      isCanceled || isStale
        ? 0
        : isCut
          ? 0
          : pending != null
            ? Math.max(0, pending)
            : activeQty != null && fulfilled != null
              ? Math.max(0, activeQty - fulfilled)
              : activeQty;
    const canceledValue =
      qty && unitPrice != null && canceledQty > 0
        ? round2(canceledQty * unitPrice)
        : 0;
    const cutValue =
      qty && unitPrice != null && cutQty > 0 ? round2(cutQty * unitPrice) : 0;
    const activeValue = round2(
      Math.max(0, (totalNet ?? 0) - canceledValue - cutValue)
    );

    const rawItem = item.nomusRawItem;
    return {
      salesOrderItemId: item.id,
      externalSalesOrderItemId: item.nomusItemExternalId ?? null,
      itemSequence: item.nomusItemSequence ?? String(index + 1),
      productCode: item.skuSnapshot,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      productExternalId: item.externalProductId ?? null,
      unit: item.unit ?? null,
      quantity: qty,
      unitPrice,
      totalNetValue: totalNet,
      nomusItemStatusRaw: item.nomusItemStatusRaw ?? null,
      nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
      itemStatus: item.nomusItemStatusNormalized ?? null,
      nomusIsCanceled: isCanceled,
      nomusIsCut: isCut,
      nomusIsStale: isStale,
      nomusQuantityFulfilled: fulfilled,
      nomusQuantityPending: pending,
      matchConfidence: item.nomusMatchConfidence ?? null,
      proposalItemId: item.proposalItemId ?? null,
      activeQuantity: activeQty,
      canceledQuantity: canceledQty > 0 ? canceledQty : 0,
      cutQuantity: cutQty > 0 ? cutQty : 0,
      activePendingQuantity: activePending,
      activeValue,
      canceledValue,
      cutValue,
      expectedDeliveryDate: toIso(expectedDeliveryDate),
      productionQuantity: readNomusRawNumber(rawItem, [
        "qtdeProduzida",
        "quantidadeProduzida",
        "producedQuantity",
      ]),
      invoicedQuantity: readNomusRawNumber(rawItem, [
        "qtdeFaturada",
        "quantidadeFaturada",
        "invoicedQuantity",
      ]),
      saldoAFaturar: readNomusRawNumber(rawItem, [
        "saldoFaturar",
        "saldoAFaturar",
        "remainingToInvoice",
      ]),
      saldoPronto: readNomusRawNumber(rawItem, [
        "saldoPronto",
        "saldoDisponivel",
        "readyBalance",
      ]),
      movementType: readNomusRawString(rawItem, [
        "tipoMovimentacao",
        "movementType",
        "descricaoMovimentacao",
      ]),
      cfop: readNomusRawString(rawItem, ["cfop", "codigoCfop", "cfopCode"]),
      linkedStockDocumentExternalIds: [],
      linkedNfeExternalIds: [],
      linkedReceivableExternalIds: [],
      alerts: [],
    };
  });
}

function item(over: Partial<OrderAuditItemSource> & { id: string }): OrderAuditItemSource {
  return {
    nomusItemExternalId: null,
    nomusItemSequence: null,
    skuSnapshot: "SKU-1",
    productNameSnapshot: "Produto 1",
    externalProductId: 11,
    unit: "PC",
    quantity: "2",
    negotiatedPrice: "100",
    totalNetValue: "200",
    nomusQuantityFulfilled: null,
    nomusQuantityPending: null,
    nomusIsCanceled: false,
    nomusIsCut: false,
    nomusIsStale: false,
    nomusItemStatusRaw: null,
    nomusItemStatusNormalized: null,
    nomusMatchConfidence: null,
    proposalItemId: null,
    nomusRawItem: null,
    ...over,
  };
}

const ENTREGA = new Date("2026-09-30T00:00:00.000Z");

const CENARIOS: Array<{
  nome: string;
  items: OrderAuditItemSource[];
  entrega: Date | string | null;
}> = [
  {
    nome: "item simples, sem flags",
    items: [item({ id: "I1" })],
    entrega: ENTREGA,
  },
  {
    nome: "item cancelado: quantidade e valor viram bucket cancelado",
    items: [item({ id: "I2", nomusIsCanceled: true })],
    entrega: ENTREGA,
  },
  {
    nome: "item stale: mesmo tratamento de cancelado",
    items: [item({ id: "I3", nomusIsStale: true })],
    entrega: ENTREGA,
  },
  {
    nome: "item cortado: corte = pedido − atendido",
    items: [
      item({ id: "I4", nomusIsCut: true, nomusQuantityFulfilled: "1" }),
    ],
    entrega: ENTREGA,
  },
  {
    nome: "item cortado sem quantidade atendida: corte fica zero",
    items: [item({ id: "I5", nomusIsCut: true, nomusQuantityFulfilled: null })],
    entrega: ENTREGA,
  },
  {
    nome: "pendente explícito prevalece sobre o derivado",
    items: [
      item({
        id: "I6",
        nomusQuantityFulfilled: "1",
        nomusQuantityPending: "0.5",
      }),
    ],
    entrega: ENTREGA,
  },
  {
    nome: "pendente derivado quando o Nomus não informa",
    items: [item({ id: "I7", nomusQuantityFulfilled: "0.5" })],
    entrega: ENTREGA,
  },
  {
    nome: "sequência ausente cai no índice (1-based)",
    items: [item({ id: "I8" }), item({ id: "I9" }), item({ id: "I10" })],
    entrega: ENTREGA,
  },
  {
    nome: "sequência informada é preservada",
    items: [item({ id: "I11", nomusItemSequence: "70" })],
    entrega: ENTREGA,
  },
  {
    nome: "nomusRawItem com números e strings com vírgula",
    items: [
      item({
        id: "I12",
        nomusRawItem: {
          qtdeProduzida: 3,
          quantidadeFaturada: "1,5",
          saldoAFaturar: "0,5",
          saldoDisponivel: 2,
          tipoMovimentacao: "  Venda  ",
          codigoCfop: 5102,
        },
      }),
    ],
    entrega: ENTREGA,
  },
  {
    nome: "nomusRawItem ausente ou inválido",
    items: [
      item({ id: "I13", nomusRawItem: null }),
      item({ id: "I14", nomusRawItem: "texto" }),
    ],
    entrega: null,
  },
  {
    nome: "quantidades nulas não quebram os buckets",
    items: [
      item({
        id: "I15",
        quantity: null,
        negotiatedPrice: null,
        totalNetValue: null,
      }),
    ],
    entrega: ENTREGA,
  },
  {
    nome: "cancelado e cortado ao mesmo tempo",
    items: [
      item({
        id: "I16",
        nomusIsCanceled: true,
        nomusIsCut: true,
        nomusQuantityFulfilled: "1",
      }),
    ],
    entrega: ENTREGA,
  },
  {
    nome: "valores decimais com arredondamento em 2 casas",
    items: [
      item({
        id: "I17",
        quantity: "3",
        negotiatedPrice: "33.333",
        totalNetValue: "99.999",
        nomusIsCut: true,
        nomusQuantityFulfilled: "1",
      }),
    ],
    entrega: ENTREGA,
  },
];

describe("CARACTERIZAÇÃO — mapper de itens do audit (extraído × inline)", () => {
  for (const cenario of CENARIOS) {
    it(cenario.nome, () => {
      const esperado = referencia(cenario.items, cenario.entrega);
      const obtido = projectOrderAuditItems({
        items: cenario.items,
        expectedDeliveryDate: cenario.entrega,
      });
      assert.deepEqual(
        JSON.parse(JSON.stringify(obtido)),
        JSON.parse(JSON.stringify(esperado))
      );
    });
  }

  it("vínculos O2C e alertas saem vazios (quem preenche é o audit)", () => {
    const [projetado] = projectOrderAuditItems({
      items: [item({ id: "I-X" })],
      expectedDeliveryDate: ENTREGA,
    });
    assert.deepEqual(projetado?.linkedStockDocumentExternalIds, []);
    assert.deepEqual(projetado?.linkedNfeExternalIds, []);
    assert.deepEqual(projetado?.linkedReceivableExternalIds, []);
    assert.deepEqual(projetado?.alerts, []);
  });
});
