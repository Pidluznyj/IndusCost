/**
 * Pedido Nomus ↔ Contas a Pagar — camada de I/O com Prisma falso.
 * Garante número constante de consultas, transação vínculo + histórico,
 * códigos de erro, que nada é escrito fora das tabelas locais de vínculo, a
 * CARDINALIDADE FINANCEIRA V1 (um título AP = no máximo um dono financeiro;
 * pré-checagem + unique global do banco → 409, não 500) e a SIMETRIA entre o
 * auto-link direto e a descoberta global de ownership.
 *
 * Os pré-filtros SQL (`$queryRaw`) são superconjunto por construção; o fake
 * devolve o superconjunto trivial (todas as linhas do seed) para provar que a
 * decisão é sempre do extrator canônico em memória.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { parsePurchaseOrderPlannedInstallments } from "./nomusPurchaseOrder360.js";
import { PurchaseOrderPayableLinkError } from "./nomusPurchaseOrderPayableLink.js";
import {
  PAYABLE_LINK_SQL_MARKERS,
  buildPurchaseOrderPayableReconciliationForOrder,
  confirmPurchaseOrderPayableLink,
  loadAutomaticPayableCandidatesForOrders,
  loadAutomaticPayableClaimsAcrossOrders,
  loadConfirmedPayableSnapshotsByOrder,
  loadOrderFinancialPayablesWithOwnership,
  mapPayableLinkError,
  removePurchaseOrderPayableLink,
  toPayableCandidateRow,
} from "./nomusPurchaseOrderPayableLink.server.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ORDER_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-20T12:00:00.000Z");
const ACTOR = { userId: "u1", userName: "Paulo" };

const RAW = {
  id: 613,
  codigoPedido: "PC00612",
  idPessoaFornecedor: 215,
  idEmpresa: 1,
  nfes: [{ id: 501, numero: "501" }],
  parcelas: [
    { dataVencimento: "16/10/2026", geraAdiantamento: false, idFormaPagamento: 10, idContaBancaria: 3, valorParcela: "1.136,68" },
    { dataVencimento: "30/10/2026", geraAdiantamento: false, idFormaPagamento: 10, idContaBancaria: 3, valorParcela: "1.136,68" },
    { dataVencimento: "09/11/2026", geraAdiantamento: false, idFormaPagamento: 10, idContaBancaria: 3, valorParcela: "1.171,14" },
  ],
};
const INSTALLMENTS = parsePurchaseOrderPlannedInstallments(RAW);

const ORDER = {
  id: ORDER_ID,
  externalId: 613,
  orderNumber: "PC00612",
  supplierExternalId: 215,
  supplierTaxId: "12345678000190",
  rawPayload: RAW as Record<string, unknown>,
};

/** Segundo pedido do MESMO fornecedor, mesmas parcelas, sem NF-e declarada (salvo override). */
const OTHER_ORDER = {
  id: OTHER_ORDER_ID,
  externalId: 614,
  orderNumber: "PC00613",
  supplierExternalId: 215,
  supplierTaxId: "12345678000190",
  rawPayload: { ...RAW, id: 614, codigoPedido: "PC00613", nfes: [] } as Record<string, unknown>,
};

type OrderSeed = typeof ORDER;

function orderWith(base: OrderSeed, overrides: Partial<OrderSeed> & { nfes?: unknown }): OrderSeed {
  const { nfes, ...rest } = overrides;
  return {
    ...base,
    ...rest,
    rawPayload: { ...(base.rawPayload as Record<string, unknown>), ...(nfes !== undefined ? { nfes } : {}) },
  };
}

class Dec {
  constructor(private readonly v: number) {}
  toString(): string {
    return String(this.v);
  }
}

type PayableSeed = Record<string, unknown> & { externalId: number };

function apRow(externalId: number, extra: Record<string, unknown> = {}): PayableSeed {
  return {
    externalId,
    companyId: 1,
    personId: 215,
    personName: "ACME LTDA",
    personCnpj: "12345678000190",
    documentNumber: null,
    sourceInvoiceId: null,
    sourceInvoiceNumber: null,
    dueDate: INSTALLMENTS[0].dueDate,
    paymentDate: null,
    settlementDate: null,
    amountPayable: new Dec(1136.68),
    amountPaid: new Dec(0),
    balancePayable: new Dec(1136.68),
    paymentMethodId: 10,
    paymentMethodName: "Boleto",
    bankAccountId: 3,
    description: null,
    comments: null,
    classification: null,
    status: true,
    suspendPayment: false,
    ...extra,
  };
}

type LinkRow = {
  id: string;
  nomusPurchaseOrderId: string;
  payableExternalId: number;
  installmentIndex: number | null;
  method: string;
  confidence: string;
  evidence: string | null;
  reason: string | null;
  createdByUserId: string | null;
  createdByUserName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type StockDocumentSeed = { idNfe: number | null; isCancelled: boolean; rawJson: Record<string, unknown> };

type Seed = {
  orders?: OrderSeed[];
  payables?: PayableSeed[];
  stockDocuments?: StockDocumentSeed[];
  links?: Array<Partial<LinkRow> & { payableExternalId: number; nomusPurchaseOrderId?: string }>;
  /** Simula a CORRIDA: a consulta de dono (pré-checagem) devolve vazio N vezes. */
  staleOwnerReads?: number;
  /** Depois da violação de unicidade, o dono some antes da reconsulta (desvinculado no meio). */
  ownerVanishesAfterConflict?: boolean;
  /** `meta.target` devolvido pelo Prisma na violação (default: colunas do índice violado). */
  uniqueMetaTarget?: unknown;
};

function matchesClause(row: Record<string, unknown>, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, cond]) => {
    const value = row[key];
    if (cond === null) return value == null;
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      const c = cond as Record<string, unknown>;
      if (Array.isArray(c.in)) return (c.in as unknown[]).includes(value);
      if (c.gte instanceof Date || c.lte instanceof Date) {
        if (!(value instanceof Date)) return false;
        if (c.gte instanceof Date && value < c.gte) return false;
        if (c.lte instanceof Date && value > c.lte) return false;
        return true;
      }
      if ("not" in c) return value !== c.not;
      return false;
    }
    return value === cond;
  });
}

