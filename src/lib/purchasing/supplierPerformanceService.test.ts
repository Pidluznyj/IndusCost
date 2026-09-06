/**
 * OP-26 — Serviço: transação, auditoria, concorrência, população e nº de queries.
 * Prisma é substituído por um duplo em memória — sem banco.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { SupplierEvaluationError } from "./supplierPerformance.js";
import {
  buildSupplierPerformanceDetail,
  buildSupplierPerformanceReport,
  loadSupplierEvaluationListSummaries,
  mapSupplierEvaluationError,
  savePurchaseOrderSupplierEvaluation,
} from "./supplierPerformance.server.js";

type EvaluationRecord = {
  id: string;
  purchaseOrderId: string;
  qualityScore: number;
  deliveryScore: number;
  conformityScore: number;
  serviceScore: number;
  overallScore: number;
  methodologyVersion: number;
  notes: string | null;
  revision: number;
  createdAt: Date;
  createdByUserId: string | null;
  createdByUserName: string | null;
  updatedAt: Date;
  updatedByUserId: string | null;
  updatedByUserName: string | null;
};

type HistoryRecord = {
  purchaseOrderId: string;
  action: string;
  reason: string | null;
  userId: string | null;
  userName: string | null;
  metaJson: Record<string, unknown>;
};

type WriteFakeOptions = {
  status?: string;
  evaluation?: EvaluationRecord | null;
  /** Simula falha ao gravar a auditoria (deve derrubar a transação inteira). */
  failHistory?: boolean;
  /** Simula outro usuário salvando entre o load e o update (CAS perde). */
  updateReturnsCount?: number;
  /** Simula UNIQUE(purchaseOrderId) violado por criação concorrente. */
  failCreateUnique?: boolean;
  missingOrder?: boolean;
};

const ORDER_ID = "11111111-1111-4111-8111-111111111111";

function buildEvaluation(partial: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    id: "eval-1",
    purchaseOrderId: ORDER_ID,
    qualityScore: 8,
    deliveryScore: 7,
    conformityScore: 9,
    serviceScore: 8,
    overallScore: 8,
    methodologyVersion: 1,
    notes: "Observação anterior.",
    revision: 1,
    createdAt: new Date("2026-03-01T10:00:00Z"),
    createdByUserId: "user-a",
    createdByUserName: "Usuário A",
    updatedAt: new Date("2026-03-01T10:00:00Z"),
    updatedByUserId: "user-a",
    updatedByUserName: "Usuário A",
    ...partial,
  };
}

