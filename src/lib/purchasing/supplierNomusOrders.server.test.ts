/**
 * Pedidos Nomus de UM fornecedor (aba Desempenho): população por chave segura,
 * verificação pela identidade oficial, paginação no servidor, nº fixo de
 * consultas. Prisma substituído por duplo em memória — sem banco.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { ResolvedPurchaseOrderSupplier } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import { SupplierEvaluationError } from "./supplierPerformance.js";
import { buildNomusSupplierEvaluationWorklistFromWhere } from "./nomusPurchaseOrderEvaluation.server.js";
import {
  buildSupplierDocumentTaxIdVariants,
  isNomusOrderRowAttributableToSupplier,
} from "./supplierNomusOrders.js";
import {
  buildSupplierNomusOrdersDetail,
  resolveSupplierNomusOrdersIdentity,
  type SupplierNomusOrdersDb,
} from "./supplierNomusOrders.server.js";

const SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const PERIOD = { from: "2026-01-01", to: "2026-06-30" } as const;

type FakeSupplier = { id: string; displayName: string; document: string | null; normalizedDocument: string | null; status: string };
type FakeAlias = { supplierId: string; externalSupplierId: number | null };
type FakeOrder = {
  id: string;
  externalId: number;
  orderNumber: string | null;
  issuedAt: Date | null;
  firstSeenAt: Date;
  stage: string;
  canceled: boolean | null;
  supplierExternalId: number | null;
  supplierName: string | null;
  supplierTaxId: string | null;
  supplierEvaluation: null | { overallScore: number; qualityScore: number; deliveryScore: number; conformityScore: number; serviceScore: number; methodologyVersion: number; revision: number };
};

function order(partial: Partial<FakeOrder> & { id: string; externalId: number }): FakeOrder {
  return {
    orderNumber: `PC-${partial.externalId}`,
    issuedAt: new Date("2026-03-10T12:00:00Z"),
    firstSeenAt: new Date("2026-03-10T12:00:00Z"),
    stage: "RECEIVED",
    canceled: false,
    supplierExternalId: null,
    supplierName: "Fornecedor",
    supplierTaxId: null,
    supplierEvaluation: null,
    ...partial,
  };
}

function createFakePrisma(input: { suppliers: FakeSupplier[]; aliases: FakeAlias[]; orders: FakeOrder[] }) {
  const log: string[] = [];
  const prisma = {
    financialSupplier: {
      findUnique: async (args: { where: { id: string } }) => {
        log.push("financialSupplier.findUnique");
        return input.suppliers.find((s) => s.id === args.where.id) ?? null;
      },
      count: async (args: { where: { normalizedDocument: string } }) => {
        log.push("financialSupplier.count");
        return input.suppliers.filter((s) => s.normalizedDocument === args.where.normalizedDocument).length;
      },
    },
    financialSupplierAlias: {
      findMany: async (args: {
        where: { supplierId?: string | { not: string }; externalSupplierId?: { not: null } | { in: number[] } };
      }) => {
        log.push("financialSupplierAlias.findMany");
        return input.aliases
          .filter((a) => {
            const sid = args.where.supplierId;
            if (typeof sid === "string" && a.supplierId !== sid) return false;
            if (sid && typeof sid === "object" && a.supplierId === sid.not) return false;
            const ext = args.where.externalSupplierId;
            if (ext && "not" in ext && a.externalSupplierId == null) return false;
            if (ext && "in" in ext && (a.externalSupplierId == null || !ext.in.includes(a.externalSupplierId))) return false;
            return true;
          })
          .map((a) => ({ externalSupplierId: a.externalSupplierId }));
      },
    },
    nomusPurchaseOrder: {
      findMany: async (args: { where: { supplierTaxId?: { in: string[] } }; distinct?: string[]; select?: unknown }) => {
        log.push("nomusPurchaseOrder.findMany");
        if (args.distinct) {
          const seen = new Set<number>();
          return input.orders
            .filter((o) => o.supplierTaxId && args.where.supplierTaxId?.in.includes(o.supplierTaxId) && o.supplierExternalId != null)
            .filter((o) => (seen.has(o.supplierExternalId!) ? false : (seen.add(o.supplierExternalId!), true)))
            .map((o) => ({ supplierExternalId: o.supplierExternalId }));
        }
        throw new Error("página deve vir pelo núcleo da worklist injetado");
      },
    },
  } as unknown as SupplierNomusOrdersDb;
  return { prisma, log };
}

function resolvedFor(supplierId: string | null, matchConfidence: ResolvedPurchaseOrderSupplier["matchConfidence"]): ResolvedPurchaseOrderSupplier {
  return {
    nomusExternalId: null,
    nomusName: "Fornecedor",
    nomusDocument: null,
    resolvedName: "Fornecedor",
    resolvedDocument: null,
    financialSupplierId: supplierId,
    matchMethod: matchConfidence === "EXACT" ? "SUPPLIER_ALIAS" : "UNRESOLVED",
    matchConfidence,
    matched: supplierId != null,
    ambiguous: false,
    source: "test",
  };
}

const BASE_SUPPLIER: FakeSupplier = { id: SUPPLIER_ID, displayName: "Alpha", document: "12.345.678/0001-90", normalizedDocument: "12345678000190", status: "ACTIVE" };

describe("helpers puros", () => {
  it("variantes do documento: dígitos + máscara padrão", () => {
    assert.deepEqual(buildSupplierDocumentTaxIdVariants("12345678000190"), ["12345678000190", "12.345.678/0001-90"]);
    assert.deepEqual(buildSupplierDocumentTaxIdVariants("12345678909"), ["12345678909", "123.456.789-09"]);
    assert.deepEqual(buildSupplierDocumentTaxIdVariants(null), []);
    assert.deepEqual(buildSupplierDocumentTaxIdVariants("123"), ["123"]);
  });

  it("linha só é do fornecedor com identidade segura E mesmo id", () => {
    const row = (financialSupplierId: string | null, identitySafe: boolean) => ({
      supplier: { nomusExternalId: 1, nomusName: null, resolvedName: null, resolvedDocument: null, financialSupplierId, matchMethod: "SUPPLIER_ALIAS", matchConfidence: "EXACT", identitySafe },
    });
    assert.equal(isNomusOrderRowAttributableToSupplier(row(SUPPLIER_ID, true), SUPPLIER_ID), true);
    assert.equal(isNomusOrderRowAttributableToSupplier(row(SUPPLIER_ID, false), SUPPLIER_ID), false);
    assert.equal(isNomusOrderRowAttributableToSupplier(row(OTHER_ID, true), SUPPLIER_ID), false);
    assert.equal(isNomusOrderRowAttributableToSupplier(row(null, true), SUPPLIER_ID), false);
  });
});

describe("resolveSupplierNomusOrdersIdentity — chaves seguras", () => {
  it("11. alias Nomus exclusivo → população por supplierExternalId", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }, { supplierId: SUPPLIER_ID, externalSupplierId: 10 }, { supplierId: SUPPLIER_ID, externalSupplierId: 11 }],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.deepEqual(identity.aliasExternalIds, [10, 11]);
    assert.deepEqual(identity.ambiguousExternalIds, []);
    assert.equal(identity.documentUnique, false);
    assert.deepEqual(identity.where, { supplierExternalId: { in: [10, 11] } });
    assert.equal(identity.matchable, true);
  });

  it("12. alias aliasado também a OUTRO fornecedor é conflito → excluído", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }, { supplierId: OTHER_ID, externalSupplierId: 10 }, { supplierId: SUPPLIER_ID, externalSupplierId: 11 }],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.deepEqual(identity.aliasExternalIds, [11]);
    assert.deepEqual(identity.ambiguousExternalIds, [10]);
    assert.deepEqual(identity.where, { supplierExternalId: { in: [11] } });
  });

  it("13. documento único no cadastro → ramo por supplierTaxId (dígitos + máscara)", async () => {
    const { prisma } = createFakePrisma({ suppliers: [BASE_SUPPLIER], aliases: [], orders: [] });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.equal(identity.documentUnique, true);
    assert.equal(identity.documentOwners, 1);
    assert.deepEqual(identity.aliasExternalIds, []);
    assert.deepEqual(identity.where, { supplierTaxId: { in: ["12345678000190", "12.345.678/0001-90"] } });
  });

  it("14. documento duplicado entre fornecedores → ramo por documento DESLIGADO (conflito)", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [BASE_SUPPLIER, { ...BASE_SUPPLIER, id: OTHER_ID, displayName: "Alpha 2" }],
      aliases: [],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.equal(identity.documentUnique, false);
    assert.equal(identity.documentOwners, 2);
    assert.equal(identity.where, null);
    assert.equal(identity.matchable, false);
  });

  it("15. no ramo por documento, ids Nomus aliasados a OUTRO fornecedor saem (NULL continua entrando)", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [BASE_SUPPLIER],
      aliases: [{ supplierId: OTHER_ID, externalSupplierId: 77 }],
      orders: [
        order({ id: "o1", externalId: 1, supplierExternalId: 77, supplierTaxId: "12345678000190" }),
        order({ id: "o2", externalId: 2, supplierExternalId: 78, supplierTaxId: "12.345.678/0001-90" }),
        order({ id: "o3", externalId: 3, supplierExternalId: null, supplierTaxId: "12345678000190" }),
      ],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.deepEqual(identity.where, {
      supplierTaxId: { in: ["12345678000190", "12.345.678/0001-90"] },
      OR: [{ supplierExternalId: null }, { supplierExternalId: { notIn: [77] } }],
    });
  });

  it("16. alias exclusivo + documento único → OR das duas chaves", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [BASE_SUPPLIER],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.deepEqual(identity.where, {
      OR: [{ supplierExternalId: { in: [10] } }, { supplierTaxId: { in: ["12345678000190", "12.345.678/0001-90"] } }],
    });
  });

  it("nome NUNCA é chave: fornecedor só com nome não tem população", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [],
      orders: [order({ id: "o1", externalId: 1, supplierName: "Alpha" })],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.equal(identity.where, null);
  });

  it("fornecedor inexistente → SUPPLIER_NOT_FOUND", async () => {
    const { prisma } = createFakePrisma({ suppliers: [], aliases: [], orders: [] });
    await assert.rejects(
      () => resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID),
      (error: unknown) => error instanceof SupplierEvaluationError && error.code === "SUPPLIER_NOT_FOUND"
    );
  });
});

describe("buildSupplierNomusOrdersDetail — população, período, paginação, verificação", () => {
  function worklistFake(items: Array<{ nomusPurchaseOrderId: string; financialSupplierId: string | null; identitySafe: boolean }>, total = items.length) {
    const calls: Array<{ base: unknown; options: unknown }> = [];
    const buildWorklist = (async (_prisma: unknown, base: unknown, options: { page: number; pageSize: number }) => {
      calls.push({ base, options });
      return {
        page: options.page,
        pageSize: options.pageSize,
        total,
        scaleMin: 1,
        scaleMax: 5,
        kpis: { eligibleOrders: total, evaluatedOrders: 1, pendingOrders: total - 1, coverage: total ? 1 / total : null, overallScore: 4, qualityScore: 4, deliveryScore: 4, conformityScore: 4, serviceScore: 4 },
        items: items.map((item, index) => ({
          nomusPurchaseOrderId: item.nomusPurchaseOrderId,
          externalId: index + 1,
          orderNumber: `PC-${index + 1}`,
          issuedAt: "2026-03-10T12:00:00.000Z",
          stage: "RECEIVED",
          canceled: false,
          eligible: true,
          eligibilityReason: null,
          evaluationStatus: "PENDING" as const,
          supplier: { nomusExternalId: 10, nomusName: "Alpha", resolvedName: "Alpha", resolvedDocument: null, financialSupplierId: item.financialSupplierId, matchMethod: "SUPPLIER_ALIAS", matchConfidence: "EXACT", identitySafe: item.identitySafe },
          evaluation: null,
          suggestions: { quality: 3, delivery: 3, conformity: 3, service: 3 },
        })),
      };
    }) as unknown as typeof buildNomusSupplierEvaluationWorklistFromWhere;
    return { buildWorklist, calls };
  }

  it("17. população do fornecedor ∧ período vão para o núcleo da worklist; página e KPIs vêm dele", async () => {
    const { prisma, log } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }],
      orders: [],
    });
    const { buildWorklist, calls } = worklistFake([{ nomusPurchaseOrderId: "o1", financialSupplierId: SUPPLIER_ID, identitySafe: true }], 120);
    const response = await buildSupplierNomusOrdersDetail(
      prisma,
      SUPPLIER_ID,
      { period: PERIOD, evaluationStatus: "all", page: 2, pageSize: 50 },
      { buildWorklist }
    );
    assert.equal(calls.length, 1);
    const base = calls[0]!.base as { AND: unknown[] };
    assert.deepEqual(base.AND[0], { supplierExternalId: { in: [10] } });
    const periodPart = base.AND[1] as { OR: Array<{ issuedAt?: { gte: Date; lt: Date } }> };
    assert.ok(periodPart.OR[0]!.issuedAt!.gte instanceof Date, "janela COALESCE(issuedAt, firstSeenAt) aplicada");
    assert.deepEqual(calls[0]!.options, { evaluationStatus: "all", page: 2, pageSize: 50 });
    assert.equal(response.orders.total, 120);
    assert.equal(response.orders.totalPages, 3);
    assert.equal(response.orders.page, 2);
    assert.equal(response.orders.items.length, 1);
    assert.equal(response.kpis.eligibleOrders, 120);
    assert.equal(response.identity.excludedOnPage, 0);
    assert.equal(response.supplier.id, SUPPLIER_ID);
    // Consultas por chave, sem pedido a pedido: cadastro + aliases próprios + aliases compartilhados.
    assert.deepEqual(log, ["financialSupplier.findUnique", "financialSupplierAlias.findMany", "financialSupplierAlias.findMany"]);
  });

  it("18. linha que o resolvedor NÃO atribui a este fornecedor é descartada e contada", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }],
      orders: [],
    });
    const { buildWorklist } = worklistFake([
      { nomusPurchaseOrderId: "mine", financialSupplierId: SUPPLIER_ID, identitySafe: true },
      { nomusPurchaseOrderId: "other", financialSupplierId: OTHER_ID, identitySafe: true },
      { nomusPurchaseOrderId: "fallback", financialSupplierId: SUPPLIER_ID, identitySafe: false },
    ]);
    const response = await buildSupplierNomusOrdersDetail(prisma, SUPPLIER_ID, { period: PERIOD, evaluationStatus: "all", page: 1, pageSize: 50 }, { buildWorklist });
    assert.deepEqual(response.orders.items.map((row) => row.nomusPurchaseOrderId), ["mine"]);
    assert.equal(response.identity.excludedOnPage, 2);
  });

  it("19. sem chave segura → resposta vazia SEM consultar pedidos", async () => {
    const { prisma, log } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [],
      orders: [order({ id: "o1", externalId: 1, supplierName: "Alpha" })],
    });
    const { buildWorklist, calls } = worklistFake([]);
    const response = await buildSupplierNomusOrdersDetail(prisma, SUPPLIER_ID, { period: PERIOD, evaluationStatus: "all", page: 1, pageSize: 50 }, { buildWorklist });
    assert.equal(calls.length, 0);
    assert.equal(response.identity.matchable, false);
    assert.equal(response.orders.total, 0);
    assert.equal(response.orders.totalPages, 0);
    assert.equal(response.kpis.eligibleOrders, 0);
    assert.equal(response.kpis.coverage, null);
    assert.deepEqual(log, ["financialSupplier.findUnique", "financialSupplierAlias.findMany"]);
  });

  it("20. página além do fim recua para a última página válida", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ ...BASE_SUPPLIER, document: null, normalizedDocument: null }],
      aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }],
      orders: [],
    });
    const calls: number[] = [];
    const buildWorklist = (async (_p: unknown, _b: unknown, options: { page: number; pageSize: number }) => {
      calls.push(options.page);
      const onLastPage = options.page === 2;
      return {
        page: options.page,
        pageSize: options.pageSize,
        total: 60,
        scaleMin: 1,
        scaleMax: 5,
        kpis: { eligibleOrders: 60, evaluatedOrders: 0, pendingOrders: 60, coverage: 0, overallScore: null, qualityScore: null, deliveryScore: null, conformityScore: null, serviceScore: null },
        items: onLastPage
          ? [{ nomusPurchaseOrderId: "x", externalId: 1, orderNumber: "PC-1", issuedAt: null, stage: "RECEIVED", canceled: false, eligible: true, eligibilityReason: null, evaluationStatus: "PENDING", supplier: { nomusExternalId: 10, nomusName: "A", resolvedName: "A", resolvedDocument: null, financialSupplierId: SUPPLIER_ID, matchMethod: "SUPPLIER_ALIAS", matchConfidence: "EXACT", identitySafe: true }, evaluation: null, suggestions: { quality: 3, delivery: 3, conformity: 3, service: 3 } }]
          : [],
      };
    }) as unknown as typeof buildNomusSupplierEvaluationWorklistFromWhere;
    const response = await buildSupplierNomusOrdersDetail(prisma, SUPPLIER_ID, { period: PERIOD, evaluationStatus: "all", page: 9, pageSize: 50 }, { buildWorklist });
    assert.deepEqual(calls, [9, 2]);
    assert.equal(response.orders.page, 2);
    assert.equal(response.orders.totalPages, 2);
    assert.equal(response.orders.items.length, 1);
  });

  it("21. mesma resposta independentemente do contexto de tela (menu Fornecedores × aba Centro de Custos)", async () => {
    const build = () =>
      createFakePrisma({
        suppliers: [BASE_SUPPLIER],
        aliases: [{ supplierId: SUPPLIER_ID, externalSupplierId: 10 }],
        orders: [],
      });
    const { buildWorklist } = worklistFake([{ nomusPurchaseOrderId: "o1", financialSupplierId: SUPPLIER_ID, identitySafe: true }]);
    const params = { period: PERIOD, evaluationStatus: "pending" as const, page: 1, pageSize: 50 };
    const first = await buildSupplierNomusOrdersDetail(build().prisma, SUPPLIER_ID, params, { buildWorklist });
    const second = await buildSupplierNomusOrdersDetail(build().prisma, SUPPLIER_ID, params, { buildWorklist });
    assert.deepEqual(second, first);
  });
});

describe("buildNomusSupplierEvaluationWorklistFromWhere — núcleo compartilhado", () => {
  it("consultas fixas (count, count, avaliações, página) + identidade injetada; sem consulta por pedido", async () => {
    const orders = Array.from({ length: 7 }, (_, i) =>
      order({ id: `o${i}`, externalId: i + 1, supplierExternalId: 10, supplierEvaluation: i === 0 ? { overallScore: 4, qualityScore: 4, deliveryScore: 4, conformityScore: 4, serviceScore: 4, methodologyVersion: 2, revision: 1 } : null })
    );
    const log: string[] = [];
    const prisma = {
      nomusPurchaseOrder: {
        count: async () => {
          log.push("count");
          return orders.length;
        },
        findMany: async (args: { take?: number; skip?: number; where: { supplierEvaluation?: unknown } }) => {
          log.push("findMany");
          if (args.where.supplierEvaluation) {
            return orders
              .filter((o) => o.supplierEvaluation)
              .map((o) => ({ supplierEvaluation: { ...o.supplierEvaluation!, overallScore: new Prisma.Decimal(o.supplierEvaluation!.overallScore), qualityScore: new Prisma.Decimal(4), deliveryScore: new Prisma.Decimal(4), conformityScore: new Prisma.Decimal(4), serviceScore: new Prisma.Decimal(4) } }));
          }
          return orders.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? orders.length)).map((o) => ({ ...o, supplierEvaluation: null }));
        },
      },
    } as unknown as PrismaClient;
    const resolveCalls: number[] = [];
    const response = await buildNomusSupplierEvaluationWorklistFromWhere(
      prisma,
      { supplierExternalId: { in: [10] } },
      { evaluationStatus: "all", page: 2, pageSize: 5 },
      {
        resolveSuppliers: async (rows) => {
          resolveCalls.push(rows.length);
          return rows.map(() => resolvedFor(SUPPLIER_ID, "EXACT"));
        },
      }
    );
    assert.deepEqual(log, ["count", "count", "findMany", "findMany"]);
    assert.deepEqual(resolveCalls, [2], "uma chamada batch para a página inteira");
    assert.equal(response.total, 7);
    assert.equal(response.items.length, 2);
    assert.equal(response.kpis.eligibleOrders, 7);
    assert.equal(response.kpis.evaluatedOrders, 1);
    assert.ok(response.items.every((row) => row.supplier.identitySafe && row.supplier.financialSupplierId === SUPPLIER_ID));
  });
});

describe("chave por documento exige a coluna normalizedDocument preenchida", () => {
  it("cadastro com document mas normalizedDocument NULL não usa a chave 2 (contagem não o inclui)", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [
        { id: SUPPLIER_ID, displayName: "Alpha", document: "12.345.678/0001-90", normalizedDocument: null, status: "ACTIVE" },
        { id: OTHER_ID, displayName: "Outro dono", document: "12345678000190", normalizedDocument: "12345678000190", status: "ACTIVE" },
      ],
      aliases: [],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.equal(identity.normalizedDocument, "12345678000190", "exibido para diagnóstico");
    assert.equal(identity.documentUnique, false, "a coluna do próprio cadastro está vazia — chave desligada");
    assert.equal(identity.where, null);
    assert.equal(identity.matchable, false);
  });

  it("sem outro dono e com a coluna vazia a chave continua desligada (nunca population de terceiro)", async () => {
    const { prisma } = createFakePrisma({
      suppliers: [{ id: SUPPLIER_ID, displayName: "Alpha", document: "12.345.678/0001-90", normalizedDocument: null, status: "ACTIVE" }],
      aliases: [],
      orders: [],
    });
    const { identity } = await resolveSupplierNomusOrdersIdentity(prisma, SUPPLIER_ID);
    assert.equal(identity.documentOwners, 0);
    assert.equal(identity.documentUnique, false);
    assert.equal(identity.where, null);
  });
});
