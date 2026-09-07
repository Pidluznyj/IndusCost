/**
 * Pedido Nomus ↔ Contas a Pagar — camada de I/O com Prisma falso.
 * Garante número constante de consultas, transação vínculo + histórico,
 * códigos de erro e que nada é escrito fora das tabelas locais de vínculo.
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
  rawPayload: RAW,
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

type Seed = {
  orders?: Array<typeof ORDER>;
  payables?: PayableSeed[];
  stockDocuments?: Array<{ idNfe: number | null; isCancelled: boolean; rawJson: Record<string, unknown> }>;
  links?: Array<Partial<LinkRow> & { payableExternalId: number; nomusPurchaseOrderId?: string }>;
};

function matchesClause(row: PayableSeed, clause: Record<string, unknown>): boolean {
  return Object.entries(clause).every(([key, cond]) => {
    const value = row[key];
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

  const db = {
    nomusPurchaseOrder: {
      findUnique: async (args: { where: { id: string } }) => {
        queries.push("order.findUnique");
        return orders.find((row) => row.id === args.where.id) ?? null;
      },
    },
    nomusStockDocument: {
      findMany: async (args: { where: { OR: Array<{ rawJson: { path: string[]; equals: unknown } }> } }) => {
        queries.push("stockDocument.findMany");
        return stockDocuments
          .filter((row) => !row.isCancelled && row.idNfe != null)
          .filter((row) => args.where.OR.some((clause) => row.rawJson[clause.rawJson.path[0]] === clause.rawJson.equals))
          .map((row) => ({ idNfe: row.idNfe }));
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
      findMany: async (args: { where: Record<string, unknown> }) => {
        queries.push("link.findMany");
        return links.filter((row) => matchesClause(row as unknown as PayableSeed, args.where));
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
        if (
          links.some(
            (row) =>
              row.nomusPurchaseOrderId === args.data.nomusPurchaseOrderId &&
              row.payableExternalId === args.data.payableExternalId
          )
        ) {
          throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
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

  return { db: db as unknown as PrismaClient, links, history, queries, writes, get transactions() { return transactions; } };
}

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
      view.unassignedPayables.map((row) => [row.payableExternalId, row.method, row.confidence]),
      [
        [9001, "DIRECT_NOMUS_NFE", "EXACT"],
        [9002, "STOCK_DOCUMENT_PURCHASE_ORDER", "EXACT"],
        [9003, "AP_DOCUMENT_NUMBER", "EXACT"],
      ]
    );
    assert.equal(view.totals.linkedCount, 3);
    assert.equal(view.totals.paidAmount, 1136.68);
    assert.equal(view.financialStatus, "PARTIALLY_PAID");
    assert.equal(view.suggestions.length, 0);
    assert.deepEqual(fake.queries, [
      "order.findUnique",
      "link.findMany",
      "stockDocument.findMany",
      "accountsPayable.findMany",
      "link.findMany",
    ]);
  });

  it("título só do mesmo fornecedor vira sugestão, nunca vínculo; título de outro pedido é sinalizado", async () => {
    const fake = createDb({
      payables: [apRow(9101), apRow(9102, { dueDate: INSTALLMENTS[1].dueDate })],
      links: [{ nomusPurchaseOrderId: OTHER_ORDER_ID, payableExternalId: 9102 }],
    });
    const view = await buildPurchaseOrderPayableReconciliationForOrder(ORDER_ID, { db: fake.db, now: NOW });
    assert.equal(view.totals.linkedCount, 0);
    assert.equal(view.financialStatus, "PLANNED_ONLY");
    assert.deepEqual(
      view.suggestions.map((row) => [row.installmentIndex, row.payableExternalId, row.linkedToOtherOrder]),
      [
        [0, 9101, false],
        [1, 9102, true],
      ]
    );
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
    const codeOf = async (body: Record<string, unknown>) => {
      try {
        await confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, body, { db: fake.db, now: NOW });
        return null;
      } catch (error) {
        return error instanceof PurchaseOrderPayableLinkError ? `${error.code}:${error.httpStatus}` : "other";
      }
    };
    assert.equal(await codeOf({ payableExternalId: 9301, reason: "x" }), "PAYABLE_SUPPLIER_MISMATCH:409");
    assert.equal(await codeOf({ payableExternalId: 9999, reason: "x" }), "PAYABLE_NOT_FOUND:404");
    assert.equal(await codeOf({ payableExternalId: 9302, reason: "x" }), "PAYABLE_OUT_OF_WINDOW:409");
    assert.deepEqual(fake.writes, []);
  });

  it("vínculo duplicado (P2002) vira 409 PAYABLE_ALREADY_LINKED", async () => {
    const fake = createDb({ payables: [apRow(9401)], links: [{ payableExternalId: 9401 }] });
    await assert.rejects(
      () => confirmPurchaseOrderPayableLink(ORDER_ID, ACTOR, { payableExternalId: 9401, reason: "de novo" }, { db: fake.db, now: NOW }),
      (error: unknown) => error instanceof PurchaseOrderPayableLinkError && error.code === "PAYABLE_ALREADY_LINKED" && error.httpStatus === 409
    );
    assert.equal(fake.links.length, 1);
    assert.equal(fake.history.length, 0);
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

describe("mapPayableLinkError", () => {
  it("erros do domínio mantêm status/código/campo; o resto vira 500 genérico", () => {
    const mapped = mapPayableLinkError(new PurchaseOrderPayableLinkError("X", "msg", 409, "payableExternalId"));
    assert.deepEqual(mapped, { status: 409, body: { error: "msg", code: "X", field: "payableExternalId" } });
    const originalError = console.error;
    console.error = () => undefined;
    try {
      assert.equal(mapPayableLinkError(new Error("boom")).status, 500);
    } finally {
      console.error = originalError;
    }
  });
});
