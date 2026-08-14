/**
 * SHADOW NÍVEL 1 — resolver de Documentos de Saída: por pedido × em lote.
 *
 * Prova que `loadOutputDocumentsForSalesOrdersBatch` devolve EXATAMENTE o que
 * `loadOutputDocumentsForSalesOrder` devolveria pedido a pedido, sobre o mesmo
 * conjunto de dados — e que faz isso com um número FIXO de consultas.
 *
 * O `allocatedValue` é o número que a fase 2C não pode mover: ele nasce aqui,
 * dentro de `resolveOutputDocument`. Comparação monetária é string exata.
 *
 * Sem banco: um Prisma em memória serve as duas implementações e conta as
 * consultas de cada uma.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadOutputDocumentsForSalesOrder } from "@/src/lib/output-documents/nomusOutputDocumentResolver.server.js";
import { loadOutputDocumentsForSalesOrdersBatch } from "@/src/lib/output-documents/nomusOutputDocumentResolverBatch.server.js";
import type { OutputDocumentResolverPrismaLike } from "@/src/lib/output-documents/nomusOutputDocumentResolver.server.js";

const TIPO_SAIDA = "DocumentoSaida";

type Row = Record<string, unknown>;

/** Avalia o `where` do Prisma nas formas realmente usadas pelos dois caminhos. */
function matches(row: Row, where: unknown): boolean {
  if (where == null || typeof where !== "object") return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === "OR") {
      const branches = cond as unknown[];
      if (!branches.some((b) => matches(row, b))) return false;
      continue;
    }
    const value = row[key];
    if (cond != null && typeof cond === "object" && "in" in (cond as Row)) {
      const list = (cond as { in: unknown[] }).in;
      if (!list.includes(value)) return false;
      continue;
    }
    if (value !== cond) return false;
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  if (orderBy == null || typeof orderBy !== "object") return rows;
  const [key, dir] = Object.entries(orderBy as Record<string, string>)[0] ?? [];
  if (!key) return rows;
  return [...rows].sort((a, b) => {
    const av = a[key] as number | string;
    const bv = b[key] as number | string;
    if (av === bv) return 0;
    const cmp = av < bv ? -1 : 1;
    return dir === "desc" ? -cmp : cmp;
  });
}

