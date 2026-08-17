/**
 * LIGHT LOADER — comportamento e custo de consultas.
 *
 * Prisma em memória: cada `findMany` conta uma operação, o que permite provar
 * estruturalmente que NENHUMA consulta acontece por pedido — dobrar o
 * portfólio não muda a contagem.
 *
 * As regras internas (itens, recebíveis, IDs de NFe do AR, alocação de
 * documento, NFes relacionadas) já foram provadas equivalentes ao audit em
 * testes próprios. Aqui o alvo é a FIAÇÃO: partição correta por pedido,
 * população de AR sem os filtros da tela, e ausência de N+1.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  loadCashFlowOrderProjections,
  type CashFlowProjectionPrismaLike,
} from "@/src/lib/finance/cashFlowOrderProjectionLoader.server.js";

type Row = Record<string, unknown>;

function matches(row: Row, where: unknown): boolean {
  if (where == null || typeof where !== "object") return true;
  for (const [key, cond] of Object.entries(where as Record<string, unknown>)) {
    if (key === "OR") {
      if (!(cond as unknown[]).some((b) => matches(row, b))) return false;
      continue;
    }
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
  const perTable: Record<string, number> = {};
  const table = (name: string) => ({
    async findMany(args: { where?: unknown } = {}) {
      queries += 1;
      perTable[name] = (perTable[name] ?? 0) + 1;
      return (data[name] ?? []).filter((r) => matches(r, args.where)) as never;
    },
    async findFirst(args: { where?: unknown } = {}) {
      queries += 1;
      perTable[name] = (perTable[name] ?? 0) + 1;
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
    async findUnique(args: { where?: unknown } = {}) {
      queries += 1;
      perTable[name] = (perTable[name] ?? 0) + 1;
      return ((data[name] ?? []).find((r) => matches(r, args.where)) ??
        null) as never;
    },
  });
  return {
    prisma: {
      salesOrder: table("salesOrder"),
      salesOrderItem: table("salesOrderItem"),
      salesOrderNfeLink: table("salesOrderNfeLink"),
      orderToCashAuditFact: table("orderToCashAuditFact"),
      nomusAccountsReceivable: table("nomusAccountsReceivable"),
      nomusStockDocument: table("nomusStockDocument"),
      nomusStockDocumentItem: table("nomusStockDocumentItem"),
      nomusNfe: table("nomusNfe"),
    } as unknown as CashFlowProjectionPrismaLike,
    counter: () => queries,
    perTable: () => ({ ...perTable }),
  };
}

const REFERENCE_DATE = new Date("2026-03-15T12:00:00.000Z");

function item(id: string, over: Row = {}): Row {
  return {
    id,
    nomusItemExternalId: null,
    nomusItemSequence: null,
    skuSnapshot: "SKU-1",
    productNameSnapshot: "Produto",
    externalProductId: 11,
    unit: "PC",
    quantity: "1",
    negotiatedPrice: "1000",
    totalNetValue: "1000",
    nomusQuantityFulfilled: "0",
    nomusQuantityPending: null,
    nomusIsCanceled: false,
    nomusIsCut: false,
    nomusIsStale: false,
    nomusItemStatusRaw: "Em aberto",
    nomusItemStatusNormalized: "PENDING",
    nomusMatchConfidence: null,
    proposalItemId: null,
    nomusRawItem: null,
    ...over,
  };
}

function order(id: string, over: Row = {}): Row {
  return {
    id,
    orderCode: `PV-${id}`,
    issueDate: new Date("2026-01-05T00:00:00.000Z"),
    expectedDeliveryDate: null,
    paymentTerms: "30/60",
    paymentMethod: "Boleto",
    nomusRawResponse: null,
    totalNetValue: "1000",
    totalGrossValue: "1000",
    items: [item(`${id}-I1`)],
    nfeLinks: [],
    ...over,
  };
}

function nfeLink(nfeExternalId: number, over: Row = {}): Row {
  return {
    id: `L-${nfeExternalId}`,
    nfeExternalId,
    nfeNumber: String(nfeExternalId),
    nfeKey: `CHAVE-${nfeExternalId}`,
    nfeStatus: 1,
    presentInLastPayload: true,
    ...over,
  };
}

function cr(externalId: number, sourceInvoiceId: number, over: Row = {}): Row {
  return {
    id: `cr-${externalId}`,
    externalId,
    companyName: "Koppetel",
    personName: "Cliente Alfa",
    personCnpj: "12345678000199",
    description: null,
    comments: null,
    sourceInvoiceId,
    sourceInvoiceNumber: String(sourceInvoiceId),
    createdAtNomus: new Date("2026-01-05T00:00:00.000Z"),
    dueDate: new Date("2026-01-20T00:00:00.000Z"),
    competenceDate: null,
    scheduleDate: null,
    settlementDate: null,
    amountReceivable: "1000",
    amountScheduled: null,
    amountReceived: "0",
    balanceReceivable: "1000",
    paymentMethodName: "Boleto",
    bankAccountName: "Itau",
    rawPayload: null,
    ...over,
  };
}

function dataset(): Record<string, Row[]> {
  return {
    salesOrder: [
      order("A"), // sem NFe, sem AR
      order("B", { nfeLinks: [nfeLink(900)] }), // uma NFe + CR de janeiro
      order("C", { nfeLinks: [nfeLink(901), nfeLink(902)] }), // múltiplas NFes
      order("D", { nfeLinks: [nfeLink(902)] }), // N:N com C
    ],
    orderToCashAuditFact: [],
    nomusAccountsReceivable: [
      cr(5001, 900),
      cr(5002, 901, { amountReceivable: "500", balanceReceivable: "500" }),
      cr(5003, 902, { amountReceivable: "300", balanceReceivable: "300" }),
      // CR de outra NF, fora do portfólio — não pode vazar para nenhum pedido.
      cr(5999, 990),
    ],
    nomusStockDocument: [],
    nomusStockDocumentItem: [],
    nomusNfe: [
      { externalId: 900, status: 1 },
      { externalId: 901, status: 1 },
      { externalId: 902, status: 1 },
    ],
    salesOrderNfeLink: [
      { salesOrderId: "B", orderCode: "PV-B", nfeExternalId: 900, nfeKey: "CHAVE-900" },
      { salesOrderId: "C", orderCode: "PV-C", nfeExternalId: 901, nfeKey: "CHAVE-901" },
      { salesOrderId: "C", orderCode: "PV-C", nfeExternalId: 902, nfeKey: "CHAVE-902" },
      { salesOrderId: "D", orderCode: "PV-D", nfeExternalId: 902, nfeKey: "CHAVE-902" },
    ],
  };
}

const IDS = ["A", "B", "C", "D"];

describe("LIGHT LOADER — Fluxo de Caixa", () => {
  it("conjunto vazio não consulta nada", async () => {
    const { prisma, counter } = makePrisma(dataset());
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: [],
      referenceDate: REFERENCE_DATE,
    });
    assert.equal(out.size, 0);
    assert.equal(counter(), 0);
  });

  it("um pedido: contrato mínimo preenchido", async () => {
    const { prisma } = makePrisma(dataset());
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["B"],
      referenceDate: REFERENCE_DATE,
    });
    const b = out.get("B");
    assert.ok(b);
    assert.equal(b.salesOrderId, "B");
    assert.equal(b.orderCode, "PV-B");
    assert.equal(b.items.length, 1);
    assert.equal(b.receivables.length, 1);
    assert.equal(b.receivables[0]?.receivableExternalId, 5001);
    assert.equal(b.personName, "Cliente Alfa");
    // Contrato pequeno: nada de blocos 360º.
    assert.deepEqual(Object.keys(b).sort(), [
      "companyName",
      "items",
      "orderCode",
      "personCnpj",
      "personName",
      "plannedReceivables",
      "receivables",
      "salesOrderId",
      "stockDocuments",
    ]);
  });

  it("particiona o AR por pedido e não vaza CR de fora", async () => {
    const { prisma } = makePrisma(dataset());
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: IDS,
      referenceDate: REFERENCE_DATE,
    });

    const ids = (id: string) =>
      (out.get(id)?.receivables ?? []).map((r) => r.receivableExternalId).sort();

    assert.deepEqual(ids("A"), [], "pedido sem NFe não tem CR");
    assert.deepEqual(ids("B"), [5001]);
    assert.deepEqual(ids("C"), [5002, 5003], "duas NFes, dois CRs");
    assert.deepEqual(ids("D"), [5003], "N:N: só o CR da NF compartilhada");

    for (const id of IDS) {
      assert.ok(
        !ids(id).includes(5999),
        `CR de NF fora do portfólio vazou em ${id}`
      );
    }
  });

  it("TRAVA janeiro × março: CR fora da janela da tela continua cobrindo", async () => {
    // O CR vence em 20/01; a referência da projeção é 15/03. A população de AR
    // do loader é carregada SEM filtro de período — se algum dia passar a usar
    // os arRows recortados da tela, este CR sumiria e a cobertura mudaria.
    const { prisma } = makePrisma(dataset());
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["B"],
      referenceDate: REFERENCE_DATE,
    });
    const b = out.get("B");
    assert.equal(b?.receivables.length, 1, "CR de janeiro precisa estar aqui");
    assert.equal(b?.receivables[0]?.dueDate, "2026-01-20T00:00:00.000Z");
    assert.equal(b?.receivables[0]?.amountReceivable, 1000);
  });

  it("REGRESSÃO: a ordem dos CRs vem da consulta, não do agrupamento por NF-e", async () => {
    // Caso real do shadow (pedido 2d017e4f-…): a consulta devolveu
    // 18674 (NF 7788) antes de 18608 (NF 7751), mas os IDs de NF-e do pedido
    // saem na ordem [7751, 7788]. Agrupar por NF-e invertia os dois CRs.
    // O pertencimento vem dos nfeIds; a ORDEM vem de arRows.
    const data = dataset();
    data.salesOrder = [
      order("Z", { nfeLinks: [nfeLink(7751), nfeLink(7788)] }),
    ];
    data.salesOrderNfeLink = [
      { salesOrderId: "Z", orderCode: "PV-Z", nfeExternalId: 7751, nfeKey: "CHAVE-7751" },
      { salesOrderId: "Z", orderCode: "PV-Z", nfeExternalId: 7788, nfeKey: "CHAVE-7788" },
    ];
    data.nomusNfe = [
      { externalId: 7751, status: 1 },
      { externalId: 7788, status: 1 },
    ];
    // Ordem da consulta AR: 7788 primeiro, 7751 depois.
    data.nomusAccountsReceivable = [
      cr(18674, 7788, { dueDate: new Date("2026-08-05T00:00:00.000Z") }),
      cr(18608, 7751, { dueDate: new Date("2026-08-11T00:00:00.000Z") }),
    ];

    const { prisma } = makePrisma(data);
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["Z"],
      referenceDate: REFERENCE_DATE,
    });

    assert.deepEqual(
      (out.get("Z")?.receivables ?? []).map((r) => r.receivableExternalId),
      [18674, 18608],
      "ordem da consulta precisa sobreviver ao particionamento"
    );
  });

  it("REGRESSÃO: datas do documento vêm do fact quando ele existe", async () => {
    // Precedência do audit: o laço de facts cria a entrada do documento e
    // grava dataDocumento/dataMovimentacao a partir de fact.stockDocumentDate.
    // O stage só vale quando não há fact. Ler o stage direto zerava
    // dataMovimentacao em 27 dos 80 pedidos do shadow real.
    const FACT_DATE = new Date("2026-02-20T00:00:00.000Z");
    const STAGE_DOC_DATE = new Date("2026-01-10T00:00:00.000Z");

    const data = dataset();
    data.salesOrder = [order("W", { nfeLinks: [nfeLink(900)] })];
    data.salesOrderNfeLink = [
      { salesOrderId: "W", orderCode: "PV-W", nfeExternalId: 900, nfeKey: "CHAVE-900" },
    ];
    data.orderToCashAuditFact = [
      {
        id: "f1",
        salesOrderId: "W",
        runId: "run-1",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        orderItemSequence: 1,
        salesOrderItemId: "W-I1",
        nfeExternalId: 900,
        nfeNumber: "900",
        nfeKey: "CHAVE-900",
        nfeHeaderValue: "1000",
        nfeItemMatchedOrderItem: true,
        stockDocumentExternalId: 7001,
        stockDocumentDate: FACT_DATE,
        stockDocumentIdNfe: 900,
        stockDocumentItemId: "sdi-1",
        stockDocumentItemExternalProductId: 11,
        allocatedValueByDocumentPrice: "1000",
        quantityUsedForOrder: "1",
      },
    ];
    // Documento COM fact: o stage tem movementDate NULO — é o caso real.
    // Documento SEM fact (7002): o stage prevalece.
    data.nomusStockDocument = [
      {
        id: "doc-7001",
        externalId: 7001,
        idNfe: 900,
        tipoDocumentoEstoque: "DocumentoSaida",
        dataDocumento: STAGE_DOC_DATE,
        documentNumber: "DS-7001",
        statusRaw: "Confirmado",
        isCancelled: false,
        totalValue: "1000",
        personExternalId: 1,
        personName: "Cliente Alfa",
        companyExternalId: 2,
        companyName: "Koppetel",
        movementDate: null,
        paymentTermsRaw: "30/60",
      },
    ];
    data.nomusStockDocumentItem = [
      {
        id: "sdi-1",
        stockDocumentId: "doc-7001",
        externalItemId: 1,
        externalProductId: 11,
        quantity: "1",
        unitValue: "1000",
        estimatedTotalValue: "1000",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    ];

    const { prisma } = makePrisma(data);
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["W"],
      referenceDate: REFERENCE_DATE,
    });

    const doc = out.get("W")?.stockDocuments[0];
    assert.ok(doc, "documento precisa chegar");
    assert.equal(
      doc.dataMovimentacao,
      FACT_DATE.toISOString(),
      "dataMovimentacao tem de vir do fact, não do stage (que é nulo)"
    );
    assert.equal(
      doc.dataDocumento,
      FACT_DATE.toISOString(),
      "dataDocumento segue a mesma precedência do audit"
    );
  });

  it("sem fact para o documento, as datas vêm do stage", async () => {
    const STAGE_DOC = new Date("2026-01-10T00:00:00.000Z");
    const STAGE_MOV = new Date("2026-01-11T00:00:00.000Z");

    const data = dataset();
    data.salesOrder = [order("V", { nfeLinks: [nfeLink(900)] })];
    data.salesOrderNfeLink = [
      { salesOrderId: "V", orderCode: "PV-V", nfeExternalId: 900, nfeKey: "CHAVE-900" },
    ];
    data.orderToCashAuditFact = [];
    data.nomusStockDocument = [
      {
        id: "doc-7009",
        externalId: 7009,
        idNfe: 900,
        tipoDocumentoEstoque: "DocumentoSaida",
        dataDocumento: STAGE_DOC,
        documentNumber: "DS-7009",
        statusRaw: "Confirmado",
        isCancelled: false,
        totalValue: "1000",
        personExternalId: 1,
        personName: "Cliente Alfa",
        companyExternalId: 2,
        companyName: "Koppetel",
        movementDate: STAGE_MOV,
        paymentTermsRaw: "30/60",
      },
    ];
    data.nomusStockDocumentItem = [];

    const { prisma } = makePrisma(data);
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["V"],
      referenceDate: REFERENCE_DATE,
    });

    const doc = out.get("V")?.stockDocuments[0];
    assert.ok(doc);
    assert.equal(doc.dataDocumento, STAGE_DOC.toISOString());
    assert.equal(doc.dataMovimentacao, STAGE_MOV.toISOString());
  });

  it("cut e stale chegam projetados como tal", async () => {
    const data = dataset();
    data.salesOrder = [
      order("X", {
        items: [
          item("X-I1", { nomusIsCut: true, nomusQuantityFulfilled: "0.4" }),
          item("X-I2", { nomusIsStale: true }),
        ],
      }),
    ];
    const { prisma } = makePrisma(data);
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: ["X"],
      referenceDate: REFERENCE_DATE,
    });
    const items = out.get("X")?.items ?? [];
    assert.equal(items[0]?.nomusIsCut, true);
    assert.equal(items[0]?.cutQuantity, 0.6);
    assert.equal(items[1]?.nomusIsStale, true);
    assert.equal(items[1]?.canceledQuantity, 1);
  });

  it("QUERY REGRESSION: dobrar os pedidos não muda a contagem", async () => {
    const seis = makePrisma(dataset());
    await loadCashFlowOrderProjections(seis.prisma, {
      salesOrderIds: IDS,
      referenceDate: REFERENCE_DATE,
    });
    const q4 = seis.counter();

    // 2N: duplica os pedidos com os mesmos vínculos.
    const data = dataset();
    for (const id of IDS) {
      const base = (data.salesOrder as Row[]).find((o) => o.id === id)!;
      data.salesOrder.push({ ...base, id: `${id}2`, orderCode: `PV-${id}2` });
      for (const l of [...data.salesOrderNfeLink]) {
        if (l.salesOrderId === id) {
          data.salesOrderNfeLink.push({ ...l, salesOrderId: `${id}2` });
        }
      }
    }
    const doze = makePrisma(data);
    await loadCashFlowOrderProjections(doze.prisma, {
      salesOrderIds: [...IDS, ...IDS.map((i) => `${i}2`)],
      referenceDate: REFERENCE_DATE,
    });
    const q8 = doze.counter();

    console.info(
      `[query-regression:loader] ${IDS.length} pedidos = ${q4} | ${IDS.length * 2} pedidos = ${q8} | por tabela: ${JSON.stringify(doze.perTable())}`
    );

    assert.equal(q8, q4, "o custo do loader não pode depender do nº de pedidos");
    assert.ok(q4 <= 12, `esperava número fixo e pequeno de consultas, veio ${q4}`);
  });

  it("nenhuma consulta a mais quando há documentos e facts", async () => {
    const data = dataset();
    data.orderToCashAuditFact = [
      {
        id: "f1",
        salesOrderId: "B",
        runId: "run-1",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        orderItemSequence: 1,
        salesOrderItemId: "B-I1",
        nfeExternalId: 900,
        nfeNumber: "900",
        nfeKey: "CHAVE-900",
        nfeHeaderValue: "1000",
        nfeItemMatchedOrderItem: true,
        stockDocumentExternalId: 7001,
        stockDocumentIdNfe: 900,
        stockDocumentItemId: "sdi-1",
        stockDocumentItemExternalProductId: 11,
        allocatedValueByDocumentPrice: "1000",
        quantityUsedForOrder: "1",
      },
    ];
    data.nomusStockDocument = [
      {
        id: "doc-7001",
        externalId: 7001,
        idNfe: 900,
        tipoDocumentoEstoque: "DocumentoSaida",
        dataDocumento: new Date("2026-01-10T00:00:00.000Z"),
        documentNumber: "DS-7001",
        statusRaw: "Confirmado",
        isCancelled: false,
        totalValue: "1000",
        personExternalId: 1,
        personName: "Cliente Alfa",
        companyExternalId: 2,
        companyName: "Koppetel",
        movementDate: new Date("2026-01-10T00:00:00.000Z"),
        paymentTermsRaw: "30/60",
      },
    ];
    data.nomusStockDocumentItem = [
      {
        id: "sdi-1",
        stockDocumentId: "doc-7001",
        externalItemId: 1,
        externalProductId: 11,
        quantity: "1",
        unitValue: "1000",
        estimatedTotalValue: "1000",
        createdAt: new Date("2026-01-10T00:00:00.000Z"),
      },
    ];

    const { prisma, counter } = makePrisma(data);
    const out = await loadCashFlowOrderProjections(prisma, {
      salesOrderIds: IDS,
      referenceDate: REFERENCE_DATE,
    });

    const b = out.get("B");
    assert.equal(b?.stockDocuments.length, 1, "documento resolvido chegou");
    assert.equal(b?.stockDocuments[0]?.stockDocumentExternalId, 7001);
    const comDocs = counter();

    // Com documentos o resolver em lote entra em cena e o custo sobe — mas
    // continua FIXO. É a constância que importa, não um teto arbitrário.
    const dobrado: Record<string, Row[]> = {
      ...data,
      salesOrder: [...(data.salesOrder ?? [])],
      salesOrderNfeLink: [...(data.salesOrderNfeLink ?? [])],
    };
    for (const id of IDS) {
      const base = (data.salesOrder as Row[]).find((o) => o.id === id)!;
      dobrado.salesOrder.push({ ...base, id: `${id}2`, orderCode: `PV-${id}2` });
      for (const l of [...data.salesOrderNfeLink]) {
        if (l.salesOrderId === id) {
          dobrado.salesOrderNfeLink.push({ ...l, salesOrderId: `${id}2` });
        }
      }
    }
    const segundo = makePrisma(dobrado);
    await loadCashFlowOrderProjections(segundo.prisma, {
      salesOrderIds: [...IDS, ...IDS.map((i) => `${i}2`)],
      referenceDate: REFERENCE_DATE,
    });

    console.info(
      `[query-regression:loader+docs] ${IDS.length} pedidos = ${comDocs} | ${IDS.length * 2} pedidos = ${segundo.counter()}`
    );
    assert.equal(
      segundo.counter(),
      comDocs,
      "com documentos, dobrar os pedidos também não pode mudar a contagem"
    );
  });
});
