import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";
import { normalizeInventoryCountListResponse } from "../components/inventory/inventoryCountPresentation.js";
import {
  parseCreateCountSessionBody,
  parseUpdateCountLineBody,
  validateCountLineUpdate,
} from "../lib/inventory/inventoryCountValidation.js";
import { computeCountDifference, hasCountDivergence } from "../lib/inventory/inventoryCountMath.js";
import {
  approveInventoryCountSession,
  createInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
  startInventoryCountSession,
  updateInventoryCountLine,
} from "../lib/inventory/inventoryCountService.server.js";
import { createInventoryMovement } from "../lib/inventory/inventoryService.server.js";
import { InventoryValidationError } from "../lib/inventory/inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryCountValidation", () => {
  it("1. cria conferência com almoxarifado", () => {
    const input = parseCreateCountSessionBody({
      warehouseId: "00000000-0000-4000-8000-000000000001",
      notes: "Inventário mensal",
    });
    assert.equal(input.warehouseId, "00000000-0000-4000-8000-000000000001");
    assert.equal(input.notes, "Inventário mensal");
  });

  it("4. informa saldo contado >= 0", () => {
    const line = parseUpdateCountLineBody({ countedQuantity: 12, justification: null });
    assert.equal(line.countedQuantity, 12);
    assert.throws(
      () => parseUpdateCountLineBody({ countedQuantity: -1 }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INVALID_COUNTED_QUANTITY"
    );
  });

  it("5. calcula diferença", () => {
    const { differenceQuantity, differencePercent } = computeCountDifference(10, 8);
    assert.equal(differenceQuantity, -2);
    assert.equal(differencePercent, -20);
  });

  it("6. divergência exige justificativa", () => {
    assert.throws(
      () => validateCountLineUpdate(10, { countedQuantity: 8, justification: null }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "JUSTIFICATION_REQUIRED"
    );
    const ok = validateCountLineUpdate(10, {
      countedQuantity: 8,
      justification: "Quebra identificada",
    });
    assert.equal(ok.differenceQuantity, -2);
  });
});

describe("inventoryCountService", () => {
  it("1. cria conferência OPEN", async () => {
    const { prisma, state } = createCountMockPrisma();
    const session = await createInventoryCountSession(
      prisma as never,
      { warehouseId: "wh-1", notes: "Teste" },
      { userId: "user-1" }
    );
    assert.equal(session.status, "OPEN");
    assert.match(session.code, /^CF-/);
    assert.equal(state.sessions.length, 1);
  });

  it("2. lista itens do almoxarifado ao iniciar", async () => {
    const { prisma, state } = createCountMockPrisma({
      balances: [
        balanceRow("item-1", "wh-1", 10),
        balanceRow("item-2", "wh-1", 5),
      ],
      sessions: [openSession("sess-1", "wh-1")],
    });
    await startInventoryCountSession(prisma as never, "sess-1", { userId: "user-1" });
    assert.equal(state.lines.length, 2);
    assert.equal(Number(state.lines[0].systemQuantity), 10);
    assert.equal(state.sessions[0].status, "COUNTING");
  });

  it("3. mostra saldo sistema nas linhas", async () => {
    const { prisma, state } = createCountMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 42)],
      sessions: [openSession("sess-1", "wh-1")],
    });
    await startInventoryCountSession(prisma as never, "sess-1", { userId: "user-1" });
    assert.equal(Number(state.lines[0].systemQuantity), 42);
  });

  it("4-5. atualiza saldo contado e diferença", async () => {
    const { prisma, state } = createCountMockPrisma({
      sessions: countingSession("sess-1", "wh-1"),
      lines: [countLine("line-1", "sess-1", "item-1", "wh-1", 10)],
    });
    await updateInventoryCountLine(
      prisma as never,
      "sess-1",
      "line-1",
      { countedQuantity: 12, justification: "Sobra física" },
      { userId: "user-1" }
    );
    assert.equal(Number(state.lines[0].countedQuantity), 12);
    assert.equal(Number(state.lines[0].differenceQuantity), 2);
  });

  it("7. finaliza conferência com divergência → WAITING_APPROVAL", async () => {
    const { prisma, state } = createCountMockPrisma({
      sessions: countingSession("sess-1", "wh-1"),
      lines: [
        {
          ...countLine("line-1", "sess-1", "item-1", "wh-1", 10),
          countedQuantity: new Prisma.Decimal(8),
          differenceQuantity: new Prisma.Decimal(-2),
          differencePercent: new Prisma.Decimal(-20),
          justification: "Perda",
        },
      ],
    });
    await finalizeInventoryCountSession(prisma as never, "sess-1", { userId: "user-1" });
    assert.equal(state.sessions[0].status, "WAITING_APPROVAL");
  });

  it("8. aprova conferência com permissão", async () => {
    const { prisma, state } = createCountMockPrisma({
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "WAITING_APPROVAL" }],
    });
    await approveInventoryCountSession(prisma as never, "sess-1", {
      userId: "mgr-1",
      permissions: ["inventory.count.manage"],
    });
    assert.equal(state.sessions[0].status, "APPROVED");
    assert.equal(state.sessions[0].approvedByUserId, "mgr-1");
  });

  it("8b. aprovação sem permissão falha", async () => {
    const { prisma } = createCountMockPrisma({
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "WAITING_APPROVAL" }],
    });
    await assert.rejects(
      () =>
        approveInventoryCountSession(prisma as never, "sess-1", {
          userId: "user-1",
          permissions: ["inventory.view"],
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "NOT_AUTHORIZED"
    );
  });

  it("9. gera ajuste positivo", async () => {
    const { prisma, state } = createCountMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "APPROVED", code: "CF-TEST" }],
      lines: [
        {
          ...countLine("line-1", "sess-1", "item-1", "wh-1", 10),
          countedQuantity: new Prisma.Decimal(13),
          differenceQuantity: new Prisma.Decimal(3),
          justification: "Sobra",
        },
      ],
    });
    const result = await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(result.movementsCreated, 1);
    assert.equal(state.movements[0].movementType, "POSITIVE_ADJUSTMENT");
    assert.equal(Number(state.movements[0].quantity), 3);
    assert.equal(state.sessions[0].status, "ADJUSTED");
  });

  it("10. gera ajuste negativo", async () => {
    const { prisma, state } = createCountMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 10)],
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "APPROVED" }],
      lines: [
        {
          ...countLine("line-1", "sess-1", "item-1", "wh-1", 10),
          countedQuantity: new Prisma.Decimal(7),
          differenceQuantity: new Prisma.Decimal(-3),
          justification: "Falta",
        },
      ],
    });
    await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(state.movements[0].movementType, "NEGATIVE_ADJUSTMENT");
    assert.equal(Number(state.movements[0].quantity), 3);
  });

  it("11. ajuste gera InventoryMovement com origem COUNT_SESSION", async () => {
    const { prisma, state } = createCountMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 5)],
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "APPROVED" }],
      lines: [
        {
          ...countLine("line-1", "sess-1", "item-1", "wh-1", 5),
          countedQuantity: new Prisma.Decimal(6),
          differenceQuantity: new Prisma.Decimal(1),
          justification: "Ajuste",
        },
      ],
    });
    await generateInventoryCountAdjustments(prisma as never, "sess-1", {
      userId: "user-1",
      permissions: ["inventory.manage"],
    });
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].originType, "COUNT_SESSION");
    assert.equal(state.movements[0].originId, "line-1");
    assert.equal(state.lines[0].generatedMovementId, state.movements[0].id);
  });

  it("12. não gera ajuste duplicado", async () => {
    const { prisma } = createCountMockPrisma({
      balances: [balanceRow("item-1", "wh-1", 5)],
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "ADJUSTED" }],
      lines: [
        {
          ...countLine("line-1", "sess-1", "item-1", "wh-1", 5),
          countedQuantity: new Prisma.Decimal(6),
          differenceQuantity: new Prisma.Decimal(1),
          generatedMovementId: "mov-existing",
        },
      ],
    });
    await assert.rejects(
      () => generateInventoryCountAdjustments(prisma as never, "sess-1", { userId: "user-1" }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "ALREADY_ADJUSTED"
    );
  });

  it("13. conferência ajustada não permite editar linha", async () => {
    const { prisma } = createCountMockPrisma({
      sessions: [{ ...countingSession("sess-1", "wh-1")[0], status: "ADJUSTED" }],
      lines: [countLine("line-1", "sess-1", "item-1", "wh-1", 10)],
    });
    await assert.rejects(
      () =>
        updateInventoryCountLine(
          prisma as never,
          "sess-1",
          "line-1",
          { countedQuantity: 5 },
          { userId: "user-1" }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "SESSION_LOCKED"
    );
  });

  it("14. serviço não altera saldo diretamente (somente via movimento)", () => {
    const src = read("src/lib/inventory/inventoryCountService.server.ts");
    assert.doesNotMatch(src, /inventoryBalance\.update/);
    assert.doesNotMatch(src, /inventoryBalance\.upsert/);
    assert.match(src, /createInventoryMovement/);
  });

  it("15. build não reintroduz Prisma no frontend", () => {
    for (const file of [
      "src/components/inventory/InventoryCountsTab.tsx",
      "src/components/inventory/InventoryCountDetailSheet.tsx",
      "src/components/inventory/inventoryCountPresentation.ts",
      "src/components/inventory/inventoryCountLabels.ts",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /PrismaClient/);
    }
  });
});

