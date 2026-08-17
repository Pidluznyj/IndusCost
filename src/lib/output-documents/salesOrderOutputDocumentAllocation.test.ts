/**
 * CARACTERIZAÇÃO — `projectOutputDocumentForSalesOrder` × fiação inline antiga.
 *
 * A função extraída substituiu um trecho inline de `loadOrderFullAuditUncached`
 * (orderFullAuditService.ts, antes da extração). `referencia()` abaixo é uma
 * transcrição literal daquele trecho, mantida aqui como implementação de
 * referência: se a extraída divergir dela, a regra mudou.
 *
 * `allocatedValue` é comparado como número exato — é o insumo que move o
 * número do Fluxo de Caixa.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocatedValueForSalesOrder,
  allocationLinesFromResolvedO2c,
  projectOutputDocumentAllocation,
  type OutputDocumentAllocationOrderItemHint,
  type OutputDocumentAllocationStageDocumentInput,
} from "@/src/lib/output-documents/outputDocumentAllocationProjection.js";
import {
  projectOutputDocumentForSalesOrder,
  type OutputDocumentFallbackFactLine,
  type ResolvedAllocationLines,
} from "@/src/lib/output-documents/salesOrderOutputDocumentAllocation.js";

type Caso = {
  nome: string;
  document: OutputDocumentAllocationStageDocumentInput;
  resolvedAllocationLines: ResolvedAllocationLines | null;
  fallbackFacts: OutputDocumentFallbackFactLine[];
  orderItemHints: OutputDocumentAllocationOrderItemHint[];
  salesOrderId: string;
  orderCode: string | null;
  productExternalIdBySalesOrderItemId?: Map<string, number | null>;
};

/** Transcrição literal da fiação que existia inline no audit. */
function referencia(c: Caso) {
  const allocationLines = c.resolvedAllocationLines
    ? allocationLinesFromResolvedO2c(
        c.resolvedAllocationLines,
        c.document.items.map((item) => ({
          stockDocumentItemId: item.id,
          externalProductId: item.externalProductId,
        }))
      )
    : c.fallbackFacts.map((f) => ({
        stockDocumentItemId: f.stockDocumentItemId ?? null,
        salesOrderId: f.salesOrderId ?? c.salesOrderId,
        salesOrderItemId: f.salesOrderItemId ?? null,
        orderCode: f.orderCode ?? c.orderCode ?? null,
        allocatedValueByDocumentPrice: f.allocatedValueByDocumentPrice,
        quantityUsedForOrder: f.quantityUsedForOrder,
        externalProductId:
          f.stockDocumentItemExternalProductId ??
          (f.salesOrderItemId
            ? c.productExternalIdBySalesOrderItemId?.get(f.salesOrderItemId) ??
              null
            : null),
      }));

  const projection = projectOutputDocumentAllocation({
    document: c.document,
    allocationLines,
    orderItemHints: c.orderItemHints,
    focusSalesOrderId: c.salesOrderId,
  });
  const forThisOrder = allocatedValueForSalesOrder(projection, c.salesOrderId);
  return {
    projection,
    allocatedValueCents: forThisOrder.allocatedValueCents,
    allocatedValue: forThisOrder.allocatedValue,
  };
}

function docStage(
  externalId: number,
  itens: Array<{ id: string; produto: number; qtd: string; unit: string }>
): OutputDocumentAllocationStageDocumentInput {
  return {
    id: `doc-${externalId}`,
    externalId,
    idNfe: 900 + externalId,
    totalValue: String(
      itens.reduce((s, i) => s + Number(i.qtd) * Number(i.unit), 0)
    ),
    items: itens.map((i) => ({
      id: i.id,
      externalItemId: Number(i.id.replace(/\D/g, "")) || 1,
      externalProductId: i.produto,
      quantity: i.qtd,
      unitValue: i.unit,
      estimatedTotalValue: String(Number(i.qtd) * Number(i.unit)),
    })),
  };
}