/** Duplo do Prisma para o caminho de escrita, com transação atômica simulada. */
function createWriteFake(options: WriteFakeOptions = {}) {
  const state = {
    evaluation: options.evaluation ?? null,
    history: [] as HistoryRecord[],
  };
  let committed = state.evaluation;
  const committedHistory: HistoryRecord[] = [];

  const tx = {
    purchaseOrder: {
      findUnique: async () =>
        options.missingOrder
          ? null
          : {
              id: ORDER_ID,
              status: options.status ?? "RECEBIDO",
              supplierId: "sup-1",
              supplierDisplayNameSnapshot: "ABC Resinas",
              supplierDocumentSnapshot: "12345678000199",
              supplierEvaluation: state.evaluation,
            },
    },
    purchaseOrderSupplierEvaluation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (options.failCreateUnique) {
          // Erro real do Prisma para exercitar o `instanceof` do serviço.
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: Prisma.prismaVersion.client,
            meta: { target: ["purchaseOrderId"] },
          });
        }
        state.evaluation = buildEvaluation({
          ...(data as Partial<EvaluationRecord>),
          qualityScore: Number(data.qualityScore),
          deliveryScore: Number(data.deliveryScore),
          conformityScore: Number(data.conformityScore),
          serviceScore: Number(data.serviceScore),
          overallScore: Number(data.overallScore),
          revision: 1,
        });
        return state.evaluation;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        const count = options.updateReturnsCount ?? 1;
        if (count === 1 && state.evaluation) {
          state.evaluation = {
            ...state.evaluation,
            qualityScore: Number(data.qualityScore),
            deliveryScore: Number(data.deliveryScore),
            conformityScore: Number(data.conformityScore),
            serviceScore: Number(data.serviceScore),
            overallScore: Number(data.overallScore),
            notes: (data.notes as string | null) ?? null,
            revision: Number(data.revision),
            updatedByUserId: (data.updatedByUserId as string) ?? null,
            updatedByUserName: (data.updatedByUserName as string) ?? null,
          };
        }
        return { count };
      },
    },
    purchaseOrderHistoryEvent: {
      create: async ({ data }: { data: HistoryRecord }) => {
        if (options.failHistory) throw new Error("falha ao gravar auditoria");
        state.history.push(data);
        return data;
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<void>) => {
      const evaluationBefore = state.evaluation;
      const historyBefore = [...state.history];
      try {
        await fn(tx);
        committed = state.evaluation;
        committedHistory.length = 0;
        committedHistory.push(...state.history);
      } catch (error) {
        // ROLLBACK: nada do que a transação tocou permanece.
        state.evaluation = evaluationBefore;
        state.history = historyBefore;
        throw error;
      }
    },
    purchaseOrder: {
      findUnique: async () =>
        options.missingOrder
          ? null
          : {
              id: ORDER_ID,
              status: options.status ?? "RECEBIDO",
              supplierId: "sup-1",
              supplierDisplayNameSnapshot: "ABC Resinas",
              supplierDocumentSnapshot: "12345678000199",
              supplierEvaluation: state.evaluation,
            },
    },
  };

  return {
    prisma: prisma as unknown as PrismaClient,
    get evaluation() {
      return committed;
    },
    get history() {
      return committedHistory;
    },
  };
}

const ACTOR = { userId: "user-b", userName: "Usuário B" };