function createDb(seed: Seed) {
  const orders = seed.orders ?? [ORDER];
  const payables = seed.payables ?? [];
  const stockDocuments = seed.stockDocuments ?? [];
  let linkSeq = 0;
  const links: LinkRow[] = (seed.links ?? []).map((row) => ({
    id: row.id ?? `link-${++linkSeq}`,
    nomusPurchaseOrderId: row.nomusPurchaseOrderId ?? ORDER_ID,
    payableExternalId: row.payableExternalId,
    installmentIndex: row.installmentIndex ?? null,
    method: row.method ?? "MANUAL",
    confidence: row.confidence ?? "CONFIRMED",
    evidence: row.evidence ?? null,
    reason: row.reason ?? "seed",
    createdByUserId: row.createdByUserId ?? "u0",
    createdByUserName: row.createdByUserName ?? "Seed",
    createdAt: row.createdAt ?? new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: row.updatedAt ?? new Date("2026-10-01T00:00:00.000Z"),
  }));
  const history: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  const writes: string[] = [];
  let transactions = 0;
  let staleOwnerReads = seed.staleOwnerReads ?? 0;

  const withOrderRelation = (row: LinkRow, select?: Record<string, unknown>) => {
    if (!select || !("nomusPurchaseOrder" in select)) return row;
    const order = orders.find((o) => o.id === row.nomusPurchaseOrderId);
    return { ...row, nomusPurchaseOrder: order ? { orderNumber: order.orderNumber } : null };
  };
  const projection = (order: OrderSeed) => ({
    id: order.id,
    externalId: order.externalId,
    orderNumber: order.orderNumber,
    supplierExternalId: order.supplierExternalId,
    supplierTaxId: order.supplierTaxId,
    nfes: (order.rawPayload as { nfes?: unknown }).nfes ?? null,
  });

  const db = {
    nomusPurchaseOrder: {
      findUnique: async (args: { where: { id: string } }) => {
        queries.push("order.findUnique");
        return orders.find((row) => row.id === args.where.id) ?? null;
      },
    },
    /**
     * Pré-filtros SQL: devolvem o SUPERCONJUNTO trivial (tudo do seed). Se a
     * regra em memória não for canônica, os testes de paridade quebram.
     */
    $queryRaw: async (query: { sql: string; values: unknown[] }) => {
      const marker = Object.entries(PAYABLE_LINK_SQL_MARKERS).find(([, value]) => query.sql.includes(value))?.[0];
      queries.push(`raw:${marker ?? "?"}`);
      switch (marker) {
        case "ordersDeclaringInvoices":
          return orders.filter((o) => Array.isArray((o.rawPayload as { nfes?: unknown }).nfes)).map(projection);
        case "ordersBySupplierScope":
          return orders.map(projection);
        case "ordersByExternalId":
          return orders.filter((o) => query.values.includes(o.externalId)).map(projection);
        case "stockDocumentsPointingToOrders":
          return stockDocuments.filter((d) => !d.isCancelled && d.idNfe != null).map((d) => ({ idNfe: d.idNfe, rawJson: d.rawJson }));
        case "payablesByDocumentNumber":
          return payables.filter((p) => typeof p.documentNumber === "string" && p.documentNumber.length > 0);
        default:
          throw new Error(`consulta raw sem marcador conhecido: ${query.sql.slice(0, 80)}`);
      }
    },
    nomusStockDocument: {
      findMany: async (args: { where: { idNfe?: { in?: number[] } } }) => {
        queries.push("stockDocument.findMany");
        const ids = args.where.idNfe?.in ?? [];
        return stockDocuments
          .filter((row) => !row.isCancelled && row.idNfe != null && ids.includes(row.idNfe))
          .map((row) => ({ idNfe: row.idNfe, rawJson: row.rawJson }));
      },
    },
    nomusAccountsPayable: {
      findMany: async (args: { where: { OR?: Array<Record<string, unknown>>; externalId?: { in: number[] }; sourceInvoiceId?: { in: number[] } } }) => {
        queries.push("accountsPayable.findMany");
        if (args.where.externalId) return payables.filter((row) => args.where.externalId!.in.includes(row.externalId));
        if (args.where.sourceInvoiceId) return payables.filter((row) => args.where.sourceInvoiceId!.in.includes(row.sourceInvoiceId as number));
        const or = args.where.OR ?? [];
        return payables.filter((row) => or.some((clause) => matchesClause(row, clause)));
      },
      findUnique: async (args: { where: { externalId: number } }) => {
        queries.push("accountsPayable.findUnique");
        return payables.find((row) => row.externalId === args.where.externalId) ?? null;
      },
    },
    nomusPurchaseOrderPayableLink: {
      findMany: async (args: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
        queries.push("link.findMany");
        const isOwnerLookup = "payableExternalId" in args.where && !("nomusPurchaseOrderId" in args.where);
        if (isOwnerLookup && staleOwnerReads > 0) {
          staleOwnerReads -= 1;
          return [];
        }
        return links
          .filter((row) => matchesClause(row as unknown as Record<string, unknown>, args.where))
          .map((row) => withOrderRelation(row, args.select));
      },
      findFirst: async (args: { where: { payableExternalId: number }; select?: Record<string, unknown> }) => {
        queries.push("link.findFirst");
        if (seed.ownerVanishesAfterConflict) return null;
        const row = links.find((r) => r.payableExternalId === args.where.payableExternalId);
        return row ? withOrderRelation(row, args.select) : null;
      },
      findUnique: async (args: {
        where: { nomusPurchaseOrderId_payableExternalId: { nomusPurchaseOrderId: string; payableExternalId: number } };
      }) => {
        queries.push("link.findUnique");
        const key = args.where.nomusPurchaseOrderId_payableExternalId;
        return (
          links.find(
            (row) => row.nomusPurchaseOrderId === key.nomusPurchaseOrderId && row.payableExternalId === key.payableExternalId
          ) ?? null
        );
      },
      create: async (args: { data: Omit<LinkRow, "id" | "createdAt" | "updatedAt"> }) => {
        writes.push("link.create");
        // O banco é a autoridade final: unique composta (pedido × título) E unique global (título).
        const samePair = links.some(
          (row) =>
            row.nomusPurchaseOrderId === args.data.nomusPurchaseOrderId &&
            row.payableExternalId === args.data.payableExternalId
        );
        const sameTitle = links.some((row) => row.payableExternalId === args.data.payableExternalId);
        if (samePair || sameTitle) {
          const target =
            seed.uniqueMetaTarget !== undefined
              ? seed.uniqueMetaTarget
              : samePair
                ? ["nomusPurchaseOrderId", "payableExternalId"]
                : ["payableExternalId"];
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });
        }
        const row: LinkRow = { ...args.data, id: `link-${++linkSeq}`, createdAt: NOW, updatedAt: NOW };
        links.push(row);
        return row;
      },
      delete: async (args: { where: { id: string } }) => {
        writes.push("link.delete");
        const index = links.findIndex((row) => row.id === args.where.id);
        if (index < 0) throw new Error("not found");
        return links.splice(index, 1)[0];
      },
    },
    nomusPurchaseOrderPayableLinkHistory: {
      create: async (args: { data: Record<string, unknown> }) => {
        writes.push("history.create");
        history.push(args.data);
        return { id: `h-${history.length}`, ...args.data };
      },
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      transactions += 1;
      return fn(db);
    },
  };

  return {
    db: db as unknown as PrismaClient,
    orders,
    links,
    history,
    queries,
    writes,
    get transactions() {
      return transactions;
    },
    /** Próximas N leituras de dono (pré-checagem) devolvem vazio — simula leitura anterior ao commit concorrente. */
    setStaleOwnerReads(count: number) {
      staleOwnerReads = count;
    },
  };
}

