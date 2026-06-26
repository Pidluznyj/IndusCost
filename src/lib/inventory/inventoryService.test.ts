import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { InventoryValidationError } from "./inventoryTypes.js";
import { createInventoryMovement, cancelInventoryReservation } from "./inventoryService.server.js";
import { mapBalanceRowToSnapshot } from "./inventoryRepository.server.js";
import { validateMovementRequest } from "./inventoryMovementRules.js";
import { snapshotFromBalance } from "./inventoryTypes.js";

const MOVEMENT_CTX = { userId: "user-1", permissions: ["inventory.movements.create"] as const };
const RESERVE_CTX = { userId: "user-1", permissions: ["inventory.reservations.manage"] as const };

describe("inventoryService", () => {
  it("1. entrada cria movimento e atualiza saldo (mock transação)", async () => {
    const { prisma, state } = createMockPrisma();
    const itemId = "item-1";
    const whId = "wh-1";

    const result = await createInventoryMovement(
      prisma as never,
      {
        itemId,
        destinationWarehouseId: whId,
        movementType: "MANUAL_ENTRY",
        quantity: 10,
        unit: "UN",
        reason: "Entrada inicial",
      },
      { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
    );

    assert.equal(result.balance.physicalQuantity, 10);
    assert.equal(state.movements.length, 1);
    assert.equal(Number(state.movements[0].nextPhysicalBalance), 10);
    assert.equal(state.balances[0].physicalQuantity, 10);
  });

  it("2. saída cria movimento e atualiza saldo", async () => {
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

    const result = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "MANUAL_EXIT",
        quantity: 5,
        unit: "UN",
        reason: "Saída teste",
      },
      { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
    );

    assert.equal(result.balance.physicalQuantity, 15);
    assert.equal(state.movements.length, 1);
  });

  it("3. saída maior que disponível falha", async () => {
    const { prisma } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(3),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(3),
        },
      ],
    });

    await assert.rejects(
      () =>
        createInventoryMovement(
          prisma as never,
          {
            itemId: "item-1",
            sourceWarehouseId: "wh-1",
            movementType: "MANUAL_EXIT",
            quantity: 5,
            unit: "UN",
            reason: "Excesso",
          },
          { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
        ),
      (e: unknown) => e instanceof InventoryValidationError
    );
  });

  it("4-5. ajustes exigem motivo", () => {
    assert.throws(() =>
      validateMovementRequest(snapshotFromBalance({ physicalQuantity: 1 }), {
        movementType: "POSITIVE_ADJUSTMENT",
        quantity: 1,
      })
    );
    assert.throws(() =>
      validateMovementRequest(snapshotFromBalance({ physicalQuantity: 1 }), {
        movementType: "NEGATIVE_ADJUSTMENT",
        quantity: 1,
      })
    );
  });

  it("6. reserva cria reserva e atualiza saldo reservado", async () => {
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

    const result = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "RESERVE",
        quantity: 4,
        unit: "UN",
        reason: "Reserva manual",
      },
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] }
    );

    assert.equal(result.balance.reservedQuantity, 4);
    assert.equal(result.balance.availableQuantity, 16);
    assert.equal(state.reservations.length, 1);
  });

  it("7. cancelamento de reserva libera saldo", async () => {
    const { prisma, state } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(20),
          reservedQuantity: new Prisma.Decimal(4),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(16),
        },
      ],
      reservations: [
        {
          id: "res-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          quantity: new Prisma.Decimal(4),
          status: "ACTIVE",
        },
      ],
    });

    const result = await cancelInventoryReservation(
      prisma as never,
      "res-1",
      { userId: RESERVE_CTX.userId, permissions: [...RESERVE_CTX.permissions] },
      "Cancelamento manual"
    );

    assert.equal(result.balance.reservedQuantity, 0);
    assert.equal(result.balance.availableQuantity, 20);
    assert.equal(state.reservations[0].status, "CANCELED");
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].movementType, "CANCEL_RESERVATION");
  });

  it("8. bloqueio atualiza saldo bloqueado", async () => {
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

    const result = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "BLOCK",
        quantity: 2,
        unit: "UN",
        reason: "Qualidade",
      },
      { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
    );

    assert.equal(result.balance.blockedQuantity, 2);
    assert.equal(result.balance.availableQuantity, 8);
  });

  it("9. transferência atualiza origem e destino", async () => {
    const { prisma } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-src",
          locationId: null,
          balanceKey: "wh-src",
          physicalQuantity: new Prisma.Decimal(30),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(30),
        },
      ],
    });

    const result = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-src",
        destinationWarehouseId: "wh-dst",
        movementType: "TRANSFER",
        quantity: 8,
        unit: "UN",
        reason: "Transferência",
      },
      { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
    );

    assert.equal((result as { sourceBalance: { physicalQuantity: number } }).sourceBalance.physicalQuantity, 22);
    assert.equal(
      (result as { destinationBalance: { physicalQuantity: number } }).destinationBalance.physicalQuantity,
      8
    );
  });

  it("10-12. movimento registra saldos, usuário e motivo", async () => {
    const { prisma, state } = createMockPrisma();
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        destinationWarehouseId: "wh-1",
        movementType: "MANUAL_ENTRY",
        quantity: 1,
        unit: "UN",
        reason: "Motivo auditável",
        responsibleUserId: "resp-1",
      },
      { userId: "user-9", permissions: ["inventory.movements.create"] }
    );

    const m = state.movements[0];
    assert.equal(Number(m.previousPhysicalBalance), 0);
    assert.equal(Number(m.nextPhysicalBalance), 1);
    assert.equal(m.reason, "Motivo auditável");
    assert.equal(m.responsibleUserId, "resp-1");
  });

  it("13. movimento é criado em transação", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/inventory/inventoryService.server.ts"), "utf8");
    assert.match(src, /prisma\.\$transaction/);
  });

  it("14. falha na validação não altera saldo", async () => {
    const { prisma, state } = createMockPrisma({
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(2),
          reservedQuantity: new Prisma.Decimal(0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(2),
        },
      ],
    });

    await assert.rejects(() =>
      createInventoryMovement(
        prisma as never,
        {
          itemId: "item-1",
          sourceWarehouseId: "wh-1",
          movementType: "MANUAL_EXIT",
          quantity: 9,
          unit: "UN",
          reason: "Falha",
        },
        { userId: MOVEMENT_CTX.userId, permissions: [...MOVEMENT_CTX.permissions] }
      )
    );
    assert.equal(Number(state.balances[0].physicalQuantity), 2);
    assert.equal(state.movements.length, 0);
  });

  it("15. arquivos server-only não entram no bundle frontend", () => {
    const root = join(process.cwd(), "src/lib/inventory");
    for (const file of [
      "inventoryService.server.ts",
      "inventoryRepository.server.ts",
      "inventoryAudit.server.ts",
    ]) {
      const src = readFileSync(join(root, file), "utf8");
      assert.match(src, /@prisma\/client/);
      assert.doesNotMatch(src, /from "react"/);
    }
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
};

type MockReservation = {
  id: string;
  itemId: string;
  warehouseId: string;
  locationId: string | null;
  quantity: Prisma.Decimal;
  status: "ACTIVE" | "CANCELED" | "CONSUMED";
};

function createMockPrisma(options?: {
  balances?: MockBalance[];
  reservations?: MockReservation[];
}) {
  const state = {
    balances: [...(options?.balances ?? [])],
    movements: [] as Array<Record<string, unknown>>,
    reservations: [...(options?.reservations ?? [])] as Array<Record<string, unknown>>,
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

  const tx = {
    inventoryItem: {
      findUnique: async () => item,
    },
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
      create: async ({ data }: { data: MockBalance }) => {
        const row = { ...data, id: data.id ?? `bal-${state.balances.length + 1}` };
        state.balances.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<MockBalance>;
      }) => {
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
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `res-${state.reservations.length + 1}`, ...data };
        state.reservations.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.reservations.find((r) => r.id === where.id) ?? null,
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const idx = state.reservations.findIndex((r) => r.id === where.id);
        if (idx >= 0) state.reservations[idx] = { ...state.reservations[idx], ...data };
        return state.reservations[idx];
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
    inventoryAuditLog: tx.inventoryAuditLog,
  };

  return { prisma, state, tx };
}

// smoke import of repository helpers used in service
describe("inventoryRepository helpers", () => {
  it("mapBalanceRowToSnapshot converte decimais", () => {
    const snap = mapBalanceRowToSnapshot({
      id: "1",
      itemId: "i",
      warehouseId: "w",
      locationId: null,
      balanceKey: "w",
      physicalQuantity: "10.5",
      reservedQuantity: 1,
      blockedQuantity: 0,
      quarantineQuantity: 0,
      availableQuantity: 9.5,
    });
    assert.equal(snap.physicalQuantity, 10.5);
    assert.equal(snap.availableQuantity, 9.5);
  });
});
