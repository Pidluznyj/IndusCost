import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  assertInitialBalanceScopeEligible,
  buildBalancesReportCsv,
  buildInitialBalanceIdempotencyKey,
  buildInitialBalanceOriginId,
  buildInitialBalanceReportCsv,
  validateInitialBalancePayload,
} from "./inventoryInitialBalance.js";
import { applyMovementToBalance, resolveMovementImpact } from "./inventoryBalanceMath.js";
import { projectBalancesFromLedger, assertMaterializedMatchesLedger } from "./inventoryLedgerProjection.js";
import { emptyInventoryBalance, InventoryValidationError } from "./inventoryTypes.js";
import {
  createInitialInventoryBalance,
  createInventoryMovement,
  reverseInventoryMovement,
} from "./inventoryService.server.js";
import { orderBalanceLockTargets } from "./inventoryLedgerConcurrency.js";

const ADJUST_CTX = {
  userId: "user-1",
  permissions: ["inventory.adjustment.create", "inventory.movements.create"] as const,
};

describe("inventoryInitialBalance (OP-10)", () => {
  it("1. fórmulas: INITIAL_BALANCE aumenta físico e disponível", () => {
    const impact = resolveMovementImpact("INITIAL_BALANCE", 15);
    assert.equal(impact.physicalDelta, 15);
    const next = applyMovementToBalance(emptyInventoryBalance(), "INITIAL_BALANCE", 15);
    assert.equal(next.physicalQuantity, 15);
    assert.equal(next.availableQuantity, 15);
    assert.equal(next.reservedQuantity, 0);
    assert.equal(next.blockedQuantity, 0);
  });

  it("2. projeção ledger reconstrói saldos (físico/reservado/bloqueado/disponível)", () => {
    const projected = projectBalancesFromLedger([
      {
        id: "m1",
        movementType: "INITIAL_BALANCE",
        quantity: 100,
        warehouseId: "wh-1",
        locationId: null,
        unit: "UN",
        movementDate: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "m2",
        movementType: "RESERVE",
        quantity: 20,
        warehouseId: "wh-1",
        locationId: null,
        unit: "UN",
        movementDate: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "m3",
        movementType: "BLOCK",
        quantity: 10,
        warehouseId: "wh-1",
        locationId: null,
        unit: "UN",
        movementDate: "2026-01-03T00:00:00.000Z",
      },
    ]);
    const bal = projected.get("wh-1")!;
    assert.equal(bal.physicalQuantity, 100);
    assert.equal(bal.reservedQuantity, 20);
    assert.equal(bal.blockedQuantity, 10);
    assert.equal(bal.availableQuantity, 70);
    assertMaterializedMatchesLedger(bal, bal);
  });

  it("3. payload exige item, almoxarifado, qty, data, responsável e justificativa", () => {
    assert.throws(
      () =>
        validateInitialBalancePayload({
          itemId: "",
          warehouseId: "wh-1",
          locationId: null,
          quantity: 1,
          countDate: new Date(),
          responsibleUserId: "u1",
          justification: "abertura",
          evidenceRef: null,
          documentNumber: null,
          notes: null,
          unitCost: null,
        }),
      InventoryValidationError
    );

    const ok = validateInitialBalancePayload({
      itemId: "item-1",
      warehouseId: "wh-1",
      locationId: null,
      quantity: 12,
      countDate: new Date("2026-07-01"),
      responsibleUserId: "u1",
      justification: "Contagem de implantação inicial",
      evidenceRef: "DOC-1",
      documentNumber: null,
      notes: null,
      unitCost: null,
    });
    assert.equal(ok.quantity, 12);
    assert.equal(buildInitialBalanceOriginId("item-1", "wh-1"), "initial:item-1:wh-1");
    assert.equal(
      buildInitialBalanceIdempotencyKey("item-1", "wh-1", "loc-1"),
      "initial:item-1:wh-1:loc-1"
    );
  });

  it("4. impede duplicidade e escopo com saldo físico", () => {
    assert.throws(
      () => assertInitialBalanceScopeEligible({ physicalQuantity: 0, hasActiveInitialBalance: true }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INITIAL_BALANCE_DUPLICATE"
    );
    assert.throws(
      () => assertInitialBalanceScopeEligible({ physicalQuantity: 5, hasActiveInitialBalance: false }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "INITIAL_BALANCE_SCOPE_NOT_EMPTY"
    );
  });

  it("5. createInitialInventoryBalance grava ledger e saldo (mock)", async () => {
    const { prisma, state } = createMockPrisma();
    const result = await createInitialInventoryBalance(
      prisma as never,
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 40,
        countDate: new Date("2026-07-01"),
        responsibleUserId: "user-1",
        justification: "Implantação do estoque inicial",
        evidenceRef: "EV-01",
        documentNumber: null,
        notes: null,
        unitCost: null,
      },
      { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions] }
    );

    assert.equal(result.movement.movementType, "INITIAL_BALANCE");
    assert.equal(result.balance?.physicalQuantity, 40);
    assert.equal(result.balance?.availableQuantity, 40);
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].evidenceRef, "EV-01");
    assert.equal(Number(state.balances[0].physicalQuantity), 40);
  });

  it("6. idempotência / concorrência: segunda implantação mesma chave não duplica qty", async () => {
    const { prisma, state } = createMockPrisma();
    const payload = {
      itemId: "item-1",
      warehouseId: "wh-1",
      locationId: null,
      quantity: 25,
      countDate: new Date("2026-07-01"),
      responsibleUserId: "user-1",
      justification: "Implantação concorrente",
      evidenceRef: null,
      documentNumber: null,
      notes: null,
      unitCost: null,
    };
    const a = await createInitialInventoryBalance(prisma as never, payload, {
      userId: ADJUST_CTX.userId,
      permissions: [...ADJUST_CTX.permissions],
    });
    const b = await createInitialInventoryBalance(prisma as never, payload, {
      userId: ADJUST_CTX.userId,
      permissions: [...ADJUST_CTX.permissions],
    });
    assert.equal(a.idempotent, undefined);
    assert.equal(b.idempotent, true);
    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.balances[0].physicalQuantity), 25);
  });

  it("7. após INITIAL ativo, nova chave diferente falha por escopo não vazio", async () => {
    const { prisma } = createMockPrisma();
    await createInitialInventoryBalance(
      prisma as never,
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 10,
        countDate: new Date(),
        responsibleUserId: "user-1",
        justification: "Primeira implantação",
        evidenceRef: null,
        documentNumber: "X",
        notes: null,
        unitCost: null,
      },
      { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions] }
    );

    await assert.rejects(
      () =>
        createInventoryMovement(
          prisma as never,
          {
            itemId: "item-1",
            destinationWarehouseId: "wh-1",
            movementType: "INITIAL_BALANCE",
            quantity: 5,
            unit: "UN",
            reason: "Tentativa indevida",
            responsibleUserId: "user-1",
            movementDate: new Date(),
            idempotencyKey: "other-key",
            originType: "OTHER",
            originId: "other-origin",
          },
          { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions] }
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        (e.code === "INITIAL_BALANCE_DUPLICATE" || e.code === "INITIAL_BALANCE_SCOPE_NOT_EMPTY")
    );
  });

  it("8. estorno libera reimplantação", async () => {
    const { prisma, state } = createMockPrisma();
    const first = await createInitialInventoryBalance(
      prisma as never,
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 8,
        countDate: new Date(),
        responsibleUserId: "user-1",
        justification: "Abertura",
        evidenceRef: null,
        documentNumber: null,
        notes: null,
        unitCost: null,
      },
      { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions] }
    );

    await reverseInventoryMovement(
      prisma as never,
      first.movement.id,
      { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions, "inventory.movements.create"] },
      "Corrigir contagem"
    );
    assert.equal(Number(state.balances[0].physicalQuantity), 0);

    const second = await createInitialInventoryBalance(
      prisma as never,
      {
        itemId: "item-1",
        warehouseId: "wh-1",
        locationId: null,
        quantity: 9,
        countDate: new Date(),
        responsibleUserId: "user-1",
        justification: "Reimplantação após estorno",
        evidenceRef: null,
        documentNumber: null,
        notes: null,
        unitCost: null,
      },
      { userId: ADJUST_CTX.userId, permissions: [...ADJUST_CTX.permissions] }
    );
    assert.equal(second.balance?.physicalQuantity, 9);
  });

  it("9. relatório CSV e locks estáveis", () => {
    const csv = buildInitialBalanceReportCsv([
      {
        movementId: "m1",
        movementDate: "2026-07-01",
        itemCode: "SKU",
        itemDescription: "Item",
        warehouseCode: "WH",
        warehouseName: "Almox",
        locationCode: null,
        quantity: 1,
        unit: "UN",
        responsibleUserId: "u1",
        reason: "ok",
        evidenceRef: null,
        documentNumber: null,
      },
    ]);
    assert.match(csv, /movementId/);
    assert.match(csv, /SKU/);
    const balCsv = buildBalancesReportCsv([
      {
        itemCode: "SKU",
        itemDescription: "Item",
        warehouseCode: "WH",
        warehouseName: "Almox",
        locationCode: null,
        physicalQuantity: 10,
        reservedQuantity: 1,
        blockedQuantity: 2,
        quarantineQuantity: 0,
        availableQuantity: 7,
        unit: "UN",
      },
    ]);
    assert.match(balCsv, /availableQuantity/);
    const ordered = orderBalanceLockTargets([
      { itemId: "b", warehouseId: "w2", locationId: null },
      { itemId: "a", warehouseId: "w1", locationId: null },
    ]);
    assert.equal(ordered[0]?.itemId, "a");
  });

  it("10. rotas e UI não permitem PATCH de saldo", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/inventoryRoutes.ts"), "utf8");
    assert.match(routes, /initial-balances/);
    assert.match(routes, /balances\/rebuild/);
    assert.match(routes, /balances\/export/);
    assert.doesNotMatch(routes, /app\.(put|patch)\("\/api\/inventory\/balances/);
    assert.match(routes, /createInitialInventoryBalance/);
  });
});

