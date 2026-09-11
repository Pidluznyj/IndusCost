import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  reconcileMaterialQuantityFromInventoryInTx,
  reconcileMaterialQuantitiesFromInventoryInTx,
  sumCanonicalPhysicalQuantity,
} from "./materialInventoryProjection.server.js";
import {
  createInventoryMovement,
  reverseInventoryMovement,
} from "./inventoryService.server.js";

const root = process.cwd();
function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";

type BalanceRow = {
  itemId: string;
  locationId: string | null;
  physicalQuantity: Prisma.Decimal;
};

function createProjectionTx(options?: {
  quantity?: unknown;
  balances?: BalanceRow[];
  itemCount?: number;
  controlsLocation?: boolean;
  materialMissing?: boolean;
}) {
  const material = {
    id: MATERIAL_ID,
    quantity: options?.quantity ?? new Prisma.Decimal(1100),
    unit: "KG",
  };
  const items = Array.from({ length: options?.itemCount ?? 1 }, (_, i) => ({
    id: i === 0 ? ITEM_ID : `${ITEM_ID}-${i}`,
    materialId: MATERIAL_ID,
    unit: "KG",
    status: "ACTIVE",
    controlsLocation: options?.controlsLocation ?? false,
  }));
  const balances = options?.balances ?? [
    {
      itemId: ITEM_ID,
      locationId: null,
      physicalQuantity: new Prisma.Decimal(6525),
    },
  ];
  const audit: unknown[] = [];

  const tx = {
    $queryRaw: async () => [{ "?column?": 1 }],
    material: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (options?.materialMissing || where.id !== MATERIAL_ID) return null;
        return { ...material };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { quantity: Prisma.Decimal };
      }) => {
        assert.equal(where.id, MATERIAL_ID);
        material.quantity = data.quantity;
        return { id: MATERIAL_ID, quantity: material.quantity };
      },
    },
    inventoryItem: {
      findMany: async () => items,
    },
    inventoryBalance: {
      findMany: async ({ where }: { where: { itemId?: string } }) =>
        balances.filter((b) => !where.itemId || b.itemId === where.itemId),
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audit.push(data);
        return data;
      },
    },
  };

  return { tx, material, audit };
}

describe("sumCanonicalPhysicalQuantity", () => {
  it("agrega 4000 + 2525 = 6525 em warehouses distintos", () => {
    const total = sumCanonicalPhysicalQuantity(
      [
        { locationId: null, physicalQuantity: new Prisma.Decimal("4000") },
        { locationId: null, physicalQuantity: new Prisma.Decimal("2525") },
      ],
      false
    );
    assert.equal(total.toString(), "6525");
  });

  it("preserva Decimal fracionário", () => {
    const total = sumCanonicalPhysicalQuantity(
      [
        { locationId: null, physicalQuantity: new Prisma.Decimal("0.001") },
        { locationId: null, physicalQuantity: new Prisma.Decimal("1234.567890") },
      ],
      false
    );
    assert.equal(total.eq(new Prisma.Decimal("1234.568890")), true);
  });
});

describe("reconcileMaterialQuantityFromInventoryInTx", () => {
  it("cenário 1 / H503: 1100 → 6525 sem copiar countedQuantity", async () => {
    const { tx, material, audit } = createProjectionTx({ quantity: new Prisma.Decimal(1100) });
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, MATERIAL_ID, {
      source: "RECONCILE",
    });
    assert.equal(result?.changed, true);
    assert.equal(result?.after.toString(), "6525");
    assert.equal(material.quantity.toString(), "6525");
    assert.equal((audit[0] as { action: string }).action, "INVENTORY_QUANTITY_PROJECTED");
  });

  it("não atualiza quando already MATCH", async () => {
    const { tx, audit } = createProjectionTx({ quantity: new Prisma.Decimal(6525) });
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, MATERIAL_ID, {
      source: "RECONCILE",
    });
    assert.equal(result?.changed, false);
    assert.equal(result?.status, "UNCHANGED");
    assert.equal(audit.length, 0);
  });

  it("cenário 6: conferência só no A (4000→3900) resulta 6425", async () => {
    const { tx, material } = createProjectionTx({
      quantity: new Prisma.Decimal(6525),
      balances: [
        { itemId: ITEM_ID, locationId: null, physicalQuantity: new Prisma.Decimal(3900) },
        { itemId: ITEM_ID, locationId: null, physicalQuantity: new Prisma.Decimal(2525) },
      ],
    });
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, MATERIAL_ID, {
      source: "COUNT_SESSION",
      countSessionId: "sess-1",
    });
    assert.equal(result?.after.toString(), "6425");
    assert.equal(material.quantity.toString(), "6425");
  });

  it("cenário 16: sem vínculo não adivinha Material", async () => {
    const { tx } = createProjectionTx({ itemCount: 0, quantity: new Prisma.Decimal(1100) });
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, MATERIAL_ID, {
      source: "INVENTORY_MOVEMENT",
    });
    assert.equal(result?.status, "NO_INVENTORY_LINK");
    assert.equal(result?.changed, false);
    assert.equal(result?.before.toString(), "1100");
  });

  it("múltiplos vínculos ativos não adivinham", async () => {
    const { tx, material } = createProjectionTx({ itemCount: 2, quantity: new Prisma.Decimal(1100) });
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, MATERIAL_ID, {
      source: "RECONCILE",
    });
    assert.equal(result?.status, "MULTIPLE_ACTIVE_LINKS");
    assert.equal(material.quantity.toString(), "1100");
  });

  it("batch ordena ids e reconcilia distintos", async () => {
    const { tx } = createProjectionTx();
    const results = await reconcileMaterialQuantitiesFromInventoryInTx(
      tx,
      [MATERIAL_ID, MATERIAL_ID, ""],
      { source: "COUNT_SESSION" }
    );
    assert.equal(results.length, 1);
    assert.equal(results[0]?.after.toString(), "6525");
  });
});

