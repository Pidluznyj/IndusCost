/**
 * Pedido Nomus ↔ Contas a Pagar — camada de I/O com Prisma falso.
 * Garante número constante de consultas, transação vínculo + histórico,
 * códigos de erro, que nada é escrito fora das tabelas locais de vínculo e a
 * CARDINALIDADE FINANCEIRA V1: um título AP = no máximo um dono financeiro
 * (pré-checagem no serviço + unique global do banco na corrida → 409, não 500).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { parsePurchaseOrderPlannedInstallments } from "./nomusPurchaseOrder360.js";
import { PurchaseOrderPayableLinkError } from "./nomusPurchaseOrderPayableLink.js";
import {
  buildPurchaseOrderPayableReconciliationForOrder,
  confirmPurchaseOrderPayableLink,
  loadConfirmedPayableSnapshotsByOrder,
  mapPayableLinkError,
  removePurchaseOrderPayableLink,
  resolvePayableOwnershipForOrderPayables,
} from "./nomusPurchaseOrderPayableLink.server.js";

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORDER_ID = "22222222-2222-4222-8222-222222222222";
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

type OrderSeed = typeof ORDER;

type Seed = {
  orders?: OrderSeed[];
  payables?: PayableSeed[];
  stockDocuments?: Array<{ idNfe: number | null; isCancelled: boolean; rawJson: Record<string, unknown> }>;
  links?: Array<Partial<LinkRow> & { payableExternalId: number; nomusPurchaseOrderId?: string }>;
  /**
   * Simula a CORRIDA: a consulta de dono (pré-checagem) devolve vazio N vezes,
   * mas o banco (unique global) continua enxergando os vínculos existentes.
   */
  staleOwnerReads?: number;
  /** Depois da violação de unicidade, o dono some antes da reconsulta (desvinculado no meio). */
  ownerVanishesAfterConflict?: boolean;
  /** `meta.target` devolvido pelo Prisma na violação (default: colunas do índice violado). */
  uniqueMetaTarget?: unknown;
};

function inList(cond: unknown, value: unknown): boolean {
  return !!cond && typeof cond === "object" && Array.isArray((cond as { in?: unknown[] }).in)
    ? ((cond as { in: unknown[] }).in as unknown[]).includes(value)
    : false;
}

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

