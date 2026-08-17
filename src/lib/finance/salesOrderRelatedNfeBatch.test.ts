/**
 * SHADOW — NFes relacionadas ao pedido: por pedido × em lote.
 *
 * `referencia()` é transcrição literal de `resolveRelatedNfesForOrderAudit`
 * (orderFullAuditService.ts), que não é exportada. Ela roda contra o mesmo
 * Prisma em memória que o resolver em lote, então a comparação é do conjunto
 * resolvido, pedido a pedido, e a contagem de consultas é dos dois caminhos.
 *
 * NÃO tenta consertar o caso 8572 (N:N por NfeLink): o lote reproduz o
 * comportamento atual, imperfeições incluídas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractOfficialItemNfeExternalId,
  resolveSalesOrderRelatedNfes,
} from "@/src/lib/sales-orders/salesOrderRelatedNfeResolver.js";
import {
  resolveRelatedNfesForOrdersBatch,
  type RelatedNfeBatchOrderInput,
  type RelatedNfeBatchPrismaLike,
} from "@/src/lib/finance/salesOrderRelatedNfeBatch.server.js";

type Row = Record<string, unknown>;

function matches(row: Row, where: unknown): boolean {
  if (where == null || typeof where !== "object") return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    const value = row[key];
    if (cond != null && typeof cond === "object") {
      const c = cond as Record<string, unknown>;
      if ("in" in c) {
        if (!(c.in as unknown[]).includes(value)) return false;
        continue;
      }
      if ("not" in c) {
        if (value === c.not) return false;
        continue;
      }
    }
    if (value !== cond) return false;
  }
  return true;
}

function makePrisma(data: Record<string, Row[]>) {
  let queries = 0;
  const table = (name: string) => ({
    async findMany(args: { where?: unknown } = {}) {
      queries += 1;
      return (data[name] ?? []).filter((r) => matches(r, args.where)) as never;
    },
  });
  return {
    prisma: {
      nomusStockDocument: table("nomusStockDocument"),
      salesOrderNfeLink: table("salesOrderNfeLink"),
      nomusNfe: table("nomusNfe"),
    } as unknown as RelatedNfeBatchPrismaLike,
    counter: () => queries,
    reset: () => {
      queries = 0;
    },
  };
}

/** Transcrição literal do resolver por pedido. */
async function referencia(
  prisma: RelatedNfeBatchPrismaLike,
  input: RelatedNfeBatchOrderInput
) {
  const stockExternalIds = [
    ...new Set(
      input.o2cFacts
        .map((f) => f.stockDocumentExternalId)
        .filter((id): id is number => id != null && id > 0)
    ),
  ];

  const stockDocuments =
    stockExternalIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { externalId: { in: stockExternalIds } },
          select: { externalId: true, idNfe: true },
        })
      : [];

  const itemRefs: Array<{ salesOrderItemId: string; nfeExternalId: number }> = [];
  for (const item of input.items) {
    const nfeExternalId = extractOfficialItemNfeExternalId(item.nomusRawItem);
    if (nfeExternalId == null) continue;
    itemRefs.push({ salesOrderItemId: item.id, nfeExternalId });
  }

  const candidateIds = new Set<number>();
  for (const link of input.links) {
    if (link.nfeExternalId > 0) candidateIds.add(link.nfeExternalId);
  }
  for (const fact of input.o2cFacts) {
    if (fact.nfeExternalId != null && fact.nfeExternalId > 0) {
      candidateIds.add(fact.nfeExternalId);
    }
    if (fact.stockDocumentIdNfe != null && fact.stockDocumentIdNfe > 0) {
      candidateIds.add(fact.stockDocumentIdNfe);
    }
  }
  for (const doc of stockDocuments) {
    if (doc.idNfe != null && doc.idNfe > 0) candidateIds.add(doc.idNfe);
  }
  for (const ref of itemRefs) candidateIds.add(ref.nfeExternalId);

  const ids = [...candidateIds];
  const [foreignLinks, nfeRows] = await Promise.all([
    ids.length > 0
      ? prisma.salesOrderNfeLink.findMany({
          where: {
            nfeExternalId: { in: ids },
            salesOrderId: { not: input.salesOrderId },
          },
          select: { salesOrderId: true, orderCode: true, nfeExternalId: true },
        })
      : Promise.resolve([]),
    ids.length > 0
      ? prisma.nomusNfe.findMany({
          where: { externalId: { in: ids } },
          select: { externalId: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  return resolveSalesOrderRelatedNfes({
    salesOrderId: input.salesOrderId,
    links: input.links.map((link) => ({
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber,
      nfeKey: link.nfeKey,
      nfeStatus: link.nfeStatus,
      presentInLastPayload: link.presentInLastPayload,
      linkId: link.id,
    })),
    o2cFacts: input.o2cFacts,
    stockDocuments: stockDocuments.map((doc) => ({
      stockDocumentExternalId: doc.externalId,
      idNfe: doc.idNfe,
    })),
    itemRefs,
    foreignLinks,
    nfeStatusHints: nfeRows.map((row) => ({
      nfeExternalId: row.externalId,
      status: row.status,
    })),
  });
}

/* ------------------------------------------------------------------ */

function link(over: Partial<RelatedNfeBatchOrderInput["links"][number]> & { id: string; nfeExternalId: number }) {
  return {
    nfeNumber: String(over.nfeExternalId),
    nfeKey: `CHAVE-${over.nfeExternalId}`,
    nfeStatus: 1,
    presentInLastPayload: true,
    ...over,
  };
}

function fact(over: Partial<RelatedNfeBatchOrderInput["o2cFacts"][number]> = {}) {
  return {
    nfeExternalId: null,
    nfeNumber: null,
    nfeKey: null,
    stockDocumentExternalId: null,
    stockDocumentIdNfe: null,
    salesOrderItemId: null,
    nfeItemMatchedOrderItem: null,
    ...over,
  };
}

const DATA: Record<string, Row[]> = {
  nomusStockDocument: [
    { externalId: 7001, idNfe: 903 },
    { externalId: 7002, idNfe: null },
  ],
  nomusNfe: [
    { externalId: 900, status: 1 },
    { externalId: 901, status: 1 },
    { externalId: 902, status: 1 },
    { externalId: 903, status: 1 },
    { externalId: 904, status: 3 }, // cancelada
    { externalId: 905, status: 1 },
  ],
  salesOrderNfeLink: [
    { salesOrderId: "O2", orderCode: "PV-2", nfeExternalId: 900 },
    { salesOrderId: "O3", orderCode: "PV-3", nfeExternalId: 901 },
    { salesOrderId: "O3", orderCode: "PV-3", nfeExternalId: 902 },
    { salesOrderId: "O5", orderCode: "PV-5", nfeExternalId: 900 },
    { salesOrderId: "O6", orderCode: "PV-6", nfeExternalId: 902 },
    { salesOrderId: "O7", orderCode: "PV-7", nfeExternalId: 904 },
    { salesOrderId: "O10", orderCode: "PV-10", nfeExternalId: 905 },
  ],
};

const ORDERS: RelatedNfeBatchOrderInput[] = [
  // 1. pedido sem NFe
  { salesOrderId: "O1", links: [], items: [], o2cFacts: [] },
  // 2. uma NFe por SalesOrderNfeLink
  {
    salesOrderId: "O2",
    links: [link({ id: "L1", nfeExternalId: 900 })],
    items: [],
    o2cFacts: [],
  },
  // 3. múltiplas NFes
  {
    salesOrderId: "O3",
    links: [
      link({ id: "L2", nfeExternalId: 901 }),
      link({ id: "L3", nfeExternalId: 902 }),
    ],
    items: [],
    o2cFacts: [],
  },
  // 4. NFe alcançada pelo documento de saída (fact → doc.idNfe)
  {
    salesOrderId: "O4",
    links: [],
    items: [],
    o2cFacts: [fact({ stockDocumentExternalId: 7001 })],
  },
  // 5. mesma NFe de O2 → relação N:N
  {
    salesOrderId: "O5",
    links: [link({ id: "L4", nfeExternalId: 900 })],
    items: [],
    o2cFacts: [],
  },
  // 6. link duplicado com a mesma NFe
  {
    salesOrderId: "O6",
    links: [
      link({ id: "L5", nfeExternalId: 902 }),
      link({ id: "L6", nfeExternalId: 902 }),
    ],
    items: [],
    o2cFacts: [],
  },
  // 7. NFe cancelada (status 3)
  {
    salesOrderId: "O7",
    links: [link({ id: "L7", nfeExternalId: 904 })],
    items: [],
    o2cFacts: [],
  },
  // 8. NFe vinda do item (nomusRawItem.idNfe)
  {
    salesOrderId: "O8",
    links: [],
    items: [{ id: "IT-1", nomusRawItem: { idNfe: 901 } }],
    o2cFacts: [],
  },
  // 9. NFe vinda de stockDocumentIdNfe do fact
  {
    salesOrderId: "O9",
    links: [],
    items: [],
    o2cFacts: [fact({ stockDocumentIdNfe: 902, nfeExternalId: 902 })],
  },
  // 10. link sem chave/número + documento sem idNfe
  {
    salesOrderId: "O10",
    links: [
      link({ id: "L8", nfeExternalId: 905, nfeKey: null, nfeNumber: null }),
    ],
    items: [{ id: "IT-2", nomusRawItem: null }],
    o2cFacts: [fact({ stockDocumentExternalId: 7002 })],
  },
];

const ORDER_IDS = ORDERS.map((o) => o.salesOrderId);

describe("SHADOW — NFes relacionadas: por pedido × lote", () => {
  it("resolve exatamente o mesmo conjunto para cada pedido", async () => {
    const old = makePrisma(DATA);
    const oldOut = new Map<string, unknown>();
    for (const order of ORDERS) {
      oldOut.set(order.salesOrderId, await referencia(old.prisma, order));
    }

    const neo = makePrisma(DATA);
    const newOut = await resolveRelatedNfesForOrdersBatch(neo.prisma, ORDERS);

    for (const id of ORDER_IDS) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(newOut.get(id))),
        JSON.parse(JSON.stringify(oldOut.get(id))),
        `divergência no pedido ${id}`
      );
    }
  });

  it("caso N:N — a NFe 900 aparece nos dois pedidos, com o link estrangeiro", async () => {
    const neo = makePrisma(DATA);
    const out = await resolveRelatedNfesForOrdersBatch(neo.prisma, ORDERS);

    const o2 = out.get("O2");
    const o5 = out.get("O5");
    assert.ok(o2 && o5);
    assert.deepEqual(
      o2.nfes.map((n) => n.nfeExternalId),
      [900]
    );
    assert.deepEqual(
      o5.nfes.map((n) => n.nfeExternalId),
      [900]
    );
    // O predicado `salesOrderId != pedido` foi preservado nos dois sentidos.
    const old = makePrisma(DATA);
    assert.deepEqual(
      JSON.parse(JSON.stringify(o2)),
      JSON.parse(JSON.stringify(await referencia(old.prisma, ORDERS[1]!)))
    );
    assert.deepEqual(
      JSON.parse(JSON.stringify(o5)),
      JSON.parse(JSON.stringify(await referencia(old.prisma, ORDERS[4]!)))
    );
  });

  it("cobertura real: sem NFe, uma, múltiplas, documento, item, cancelada", async () => {
    const neo = makePrisma(DATA);
    const out = await resolveRelatedNfesForOrdersBatch(neo.prisma, ORDERS);
    const count = (id: string) => out.get(id)?.nfes.length ?? 0;

    assert.equal(count("O1"), 0, "pedido sem NFe");
    assert.equal(count("O2"), 1, "uma NFe por link");
    assert.equal(count("O3"), 2, "múltiplas NFes");
    assert.equal(count("O4"), 1, "NFe via documento de saída");
    assert.equal(count("O6"), 1, "link duplicado não duplica a NFe");
    assert.equal(count("O7"), 1, "NFe cancelada continua listada");
    assert.equal(count("O8"), 1, "NFe declarada no item");
    assert.equal(count("O9"), 1, "NFe via stockDocumentIdNfe");
  });

  it("query regression: o lote não cresce com o número de pedidos", async () => {
    const old = makePrisma(DATA);
    for (const order of ORDERS) await referencia(old.prisma, order);
    const oldQueries = old.counter();

    const seis = makePrisma(DATA);
    await resolveRelatedNfesForOrdersBatch(seis.prisma, ORDERS.slice(0, 6));
    const seisQueries = seis.counter();

    const doze = makePrisma(DATA);
    await resolveRelatedNfesForOrdersBatch(doze.prisma, ORDERS);
    const dozeQueries = doze.counter();

    console.info(
      `[query-regression:nfe] ${ORDERS.length} pedidos OLD=${oldQueries} | 6 BATCH=${seisQueries} | ${ORDERS.length} BATCH=${dozeQueries}`
    );
    assert.equal(
      dozeQueries,
      seisQueries,
      "dobrar os pedidos não pode mudar a contagem"
    );
    assert.ok(
      dozeQueries <= 3,
      `o lote deve custar no máximo 3 consultas, veio ${dozeQueries}`
    );
    assert.ok(oldQueries > dozeQueries * 3, `OLD=${oldQueries} deveria ser muito maior`);
  });
});