function makePrisma(data: Record<string, Row[]>) {
  let queries = 0;
  const table = (name: string) => ({
    async findMany(args: { where?: unknown; orderBy?: unknown } = {}) {
      queries += 1;
      return sortRows(
        (data[name] ?? []).filter((r) => matches(r, args.where)),
        args.orderBy
      ) as never;
    },
    async findFirst(args: { where?: unknown } = {}) {
      queries += 1;
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
    async findUnique(args: { where?: unknown } = {}) {
      queries += 1;
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
  });
  return {
    prisma: {
      nomusStockDocument: table("nomusStockDocument"),
      nomusStockDocumentItem: table("nomusStockDocumentItem"),
      nomusNfe: table("nomusNfe"),
      salesOrderNfeLink: table("salesOrderNfeLink"),
      salesOrder: table("salesOrder"),
      salesOrderItem: table("salesOrderItem"),
      orderToCashAuditFact: table("orderToCashAuditFact"),
      nomusAccountsReceivable: table("nomusAccountsReceivable"),
    } as unknown as OutputDocumentResolverPrismaLike,
    counter: () => queries,
    reset: () => {
      queries = 0;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Cenário: cobre sem documento, um, parcial, múltiplos, N:N e O2C.   */
/* ------------------------------------------------------------------ */

function doc(externalId: number, idNfe: number | null, total: string): Row {
  return {
    id: `doc-${externalId}`,
    externalId,
    idNfe,
    tipoDocumentoEstoque: TIPO_SAIDA,
    dataDocumento: new Date("2026-06-15T00:00:00.000Z"),
    documentNumber: `DS-${externalId}`,
    statusRaw: "Confirmado",
    isCancelled: false,
    totalValue: total,
    personExternalId: 1,
    personName: "Cliente X",
    companyExternalId: 2,
    companyName: "Koppetel",
    movementDate: new Date("2026-06-15T00:00:00.000Z"),
    paymentTermsRaw: "30/60",
  };
}

function docItem(
  docExternalId: number,
  seq: number,
  externalProductId: number,
  quantity: string,
  unitValue: string
): Row {
  return {
    id: `sdi-${docExternalId}-${seq}`,
    stockDocumentId: `doc-${docExternalId}`,
    externalItemId: docExternalId * 100 + seq,
    externalProductId,
    quantity,
    unitValue,
    estimatedTotalValue: String(Number(quantity) * Number(unitValue)),
    createdAt: new Date(`2026-06-15T00:0${seq}:00.000Z`),
  };
}

function fact(over: Row): Row {
  return {
    runId: "run-1",
    salesOrderId: null,
    orderCode: null,
    salesOrderItemId: null,
    nfeExternalId: null,
    stockDocumentExternalId: null,
    stockDocumentIdNfe: null,
    stockDocumentItemId: null,
    allocatedValueByDocumentPrice: null,
    quantityUsedForOrder: null,
    receivableIdsJson: null,
    ...over,
  };
}

function buildDataset(): Record<string, Row[]> {
  return {
    salesOrder: [
      { id: "SO-A", orderCode: "PV-A", status: "OPEN" },
      { id: "SO-B", orderCode: "PV-B", status: "OPEN" },
      { id: "SO-C", orderCode: "PV-C", status: "OPEN" },
      { id: "SO-D", orderCode: "PV-D", status: "OPEN" },
      { id: "SO-E", orderCode: "PV-E", status: "OPEN" },
      { id: "SO-F", orderCode: "PV-F", status: "OPEN" },
    ],
    salesOrderItem: [
      { id: "I-B1", salesOrderId: "SO-B", externalProductId: 11, nomusItemExternalId: 1 },
      { id: "I-C1", salesOrderId: "SO-C", externalProductId: 21, nomusItemExternalId: 2 },
      { id: "I-C2", salesOrderId: "SO-C", externalProductId: 22, nomusItemExternalId: 3 },
      { id: "I-D1", salesOrderId: "SO-D", externalProductId: 31, nomusItemExternalId: 4 },
      { id: "I-E1", salesOrderId: "SO-E", externalProductId: 31, nomusItemExternalId: 5 },
      { id: "I-F1", salesOrderId: "SO-F", externalProductId: 41, nomusItemExternalId: 6 },
    ],
    salesOrderNfeLink: [
      // SO-A: sem link → sem documento
      { id: "L-B", salesOrderId: "SO-B", orderCode: "PV-B", nfeExternalId: 900, nfeKey: "CHAVE-900" },
      { id: "L-C", salesOrderId: "SO-C", orderCode: "PV-C", nfeExternalId: 901, nfeKey: "CHAVE-901" },
      { id: "L-D", salesOrderId: "SO-D", orderCode: "PV-D", nfeExternalId: 902, nfeKey: "CHAVE-902" },
      { id: "L-D2", salesOrderId: "SO-D", orderCode: "PV-D", nfeExternalId: 903, nfeKey: "CHAVE-903" },
      // SO-E divide a mesma NF de SO-D (N:N)
      { id: "L-E", salesOrderId: "SO-E", orderCode: "PV-E", nfeExternalId: 902, nfeKey: "CHAVE-902" },
    ],
    nomusNfe: [
      { id: "nfe-900", externalId: 900, numero: "900", chave: "CHAVE-900", status: "AUTORIZADA" },
      { id: "nfe-901", externalId: 901, numero: "901", chave: "CHAVE-901", status: "AUTORIZADA" },
      { id: "nfe-902", externalId: 902, numero: "902", chave: "CHAVE-902", status: "AUTORIZADA" },
      { id: "nfe-903", externalId: 903, numero: "903", chave: "CHAVE-903", status: "AUTORIZADA" },
      { id: "nfe-904", externalId: 904, numero: "904", chave: "CHAVE-904", status: "AUTORIZADA" },
    ],
    nomusStockDocument: [
      doc(7000, 900, "1000"), // SO-B: documento integral
      doc(7001, 901, "400"), // SO-C: documento parcial
      doc(7002, 902, "600"), // SO-D + SO-E
      doc(7003, 903, "300"), // SO-D segundo documento
      doc(7004, 904, "250"), // SO-F: só alcançável via overlay O2C
    ],
    nomusStockDocumentItem: [
      docItem(7000, 1, 11, "2", "500"),
      docItem(7001, 1, 21, "1", "400"),
      docItem(7002, 1, 31, "3", "200"),
      docItem(7003, 1, 31, "1", "300"),
      docItem(7004, 1, 41, "1", "250"),
    ],
    orderToCashAuditFact: [
      fact({
        salesOrderId: "SO-B",
        orderCode: "PV-B",
        salesOrderItemId: "I-B1",
        nfeExternalId: 900,
        stockDocumentExternalId: 7000,
        stockDocumentIdNfe: 900,
        stockDocumentItemId: "sdi-7000-1",
        allocatedValueByDocumentPrice: "1000",
        quantityUsedForOrder: "2",
      }),
      fact({
        salesOrderId: "SO-C",
        orderCode: "PV-C",
        salesOrderItemId: "I-C1",
        nfeExternalId: 901,
        stockDocumentExternalId: 7001,
        stockDocumentIdNfe: 901,
        stockDocumentItemId: "sdi-7001-1",
        allocatedValueByDocumentPrice: "400",
        quantityUsedForOrder: "1",
      }),
      fact({
        salesOrderId: "SO-D",
        orderCode: "PV-D",
        salesOrderItemId: "I-D1",
        nfeExternalId: 902,
        stockDocumentExternalId: 7002,
        stockDocumentIdNfe: 902,
        stockDocumentItemId: "sdi-7002-1",
        allocatedValueByDocumentPrice: "400",
        quantityUsedForOrder: "2",
      }),
      fact({
        salesOrderId: "SO-E",
        orderCode: "PV-E",
        salesOrderItemId: "I-E1",
        nfeExternalId: 902,
        stockDocumentExternalId: 7002,
        stockDocumentIdNfe: 902,
        stockDocumentItemId: "sdi-7002-1",
        allocatedValueByDocumentPrice: "200",
        quantityUsedForOrder: "1",
      }),
      fact({
        salesOrderId: "SO-D",
        orderCode: "PV-D",
        salesOrderItemId: "I-D1",
        nfeExternalId: 903,
        stockDocumentExternalId: 7003,
        stockDocumentIdNfe: 903,
        stockDocumentItemId: "sdi-7003-1",
        allocatedValueByDocumentPrice: "300",
        quantityUsedForOrder: "1",
      }),
      // SO-F só chega ao documento 7004 pelo overlay O2C (não tem NfeLink)
      fact({
        salesOrderId: "SO-F",
        orderCode: "PV-F",
        salesOrderItemId: "I-F1",
        nfeExternalId: 904,
        stockDocumentExternalId: 7004,
        stockDocumentIdNfe: 904,
        stockDocumentItemId: "sdi-7004-1",
        allocatedValueByDocumentPrice: "250",
        quantityUsedForOrder: "1",
      }),
    ],
    nomusAccountsReceivable: [
      {
        id: "cr-1",
        externalId: 5001,
        sourceInvoiceId: 900,
        amountReceivable: "1000",
        balanceReceivable: "0",
        status: "RECEBIDO",
      },
      {
        id: "cr-2",
        externalId: 5002,
        sourceInvoiceId: 902,
        amountReceivable: "600",
        balanceReceivable: "600",
        status: "ABERTO",
      },
    ],
  };
}

const ORDER_IDS = ["SO-A", "SO-B", "SO-C", "SO-D", "SO-E", "SO-F"];

async function runOld(data: Record<string, Row[]>) {
  const { prisma, counter, reset } = makePrisma(data);
  reset();
  const out = new Map<string, unknown>();
  for (const id of ORDER_IDS) {
    out.set(id, await loadOutputDocumentsForSalesOrder(prisma, id));
  }
  return { out, queries: counter() };
}

async function runNew(data: Record<string, Row[]>) {
  const { prisma, counter, reset } = makePrisma(data);
  reset();
  const out = await loadOutputDocumentsForSalesOrdersBatch(prisma, ORDER_IDS);
  return { out, queries: counter() };
}

describe("SHADOW 1 — resolver de Documentos de Saída: por pedido × lote", () => {
  it("devolve exatamente os mesmos documentos resolvidos, pedido a pedido", async () => {
    const data = buildDataset();
    const old = await runOld(data);
    const neo = await runNew(data);

    for (const id of ORDER_IDS) {
      assert.deepEqual(
        JSON.parse(JSON.stringify(neo.out.get(id))),
        JSON.parse(JSON.stringify(old.out.get(id))),
        `divergência no pedido ${id}`
      );
    }
  });

  it("allocatedValue idêntico como string exata, documento a documento", async () => {
    const data = buildDataset();
    const old = await runOld(data);
    const neo = await runNew(data);

    const alloc = (v: unknown) =>
      (v as Array<{ document: { externalId: number }; o2c?: unknown }>).map(
        (d) => [d.document.externalId, JSON.stringify(d.o2c)] as const
      );

    let comparados = 0;
    for (const id of ORDER_IDS) {
      const a = alloc(old.out.get(id));
      const b = alloc(neo.out.get(id));
      assert.deepEqual(b, a, `alocação divergente no pedido ${id}`);
      comparados += a.length;
    }
    assert.ok(comparados >= 6, `esperava cobertura real, comparou ${comparados}`);
  });

  it("casos cobertos: sem documento, um, parcial, múltiplos, N:N e overlay O2C", async () => {
    const data = buildDataset();
    const { out } = await runNew(data);
    const count = (id: string) =>
      (out.get(id) as unknown[] | undefined)?.length ?? 0;

    assert.equal(count("SO-A"), 0, "SO-A não tem documento");
    assert.equal(count("SO-B"), 1, "SO-B tem um documento");
    assert.equal(count("SO-C"), 1, "SO-C tem documento parcial");
    assert.equal(count("SO-D"), 2, "SO-D tem múltiplos documentos");
    assert.equal(count("SO-E"), 1, "SO-E divide documento com SO-D (N:N)");
    assert.equal(count("SO-F"), 1, "SO-F chega ao documento só via overlay O2C");
  });

  it("o lote não escala com o número de pedidos (fim do N+1)", async () => {
    const data = buildDataset();
    const old = await runOld(data);
    const neo = await runNew(data);

    assert.ok(
      neo.queries < old.queries / 3,
      `lote deveria custar bem menos: antigo=${old.queries}, lote=${neo.queries}`
    );
    // Teto estrutural: o lote é um número fixo de consultas, não f(pedidos).
    console.info(`[query-regression] antigo=${old.queries} lote=${neo.queries}`);
    assert.ok(
      neo.queries <= 12,
      `lote deveria ser um número fixo de consultas, veio ${neo.queries}`
    );
  });

  it("dobrar os pedidos não dobra as consultas do lote", async () => {
    const data = buildDataset();
    const single = await runNew(data);

    // 2N: duplica os pedidos com documentos próprios.
    const dobrado = buildDataset();
    for (const id of ORDER_IDS) {
      const clone = `${id}-2`;
      dobrado.salesOrder!.push({ id: clone, orderCode: `${clone}`, status: "OPEN" });
      for (const link of buildDataset().salesOrderNfeLink!) {
        if (link.salesOrderId === id) {
          dobrado.salesOrderNfeLink!.push({ ...link, id: `${link.id}-2`, salesOrderId: clone });
        }
      }
      for (const f of buildDataset().orderToCashAuditFact!) {
        if (f.salesOrderId === id) {
          dobrado.orderToCashAuditFact!.push({ ...f, salesOrderId: clone });
        }
      }
    }

    const { prisma, counter } = makePrisma(dobrado);
    await loadOutputDocumentsForSalesOrdersBatch(prisma, [
      ...ORDER_IDS,
      ...ORDER_IDS.map((id) => `${id}-2`),
    ]);

    assert.equal(
      counter(),
      single.queries,
      `2N pedidos deveria custar as mesmas ${single.queries} consultas`
    );
  });
});
