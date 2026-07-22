import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { applyMovementToBalance, resolveMovementImpact } from "./inventoryBalanceMath.js";
import { emptyInventoryBalance, InventoryValidationError, snapshotFromBalance } from "./inventoryTypes.js";
import { validateMovementRequest } from "./inventoryMovementRules.js";
import {
  INVENTORY_OVER_RESERVATION_POLICY,
  resolveAllowOverReservation,
} from "./inventoryReservationPolicy.js";
import {
  cancelInventoryReservation,
  createInventoryMovement,
  releaseInventoryBlock,
  reverseInventoryMovement,
  transferBetweenPhysicalAndQuarantine,
} from "./inventoryService.server.js";

const RESERVE_CTX = {
  userId: "user-1",
  permissions: ["inventory.reservations.manage", "inventory.block.manage", "inventory.transfer.create"] as const,
};
const OVERRIDE_CTX = {
  userId: "user-1",
  permissions: [
    "inventory.reservations.manage",
    "inventory.block.manage",
    "inventory.movements.override",
  ] as const,
};

describe("inventory reservations/blocks/quarantine (OP-11)", () => {
  it("1. reserva reduz disponível, não físico", () => {
    const base = snapshotFromBalance({ physicalQuantity: 50 });
    const next = applyMovementToBalance(base, "RESERVE", 12);
    assert.equal(next.physicalQuantity, 50);
    assert.equal(next.reservedQuantity, 12);
    assert.equal(next.availableQuantity, 38);
  });

  it("2. bloqueio reduz disponível, não físico", () => {
    const base = snapshotFromBalance({ physicalQuantity: 40 });
    const next = applyMovementToBalance(base, "BLOCK", 7);
    assert.equal(next.physicalQuantity, 40);
    assert.equal(next.blockedQuantity, 7);
    assert.equal(next.availableQuantity, 33);
  });

  it("3. quarentena in/out no bucket (não altera físico)", () => {
    assert.equal(resolveMovementImpact("QUARANTINE_IN", 5).quarantineDelta, 5);
    assert.equal(resolveMovementImpact("QUARANTINE_IN", 5).physicalDelta, 0);
    const afterIn = applyMovementToBalance(snapshotFromBalance({ physicalQuantity: 20 }), "QUARANTINE_IN", 5);
    assert.equal(afterIn.quarantineQuantity, 5);
    assert.equal(afterIn.availableQuantity, 15);
    const afterOut = applyMovementToBalance(afterIn, "QUARANTINE_OUT", 5);
    assert.equal(afterOut.quarantineQuantity, 0);
    assert.equal(afterOut.availableQuantity, 20);
  });

  it("4. reserva não excede disponível sem política explícita", () => {
    const base = snapshotFromBalance({ physicalQuantity: 10, reservedQuantity: 8 });
    assert.throws(
      () =>
        validateMovementRequest(base, {
          movementType: "RESERVE",
          quantity: 5,
          reason: "excesso",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INSUFFICIENT_AVAILABLE"
    );
    const ok = validateMovementRequest(
      base,
      { movementType: "RESERVE", quantity: 5, reason: "override" },
      { allowNegativeAvailable: true }
    );
    assert.equal(ok.availableQuantity, -3);
    assert.equal(INVENTORY_OVER_RESERVATION_POLICY.defaultAllowOverReservation, false);
    assert.equal(INVENTORY_OVER_RESERVATION_POLICY.integrationsAutoReserveFromSalesOrder, false);
    assert.equal(
      resolveAllowOverReservation({
        allowOverReservation: true,
        permissions: ["inventory.movements.override"],
      }),
      true
    );
  });

  it("5. bloqueio exige motivo", () => {
    assert.throws(
      () =>
        validateMovementRequest(emptyInventoryBalance(), {
          movementType: "BLOCK",
          quantity: 1,
          reason: "",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "REASON_REQUIRED"
    );
  });

  it("6. cria reserva com origem/tipo/responsável e cancela preservando histórico", async () => {
    const { prisma, state } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(30),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(30),
        },
      ],
    });

    const created = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "RESERVE",
        quantity: 10,
        unit: "UN",
        reason: "Reserva qualidade",
        reservationType: "QUALITY",
        originType: "OTHER",
        originId: "origin-qa-1",
        responsibleUserId: "resp-1",
        expiresAt: new Date("2026-12-31"),
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );

    assert.ok(created.reservationId);
    assert.equal(state.reservations[0].reservationType, "QUALITY");
    assert.equal(state.reservations[0].responsibleUserId, "resp-1");
    assert.equal(state.reservations[0].originId, "origin-qa-1");
    assert.equal(state.reservations[0].status, "ACTIVE");
    assert.equal(Number(state.balances[0].physicalQuantity), 30);
    assert.equal(Number(state.balances[0].reservedQuantity), 10);

    await cancelInventoryReservation(
      prisma as never,
      created.reservationId!,
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] },
      "Cancelamento auditável"
    );

    assert.equal(state.reservations[0].status, "CANCELED");
    assert.ok(state.reservations[0].canceledAt);
    assert.equal(state.movements.some((m) => m.movementType === "CANCEL_RESERVATION"), true);
    assert.equal(Number(state.balances[0].reservedQuantity), 0);
  });

  it("7. cria InventoryBlock e libera sem apagar histórico", async () => {
    const { prisma, state } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(20),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(20),
        },
      ],
    });

    const blocked = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "BLOCK",
        quantity: 4,
        unit: "UN",
        reason: "Amostra qualidade",
        blockReasonType: "QUALITY",
        responsibleUserId: "resp-2",
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );

    assert.ok(blocked.blockId);
    assert.equal(state.blocks[0].status, "ACTIVE");
    assert.equal(state.blocks[0].reasonType, "QUALITY");
    assert.equal(Number(state.balances[0].blockedQuantity), 4);
    assert.equal(Number(state.balances[0].physicalQuantity), 20);

    await releaseInventoryBlock(
      prisma as never,
      blocked.blockId!,
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] },
      "Liberado após inspeção"
    );

    assert.equal(state.blocks[0].status, "RELEASED");
    assert.ok(state.blocks[0].releasedAt);
    assert.equal(state.blocks.length, 1);
    assert.equal(Number(state.balances[0].blockedQuantity), 0);
  });

  it("8. concorrência: segunda reserva acima do disponível falha", async () => {
    const { prisma } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(10),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(10),
        },
      ],
    });

    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "RESERVE",
        quantity: 8,
        unit: "UN",
        reason: "primeira",
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );

    await assert.rejects(
      () =>
        createInventoryMovement(
          prisma as never,
          {
            itemId: "item-1",
            sourceWarehouseId: "wh-1",
            movementType: "RESERVE",
            quantity: 5,
            unit: "UN",
            reason: "segunda",
          },
          { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INSUFFICIENT_AVAILABLE"
    );

    // Com política explícita + override, permite.
    const over = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "RESERVE",
        quantity: 5,
        unit: "UN",
        reason: "overbook",
      },
      {
        userId: OVERRIDE_CTX.userId,
        permissions: [...OVERRIDE_CTX.permissions],
        allowOverReservation: true,
      }
    );
    assert.equal(over.balance?.availableQuantity, -3);
  });

  it("9. estorno de BLOCK reverte saldo bloqueado", async () => {
    const { prisma, state } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(15),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(15),
        },
      ],
    });

    const blocked = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "BLOCK",
        quantity: 3,
        unit: "UN",
        reason: "bloqueio",
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );

    await reverseInventoryMovement(
      prisma as never,
      blocked.movement.id,
      {
        userId: RESERVE_CTX.userId,
        permissions: [...RESERVE_CTX.permissions, "inventory.movements.create"],
      },
      "estorno bloqueio"
    );

    assert.equal(Number(state.balances[0].blockedQuantity), 0);
    assert.equal(state.movements.some((m) => m.movementType === "REVERSAL"), true);
  });

  it("10. transferência físico↔quarentena exige local QUARANTINE", async () => {
    const { prisma } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: "loc-phys",
          balanceKey: "wh-1:loc-phys",
          physicalQuantity: new Prisma.Decimal(12),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(12),
        },
      ],
      locations: [
        { id: "loc-phys", locationType: "PHYSICAL", warehouseId: "wh-1", status: "ACTIVE" },
        { id: "loc-q", locationType: "QUARANTINE", warehouseId: "wh-1", status: "ACTIVE" },
      ],
    });

    await assert.rejects(
      () =>
        transferBetweenPhysicalAndQuarantine(
          prisma as never,
          {
            itemId: "item-1",
            quantity: 2,
            reason: "sem tipo",
            sourceWarehouseId: "wh-1",
            sourceLocationId: "loc-phys",
            destinationWarehouseId: "wh-1",
            destinationLocationId: "loc-phys",
            toQuarantine: true,
          },
          { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
        ),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "QUARANTINE_LOCATION_REQUIRED"
    );

    const ok = await transferBetweenPhysicalAndQuarantine(
      prisma as never,
      {
        itemId: "item-1",
        quantity: 2,
        reason: "enviar a quarentena",
        sourceWarehouseId: "wh-1",
        sourceLocationId: "loc-phys",
        destinationWarehouseId: "wh-1",
        destinationLocationId: "loc-q",
        toQuarantine: true,
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );
    assert.equal(ok.movement.movementType, "TRANSFER");
    assert.match(String(ok.movement.notes ?? ""), /PHYSICAL→QUARANTINE/);
  });

  it("11. rotas e política sem integração OP/PV automática", () => {
    const routes = readFileSync(join(process.cwd(), "src/lib/inventoryRoutes.ts"), "utf8");
    assert.match(routes, /\/api\/inventory\/blocks/);
    assert.match(routes, /releaseInventoryBlock/);
    assert.match(routes, /quarantine\/transfer/);
    assert.match(routes, /GET \/api\/inventory\/reservations/);
    const policy = readFileSync(
      join(process.cwd(), "src/lib/inventory/inventoryReservationPolicy.ts"),
      "utf8"
    );
    assert.match(policy, /integrationsAutoReserveFromSalesOrder: false/);
    assert.match(policy, /integrationsAutoReserveFromProductionOrder: false/);
  });
});