const codeOf = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return null;
  } catch (error) {
    return error instanceof PurchaseOrderPayableLinkError ? `${error.code}:${error.httpStatus}` : `other:${String(error)}`;
  }
};

/** Conjunto {pedido|título|método} — comparação de candidatos direto × global. */
const claimKey = (row: { nomusPurchaseOrderId: string; payableExternalId: number; method?: string | null }) =>
  `${row.nomusPurchaseOrderId}|${row.payableExternalId}|${row.method ?? ""}`;

async function directClaims(fake: ReturnType<typeof createDb>) {
  const byOrder = await loadAutomaticPayableCandidatesForOrders(fake.db, fake.orders);
  return [...byOrder.entries()]
    .flatMap(([orderId, c]) => c.automatic.map((link) => ({ nomusPurchaseOrderId: orderId, payableExternalId: link.payableExternalId, method: link.method })))
    .map(claimKey)
    .sort();
}

async function globalClaims(fake: ReturnType<typeof createDb>, payables: PayableSeed[]) {
  const refs = payables.map((row) => toPayableCandidateRow(row as never));
  return (await loadAutomaticPayableClaimsAcrossOrders(fake.db, refs)).map(claimKey).sort();
}

describe("buildPurchaseOrderPayableReconciliationForOrder", () => {
  it("resolve NF-e direta, documento de entrada e número do pedido com número constante de consultas", async () => {
    const fake = createDb({
      payables: [
        apRow(9001, { sourceInvoiceId: 501, amountPaid: new Dec(1136.68), balancePayable: new Dec(0), paymentDate: NOW, settlementDate: NOW }),
        apRow(9002, { sourceInvoiceId: 777, dueDate: INSTALLMENTS[1].dueDate }),
        apRow(9003, { documentNumber: "PC00612", dueDate: INSTALLMENTS[2].dueDate, amountPayable: new Dec(1171.14), balancePayable: new Dec(1171.14) }),
        apRow(9004, { personId: 999, personCnpj: "99999999000199", documentNumber: "PC00612" }),
        apRow(9005, { dueDate: new Date(2030, 0, 1) }),
      ],
      stockDocuments: [
        { idNfe: 777, isCancelled: false, rawJson: { idPedidoCompra: 613 } },
        { idNfe: 778, isCancelled: true, rawJson: { idPedidoCompra: 613 } },
      ],
    });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.deepEqual(
      view.unassignedPayables.map((row) => [row.payableExternalId, row.method, row.confidence, row.countsForThisOrder]),
      [
        [9001, "DIRECT_NOMUS_NFE", "EXACT", true],
        [9002, "STOCK_DOCUMENT_PURCHASE_ORDER", "EXACT", true],
        [9003, "AP_DOCUMENT_NUMBER", "EXACT", true],
      ]
    );
    assert.equal(view.totals.linkedCount, 3);
    assert.equal(view.totals.paidAmount, 1136.68);
    assert.equal(view.totals.excludedByOwnershipCount, 0);
    assert.equal(view.financialStatus, "PARTIALLY_PAID");
    assert.equal(view.suggestions.length, 0);
    // Constante e sem consulta por título: candidatos (documentos de entrada, títulos por NF-e, títulos
    // por número), persistidos, sugestões (janela do fornecedor), dono financeiro em lote.
    assert.deepEqual(fake.queries, [
      "order.findUnique",
      "raw:stockDocumentsPointingToOrders",
      "link.findMany",
      "accountsPayable.findMany",
      "raw:payablesByDocumentNumber",
      "accountsPayable.findMany",
      "link.findMany",
      "raw:ordersDeclaringInvoices",
      "raw:ordersBySupplierScope",
      "stockDocument.findMany",
    ]);
  });

  it("título só do mesmo fornecedor vira sugestão, nunca vínculo; título confirmado em outro pedido é sinalizado e NÃO é confirmável", async () => {
    const fake = createDb({
      orders: [ORDER, OTHER_ORDER],
      payables: [apRow(9101), apRow(9102, { dueDate: INSTALLMENTS[1].dueDate })],
      links: [{ nomusPurchaseOrderId: OTHER_ORDER_ID, payableExternalId: 9102 }],
    });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(view.totals.linkedCount, 0);
    assert.equal(view.financialStatus, "PLANNED_ONLY");
    assert.deepEqual(
      view.suggestions.map((row) => [row.installmentIndex, row.payableExternalId, row.linkedToOtherOrder, row.confirmable, row.ownerOrderNumber]),
      [
        [0, 9101, false, true, null],
        [1, 9102, true, false, "PC00613"],
      ]
    );
    assert.ok(view.warnings.some((w) => /9102 sugerido para a parcela 2 já está vinculado financeiramente a outro pedido \(PC00613\)/.test(w)));
  });

  it("Q. vínculo persistido cujo título sumiu do espelho: aviso, sem inventar valor nem dono", async () => {
    const fake = createDb({ payables: [apRow(9101)], links: [{ payableExternalId: 9999 }] });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.ok(view.warnings.some((w) => /Título 9999 vinculado manualmente não está mais no espelho/.test(w)));
    assert.equal(view.totals.linkedCount, 0);
    assert.equal(view.totals.linkedAmount, 0);
    assert.equal(view.financialStatus, "PLANNED_ONLY");
  });

  it("pedido inexistente: 404 PURCHASE_ORDER_NOT_FOUND", async () => {
    const fake = createDb({ orders: [] });
    await assert.rejects(
      () => buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db }),
      (error: unknown) =>
        error instanceof PurchaseOrderPayableLinkError && error.code === "PURCHASE_ORDER_NOT_FOUND" && error.httpStatus === 404
    );
  });
});