describe("inventoryCounts — rotas e navegação", () => {
  it("rotas count-sessions registradas", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /\/api\/inventory\/count-sessions/);
    assert.match(routes, /generate-adjustments/);
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.inventoryCounts/);
    assert.doesNotMatch(routes, /inventoryBalance\.update/);
  });

  it("App.tsx rota /inventory/counts", () => {
    assert.match(read("src/App.tsx"), /inventory\/counts/);
    assert.equal(resolveInventoryTabFromPath("/inventory/counts"), "counts");
  });

  it("InventoryModule renderiza aba counts", () => {
    const mod = read("src/components/InventoryModule.tsx");
    const app = read("src/App.tsx");
    assert.match(mod, /InventoryCountsTab/);
    assert.match(app, /inventory\/counts/);
    assert.match(app, /initialTab="counts"/);
  });

  it("normalizeInventoryCountListResponse", () => {
    const data = normalizeInventoryCountListResponse({
      rows: [
        {
          id: "s1",
          code: "CF-001",
          warehouseId: "w1",
          status: "OPEN",
          divergenceCount: 2,
          impactedQuantity: 5,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].divergenceCount, 2);
    assert.equal(data.rows[0].impactedQuantity, 5);
  });
});

describe("inventoryCountMath", () => {
  it("hasCountDivergence", () => {
    assert.equal(hasCountDivergence(0), false);
    assert.equal(hasCountDivergence(0.0001), true);
  });
});