function createMockPrisma(options?: {
  balances?: Array<Record<string, unknown>>;
}) {
  const state = {
    balances: [...(options?.balances ?? [])] as Array<Record<string, unknown>>,
    movements: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    reservations: [] as Array<Record<string, unknown>>,
  };

  const item = {
    id: "item-1",
    status: "ACTIVE" as const,
    itemType: "RAW_MATERIAL" as const,
    unit: "UN",
    controlsStock: true,
    controlsLocation: false,
    allowsReservation: true,
    allowsBlock: true,
    materialId: null as string | null,
    materialCodeSnapshot: null as string | null,
    materialDescriptionSnapshot: null as string | null,
    lastKnownCost: null as unknown,
    averageCost: null as unknown,
  };
  const warehouse = { id: "wh-1", status: "ACTIVE" as const, allowsMovements: true };

  const tx = {
    inventoryItem: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === item.id ? { ...item } : null,
    },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === warehouse.id ? warehouse : null,
    },
    inventoryBalance: {
      findUnique: async ({
        where,
      }: {
        where: { id?: string; itemId_balanceKey?: { itemId: string; balanceKey: string } };
      }) => {
        if (where.id) return state.balances.find((b) => b.id === where.id) ?? null;
        if (where.itemId_balanceKey) {
          return (
            state.balances.find(
              (b) =>
                b.itemId === where.itemId_balanceKey!.itemId &&
                b.balanceKey === where.itemId_balanceKey!.balanceKey
            ) ?? null
          );
        }
        return null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `bal-${state.balances.length + 1}`, ...data };
        state.balances.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.balances.findIndex((b) => b.id === where.id);
        state.balances[idx] = { ...state.balances[idx], ...data };
        return state.balances[idx];
      },
    },
    inventoryMovement: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.movements.find((m) => {
            if (where.idempotencyKey && m.idempotencyKey === where.idempotencyKey) return true;
            if (where.originId && m.originId === where.originId) return true;
            if (where.reversedMovementId && m.reversedMovementId === where.reversedMovementId) {
              return true;
            }
            if (where.movementType === "INITIAL_BALANCE" && m.movementType === "INITIAL_BALANCE") {
              if (where.itemId && m.itemId !== where.itemId) return false;
              if (
                where.destinationWarehouseId &&
                m.destinationWarehouseId !== where.destinationWarehouseId
              ) {
                return false;
              }
              return true;
            }
            if (where.id && m.id === where.id) return true;
            return false;
          }) ?? null
        );
      },
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => {
        if (!where) return [...state.movements];
        return state.movements.filter((m) => {
          if (where.itemId && m.itemId !== where.itemId) return false;
          if (where.movementType && m.movementType !== where.movementType) return false;
          if (
            where.destinationWarehouseId &&
            m.destinationWarehouseId !== where.destinationWarehouseId
          ) {
            return false;
          }
          if ("destinationLocationId" in where) {
            const expected = where.destinationLocationId;
            if ((m.destinationLocationId ?? null) !== (expected ?? null)) return false;
          }
          if (where.reversedMovementId && m.reversedMovementId !== where.reversedMovementId) {
            return false;
          }
          return true;
        });
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.movements.find((m) => m.id === where.id) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${state.movements.length + 1}`, createdAt: new Date(), ...data };
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
  };

  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    inventoryItem: tx.inventoryItem,
    inventoryMovement: tx.inventoryMovement,
    inventoryAuditLog: tx.inventoryAuditLog,
  };

  return { prisma, state, tx };
}