describe("simetria auto-link direto × descoberta global de ownership", () => {
  const X = 501;
  const title = () => apRow(9001, { sourceInvoiceId: X, amountPayable: new Dec(10000), amountPaid: new Dec(10000), balancePayable: new Dec(0), paymentDate: NOW, settlementDate: NOW });

  /** TODAS as formas aceitas pelo extrator canônico (`extractDirectNomusNfeRefs` → `toInt`). */
  const NFE_SHAPES: Array<[string, unknown]> = [
    ["nfes[].id numérico (canônico)", [{ id: X, numero: "501" }]],
    ["nfes[].id texto", [{ id: "501" }]],
    ["nfes[].id texto com zeros à esquerda", [{ id: "0501" }]],
    ["nfes[].id texto com sufixo (toInt ignora não dígitos)", [{ id: "501/A" }]],
    ["nfes[].idNfe", [{ idNfe: X }]],
    ["nfes[].externalId", [{ externalId: "501" }]],
    ["nfes[] escalar numérico", [X]],
    ["nfes[] escalar texto", ["501"]],
    ["nfes[].id nulo cai para idNfe (primeira chave não nula)", [{ id: null, idNfe: X }]],
  ];

  for (const [label, nfes] of NFE_SHAPES) {
    it(`forma "${label}": pedido é reconhecido pelo direto E descoberto pelo global`, async () => {
      const fake = createDb({ orders: [orderWith(ORDER, { nfes })], payables: [title()] });
      const direct = await directClaims(fake);
      const global = await globalClaims(fake, [title()]);
      assert.deepEqual(direct, [`${ORDER_ID}|9001|DIRECT_NOMUS_NFE`]);
      assert.deepEqual(global, direct);
      const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
      assert.equal(view.unassignedPayables[0]?.ownership.kind, "AUTO_SINGLE_OWNER");
      assert.equal(view.totals.paidAmount, 10000);
    });
  }

  it("forma NÃO aceita pelo extrator (id sem dígitos) não gera candidato em nenhum dos dois lados", async () => {
    const fake = createDb({ orders: [orderWith(ORDER, { nfes: [{ id: "abc", idNfe: X }] })], payables: [title()] });
    // `id` presente e não nulo vence, mesmo sem dígitos: não cai para idNfe (regra do extrator).
    assert.deepEqual(await directClaims(fake), []);
    assert.deepEqual(await globalClaims(fake, [title()]), []);
  });

  it("MISTO: PO A com nfes[].id canônico + PO B com forma alternativa da MESMA NF-e → AUTO_CONFLICT; ninguém conta", async () => {
    const alternatives: unknown[] = [[{ idNfe: "0501" }], [{ externalId: X }], ["501"], [X]];
    for (const nfes of alternatives) {
      const fake = createDb({ orders: [ORDER, orderWith(OTHER_ORDER, { nfes })], payables: [title()] });
      const direct = await directClaims(fake);
      assert.deepEqual(direct, [`${ORDER_ID}|9001|DIRECT_NOMUS_NFE`, `${OTHER_ORDER_ID}|9001|DIRECT_NOMUS_NFE`]);
      assert.deepEqual(await globalClaims(fake, [title()]), direct);
      const viewA = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
      const viewB = await buildPurchaseOrderPayableReconciliationForOrder(OTHER_ORDER_ID, { db: fake.db, now: NOW });
      for (const view of [viewA, viewB]) {
        assert.equal(view.unassignedPayables[0].ownership.kind, "AUTO_CONFLICT", JSON.stringify(nfes));
        assert.equal(view.unassignedPayables[0].countsForThisOrder, false);
        assert.equal(view.totals.paidAmount, 0);
        assert.equal(view.fullySettled, false);
      }
      const financial = await loadOrderFinancialPayablesWithOwnership(fake.orders, { db: fake.db });
      assert.equal(financial.ownership.get(9001)!.kind, "AUTO_CONFLICT", "listagem/360 veem o mesmo conflito");
    }
  });

  it("camada 2 (documento de entrada): idPedidoCompra/idPedido/pedidoCompraId, número ou texto, primeira chave vence — direto == global", async () => {
    const docs: Array<[string, Record<string, unknown>, boolean]> = [
      ["idPedidoCompra numérico", { idPedidoCompra: 613 }, true],
      ["idPedidoCompra texto", { idPedidoCompra: "613" }, true],
      ["idPedidoCompra texto com zeros", { idPedidoCompra: "000613" }, true],
      ["idPedido numérico", { idPedido: 613 }, true],
      ["pedidoCompraId texto", { pedidoCompraId: "613" }, true],
      ["idPedidoCompra de OUTRO pedido + idPedido deste: primeira chave vence → não é deste", { idPedidoCompra: 999, idPedido: 613 }, false],
    ];
    for (const [label, rawJson, expected] of docs) {
      const fake = createDb({
        orders: [orderWith(ORDER, { nfes: [] })],
        payables: [apRow(9002, { sourceInvoiceId: 777 })],
        stockDocuments: [{ idNfe: 777, isCancelled: false, rawJson }],
      });
      const direct = await directClaims(fake);
      const global = await globalClaims(fake, [apRow(9002, { sourceInvoiceId: 777 })]);
      assert.deepEqual(direct, expected ? [`${ORDER_ID}|9002|STOCK_DOCUMENT_PURCHASE_ORDER`] : [], label);
      assert.deepEqual(global, direct, label);
    }
    // Cancelado não liga em nenhum lado.
    const cancelled = createDb({
      orders: [orderWith(ORDER, { nfes: [] })],
      payables: [apRow(9002, { sourceInvoiceId: 777 })],
      stockDocuments: [{ idNfe: 777, isCancelled: true, rawJson: { idPedidoCompra: 613 } }],
    });
    assert.deepEqual(await directClaims(cancelled), []);
    assert.deepEqual(await globalClaims(cancelled, [apRow(9002, { sourceInvoiceId: 777 })]), []);
  });

  it("camada 3 (número do pedido no título): normalização e fornecedor iguais nos dois lados", async () => {
    const cases: Array<[string, Record<string, unknown>, boolean]> = [
      ["número exato", { documentNumber: "PC00612" }, true],
      ["minúsculas e separador", { documentNumber: "pc-00612" }, true],
      ["ID do pedido com zeros à esquerda", { documentNumber: "000613" }, true],
      ["outro fornecedor", { documentNumber: "PC00612", personId: 999, personCnpj: "99999999000199" }, false],
      ["fornecedor sem ID Nomus, CNPJ igual", { documentNumber: "PC00612", personId: null }, true],
      ["número parecido, não idêntico", { documentNumber: "PC006120" }, false],
    ];
    for (const [label, extra, expected] of cases) {
      const row = apRow(9003, { dueDate: new Date(2031, 0, 1), ...extra });
      const fake = createDb({ orders: [orderWith(ORDER, { nfes: [] })], payables: [row] });
      const direct = await directClaims(fake);
      assert.deepEqual(direct, expected ? [`${ORDER_ID}|9003|AP_DOCUMENT_NUMBER`] : [], label);
      assert.deepEqual(await globalClaims(fake, [row]), direct, label);
    }
  });

  it("PARIDADE estrutural: para um universo misto de pedidos/documentos/títulos, direto == global (por título, pedido e método)", async () => {
    const payables = [
      apRow(9001, { sourceInvoiceId: 501 }),
      apRow(9002, { sourceInvoiceId: 777 }),
      apRow(9003, { documentNumber: "pc00613" }),
      apRow(9004, { sourceInvoiceId: 888, documentNumber: "PC00612" }),
      apRow(9005, { personId: 300, personCnpj: "30000000000100", sourceInvoiceId: 502 }),
      apRow(9006, { documentNumber: "615" }),
    ];
    const fake = createDb({
      orders: [
        ORDER,
        orderWith(OTHER_ORDER, { nfes: ["0501", { externalId: 888 }] }),
        orderWith(OTHER_ORDER, { id: THIRD_ORDER_ID, externalId: 615, orderNumber: "PC00614", supplierExternalId: 300, supplierTaxId: "30000000000100", nfes: [{ id: null, idNfe: 502 }] }),
      ],
      stockDocuments: [
        { idNfe: 777, isCancelled: false, rawJson: { idPedidoCompra: "614" } },
        { idNfe: 777, isCancelled: false, rawJson: { pedidoCompraId: 613 } },
        { idNfe: 502, isCancelled: false, rawJson: { idPedidoCompra: 613 } },
      ],
      payables,
    });
    const direct = await directClaims(fake);
    const global = await globalClaims(fake, payables);
    assert.deepEqual(global, direct);
    assert.ok(direct.length >= 6, `universo cobre todas as camadas: ${direct.join(", ")}`);
    // E o dono financeiro resolve conflitos onde há mais de um pedido por título.
    const financial = await loadOrderFinancialPayablesWithOwnership(fake.orders, { db: fake.db });
    assert.equal(financial.ownership.get(9001)!.kind, "AUTO_CONFLICT", "NF-e 501 em A (id) e B ('0501')");
    assert.equal(financial.ownership.get(9002)!.kind, "AUTO_CONFLICT", "NF-e 777 aponta A (pedidoCompraId) e B (idPedidoCompra)");
    assert.equal(financial.ownership.get(9003)!.ownerOrderId, OTHER_ORDER_ID);
    assert.equal(financial.ownership.get(9004)!.kind, "AUTO_CONFLICT", "A por número do pedido, B por externalId da NF-e");
    assert.equal(financial.ownership.get(9005)!.kind, "AUTO_CONFLICT", "C por idNfe (fornecedor 300) e A por documento de entrada da NF-e 502");
    assert.equal(financial.ownership.get(9006), undefined, "ID 615 é do pedido C, mas o título é do fornecedor 215 ≠ 300: nenhum candidato, sem dono");
    assert.ok(!direct.some((key) => key.includes("|9006|")), "camada 3 exige o mesmo fornecedor nos dois lados");
  });
});