describe("createInventoryMovement projeta só quando physical muda", () => {
  function createMovementMock(input: {
    physical: number;
    reserved?: number;
    materialId: string | null;
    materialQuantity: number;
    extraBalances?: Array<{ warehouseId: string; physical: number }>;
  }) {
    const extras = (input.extraBalances ?? []).map((row, i) => ({
      id: `bal-x-${i + 1}`,
      itemId: "item-1",
      warehouseId: row.warehouseId,
      locationId: null,
      balanceKey: row.warehouseId,
      physicalQuantity: new Prisma.Decimal(row.physical),
      reservedQuantity: new Prisma.Decimal(0),
      blockedQuantity: new Prisma.Decimal(0),
      quarantineQuantity: new Prisma.Decimal(0),
      availableQuantity: new Prisma.Decimal(row.physical),
    }));
    const state = {
      balances: [
        {
          id: "bal-1",
          itemId: "item-1",
          warehouseId: "wh-1",
          locationId: null,
          balanceKey: "wh-1",
          physicalQuantity: new Prisma.Decimal(input.physical),
          reservedQuantity: new Prisma.Decimal(input.reserved ?? 0),
          blockedQuantity: new Prisma.Decimal(0),
          quarantineQuantity: new Prisma.Decimal(0),
          availableQuantity: new Prisma.Decimal(input.physical - (input.reserved ?? 0)),
        },
        ...extras,
      ],
      movements: [] as Array<Record<string, unknown>>,
      reservations: [] as Array<Record<string, unknown>>,
      materialQuantity: new Prisma.Decimal(input.materialQuantity),
    };

    const item = {
      id: "item-1",
      status: "ACTIVE" as const,
      itemType: "RAW_MATERIAL" as const,
      unit: "KG",
      controlsStock: true,
      controlsLocation: false,
      allowsReservation: true,
      allowsBlock: true,
      materialId: input.materialId,
      materialCodeSnapshot: "115.01--",
      materialDescriptionSnapshot: "PP",
      lastKnownCost: null as unknown,
      averageCost: null as unknown,
    };

    const tx = {
      $queryRaw: async () => [{ "?column?": 1 }],
      inventoryItem: {
        findUnique: async () => item,
        findMany: async () =>
          input.materialId
            ? [
                {
                  id: item.id,
                  materialId: item.materialId,
                  unit: item.unit,
                  status: item.status,
                  controlsLocation: item.controlsLocation,
                },
              ]
            : [],
      },
      inventoryWarehouse: {
        findUnique: async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          status: "ACTIVE",
          allowsMovements: true,
        }),
      },
      inventoryBalance: {
        findUnique: async ({
          where,
        }: {
          where: { itemId_balanceKey?: { itemId: string; balanceKey: string }; id?: string };
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
        findMany: async () =>
          state.balances.map((b) => ({
            locationId: b.locationId,
            physicalQuantity: b.physicalQuantity,
          })),
        create: async ({ data }: { data: (typeof state.balances)[0] }) => {
          state.balances.push(data);
          return data;
        },
        update: async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<(typeof state.balances)[0]>;
        }) => {
          const idx = state.balances.findIndex((b) => b.id === where.id);
          state.balances[idx] = { ...state.balances[idx], ...data };
          return state.balances[idx];
        },
      },
      inventoryMovement: {
        findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
          state.movements.find((m) => {
            if (where?.reversedMovementId && m.reversedMovementId === where.reversedMovementId) {
              return true;
            }
            if (where?.idempotencyKey && m.idempotencyKey === where.idempotencyKey) return true;
            if (where?.originId && m.originId === where.originId) return true;
            return false;
          }) ?? null,
        findUnique: async ({ where }: { where: { id: string } }) =>
          state.movements.find((m) => m.id === where.id) ?? null,
        findMany: async () => [...state.movements],
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
      },
      inventoryBlock: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({
          id: "blk-1",
          ...data,
        }),
      },
      inventoryAuditLog: { create: async ({ data }: { data: unknown }) => data },
      material: {
        findUnique: async () => ({
          id: MATERIAL_ID,
          quantity: state.materialQuantity,
          unit: "KG",
        }),
        update: async ({ data }: { data: { quantity: Prisma.Decimal } }) => {
          state.materialQuantity = data.quantity;
          return { id: MATERIAL_ID, quantity: data.quantity };
        },
      },
    };

    const prisma = {
      $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
      inventoryAuditLog: tx.inventoryAuditLog,
      inventoryMovement: tx.inventoryMovement,
      inventoryItem: tx.inventoryItem,
    };

    return { prisma, state };
  }

  const ctx = { userId: "user-1", permissions: ["inventory.movements.create"] as const };
  const reserveCtx = { userId: "user-1", permissions: ["inventory.reservations.manage"] as const };

  it("cenário 8: saída física reduz Material.quantity", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 100,
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "REQUISITION_EXIT",
        quantity: 10,
        unit: "KG",
        reason: "Collector",
      },
      ctx
    );
    assert.equal(state.materialQuantity.toString(), "90");
  });

  it("cenário 9: RESERVE não muda Material.quantity", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 100,
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "RESERVE",
        quantity: 20,
        unit: "KG",
        reason: "Reserva",
        reservationType: "MANUAL",
      },
      reserveCtx
    );
    assert.equal(Number(state.balances[0].physicalQuantity), 100);
    assert.equal(state.materialQuantity.toString(), "100");
  });

  it("cenário 7: transferência entre almoxarifados não muda o total", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 150,
      extraBalances: [{ warehouseId: "wh-2", physical: 50 }],
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        destinationWarehouseId: "wh-2",
        movementType: "TRANSFER",
        quantity: 20,
        unit: "KG",
        reason: "Transferência",
      },
      { userId: "user-1", permissions: ["inventory.transfer.create"] }
    );
    const total = state.balances.reduce(
      (sum, row) => sum.add(new Prisma.Decimal(row.physicalQuantity.toString())),
      new Prisma.Decimal(0)
    );
    assert.equal(total.toString(), "150");
    assert.equal(state.materialQuantity.toString(), "150");
  });

  it("cenário 10: BLOCK não muda Material.quantity", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 100,
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "BLOCK",
        quantity: 15,
        unit: "KG",
        reason: "Bloqueio",
        blockReasonType: "QUALITY",
      },
      { userId: "user-1", permissions: ["inventory.block.manage"] }
    );
    assert.equal(Number(state.balances[0].physicalQuantity), 100);
    assert.equal(state.materialQuantity.toString(), "100");
  });

  it("cenário 11: QUARANTINE_IN não muda Material.quantity", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 100,
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "QUARANTINE_IN",
        quantity: 8,
        unit: "KG",
        reason: "Quarentena",
      },
      { userId: "user-1", permissions: ["inventory.block.manage"] }
    );
    assert.equal(Number(state.balances[0].physicalQuantity), 100);
    assert.equal(state.materialQuantity.toString(), "100");
  });

  it("cenário 12: REVERSAL restaura o físico e a projeção", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: MATERIAL_ID,
      materialQuantity: 100,
    });
    const exit = await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "REQUISITION_EXIT",
        quantity: 10,
        unit: "KG",
        reason: "Collector",
      },
      ctx
    );
    assert.equal(state.materialQuantity.toString(), "90");
    await reverseInventoryMovement(
      prisma as never,
      exit.movement.id as string,
      ctx,
      "Estorno"
    );
    assert.equal(state.materialQuantity.toString(), "100");
  });

  it("cenário 16: item sem materialId não projeta", async () => {
    const { prisma, state } = createMovementMock({
      physical: 100,
      materialId: null,
      materialQuantity: 1100,
    });
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        movementType: "MANUAL_EXIT",
        quantity: 10,
        unit: "KG",
        reason: "Saída",
      },
      ctx
    );
    assert.equal(state.materialQuantity.toString(), "1100");
  });
});

describe("arquitetura — um único escritor de saldo cadastral", () => {
  it("ledger chama a projeção; conferência tablet não grava quantity", () => {
    const service = read("src/lib/inventory/inventoryService.server.ts");
    assert.match(service, /reconcileMaterialQuantityFromInventoryInTx/);
    const count = read("src/lib/inventory/inventoryCountService.server.ts");
    assert.match(count, /createInventoryMovementInTx/);
    assert.match(count, /reconcileMaterialQuantitiesFromInventoryInTx/);
    const conference = read("src/lib/materialStockConference.server.ts");
    assert.doesNotMatch(conference, /quantity:\s*reported/);
    assert.doesNotMatch(conference, /reconcileMaterialQuantityFromInventoryInTx/);
    const parameters = read("src/lib/materialStockParameters.server.ts");
    assert.doesNotMatch(parameters, /quantity:\s*command\.currentQuantity/);
    const server = read("server.ts");
    assert.match(server, /materialUpdateQuantityHttpResult/);
    assert.match(server, /materialCreateQuantityHttpResult/);
    assert.doesNotMatch(server, /quantity: body\.quantity/);
    assert.match(count, /prisma\.\$transaction/);
  });
});
