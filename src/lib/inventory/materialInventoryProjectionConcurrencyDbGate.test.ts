/**
 * Gate PostgreSQL descartável: duas movimentações concorrentes da mesma MP
 * em almoxarifados diferentes não podem perder a projeção de Material.quantity.
 *
 * Só roda com INVENTORY_TEMPORAL_DB_URL contendo inventory_temporal_gate.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { createInventoryMovement } from "./inventoryService.server.js";
import {
  DB_GATE_PENDING,
  assertDisposableTemporalDb,
  resolveTemporalDbUrl,
} from "./inventoryCountDbGateSupport.js";

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

describe("projeção Material.quantity — concorrência em PostgreSQL real", { skip: gate }, () => {
  let prisma: PrismaClient;
  let materialId = "";
  let itemId = "";
  let warehouseA = "";
  let warehouseB = "";
  const suffix = `proj-${Date.now()}`;

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    await prisma.$connect();

    const material = await prisma.material.create({
      data: {
        code: `MP-${suffix}`,
        description: `Proj ${suffix}`,
        unit: "KG",
        category: "TEST",
        status: "ACTIVE",
        currentCost: 1,
        averageCost: 1,
        standardCost: 1,
        quantity: 0,
      },
    });
    materialId = material.id;

    const [wa, wb] = await Promise.all([
      prisma.inventoryWarehouse.create({
        data: { code: `WHA-${suffix}`, name: `A ${suffix}`, status: "ACTIVE" },
      }),
      prisma.inventoryWarehouse.create({
        data: { code: `WHB-${suffix}`, name: `B ${suffix}`, status: "ACTIVE" },
      }),
    ]);
    warehouseA = wa.id;
    warehouseB = wb.id;

    const item = await prisma.inventoryItem.create({
      data: {
        code: material.code,
        description: material.description,
        itemType: "RAW_MATERIAL",
        unit: "KG",
        status: "ACTIVE",
        controlsStock: true,
        materialId: material.id,
        materialCodeSnapshot: material.code,
        materialDescriptionSnapshot: material.description,
        materialUnitSnapshot: material.unit,
      },
    });
    itemId = item.id;
  });

  after(async () => {
    if (!prisma) return;
    try {
      if (itemId) {
        await prisma.inventoryMovement.deleteMany({ where: { itemId } });
        await prisma.inventoryBalance.deleteMany({ where: { itemId } });
        await prisma.inventoryItem.deleteMany({ where: { id: itemId } });
      }
      if (warehouseA) await prisma.inventoryWarehouse.deleteMany({ where: { id: warehouseA } });
      if (warehouseB) await prisma.inventoryWarehouse.deleteMany({ where: { id: warehouseB } });
      if (materialId) await prisma.material.deleteMany({ where: { id: materialId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("cenário 15: duas entradas concorrentes projetam o agregado", async () => {
    const ctx = {
      userId: "proj-user",
      permissions: ["inventory.movements.create"],
    } as const;
    const a = createInventoryMovement(
      prisma,
      {
        itemId,
        destinationWarehouseId: warehouseA,
        movementType: "MANUAL_ENTRY",
        quantity: 40,
        unit: "KG",
        reason: "Entrada A",
      },
      ctx
    );
    const b = createInventoryMovement(
      prisma,
      {
        itemId,
        destinationWarehouseId: warehouseB,
        movementType: "MANUAL_ENTRY",
        quantity: 25,
        unit: "KG",
        reason: "Entrada B",
      },
      ctx
    );
    await Promise.all([a, b]);
    const material = await prisma.material.findUniqueOrThrow({
      where: { id: materialId },
      select: { quantity: true },
    });
    assert.equal(new Prisma.Decimal(material.quantity.toString()).toString(), "65");
  });
});