describe("criação da avaliação", () => {
  it("grava notas, nota geral do servidor e auditoria na mesma transação", async () => {
    const fake = createWriteFake();
    const result = await savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
      qualityScore: 5,
      deliveryScore: 4,
      conformityScore: 5,
      serviceScore: 3,
      notes: "  Fornecedor cumpriu o combinado.  ",
    });

    assert.equal(result.evaluation?.scores.overall, 4.25);
    assert.equal(fake.evaluation?.overallScore, 4.25);
    assert.equal(fake.evaluation?.revision, 1);
    assert.equal(fake.evaluation?.methodologyVersion, 2);
    assert.equal(fake.evaluation?.notes, "Fornecedor cumpriu o combinado.");
    assert.equal(fake.evaluation?.createdByUserId, "user-b");

    assert.equal(fake.history.length, 1);
    assert.equal(fake.history[0].action, "SUPPLIER_EVALUATION_CREATED");
    assert.equal(fake.history[0].userId, "user-b");
    const meta = fake.history[0].metaJson as Record<string, unknown>;
    assert.equal((meta.scores as Record<string, number>).overall, 4.25);
    assert.equal(meta.supplierId, "sup-1");
    assert.equal(meta.revision, 1);
  });

  it("ignora overallScore enviado pelo cliente — o servidor calcula 4,25", async () => {
    const fake = createWriteFake();
    const result = await savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
      qualityScore: 5,
      deliveryScore: 4,
      conformityScore: 5,
      serviceScore: 3,
      overallScore: 99,
      methodologyVersion: 1,
    } as never);
    assert.equal(result.evaluation?.scores.overall, 4.25);
    assert.equal(fake.evaluation?.overallScore, 4.25);
    assert.equal(fake.evaluation?.methodologyVersion, 2);
  });

  it("ENCERRADO também é elegível", async () => {
    const fake = createWriteFake({ status: "ENCERRADO" });
    await savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
      qualityScore: 5,
      deliveryScore: 5,
      conformityScore: 5,
      serviceScore: 5,
    });
    assert.equal(fake.evaluation?.overallScore, 5);
  });

  it("nota 1 é válida e não vira ausência de avaliação", async () => {
    const fake = createWriteFake();
    const result = await savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
      qualityScore: 1,
      deliveryScore: 1,
      conformityScore: 1,
      serviceScore: 1,
    });
    assert.equal(result.evaluation?.scores.overall, 1);
    assert.equal(fake.history.length, 1);
  });

  for (const status of [
    "RASCUNHO",
    "APROVADO",
    "ENVIADO",
    "EMITIDO",
    "CONFIRMADO",
    "PARCIALMENTE_RECEBIDO",
    "CANCELADO",
  ]) {
    it(`recusa avaliação com status ${status} (409) e não grava nada`, async () => {
      const fake = createWriteFake({ status });
      await assert.rejects(
        savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
          qualityScore: 9,
          deliveryScore: 9,
          conformityScore: 9,
          serviceScore: 9,
        }),
        (error: unknown) => {
          assert.ok(error instanceof SupplierEvaluationError);
          assert.equal(error.code, "PURCHASE_ORDER_NOT_ELIGIBLE_FOR_SUPPLIER_EVALUATION");
          assert.equal(error.httpStatus, 409);
          return true;
        }
      );
      assert.equal(fake.evaluation, null);
      assert.equal(fake.history.length, 0);
    });
  }

  it("pedido inexistente retorna 404", async () => {
    const fake = createWriteFake({ missingOrder: true });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 9,
        deliveryScore: 9,
        conformityScore: 9,
        serviceScore: 9,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "PURCHASE_ORDER_NOT_FOUND");
        assert.equal(error.httpStatus, 404);
        return true;
      }
    );
  });

  it("criação concorrente vira conflito de domínio, não erro bruto do Prisma", async () => {
    const fake = createWriteFake({ failCreateUnique: true });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 5,
        deliveryScore: 4,
        conformityScore: 5,
        serviceScore: 3,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "SUPPLIER_EVALUATION_REVISION_CONFLICT");
        assert.equal(error.httpStatus, 409);
        return true;
      }
    );
    assert.equal(fake.history.length, 0);
  });
});