type MockBalance = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  balanceKey: string;
  physicalQuantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  blockedQuantity: Prisma.Decimal;
  quarantineQuantity: Prisma.Decimal;
  availableQuantity: Prisma.Decimal;
  item: { status: string };
};

type MockSession = {
  id: string;
  code: string;
  warehouseId: string;
  status: string;
  responsibleUserId?: string | null;
  approvedByUserId?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  approvedAt?: Date | null;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

type MockLine = {
  id: string;
  sessionId: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  systemQuantity: Prisma.Decimal;
  countedQuantity?: Prisma.Decimal | null;
  differenceQuantity?: Prisma.Decimal | null;
  differencePercent?: Prisma.Decimal | null;
  justification?: string | null;
  generatedMovementId?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
};

function balanceRow(itemId: string, warehouseId: string, qty: number): MockBalance {
  return {
    id: `bal-${itemId}`,
    itemId,
    warehouseId,
    locationId: null,
    balanceKey: warehouseId,
    physicalQuantity: new Prisma.Decimal(qty),
    reservedQuantity: new Prisma.Decimal(0),
    blockedQuantity: new Prisma.Decimal(0),
    quarantineQuantity: new Prisma.Decimal(0),
    availableQuantity: new Prisma.Decimal(qty),
    item: { status: "ACTIVE" },
  };
}

function openSession(id: string, warehouseId: string): MockSession {
  return {
    id,
    code: "CF-OPEN",
    warehouseId,
    status: "OPEN",
    responsibleUserId: "user-1",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function countingSession(id: string, warehouseId: string): MockSession[] {
  return [
    {
      id,
      code: "CF-COUNT",
      warehouseId,
      status: "COUNTING",
      responsibleUserId: "user-1",
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];
}

function countLine(
  id: string,
  sessionId: string,
  itemId: string,
  warehouseId: string,
  systemQty: number
): MockLine {
  return {
    id,
    sessionId,
    itemId,
    warehouseId,
    locationId: null,
    systemQuantity: new Prisma.Decimal(systemQty),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createCountMockPrisma(options?: {
  balances?: MockBalance[];
  sessions?: MockSession[];
  lines?: MockLine[];
}) {
  const state = {
    balances: [...(options?.balances ?? [])],
    sessions: [...(options?.sessions ?? [])] as MockSession[],
    lines: [...(options?.lines ?? [])] as MockLine[],
    movements: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
  };

  const item = {
    id: "item-1",
    status: "ACTIVE" as const,
    itemType: "RAW_MATERIAL" as const,
    unit: "UN",
  };

  const warehouse = (id: string) => ({
    id,
    status: "ACTIVE" as const,
    allowsMovements: true,
  });

  const movementTx = {
    inventoryItem: { findUnique: async ({ where }: { where: { id: string } }) => ({ ...item, id: where.id }) },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) => warehouse(where.id),
    },
    inventoryBalance: {
      findUnique: async ({
        where,
      }: {
        where: { itemId_balanceKey: { itemId: string; balanceKey: string } };
      }) =>
        state.balances.find(
          (b) =>
            b.itemId === where.itemId_balanceKey.itemId &&
            b.balanceKey === where.itemId_balanceKey.balanceKey
        ) ?? null,
      findMany: async ({ where }: { where: { warehouseId?: string } }) =>
        state.balances.filter((b) => !where.warehouseId || b.warehouseId === where.warehouseId),
      create: async ({ data }: { data: MockBalance }) => {
        const row = { ...data, id: data.id ?? `bal-${state.balances.length + 1}` };
        state.balances.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<MockBalance> }) => {
        const idx = state.balances.findIndex((b) => b.id === where.id);
        state.balances[idx] = { ...state.balances[idx], ...data };
        return state.balances[idx];
      },
    },
    inventoryMovement: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryReservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "res-1", ...data }),
      findUnique: async () => null,
      update: async () => ({}),
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
    inventoryCountSession: {
      count: async ({ where }: { where: { code?: { startsWith: string } } }) => {
        const prefix = where.code?.startsWith;
        if (!prefix) return state.sessions.length;
        return state.sessions.filter((s) => s.code.startsWith(prefix)).length;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.sessions.find((s) => s.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `sess-${state.sessions.length + 1}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.sessions.push(row as MockSession);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.sessions.findIndex((s) => s.id === where.id);
        state.sessions[idx] = { ...state.sessions[idx], ...data } as MockSession;
        return state.sessions[idx];
      },
    },
    inventoryCountLine: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `line-${state.lines.length + 1}`, ...data };
        state.lines.push(row as MockLine);
        return row;
      },
      findFirst: async ({ where }: { where: { id: string; sessionId: string } }) =>
        state.lines.find((l) => l.id === where.id && l.sessionId === where.sessionId) ?? null,
      findMany: async ({
        where,
        include,
      }: {
        where: { sessionId: string };
        include?: { item?: { select: { unit: boolean } } };
      }) =>
        state.lines
          .filter((l) => l.sessionId === where.sessionId)
          .map((l) => ({
            ...l,
            ...(include?.item
              ? { item: { unit: "UN" } }
              : {}),
          })),
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.lines.findIndex((l) => l.id === where.id);
        state.lines[idx] = { ...state.lines[idx], ...data } as MockLine;
        return state.lines[idx];
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof movementTx) => Promise<unknown>) => fn(movementTx),
    inventoryAuditLog: movementTx.inventoryAuditLog,
    inventoryCountSession: movementTx.inventoryCountSession,
    inventoryCountLine: movementTx.inventoryCountLine,
    inventoryBalance: movementTx.inventoryBalance,
    inventoryItem: movementTx.inventoryItem,
    inventoryWarehouse: movementTx.inventoryWarehouse,
    inventoryMovement: movementTx.inventoryMovement,
    inventoryReservation: movementTx.inventoryReservation,
  };

  // Wire createInventoryMovement for generate adjustments
  void createInventoryMovement;

  return { prisma, state, tx: movementTx };
}
