import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  ComponentPerformanceValidationError,
  patchComponentPerformanceProduct,
} from "./componentPerformanceChange.server.js";

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  status: string | null;
  type: "PRODUCT" | "COMPONENT";
  cycleTimeSeconds: number | null;
  cavities: number | null;
  setupTimeMin: number | null;
  efficiencyExpected: number | null;
  costingMode: string;
  defaultLotSize: number;
  updatedAt: Date;
};

type LogRow = {
  id: string;
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  productTypeSnapshot: "COMPONENT";
  changedAt: Date;
  changedByUserId: string;
  changedByUserName: string;
  changedByUserEmail: string;
  responsiblePersonName: string;
  note: string | null;
  oldCycleTimeSeconds: number | null;
  newCycleTimeSeconds: number | null;
  oldCavities: number | null;
  newCavities: number | null;
  oldValuesJson: unknown;
  newValuesJson: unknown;
  changedFieldsJson: string[];
  source: string;
  createdAt: Date;
};

type PublishedCostRow = {
  id: string;
  productId: string;
  unitProductionCost: number;
  status: string;
};

function createMockDb(initial?: Partial<ProductRow>) {
  const productId = initial?.id ?? randomUUID();
  const products = new Map<string, ProductRow>([
    [
      productId,
      {
        id: productId,
        sku: initial?.sku ?? "COMP-001",
        name: initial?.name ?? "Componente Teste",
        status: "ACTIVE",
        type: "COMPONENT",
        cycleTimeSeconds: 45,
        cavities: 4,
        setupTimeMin: 10,
        efficiencyExpected: 95,
        costingMode: "OWN_PROCESS",
        defaultLotSize: 1000,
        updatedAt: new Date(),
        ...initial,
      },
    ],
  ]);
  const logs: LogRow[] = [];
  const publishedCosts: PublishedCostRow[] = [
    {
      id: randomUUID(),
      productId,
      unitProductionCost: 12.5,
      status: "PUBLISHED",
    },
  ];

  let logSeq = 0;

  const db = {
    product: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: unknown }) => {
        const row = products.get(where.id);
        if (!row) return null;
        if (select && typeof select === "object" && select !== null && "_count" in select) {
          return {
            ...row,
            _count: { SalesOrderItem: 2, ProductRouting: 0 },
          };
        }
        return { ...row };
      },
      update: async ({
        where,
        data,
        select,
      }: {
        where: { id: string };
        data: Partial<ProductRow>;
        select?: unknown;
      }) => {
        const row = products.get(where.id);
        if (!row) throw new Error("not found");
        const updated = {
          ...row,
          ...data,
          updatedAt: new Date(),
        };
        products.set(where.id, updated);
        if (select && typeof select === "object" && select !== null && "_count" in select) {
          return { ...updated, _count: { SalesOrderItem: 2, ProductRouting: 0 } };
        }
        return updated;
      },
    },
    componentPerformanceChangeLog: {
      count: async ({ where }: { where: { productId: string } }) =>
        logs.filter((l) => l.productId === where.productId).length,
      findMany: async ({ where }: { where: { productId: string } }) =>
        logs.filter((l) => l.productId === where.productId),
      create: async ({ data }: { data: Omit<LogRow, "id" | "changedAt" | "createdAt"> }) => {
        const row: LogRow = {
          id: `log-${++logSeq}`,
          changedAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        logs.push(row);
        return row;
      },
    },
    productionCostTableItem: {
      findFirst: async ({ where }: { where: { productId: string } }) =>
        publishedCosts.find((c) => c.productId === where.productId) ?? null,
    },
    $transaction: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    _logs: logs,
    _products: products,
    _publishedCosts: publishedCosts,
  };

  return { db, productId };
}

const actor = {
  userId: randomUUID(),
  userName: "Paulo Admin",
  userEmail: "paulo@example.com",
};