describe("revisão da avaliação", () => {
  it("exige motivo e preserva before/after no histórico", async () => {
    const fake = createWriteFake({ evaluation: buildEvaluation() });
    const result = await savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
      qualityScore: 9,
      deliveryScore: 8,
      conformityScore: 9,
      serviceScore: 8,
      notes: "Avaliação corrigida.",
      expectedRevision: 1,
      revisionReason: "Correção após conferência do recebimento.",
    });

    assert.equal(result.evaluation?.revision, 2);
    assert.equal(result.evaluation?.scores.overall, 8.5);
    assert.equal(fake.evaluation?.updatedByUserName, "Usuário B");
    assert.equal(fake.evaluation?.createdByUserName, "Usuário A");

    assert.equal(fake.history.length, 1);
    const event = fake.history[0];
    assert.equal(event.action, "SUPPLIER_EVALUATION_REVISED");
    assert.equal(event.reason, "Correção após conferência do recebimento.");
    const meta = event.metaJson as Record<string, Record<string, unknown>>;
    assert.equal(meta.before.overall, 8);
    assert.equal(meta.before.notes, "Observação anterior.");
    assert.equal(meta.after.overall, 8.5);
    assert.equal(meta.after.notes, "Avaliação corrigida.");
    assert.equal((event.metaJson as Record<string, unknown>).revision, 2);
  });

  it("revisão sem motivo é rejeitada e nada é gravado", async () => {
    const fake = createWriteFake({ evaluation: buildEvaluation() });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 9,
        deliveryScore: 8,
        conformityScore: 9,
        serviceScore: 8,
        expectedRevision: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "INVALID_SUPPLIER_EVALUATION_PAYLOAD");
        return true;
      }
    );
    assert.equal(fake.evaluation?.revision, 1);
    assert.equal(fake.history.length, 0);
  });

  it("expectedRevision defasado devolve 409 sem sobrescrever", async () => {
    // Usuário A carregou revision 1; usuário B já salvou e a base está em 2.
    const fake = createWriteFake({ evaluation: buildEvaluation({ revision: 2 }) });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 1,
        deliveryScore: 1,
        conformityScore: 1,
        serviceScore: 1,
        expectedRevision: 1,
        revisionReason: "Tentativa concorrente.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "SUPPLIER_EVALUATION_REVISION_CONFLICT");
        assert.equal(error.httpStatus, 409);
        return true;
      }
    );
    assert.equal(fake.evaluation?.overallScore, 8);
    assert.equal(fake.history.length, 0);
  });

  it("corrida entre load e update (CAS retorna 0 linhas) devolve 409", async () => {
    const fake = createWriteFake({
      evaluation: buildEvaluation(),
      updateReturnsCount: 0,
    });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 9,
        deliveryScore: 9,
        conformityScore: 9,
        serviceScore: 9,
        expectedRevision: 1,
        revisionReason: "Correção.",
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "SUPPLIER_EVALUATION_REVISION_CONFLICT");
        return true;
      }
    );
    assert.equal(fake.history.length, 0);
  });

  it("salvar sem expectedRevision sobre avaliação existente é conflito, não last-write-wins", async () => {
    const fake = createWriteFake({ evaluation: buildEvaluation() });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 1,
        deliveryScore: 1,
        conformityScore: 1,
        serviceScore: 1,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "SUPPLIER_EVALUATION_REVISION_CONFLICT");
        return true;
      }
    );
    assert.equal(fake.evaluation?.overallScore, 8);
  });
});