describe("cardinalidade V1 — dono financeiro na aba Financeiro (evidências de outros pedidos)", () => {
  const BOTH_DECLARE_501 = [ORDER, orderWith(OTHER_ORDER, { nfes: [{ id: 501, numero: "501" }] })];

  it("I. confirmado em A + NF-e do mesmo título em B → só A conta; em B fica visível como 'vinculado a outro pedido'", async () => {
    const paid = apRow(9001, { sourceInvoiceId: 501, amountPayable: new Dec(10000), amountPaid: new Dec(10000), balancePayable: new Dec(0), paymentDate: NOW, settlementDate: NOW });
    const fake = createDb({ orders: BOTH_DECLARE_501, payables: [paid], links: [{ nomusPurchaseOrderId: ORDER_ID, payableExternalId: 9001, method: "MANUAL" }] });

    const viewA = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(viewA.totals.paidAmount, 10000);
    assert.equal(viewA.totals.linkedCount, 1);
    assert.equal(viewA.fullySettled, true);
    assert.equal(viewA.unassignedPayables[0].ownership.kind, "CONFIRMED_OWNER");
    assert.equal(viewA.unassignedPayables[0].countsForThisOrder, true);

    const viewB = await buildPurchaseOrderPayableReconciliationForOrder(OTHER_ORDER_ID, { db: fake.db, now: NOW });
    const rowB = viewB.unassignedPayables[0];
    assert.equal(rowB.payableExternalId, 9001, "a evidência continua visível em B");
    assert.equal(rowB.countsForThisOrder, false);
    assert.equal(rowB.ownership.kind, "CONFIRMED_OWNER");
    assert.equal(rowB.ownership.ownerOrderId, ORDER_ID);
    assert.equal(rowB.ownership.ownerOrderNumber, "PC00612");
    assert.equal(viewB.totals.paidAmount, 0);
    assert.equal(viewB.totals.linkedAmount, 0);
    assert.equal(viewB.totals.excludedByOwnershipCount, 1);
    assert.equal(viewB.fullySettled, false, "o mesmo pagamento não quita dois pedidos");
    assert.equal(viewB.financialStatus, "PLANNED_ONLY");
    assert.ok(viewB.warnings.some((w) => /9001 está vinculado financeiramente a outro pedido \(PC00612\)/.test(w)));
    assert.equal(viewA.totals.paidAmount + viewB.totals.paidAmount, 10000, "R$ 10.000 não viram R$ 20.000");
  });

  it("K. NF-e do mesmo título em A e B, sem confirmação → conflito automático: 0 em A e 0 em B", async () => {
    const paid = apRow(9001, { sourceInvoiceId: 501, amountPayable: new Dec(10000), amountPaid: new Dec(10000), balancePayable: new Dec(0), paymentDate: NOW, settlementDate: NOW });
    const fake = createDb({ orders: BOTH_DECLARE_501, payables: [paid] });
    const viewA = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    const viewB = await buildPurchaseOrderPayableReconciliationForOrder(OTHER_ORDER_ID, { db: fake.db, now: NOW });
    for (const view of [viewA, viewB]) {
      assert.equal(view.unassignedPayables[0].ownership.kind, "AUTO_CONFLICT");
      assert.equal(view.unassignedPayables[0].countsForThisOrder, false);
      assert.equal(view.totals.paidAmount, 0);
      assert.equal(view.totals.linkedAmount, 0);
      assert.equal(view.fullySettled, false);
      assert.ok(view.warnings.some((w) => /9001 tem evidência de vínculo em mais de um pedido/.test(w)));
    }
  });

  it("J/L. evidências automáticas só em A (NF-e + número do pedido) → A conta uma única vez", async () => {
    const fake = createDb({
      orders: [ORDER, OTHER_ORDER],
      payables: [apRow(9001, { sourceInvoiceId: 501, documentNumber: "PC00612" })],
    });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(view.unassignedPayables.length, 1);
    assert.equal(view.unassignedPayables[0].ownership.kind, "AUTO_SINGLE_OWNER");
    assert.equal(view.totals.linkedCount, 1);
    assert.equal(view.totals.linkedAmount, 1136.68);
  });

  it("M. confirmado + NF-e no MESMO pedido → conta uma vez", async () => {
    const fake = createDb({
      payables: [apRow(9001, { sourceInvoiceId: 501 })],
      links: [{ payableExternalId: 9001, method: "MANUAL" }],
    });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(view.totals.linkedCount, 1);
    assert.equal(view.totals.linkedAmount, 1136.68);
    assert.equal(view.unassignedPayables[0].confidence, "CONFIRMED");
  });

  it("P. título cancelado continua fora dos totais mesmo sendo o dono", async () => {
    const fake = createDb({ payables: [apRow(9001, { sourceInvoiceId: 501, description: "TITULO CANCELADO" })] });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(view.unassignedPayables[0].status, "CANCELLED");
    assert.equal(view.unassignedPayables[0].countsForThisOrder, false);
    assert.equal(view.totals.linkedAmount, 0);
    assert.equal(view.totals.excludedByOwnershipCount, 0, "cancelado não é exclusão por dono");
    assert.equal(view.fullySettled, false);
  });
});