describe("componentPerformanceChange.server — patch transacional", () => {
  it("alteração de ciclo cria log com old/new e usuário logado", async () => {
    const { db, productId } = createMockDb();
    const result = await patchComponentPerformanceProduct(
      db as never,
      productId,
      {
        cycleTimeSeconds: 40,
        responsiblePersonName: "João da Produção",
        note: "Melhoria de setup",
      },
      actor
    );

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.changeLog.oldCycleTimeSeconds, 45);
    assert.equal(result.changeLog.newCycleTimeSeconds, 40);
    assert.equal(result.changeLog.responsiblePersonName, "João da Produção");
    assert.equal(result.changeLog.changedByUserEmail, actor.userEmail);
    assert.equal(result.changeLog.changedByUserId, actor.userId);
    assert.equal(db._logs.length, 1);
    assert.equal(db._products.get(productId)?.cycleTimeSeconds, 40);
  });

  it("alteração de cavidades cria log", async () => {
    const { db, productId } = createMockDb();
    const result = await patchComponentPerformanceProduct(
      db as never,
      productId,
      { cavities: 2, responsiblePersonName: "Maria Produção" },
      actor
    );
    assert.equal(result.changed, true);
    assert.equal(result.changeLog.oldCavities, 4);
    assert.equal(result.changeLog.newCavities, 2);
  });

  it("alteração de ciclo e cavidades gera log único", async () => {
    const { db, productId } = createMockDb();
    await patchComponentPerformanceProduct(
      db as never,
      productId,
      {
        cycleTimeSeconds: 38,
        cavities: 3,
        responsiblePersonName: "João da Produção",
      },
      actor
    );
    assert.equal(db._logs.length, 1);
    assert.deepEqual(db._logs[0].changedFieldsJson, ["cycleTimeSeconds", "cavities"]);
  });

  it("sem mudança real não cria log", async () => {
    const { db, productId } = createMockDb();
    const result = await patchComponentPerformanceProduct(
      db as never,
      productId,
      { cycleTimeSeconds: 45, responsiblePersonName: "João da Produção" },
      actor
    );
    assert.equal(result.changed, false);
    assert.equal(db._logs.length, 0);
  });

  it("responsiblePersonName obrigatório", async () => {
    const { db, productId } = createMockDb();
    await assert.rejects(
      () =>
        patchComponentPerformanceProduct(
          db as never,
          productId,
          { cycleTimeSeconds: 40, responsiblePersonName: " " },
          actor
        ),
      ComponentPerformanceValidationError
    );
  });

  it("rejeita valores inválidos de ciclo", async () => {
    const { db, productId } = createMockDb();
    await assert.rejects(
      () =>
        patchComponentPerformanceProduct(
          db as never,
          productId,
          { cycleTimeSeconds: -1, responsiblePersonName: "João" },
          actor
        ),
      (error: unknown) =>
        error instanceof ComponentPerformanceValidationError && error.code === "INVALID_CYCLE"
    );
  });

  it("rejeita item que não é COMPONENT", async () => {
    const { db, productId } = createMockDb({ type: "PRODUCT" });
    await assert.rejects(
      () =>
        patchComponentPerformanceProduct(
          db as never,
          productId,
          { cycleTimeSeconds: 40, responsiblePersonName: "João" },
          actor
        ),
      (error: unknown) =>
        error instanceof ComponentPerformanceValidationError && error.code === "NOT_COMPONENT"
    );
  });

  it("não altera custo publicado congelado", async () => {
    const { db, productId } = createMockDb();
    const beforeCost = db._publishedCosts[0].unitProductionCost;
    await patchComponentPerformanceProduct(
      db as never,
      productId,
      { cycleTimeSeconds: 30, responsiblePersonName: "João da Produção" },
      actor
    );
    assert.equal(db._publishedCosts[0].unitProductionCost, beforeCost);
    assert.equal(db._publishedCosts.length, 1);
  });
});