describe("transação — auditoria e avaliação são indivisíveis", () => {
  it("falha ao gravar histórico impede a criação da avaliação", async () => {
    const fake = createWriteFake({ failHistory: true });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 9,
        deliveryScore: 9,
        conformityScore: 9,
        serviceScore: 9,
      })
    );
    assert.equal(fake.evaluation, null);
    assert.equal(fake.history.length, 0);
  });

  it("falha ao gravar histórico impede a revisão", async () => {
    const fake = createWriteFake({
      evaluation: buildEvaluation(),
      failHistory: true,
    });
    await assert.rejects(
      savePurchaseOrderSupplierEvaluation(fake.prisma, ORDER_ID, ACTOR, {
        qualityScore: 5,
        deliveryScore: 5,
        conformityScore: 5,
        serviceScore: 5,
        expectedRevision: 1,
        revisionReason: "Correção.",
      })
    );
    assert.equal(fake.evaluation?.overallScore, 8);
    assert.equal(fake.evaluation?.revision, 1);
    assert.equal(fake.history.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * Leitura consolidada — população, cobertura e nº de queries
 * ------------------------------------------------------------------ */

type QueryLog = Array<{ model: string; op: string; args: Record<string, unknown> }>;

function createReadFake(input: {
  eligibleCount: number;
  evaluatedRows: Array<{ supplierId: string; scores: number[]; methodologyVersion?: number }>;
  listTotal: number;
  listItems?: unknown[];
  supplier?: { id: string; displayName: string; document: string | null; status: string } | null;
  groups?: Array<{ supplierId: string; _count: { _all: number } }>;
  suppliers?: Array<{ id: string; displayName: string; document: string | null; status: string }>;
}) {
  const log: QueryLog = [];
  const evaluated = input.evaluatedRows.map((row) => ({
    supplierId: row.supplierId,
    supplierEvaluation: {
      overallScore: row.scores[0],
      qualityScore: row.scores[1] ?? row.scores[0],
      deliveryScore: row.scores[2] ?? row.scores[0],
      conformityScore: row.scores[3] ?? row.scores[0],
      serviceScore: row.scores[4] ?? row.scores[0],
      methodologyVersion: row.methodologyVersion ?? 1,
    },
  }));

  let countCall = 0;
  let findManyCall = 0;

  const prisma = {
    financialSupplier: {
      findUnique: async (args: Record<string, unknown>) => {
        log.push({ model: "financialSupplier", op: "findUnique", args });
        return input.supplier === undefined
          ? { id: "sup-1", displayName: "ABC Resinas", document: "123", status: "ACTIVE" }
          : input.supplier;
      },
      findMany: async (args: Record<string, unknown>) => {
        log.push({ model: "financialSupplier", op: "findMany", args });
        return input.suppliers ?? [];
      },
    },
    purchaseOrder: {
      count: async (args: Record<string, unknown>) => {
        log.push({ model: "purchaseOrder", op: "count", args });
        countCall += 1;
        return countCall === 1 ? input.eligibleCount : input.listTotal;
      },
      findMany: async (args: Record<string, unknown>) => {
        log.push({ model: "purchaseOrder", op: "findMany", args });
        findManyCall += 1;
        return findManyCall === 1 ? evaluated : (input.listItems ?? []);
      },
      groupBy: async (args: Record<string, unknown>) => {
        log.push({ model: "purchaseOrder", op: "groupBy", args });
        return input.groups ?? [];
      },
    },
  };

  return { prisma: prisma as unknown as PrismaClient, log };
}

const PERIOD = { from: "2026-02-01", to: "2026-02-28" };

describe("detalhe do fornecedor — população e cobertura", () => {
  it("consolida sobre todo o período e não sobre a página visível", async () => {
    const fake = createReadFake({
      eligibleCount: 42,
      evaluatedRows: Array.from({ length: 37 }, () => ({
        supplierId: "sup-1",
        scores: [8.74, 9.21, 7.83, 9.42, 8.5],
      })),
      listTotal: 60,
      listItems: [],
    });

    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });

    assert.equal(result.summary.eligibleOrders, 42);
    assert.equal(result.summary.evaluatedOrders, 37);
    assert.equal(result.summary.pendingOrders, 5);
    assert.equal(result.summary.overallScore, 8.74);
    assert.equal(result.summary.qualityScore, 9.21);
    assert.ok(result.summary.coverage != null);
    assert.equal(Number(result.summary.coverage.toFixed(6)), 0.880952);
    assert.equal(result.orders.total, 60);
    assert.equal(result.orders.pageSize, 50);
  });

  it("média dos pedidos ignora valor financeiro (5 e 10 -> 7,50)", async () => {
    const fake = createReadFake({
      eligibleCount: 2,
      evaluatedRows: [
        { supplierId: "sup-1", scores: [5] },
        { supplierId: "sup-1", scores: [10] },
      ],
      listTotal: 2,
    });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.summary.overallScore, 7.5);
  });

  it("V2: 4,50 / 3,80 / 4,20 / 5,00 -> 4,38 e rascunho não entra", async () => {
    const fake = createReadFake({
      eligibleCount: 5,
      evaluatedRows: [
        { supplierId: "sup-1", scores: [4.5, 5, 4, 5, 4], methodologyVersion: 2 },
        { supplierId: "sup-1", scores: [3.8, 4, 3, 4, 4], methodologyVersion: 2 },
        { supplierId: "sup-1", scores: [4.2, 4, 4, 5, 4], methodologyVersion: 2 },
        { supplierId: "sup-1", scores: [5, 5, 5, 5, 5], methodologyVersion: 2 },
      ],
      listTotal: 5,
    });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.summary.overallScore, 4.38);
    assert.equal(result.summary.evaluatedOrders, 4);
    assert.equal(result.scaleMax, 5);
    assert.equal(result.summary.coverage, 0.8);
  });

  it("V2 sem ponderação financeira: 1 e 5 -> 3,00", async () => {
    const fake = createReadFake({
      eligibleCount: 2,
      evaluatedRows: [
        { supplierId: "sup-1", scores: [1], methodologyVersion: 2 },
        { supplierId: "sup-1", scores: [5], methodologyVersion: 2 },
      ],
      listTotal: 2,
    });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.summary.overallScore, 3);
    assert.equal(result.scaleMax, 5);
  });

  it("sem pedidos elegíveis: cobertura null e nota null", async () => {
    const fake = createReadFake({ eligibleCount: 0, evaluatedRows: [], listTotal: 0 });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.summary.coverage, null);
    assert.equal(result.summary.overallScore, null);
    assert.equal(result.orders.totalPages, 0);
    assert.equal(result.orders.page, 1);
  });

  it("elegíveis sem avaliação: cobertura 0 e nota null", async () => {
    const fake = createReadFake({ eligibleCount: 5, evaluatedRows: [], listTotal: 5 });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.summary.coverage, 0);
    assert.equal(result.summary.overallScore, null);
    assert.equal(result.summary.pendingOrders, 5);
  });

  it("fornecedor inexistente devolve 404 de domínio", async () => {
    const fake = createReadFake({
      eligibleCount: 0,
      evaluatedRows: [],
      listTotal: 0,
      supplier: null,
    });
    await assert.rejects(
      buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
        period: PERIOD,
        evaluationStatus: "all",
        page: 1,
        pageSize: 50,
      }),
      (error: unknown) => {
        assert.ok(error instanceof SupplierEvaluationError);
        assert.equal(error.code, "SUPPLIER_NOT_FOUND");
        return true;
      }
    );
  });

  it("fornecedor inativo continua consultável", async () => {
    const fake = createReadFake({
      eligibleCount: 3,
      evaluatedRows: [{ supplierId: "sup-1", scores: [9] }],
      listTotal: 3,
      supplier: { id: "sup-1", displayName: "Inativo", document: null, status: "INACTIVE" },
    });
    const result = await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(result.supplier.status, "INACTIVE");
    assert.equal(result.summary.overallScore, 9);
  });
});