describe("confirmPurchaseOrderPayableLink", () => {
  it("confirma uma sugestão real em transação: vínculo + histórico, e devolve a reconciliação nova", async () => {
    const fake = createDb({ payables: [apRow(9101)] });
    const view = await confirmPurchaseOrderPayableLink(
      ORDER_ID,
      ACTOR,
      { payableExternalId: 9101, installmentIndex: 0, method: "INSTALLMENT_MATCH" },
      { db: fake.db, now: NOW }
    );
    assert.equal(fake.transactions, 1);
    assert.deepEqual(fake.writes, ["link.create", "history.create"]);
    assert.equal(fake.links[0].method, "INSTALLMENT_MATCH");
    assert.equal(fake.links[0].confidence, "CONFIRMED");
    assert.equal(fake.links[0].installmentIndex, 0);
    assert.equal(fake.links[0].createdByUserName, "Paulo");
    assert.equal(fake.history[0].action, "PURCHASE_ORDER_PAYABLE_LINKED");
    assert.equal(view.installments[0].status, "LINKED");
    assert.equal(view.installments[0].payables[0].linkId, fake.links[0].id);
    assert.equal(view.installments[0].payables[0].countsForThisOrder, true);
    assert.equal(view.suggestions.length, 0);
    assert.equal(view.financialStatus, "PARTIALLY_CONFIRMED");
  });

  it("INSTALLMENT_MATCH fora das sugestões do motor é recusado (409 SUGGESTION_NOT_FOUND)", async () => {
    const fake = createDb({ payables: [apRow(9101)] });
    await assert.rejects(
      () =>
        confirmPurchaseOrderPayableLink(
          ORDER_ID,
          ACTOR,
          { payableExternalId: 9101, installmentIndex: 1, method: "INSTALLMENT_MATCH" },
          { db: fake.db, now: NOW }
        ),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "SUGGESTION_NOT_FOUND" && error.httpStatus === 409
    );
    assert.deepEqual(fake.writes, []);
  });

  it("manual exige motivo e aceita título do fornecedor mesmo sem parcela", async () => {
    const fake = createDb({ payables: [apRow(9201, { amountPayable: new Dec(50), balancePayable: new Dec(50) })] });
    await assert.rejects(
      () => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9201 }, { db: fake.db, now: NOW }),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED"
    );
    const view = await confirmPurchaseOrderPayableLink(
      ORDER_ID,
      ACTOR,
      { payableExternalId: 9201, reason: "frete cobrado à parte" },
      { db: fake.db, now: NOW }
    );
    assert.equal(fake.links[0].method, "MANUAL");
    assert.equal(fake.links[0].reason, "frete cobrado à parte");
    assert.equal(view.unassignedPayables[0].payableExternalId, 9201);
    assert.equal(view.unassignedPayables[0].methodLabel, "Vínculo manual");
    assert.ok(view.warnings.some((w) => /difere do planejado/.test(w)));
  });

  it("título de outro fornecedor: 409 PAYABLE_SUPPLIER_MISMATCH; inexistente: 404; fora da janela: 409", async () => {
    const fake = createDb({
      payables: [apRow(9301, { personId: 999, personCnpj: "99999999000199" }), apRow(9302, { dueDate: new Date(2031, 0, 1) })],
    });
    const run = (body: Record<string, unknown>) => codeOf(() => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, body, { db: fake.db, now: NOW }));
    assert.equal(await run({ payableExternalId: 9301, reason: "x" }), "PAYABLE_SUPPLIER_MISMATCH:409");
    assert.equal(await run({ payableExternalId: 9999, reason: "x" }), "PAYABLE_NOT_FOUND:404");
    assert.equal(await run({ payableExternalId: 9302, reason: "x" }), "PAYABLE_OUT_OF_WINDOW:409");
    assert.deepEqual(fake.writes, []);
  });

  it("F. mesmo par pedido×título duplicado: 409 PAYABLE_ALREADY_LINKED na pré-checagem, sem segunda linha", async () => {
    const fake = createDb({ payables: [apRow(9401)], links: [{ payableExternalId: 9401 }] });
    await assert.rejects(
      () => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9401, reason: "de novo" }, { db: fake.db, now: NOW }),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "PAYABLE_ALREADY_LINKED" && error.httpStatus === 409
    );
    assert.equal(fake.links.length, 1);
    assert.equal(fake.history.length, 0);
    assert.deepEqual(fake.writes, []);
  });
});