function hints(
  pares: Array<[string, string, number]>
): OutputDocumentAllocationOrderItemHint[] {
  return pares.map(([salesOrderItemId, salesOrderId, externalProductId]) => ({
    salesOrderItemId,
    salesOrderId,
    orderCode: salesOrderId,
    externalProductId,
  }));
}

function linhaResolver(over: {
  stockDocumentItemId: string | null;
  salesOrderId: string | null;
  salesOrderItemId: string | null;
  allocatedValueByDocumentPrice: string | null;
  quantityUsedForOrder: string | null;
}) {
  return over as unknown as ResolvedAllocationLines[number];
}

const CASOS: Caso[] = [
  {
    nome: "sem documento resolvido e sem facts (nada alocado)",
    document: docStage(1, [{ id: "sdi-1", produto: 11, qtd: "1", unit: "100" }]),
    resolvedAllocationLines: null,
    fallbackFacts: [],
    orderItemHints: hints([["I1", "SO-1", 11]]),
    salesOrderId: "SO-1",
    orderCode: "PV-1",
  },
  {
    nome: "um documento, alocação integral via resolver",
    document: docStage(2, [{ id: "sdi-2", produto: 11, qtd: "2", unit: "500" }]),
    resolvedAllocationLines: [
      linhaResolver({
        stockDocumentItemId: "sdi-2",
        salesOrderId: "SO-1",
        salesOrderItemId: "I1",
        allocatedValueByDocumentPrice: "1000",
        quantityUsedForOrder: "2",
      }),
    ],
    fallbackFacts: [],
    orderItemHints: hints([["I1", "SO-1", 11]]),
    salesOrderId: "SO-1",
    orderCode: "PV-1",
  },
  {
    nome: "documento parcial: só metade da quantidade vai ao pedido",
    document: docStage(3, [{ id: "sdi-3", produto: 21, qtd: "4", unit: "100" }]),
    resolvedAllocationLines: [
      linhaResolver({
        stockDocumentItemId: "sdi-3",
        salesOrderId: "SO-2",
        salesOrderItemId: "I2",
        allocatedValueByDocumentPrice: "200",
        quantityUsedForOrder: "2",
      }),
    ],
    fallbackFacts: [],
    orderItemHints: hints([["I2", "SO-2", 21]]),
    salesOrderId: "SO-2",
    orderCode: "PV-2",
  },
  {
    nome: "mesmo documento dividido entre dois pedidos (foco SO-3)",
    document: docStage(4, [
      { id: "sdi-4a", produto: 31, qtd: "3", unit: "200" },
      { id: "sdi-4b", produto: 32, qtd: "1", unit: "400" },
    ]),
    resolvedAllocationLines: [
      linhaResolver({
        stockDocumentItemId: "sdi-4a",
        salesOrderId: "SO-3",
        salesOrderItemId: "I3",
        allocatedValueByDocumentPrice: "600",
        quantityUsedForOrder: "3",
      }),
      linhaResolver({
        stockDocumentItemId: "sdi-4b",
        salesOrderId: "SO-4",
        salesOrderItemId: "I4",
        allocatedValueByDocumentPrice: "400",
        quantityUsedForOrder: "1",
      }),
    ],
    fallbackFacts: [],
    orderItemHints: hints([
      ["I3", "SO-3", 31],
      ["I4", "SO-4", 32],
    ]),
    salesOrderId: "SO-3",
    orderCode: "PV-3",
  },
  {
    nome: "mesmo documento, foco no outro pedido (SO-4)",
    document: docStage(4, [
      { id: "sdi-4a", produto: 31, qtd: "3", unit: "200" },
      { id: "sdi-4b", produto: 32, qtd: "1", unit: "400" },
    ]),
    resolvedAllocationLines: [
      linhaResolver({
        stockDocumentItemId: "sdi-4a",
        salesOrderId: "SO-3",
        salesOrderItemId: "I3",
        allocatedValueByDocumentPrice: "600",
        quantityUsedForOrder: "3",
      }),
      linhaResolver({
        stockDocumentItemId: "sdi-4b",
        salesOrderId: "SO-4",
        salesOrderItemId: "I4",
        allocatedValueByDocumentPrice: "400",
        quantityUsedForOrder: "1",
      }),
    ],
    fallbackFacts: [],
    orderItemHints: hints([
      ["I3", "SO-3", 31],
      ["I4", "SO-4", 32],
    ]),
    salesOrderId: "SO-4",
    orderCode: "PV-4",
  },
  {
    nome: "FALLBACK por facts (documento não resolvido)",
    document: docStage(5, [{ id: "sdi-5", produto: 41, qtd: "1", unit: "250" }]),
    resolvedAllocationLines: null,
    fallbackFacts: [
      {
        stockDocumentItemId: "sdi-5",
        salesOrderId: "SO-5",
        salesOrderItemId: "I5",
        orderCode: "PV-5",
        allocatedValueByDocumentPrice: "250",
        quantityUsedForOrder: "1",
        stockDocumentItemExternalProductId: 41,
      },
    ],
    orderItemHints: hints([["I5", "SO-5", 41]]),
    salesOrderId: "SO-5",
    orderCode: "PV-5",
  },
  {
    nome: "FALLBACK sem produto no fact: cai no mapa do item do pedido",
    document: docStage(6, [{ id: "sdi-6", produto: 51, qtd: "2", unit: "150" }]),
    resolvedAllocationLines: null,
    fallbackFacts: [
      {
        stockDocumentItemId: null,
        salesOrderId: null,
        salesOrderItemId: "I6",
        orderCode: null,
        allocatedValueByDocumentPrice: "300",
        quantityUsedForOrder: "2",
      },
    ],
    orderItemHints: hints([["I6", "SO-6", 51]]),
    salesOrderId: "SO-6",
    orderCode: "PV-6",
    productExternalIdBySalesOrderItemId: new Map([["I6", 51]]),
  },
  {
    nome: "documento com item extra fora do pedido",
    document: docStage(7, [
      { id: "sdi-7a", produto: 61, qtd: "1", unit: "100" },
      { id: "sdi-7b", produto: 99, qtd: "1", unit: "900" },
    ]),
    resolvedAllocationLines: [
      linhaResolver({
        stockDocumentItemId: "sdi-7a",
        salesOrderId: "SO-7",
        salesOrderItemId: "I7",
        allocatedValueByDocumentPrice: "100",
        quantityUsedForOrder: "1",
      }),
    ],
    fallbackFacts: [],
    orderItemHints: hints([["I7", "SO-7", 61]]),
    salesOrderId: "SO-7",
    orderCode: "PV-7",
  },
];

describe("CARACTERIZAÇÃO — alocação de documento por pedido (extraída × inline)", () => {
  for (const caso of CASOS) {
    it(caso.nome, () => {
      const esperado = referencia(caso);
      const obtido = projectOutputDocumentForSalesOrder(caso);

      assert.equal(
        obtido.allocatedValue,
        esperado.allocatedValue,
        "allocatedValue precisa ser idêntico"
      );
      assert.equal(obtido.allocatedValueCents, esperado.allocatedValueCents);
      assert.deepEqual(
        JSON.parse(JSON.stringify(obtido.projection)),
        JSON.parse(JSON.stringify(esperado.projection)),
        "projeção inteira precisa ser idêntica"
      );
    });
  }

  it("os casos exercitam alocação real (não são todos zero)", () => {
    const valores = CASOS.map(
      (c) => projectOutputDocumentForSalesOrder(c).allocatedValue
    );
    const positivos = valores.filter((v) => v > 0);
    assert.ok(
      positivos.length >= 5,
      `esperava vários casos com alocação > 0, veio ${JSON.stringify(valores)}`
    );
    // O caso sem resolver e sem facts tem de ser exatamente zero.
    assert.equal(valores[0], 0);
  });
});