describe("where canônico — período, elegibilidade e filtros", () => {
  it("filtra pelo eixo COALESCE(issuedAt, createdAt) e só por RECEBIDO/ENCERRADO", async () => {
    const fake = createReadFake({ eligibleCount: 1, evaluatedRows: [], listTotal: 1 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });

    const eligible = fake.log.find((q) => q.op === "count")?.args.where as Record<string, unknown>;
    assert.deepEqual(eligible.status, { in: ["RECEBIDO", "ENCERRADO"] });
    assert.equal(eligible.supplierId, "sup-1");

    const or = (eligible.AND as Array<Record<string, unknown>>)[0].OR as Array<
      Record<string, unknown>
    >;
    assert.equal(or.length, 2);
    const bounds = or[0].issuedAt as { gte: Date; lt: Date };
    assert.equal(bounds.gte.getFullYear(), 2026);
    assert.equal(bounds.gte.getMonth(), 1);
    assert.equal(bounds.gte.getDate(), 1);
    // Fim exclusivo no dia seguinte ao "até".
    assert.equal(bounds.lt.getMonth(), 2);
    assert.equal(bounds.lt.getDate(), 1);
    // Fallback: sem emissão, usa a criação na mesma janela.
    const fallback = (or[1].AND as Array<Record<string, unknown>>)[0];
    assert.deepEqual(fallback, { issuedAt: null });
  });

  it("filtro Pendentes = elegível sem avaliação", async () => {
    const fake = createReadFake({ eligibleCount: 1, evaluatedRows: [], listTotal: 1 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "pending",
      page: 1,
      pageSize: 50,
    });
    const listWhere = fake.log.filter((q) => q.op === "count")[1].args.where as Record<
      string,
      unknown
    >;
    assert.deepEqual(listWhere.status, { in: ["RECEBIDO", "ENCERRADO"] });
    assert.deepEqual(listWhere.supplierEvaluation, { is: null });
  });

  it("filtro Avaliados usa isNot: null (nunca NOT + is)", async () => {
    const fake = createReadFake({ eligibleCount: 1, evaluatedRows: [], listTotal: 1 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "evaluated",
      page: 1,
      pageSize: 50,
    });
    const listWhere = fake.log.filter((q) => q.op === "count")[1].args.where as Record<
      string,
      unknown
    >;
    assert.deepEqual(listWhere.supplierEvaluation, { isNot: null });
    assert.equal(listWhere.NOT, undefined);
  });

  it("filtro Não elegíveis exclui RECEBIDO/ENCERRADO", async () => {
    const fake = createReadFake({ eligibleCount: 1, evaluatedRows: [], listTotal: 1 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "ineligible",
      page: 1,
      pageSize: 50,
    });
    const listWhere = fake.log.filter((q) => q.op === "count")[1].args.where as Record<
      string,
      unknown
    >;
    assert.deepEqual(listWhere.status, { notIn: ["RECEBIDO", "ENCERRADO"] });
  });

  it("período 'Todos' não aplica recorte de data", async () => {
    const fake = createReadFake({ eligibleCount: 1, evaluatedRows: [], listTotal: 1 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: { from: null, to: null },
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    const eligible = fake.log.find((q) => q.op === "count")?.args.where as Record<string, unknown>;
    assert.equal(eligible.AND, undefined);
  });

  it("lista pagina no servidor e não carrega payload cru", async () => {
    const fake = createReadFake({ eligibleCount: 120, evaluatedRows: [], listTotal: 120 });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 2,
      pageSize: 50,
    });
    const page = fake.log.filter((q) => q.op === "findMany")[1].args;
    assert.equal(page.skip, 50);
    assert.equal(page.take, 50);
    const select = page.select as Record<string, unknown>;
    assert.ok(select.code);
    assert.equal(select.evidenceIdsJson, undefined);
    assert.equal(page.include, undefined);
  });
});