describe("cardinalidade V1 — segundo dono financeiro é recusado (409, nunca 500)", () => {
  const conflictCode = "PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER:409";

  it("A. título confirmado no pedido A: confirmar (manual) no pedido B → 409; nada é escrito", async () => {
    const fake = createDb({
      orders: [ORDER, OTHER_ORDER],
      payables: [apRow(9410)],
      links: [{ payableExternalId: 9410, nomusPurchaseOrderId: OTHER_ORDER_ID }],
    });
    let caught: PurchaseOrderPayableLinkError | null = null;
    try {
      await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9410, reason: "mesmo boleto no segundo pedido" }, { db: fake.db, now: NOW });
    } catch (error) {
      caught = error as PurchaseOrderPayableLinkError;
    }
    assert.ok(caught instanceof PurchaseOrderPayableLinkError);
    assert.equal(caught.code, "PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER");
    assert.equal(caught.httpStatus, 409);
    assert.equal(caught.message, "Este título já está vinculado financeiramente a outro pedido.");
    assert.deepEqual(caught.details, { payableExternalId: 9410, ownerOrderId: OTHER_ORDER_ID, ownerOrderNumber: "PC00613" });
    assert.deepEqual(fake.writes, []);
    assert.equal(fake.links.length, 1);
  });

  it("B. manual em A e depois manual em B → o segundo recebe 409; só um dono", async () => {
    const fake = createDb({ orders: [ORDER, OTHER_ORDER], payables: [apRow(9420)] });
    await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9420, reason: "A" }, { db: fake.db, now: NOW });
    assert.equal(
      await codeOf(() => confirmPurchaseOrderPayableLink(OTHER_ORDER_ID, ACTOR, { payableExternalId: 9420, reason: "B" }, { db: fake.db, now: NOW })),
      conflictCode
    );
    assert.deepEqual(fake.links.map((row) => row.nomusPurchaseOrderId), [ORDER_ID]);
  });

  it("C. INSTALLMENT_MATCH em A e depois confirmar a mesma sugestão em B → 409", async () => {
    const fake = createDb({ orders: [ORDER, OTHER_ORDER], payables: [apRow(9430)] });
    await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9430, installmentIndex: 0, method: "INSTALLMENT_MATCH" }, { db: fake.db, now: NOW });
    assert.equal(
      await codeOf(() =>
        confirmPurchaseOrderPayableLink(OTHER_ORDER_ID, ACTOR, { payableExternalId: 9430, installmentIndex: 0, method: "INSTALLMENT_MATCH" }, { db: fake.db, now: NOW })
      ),
      conflictCode
    );
    assert.equal(fake.links.length, 1);
  });

  it("E. corrida A × B: a pré-checagem dos dois passa, o banco (unique global) decide; o perdedor recebe 409 e não 500", async () => {
    // A pré-checagem de B lê "sem dono" (leitura anterior ao commit de A), mas o create de B viola a unique global.
    const fake = createDb({ orders: [ORDER, OTHER_ORDER], payables: [apRow(9440)] });
    await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9440, reason: "A" }, { db: fake.db, now: NOW });
    fake.setStaleOwnerReads(1);
    const before = fake.queries.length;
    assert.equal(
      await codeOf(() => confirmPurchaseOrderPayableLink(OTHER_ORDER_ID, ACTOR, { payableExternalId: 9440, reason: "B" }, { db: fake.db, now: NOW })),
      conflictCode
    );
    assert.ok(fake.writes.filter((w) => w === "link.create").length === 2, "B tentou gravar (pré-checagem passou) e o banco recusou");
    assert.ok(fake.queries.slice(before).includes("link.findFirst"), "reconsulta o dono para responder com exatidão");
    assert.deepEqual(fake.links.map((row) => row.nomusPurchaseOrderId), [ORDER_ID], "somente um dono");
    assert.equal(fake.history.length, 1, "o histórico do perdedor não é gravado");
  });

  it("E'. P2002 sem dono na reconsulta: decide por meta.target — só payableExternalId → outro pedido; par → mesmo pedido", async () => {
    const other = createDb({ orders: [ORDER, OTHER_ORDER], payables: [apRow(9441)], links: [{ payableExternalId: 9441, nomusPurchaseOrderId: OTHER_ORDER_ID }], staleOwnerReads: 1, ownerVanishesAfterConflict: true });
    assert.equal(await codeOf(() => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9441, reason: "x" }, { db: other.db, now: NOW })), conflictCode);

    const same = createDb({ payables: [apRow(9442)], links: [{ payableExternalId: 9442 }], staleOwnerReads: 1, ownerVanishesAfterConflict: true });
    assert.equal(await codeOf(() => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9442, reason: "x" }, { db: same.db, now: NOW })), "PAYABLE_ALREADY_LINKED:409");

    // meta ausente (driver sem detalhe) e dono sumido: conservador → outro pedido, ainda 409.
    const noMeta = createDb({ orders: [ORDER, OTHER_ORDER], payables: [apRow(9443)], links: [{ payableExternalId: 9443, nomusPurchaseOrderId: OTHER_ORDER_ID }], staleOwnerReads: 1, ownerVanishesAfterConflict: true, uniqueMetaTarget: null });
    assert.equal(await codeOf(() => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9443, reason: "x" }, { db: noMeta.db, now: NOW })), conflictCode);
  });

  it("evidência automática de outro pedido NÃO bloqueia a confirmação: o vínculo confirmado passa a ter precedência", async () => {
    const fake = createDb({
      orders: [ORDER, orderWith(OTHER_ORDER, { nfes: [{ id: 501 }] })],
      payables: [apRow(9450, { sourceInvoiceId: 501 })],
    });
    const view = await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9450, reason: "conferido: NF é deste pedido" }, { db: fake.db, now: NOW });
    assert.equal(view.unassignedPayables[0].ownership.kind, "CONFIRMED_OWNER");
    assert.equal(view.unassignedPayables[0].countsForThisOrder, true);
    const viewB = await buildPurchaseOrderPayableReconciliationForOrder(OTHER_ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(viewB.unassignedPayables[0].countsForThisOrder, false);
    assert.equal(viewB.totals.linkedAmount, 0);
  });
});

describe("removePurchaseOrderPayableLink", () => {
  it("remove vínculo persistido com motivo e registra histórico de desvínculo", async () => {
    const fake = createDb({
      payables: [apRow(9501)],
      links: [{ payableExternalId: 9501, installmentIndex: 0, method: "INSTALLMENT_MATCH", createdByUserName: "Ana" }],
    });
    const view = await removePurchaseOrderPayableLink(ORDER_ID, 9501, ACTOR, { reason: "título trocado" }, { db: fake.db, now: NOW });
    assert.equal(fake.links.length, 0);
    assert.deepEqual(fake.writes, ["link.delete", "history.create"]);
    assert.equal(fake.history[0].action, "PURCHASE_ORDER_PAYABLE_UNLINKED");
    assert.equal(fake.history[0].reason, "título trocado");
    assert.equal((fake.history[0].detailsJson as { linkedByUserName: string }).linkedByUserName, "Ana");
    assert.equal(view.installments[0].status, "UNLINKED");
    assert.equal(view.suggestions[0]?.payableExternalId, 9501);
  });

  it("G/H. desvincular em A libera o dono: B pode confirmar; o histórico de A sobrevive", async () => {
    const fake = createDb({
      orders: [ORDER, OTHER_ORDER],
      payables: [apRow(9510)],
      links: [{ id: "link-a", payableExternalId: 9510, nomusPurchaseOrderId: ORDER_ID }],
    });
    assert.equal(
      await codeOf(() => confirmPurchaseOrderPayableLink(OTHER_ORDER_ID, ACTOR, { payableExternalId: 9510, reason: "B" }, { db: fake.db, now: NOW })),
      "PAYABLE_ALREADY_LINKED_TO_ANOTHER_PURCHASE_ORDER:409"
    );
    await removePurchaseOrderPayableLink(ORDER_ID, 9510, ACTOR, { reason: "era do outro pedido" }, { db: fake.db, now: NOW });
    const view = await confirmPurchaseOrderPayableLink(OTHER_ORDER_ID, ACTOR, { payableExternalId: 9510, reason: "B" }, { db: fake.db, now: NOW });
    assert.deepEqual(fake.links.map((row) => [row.nomusPurchaseOrderId, row.payableExternalId]), [[OTHER_ORDER_ID, 9510]]);
    assert.equal(view.unassignedPayables[0].countsForThisOrder, true);
    assert.deepEqual(
      fake.history.map((row) => [row.action, row.nomusPurchaseOrderId, row.linkId]),
      [
        ["PURCHASE_ORDER_PAYABLE_UNLINKED", ORDER_ID, "link-a"],
        ["PURCHASE_ORDER_PAYABLE_LINKED", OTHER_ORDER_ID, fake.links[0].id],
      ],
      "o histórico de A permanece após o desvínculo e não bloqueia o novo dono"
    );
  });

  it("sem motivo não remove; vínculo inexistente (automático por NF-e) é 404", async () => {
    const fake = createDb({ payables: [apRow(9601, { sourceInvoiceId: 501 })] });
    await assert.rejects(
      () => removePurchaseOrderPayableLink(ORDER_ID, 9601, ACTOR, {}, { db: fake.db, now: NOW }),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED"
    );
    await assert.rejects(
      () => removePurchaseOrderPayableLink(ORDER_ID, 9601, ACTOR, { reason: "x" }, { db: fake.db, now: NOW }),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "PAYABLE_LINK_NOT_FOUND" && error.httpStatus === 404
    );
    assert.deepEqual(fake.writes, []);
  });
});