function createMockPrisma(options?: {
  balances?: Array<Record<string, unknown>>;
  locations?: Array<Record<string, unknown>>;
}) {
  const state = {
    balances: [...(options?.balances ?? [])] as Array<Record<string, unknown>>,
    movements: [] as Array<Record<string, unknown>>,
    reservations: [] as Array<Record<string, unknown>>,
    blocks: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    locations: [...(options?.locations ?? [])] as Array<Record<string, unknown>>,
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
    $queryRaw: async () => [{ "?column?": 1 }],
    inventoryItem: { findUnique: async () => item },
    inventoryWarehouse: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === warehouse.id ? warehouse : warehouse,
    },
    inventoryLocation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.locations.find((l) => l.id === where.id) ?? null,
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
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.movements.find((m) => {
          if (where.idempotencyKey && m.idempotencyKey === where.idempotencyKey) return true;
          if (where.originId && m.originId === where.originId) return true;
          if (where.reversedMovementId && m.reversedMovementId === where.reversedMovementId) {
            return true;
          }
          return false;
        }) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.movements.find((m) => m.id === where.id) ?? null,
      findMany: async () => [...state.movements],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${state.movements.length + 1}`, createdAt: new Date(), ...data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryBlock: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `blk-${state.blocks.length + 1}`, ...data };
        state.blocks.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.blocks.find((b) => b.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.blocks.findIndex((b) => b.id === where.id);
        state.blocks[idx] = { ...state.blocks[idx], ...data };
        return state.blocks[idx];
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const row = state.blocks.find(
          (b) => b.id === where.id && (!where.status || b.status === where.status)
        );
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    inventoryReservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `res-${state.reservations.length + 1}`, ...data };
        state.reservations.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.reservations.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.reservations.findIndex((r) => r.id === where.id);
        state.reservations[idx] = { ...state.reservations[idx], ...data };
        return state.reservations[idx];
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        const row = state.reservations.find(
          (r) => r.id === where.id && (!where.status || r.status === where.status)
        );
        if (row) Object.assign(row, data);
        return { count: row ? 1 : 0 };
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  const prisma = {
    $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
    inventoryItem: tx.inventoryItem,
    inventoryMovement: tx.inventoryMovement,
    inventoryLocation: tx.inventoryLocation,
    inventoryAuditLog: tx.inventoryAuditLog,
  };

  return { prisma, state, tx };
}