describe("nº de queries — sem N+1", () => {
  it("detalhe do fornecedor usa 5 consultas, independente do volume", async () => {
    const many = Array.from({ length: 500 }, () => ({ supplierId: "sup-1", scores: [9] }));
    const fake = createReadFake({
      eligibleCount: 500,
      evaluatedRows: many,
      listTotal: 500,
      listItems: [],
    });
    await buildSupplierPerformanceDetail(fake.prisma, "sup-1", {
      period: PERIOD,
      evaluationStatus: "all",
      page: 1,
      pageSize: 50,
    });
    assert.equal(fake.log.length, 5);
  });

  it("relatório global usa 3 consultas para 500 fornecedores", async () => {
    const groups = Array.from({ length: 500 }, (_, i) => ({
      supplierId: `sup-${i}`,
      _count: { _all: 2 },
    }));
    const evaluatedRows = groups.map((g) => ({ supplierId: g.supplierId, scores: [8] }));
    const suppliers = groups.map((g) => ({
      id: g.supplierId,
      displayName: `Fornecedor ${g.supplierId}`,
      document: null,
      status: "ACTIVE",
    }));

    const fake = createReadFake({
      eligibleCount: 1000,
      evaluatedRows,
      listTotal: 0,
      groups,
      suppliers,
    });

    const report = await buildSupplierPerformanceReport(fake.prisma, {
      period: PERIOD,
      sort: "name",
    });

    assert.equal(fake.log.length, 3);
    assert.equal(report.rows.length, 500);
    assert.equal(report.totals.eligibleOrders, 1000);
    assert.equal(report.totals.evaluatedOrders, 500);
    assert.equal(report.totals.overallScore, 8);
    assert.equal(report.rows[0].summary.coverage, 0.5);
  });

  it("relatório sem fornecedor elegível devolve vazio sem quebrar", async () => {
    const fake = createReadFake({
      eligibleCount: 0,
      evaluatedRows: [],
      listTotal: 0,
      groups: [],
    });
    const report = await buildSupplierPerformanceReport(fake.prisma, {
      period: PERIOD,
      sort: "name",
    });
    assert.deepEqual(report.rows, []);
    assert.equal(report.totals.coverage, null);
    assert.equal(report.methodologyVersion, 2);
  });
});