describe("loadConfirmedPayableSnapshotsByOrder", () => {
  it("duas consultas para N pedidos; agrupa por pedido; vazio não consulta", async () => {
    const fake = createDb({
      payables: [apRow(9701), apRow(9702)],
      links: [
        { payableExternalId: 9701 },
        { payableExternalId: 9702, nomusPurchaseOrderId: OTHER_ORDER_ID },
      ],
    });
    const map = await loadConfirmedPayableSnapshotsByOrder([ORDER_ID, OTHER_ORDER_ID, THIRD_ORDER_ID], { db: fake.db });
    assert.deepEqual(fake.queries, ["link.findMany", "accountsPayable.findMany"]);
    assert.equal(map.get(ORDER_ID)?.[0].externalId, 9701);
    assert.equal(map.get(OTHER_ORDER_ID)?.[0].externalId, 9702);
    assert.equal(map.get(OTHER_ORDER_ID)?.[0].amountPayable, 1136.68);

    const empty = createDb({});
    assert.equal((await loadConfirmedPayableSnapshotsByOrder([], { db: empty.db })).size, 0);
    assert.deepEqual(empty.queries, []);
  });
});

describe("loadOrderFinancialPayablesWithOwnership — listagem/360 com a MESMA entrada financeira da aba", () => {
  it("página com N pedidos: consultas constantes; camadas 1–3 + confirmados; conflito e dono fora da página resolvidos", async () => {
    const third = orderWith(OTHER_ORDER, { id: THIRD_ORDER_ID, externalId: 615, orderNumber: "PC00614", nfes: [{ id: 502 }] });
    const fake = createDb({
      orders: [ORDER, orderWith(OTHER_ORDER, { nfes: [{ id: 501 }] }), third],
      payables: [
        apRow(9801, { sourceInvoiceId: 501 }),
        apRow(9802, { sourceInvoiceId: 502 }),
        apRow(9803, { documentNumber: "PC00613", dueDate: new Date(2031, 0, 1) }),
        apRow(9804, { sourceInvoiceId: 777 }),
      ],
      stockDocuments: [{ idNfe: 777, isCancelled: false, rawJson: { idPedidoCompra: 613 } }],
      links: [{ payableExternalId: 9802, nomusPurchaseOrderId: THIRD_ORDER_ID }],
    });
    const page = [ORDER, fake.orders[1]];
    const { payablesByOrder, ownership } = await loadOrderFinancialPayablesWithOwnership(page, { db: fake.db });
    assert.deepEqual(payablesByOrder.get(ORDER_ID)!.map((r) => r.externalId).sort(), [9801, 9804], "NF-e (1) + documento de entrada (2)");
    assert.deepEqual(payablesByOrder.get(OTHER_ORDER_ID)!.map((r) => r.externalId).sort(), [9801, 9803], "NF-e (1) + número do pedido (3)");
    assert.equal(ownership.get(9801)!.kind, "AUTO_CONFLICT");
    assert.equal(ownership.get(9804)!.ownerOrderId, ORDER_ID);
    assert.equal(ownership.get(9803)!.ownerOrderId, OTHER_ORDER_ID);
    assert.deepEqual(
      fake.queries,
      [
        "raw:stockDocumentsPointingToOrders",
        "link.findMany",
        "accountsPayable.findMany",
        "raw:payablesByDocumentNumber",
        "link.findMany",
        "raw:ordersDeclaringInvoices",
        "raw:ordersBySupplierScope",
        "stockDocument.findMany",
      ],
      "sem consulta por pedido nem por título"
    );
  });

  it("aba e listagem produzem os mesmos títulos que contam para o pedido", async () => {
    const fake = createDb({
      orders: [ORDER, OTHER_ORDER],
      payables: [
        apRow(9811, { sourceInvoiceId: 501, amountPaid: new Dec(1136.68), balancePayable: new Dec(0), settlementDate: NOW }),
        apRow(9812, { documentNumber: "000613", dueDate: new Date(2031, 0, 1) }),
        apRow(9813, { sourceInvoiceId: 777 }),
        apRow(9814),
      ],
      stockDocuments: [{ idNfe: 777, isCancelled: false, rawJson: { idPedido: "613" } }],
      links: [{ payableExternalId: 9814 }],
    });
    const tab = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    const listing = await loadOrderFinancialPayablesWithOwnership([ORDER], { db: fake.db });
    const tabIds = [...tab.installments.flatMap((i) => i.payables), ...tab.unassignedPayables]
      .filter((row) => row.countsForThisOrder)
      .map((row) => row.payableExternalId)
      .sort();
    const listingIds = listing.payablesByOrder
      .get(ORDER_ID)!
      .filter((row) => listing.ownership.get(row.externalId)?.ownerOrderId === ORDER_ID)
      .map((row) => row.externalId)
      .sort();
    assert.deepEqual(tabIds, [9811, 9812, 9813, 9814]);
    assert.deepEqual(listingIds, tabIds);
  });

  it("sem pedidos: nenhuma consulta", async () => {
    const fake = createDb({});
    const result = await loadOrderFinancialPayablesWithOwnership([], { db: fake.db });
    assert.equal(result.ownership.size, 0);
    assert.deepEqual(fake.queries, []);
  });
});

describe("mapPayableLinkError", () => {
  it("erros do domínio mantêm status/código/campo/detalhes; o resto vira 500 genérico", () => {
    const mapped = mapPayableLinkError(new PurchaseOrderPayableLinkError("X", "msg", 409, "payableExternalId", { ownerOrderId: "o2" }));
    assert.deepEqual(mapped, { status: 409, body: { error: "msg", code: "X", field: "payableExternalId", details: { ownerOrderId: "o2" } } });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      assert.equal(mapPayableLinkError(new Error("boom")).status, 500);
    } finally {
      console.error = originalError;
    }
  });
});