/** Avalia o `where` da busca reversa de pedidos (AND/OR, fornecedor, JSON nfes, número, externalId). */
function matchesOrderWhere(order: OrderSeed, where: Record<string, unknown>): boolean {
  if (Array.isArray(where.AND)) return (where.AND as Record<string, unknown>[]).every((w) => matchesOrderWhere(order, w));
  if (Array.isArray(where.OR)) return (where.OR as Record<string, unknown>[]).some((w) => matchesOrderWhere(order, w));
  if ("supplierExternalId" in where) {
    const cond = where.supplierExternalId;
    if (cond === null) return order.supplierExternalId == null;
    return inList(cond, order.supplierExternalId);
  }
  if ("rawPayload" in where) {
    const cond = where.rawPayload as { path: string[]; array_contains: Array<Record<string, unknown>> };
    assert.deepEqual(cond.path, ["nfes"]);
    const nfes = (order.rawPayload as { nfes?: unknown[] }).nfes ?? [];
    return cond.array_contains.every((needle) =>
      nfes.some(
        (entry) =>
          !!entry &&
          typeof entry === "object" &&
          Object.entries(needle).every(([k, v]) => (entry as Record<string, unknown>)[k] === v)
      )
    );
  }
  if ("orderNumber" in where) return inList(where.orderNumber, order.orderNumber);
  if ("externalId" in where) return inList(where.externalId, order.externalId);
  throw new Error(`where de pedido não suportado no fake: ${JSON.stringify(where)}`);
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

  const db = {
    nomusPurchaseOrder: {
      findUnique: async (args: { where: { id: string } }) => {
        queries.push("order.findUnique");
        return orders.find((row) => row.id === args.where.id) ?? null;
      },
      findMany: async (args: { where: Record<string, unknown>; take?: number }) => {
        queries.push("order.findMany");
        return orders.filter((row) => matchesOrderWhere(row, args.where));
      },
    },
    nomusStockDocument: {
      findMany: async (args: {
        where: { OR?: Array<{ rawJson: { path: string[]; equals: unknown } }>; idNfe?: { in?: number[]; not?: null } };
      }) => {
        queries.push("stockDocument.findMany");
        const active = stockDocuments.filter((row) => !row.isCancelled && row.idNfe != null);
        if (args.where.OR) {
          return active
            .filter((row) => args.where.OR!.some((clause) => row.rawJson[clause.rawJson.path[0]] === clause.rawJson.equals))
            .map((row) => ({ idNfe: row.idNfe }));
        }
        const ids = args.where.idNfe?.in ?? [];
        return active.filter((row) => ids.includes(row.idNfe!)).map((row) => ({ idNfe: row.idNfe, rawJson: row.rawJson }));
      },
    },
    nomusAccountsPayable: {
      findMany: async (args: { where: { OR?: Array<Record<string, unknown>>; externalId?: { in: number[] } } }) => {
        queries.push("accountsPayable.findMany");
        if (args.where.externalId) return payables.filter((row) => args.where.externalId!.in.includes(row.externalId));
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

describe("buildPurchaseOrderPayableReconciliationForOrder", () => {
  it("resolve NF-e direta, documento de entrada e número do pedido com número constante de consultas", async () => {
    const fake = createDb({
      payables: [
        apRow(9001, { sourceInvoiceId: 501, amountPaid: new Dec(1136.68), balancePayable: new Dec(0), paymentDate: NOW, settlementDate: NOW }),
        apRow(9002, { sourceInvoiceId: 777, dueDate: INSTALLMENTS[1].dueDate }),
        apRow(9003, { documentNumber: "PC00612", dueDate: INSTALLMENTS[2].dueDate, amountPayable: new Dec(1171.14), balancePayable: new Dec(1171.14) }),
        apRow(9004, { personId: 999, documentNumber: "PC00612" }),
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
    // Constante: contexto (4) + dono financeiro em lote (vínculos por título, pedidos por NF-e,
    // pedidos por número do título, documentos de entrada por NF-e). Nada por título.
    assert.deepEqual(fake.queries, [
      "order.findUnique",
      "link.findMany",
      "stockDocument.findMany",
      "accountsPayable.findMany",
      "link.findMany",
      "order.findMany",
      "order.findMany",
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

describe("cardinalidade V1 — dono financeiro na aba Financeiro (evidências de outros pedidos)", () => {
  const BOTH_DECLARE_501 = [ORDER, { ...OTHER_ORDER, rawPayload: { ...OTHER_ORDER.rawPayload, nfes: [{ id: 501, numero: "501" }] } }];

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
      payables: [apRow(9301, { personId: 999 }), apRow(9302, { dueDate: new Date(2031, 0, 1) })],
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
      orders: [ORDER, { ...OTHER_ORDER, rawPayload: { ...OTHER_ORDER.rawPayload, nfes: [{ id: 501 }] } }],
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
    const map = await loadConfirmedPayableSnapshotsByOrder([ORDER_ID, OTHER_ORDER_ID, "33333333-3333-4333-8333-333333333333"], { db: fake.db });
    assert.deepEqual(fake.queries, ["link.findMany", "accountsPayable.findMany"]);
    assert.equal(map.get(ORDER_ID)?.[0].externalId, 9701);
    assert.equal(map.get(OTHER_ORDER_ID)?.[0].externalId, 9702);
    assert.equal(map.get(OTHER_ORDER_ID)?.[0].amountPayable, 1136.68);

    const empty = createDb({});
    assert.equal((await loadConfirmedPayableSnapshotsByOrder([], { db: empty.db })).size, 0);
    assert.deepEqual(empty.queries, []);
  });
});

describe("resolvePayableOwnershipForOrderPayables — listagem/360 usam a mesma autoridade, em lote", () => {
  const snapshot = (externalId: number, extra: Record<string, unknown> = {}) => ({
    externalId,
    sourceInvoiceId: 501,
    sourceInvoiceNumber: "501",
    documentNumber: null,
    personId: 215,
    personName: "ACME",
    personCnpj: "12345678000190",
    dueDate: NOW,
    paymentDate: null,
    settlementDate: null,
    amountPayable: 100,
    amountPaid: 0,
    balancePayable: 100,
    paymentMethodName: null,
    description: null,
    comments: null,
    classification: null,
    nomusStatus: true,
    suspendPayment: false,
    ...extra,
  });

  it("página com N pedidos: consultas constantes; NF-e em dois pedidos vira conflito; confirmado fora da página vence", async () => {
    const third = { ...OTHER_ORDER, id: "33333333-3333-4333-8333-333333333333", externalId: 615, orderNumber: "PC00614", rawPayload: { ...OTHER_ORDER.rawPayload, id: 615, nfes: [{ id: 502 }] } };
    const fake = createDb({
      orders: [ORDER, { ...OTHER_ORDER, rawPayload: { ...OTHER_ORDER.rawPayload, nfes: [{ id: 501 }] } }, third],
      links: [{ payableExternalId: 9802, nomusPurchaseOrderId: third.id }],
    });
    const resolution = await resolvePayableOwnershipForOrderPayables(
      {
        payablesByOrder: new Map([
          [ORDER_ID, [snapshot(9801), snapshot(9802, { sourceInvoiceId: 502 })]],
          [OTHER_ORDER_ID, [snapshot(9801)]],
        ]),
        confirmedByOrder: new Map(),
      },
      { db: fake.db }
    );
    assert.equal(resolution.ownership.get(9801)!.kind, "AUTO_CONFLICT");
    assert.equal(resolution.ownership.get(9802)!.kind, "CONFIRMED_OWNER");
    assert.equal(resolution.ownership.get(9802)!.ownerOrderId, third.id, "vínculo confirmado fora da página vence a NF-e da página");
    assert.equal(resolution.orderNumbersById.get(third.id), "PC00614");
    assert.deepEqual(fake.queries, ["link.findMany", "order.findMany", "stockDocument.findMany"], "sem consulta por pedido nem por título");
  });

  it("sem títulos: nenhuma consulta", async () => {
    const fake = createDb({});
    const resolution = await resolvePayableOwnershipForOrderPayables({ payablesByOrder: new Map(), confirmedByOrder: new Map() }, { db: fake.db });
    assert.equal(resolution.ownership.size, 0);
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