describe("lista de fornecedores — resumo em lote", () => {
  function createListSummaryFake(input: {
    nomusEvals?: Array<{
      financialSupplierId: string;
      supplierMatchConfidence: string;
      overallScore: number;
      qualityScore: number;
      deliveryScore: number;
      conformityScore: number;
      serviceScore: number;
      methodologyVersion: number;
      nomusPurchaseOrder: { supplierExternalId: number | null };
    }>;
    internalOrders?: Array<{
      supplierId: string;
      supplierEvaluation: {
        overallScore: number;
        qualityScore: number;
        deliveryScore: number;
        conformityScore: number;
        serviceScore: number;
        methodologyVersion: number;
      } | null;
    }>;
    nomusEligible?: Array<{ supplierExternalId: number; _count: { _all: number } }>;
  }) {
    const log: QueryLog = [];
    const prisma = {
      nomusPurchaseOrderSupplierEvaluation: {
        findMany: async (args: Record<string, unknown>) => {
          log.push({ model: "nomusPurchaseOrderSupplierEvaluation", op: "findMany", args });
          return input.nomusEvals ?? [];
        },
      },
      purchaseOrder: {
        findMany: async (args: Record<string, unknown>) => {
          log.push({ model: "purchaseOrder", op: "findMany", args });
          return input.internalOrders ?? [];
        },
      },
      nomusPurchaseOrder: {
        groupBy: async (args: Record<string, unknown>) => {
          log.push({ model: "nomusPurchaseOrder", op: "groupBy", args });
          return input.nomusEligible ?? [];
        },
      },
    };
    return { prisma: prisma as unknown as PrismaClient, log };
  }

  it("5 e 50 fornecedores usam o mesmo número de consultas", async () => {
    const five = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000000${i}`);
    const fifty = Array.from({ length: 50 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const fake5 = createListSummaryFake({});
    const fake50 = createListSummaryFake({});
    await loadSupplierEvaluationListSummaries(fake5.prisma, five);
    await loadSupplierEvaluationListSummaries(fake50.prisma, fifty);
    assert.equal(fake5.log.length, fake50.log.length);
    assert.ok(fake5.log.length >= 2 && fake5.log.length <= 3);
  });

  it("não associa avaliação Nomus com identidade FALLBACK", async () => {
    const supplierId = "11111111-1111-4111-8111-111111111111";
    const fake = createListSummaryFake({
      nomusEvals: [
        {
          financialSupplierId: supplierId,
          supplierMatchConfidence: "FALLBACK",
          overallScore: 5,
          qualityScore: 5,
          deliveryScore: 5,
          conformityScore: 5,
          serviceScore: 5,
          methodologyVersion: 2,
          nomusPurchaseOrder: { supplierExternalId: 99 },
        },
      ],
      internalOrders: [],
    });
    const result = await loadSupplierEvaluationListSummaries(fake.prisma, [supplierId]);
    assert.equal(result.items[0]?.summary.overallScore, null);
  });
});

describe("mapeamento de erro HTTP", () => {
  it("preserva código e status do domínio", () => {
    const mapped = mapSupplierEvaluationError(
      new SupplierEvaluationError("SUPPLIER_EVALUATION_REVISION_CONFLICT", "conflito")
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.body.code, "SUPPLIER_EVALUATION_REVISION_CONFLICT");
  });

  it("erro inesperado vira 500 genérico sem vazar detalhe", () => {
    const mapped = mapSupplierEvaluationError(new Error("segredo interno"));
    assert.equal(mapped.status, 500);
    assert.doesNotMatch(mapped.body.error, /segredo/);
  });
});
