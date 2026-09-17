/**
 * Fluxo real: contagem física → InventoryMovement → InventoryBalance → Material.quantity.
 *
 * Opt-in: INVENTORY_TEMPORAL_DB_URL (PostgreSQL descartável). Sem URL → skip.
 * Nunca faz UPDATE direto de InventoryBalance ou Material.quantity.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { recordInventoryCount as recordInventoryCountService } from "./inventoryCountApplicationService.server.js";
import {
  approveInventoryCountSession,
  createInventoryCountSession,
  finalizeInventoryCountSession,
  generateInventoryCountAdjustments,
} from "./inventoryCountService.server.js";
import {
  COLLECTOR_NO_COUNTED_ITEMS,
  finalizeCollectorSession,
} from "./collector/collectorAutonomousSession.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import {
  DB_GATE_PENDING,
  assertDisposableTemporalDb,
  resolveTemporalDbUrl,
} from "./inventoryCountDbGateSupport.js";

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

const OPERATOR = {
  userId: "count-supplies-user",
  permissions: ["inventory.manage", "inventory.count.manage", "inventory.count.approve"],
} as const;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

async function recordInventoryCount(
  prisma: PrismaClient,
  input: {
    sessionId: string;
    lineId: string;
    countedQuantity: number;
    justification?: string | null;
  }
) {
  const current = await prisma.inventoryCountLine.findFirst({
    where: { id: input.lineId, sessionId: input.sessionId },
  });
  return recordInventoryCountService(
    prisma,
    { ...input, expectedVersion: current?.version ?? 0 },
    OPERATOR
  );
}

type Fixture = {
  stamp: string;
  materialId: string;
  itemId: string;
  warehouseId: string;
  sessionId: string;
  lineId: string;
  extraMaterialId?: string;
  extraItemId?: string;
  extraLineId?: string;
};

describe("contagem física → Suprimentos (PostgreSQL real)", { skip: gate }, () => {
  let prisma: PrismaClient;
  const created: Fixture[] = [];

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    await prisma.$connect();
  });

  after(async () => {
    for (const f of [...created].reverse()) {
      await prisma.inventoryCountLine.updateMany({
        where: { sessionId: f.sessionId },
        data: { currentObservationId: null, generatedMovementId: null },
      });
      await prisma.inventoryCountObservation.deleteMany({
        where: { line: { sessionId: f.sessionId } },
      });
      await prisma.inventoryCountOperation.deleteMany({ where: { sessionId: f.sessionId } });
      await prisma.inventoryCountLine.deleteMany({ where: { sessionId: f.sessionId } });
      await prisma.inventoryCountSession.deleteMany({ where: { id: f.sessionId } });
      await prisma.inventoryMovement.deleteMany({
        where: { itemId: { in: [f.itemId, f.extraItemId].filter((id): id is string => Boolean(id)) } },
      });
      await prisma.inventoryBalance.deleteMany({
        where: { itemId: { in: [f.itemId, f.extraItemId].filter((id): id is string => Boolean(id)) } },
      });
      await prisma.inventoryItem.deleteMany({
        where: { id: { in: [f.itemId, f.extraItemId].filter((id): id is string => Boolean(id)) } },
      });
      await prisma.inventoryWarehouse.deleteMany({ where: { id: f.warehouseId } });
      await prisma.material.deleteMany({
        where: { id: { in: [f.materialId, f.extraMaterialId].filter((id): id is string => Boolean(id)) } },
      });
    }
    await prisma.$disconnect();
  });

  async function seedLinkedWithoutBalance(input?: {
    extraUncounted?: boolean;
  }): Promise<Fixture> {
    const stamp = `CTS-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const warehouse = await prisma.inventoryWarehouse.create({
      data: { code: stamp, name: stamp, status: "ACTIVE" },
    });
    const material = await prisma.material.create({
      data: {
        code: `115-${stamp}`,
        description: `*PP* ${stamp}`,
        unit: "KG",
        status: "ACTIVE",
        category: "TEST",
        currentCost: 1,
        averageCost: 1,
        standardCost: 1,
        quantity: 1100,
      },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        code: `115-${stamp}`,
        description: material.description,
        itemType: "RAW_MATERIAL",
        unit: "KG",
        status: "ACTIVE",
        controlsStock: true,
        materialId: material.id,
        defaultWarehouseId: warehouse.id,
        notes: "Collector cold-start link",
      },
    });

    const session = await createInventoryCountSession(
      prisma,
      { warehouseId: warehouse.id, notes: stamp },
      OPERATOR
    );
    await prisma.inventoryCountSession.update({
      where: { id: session.id },
      data: { status: "COUNTING", startedAt: new Date() },
    });
    const line = await prisma.inventoryCountLine.create({
      data: {
        sessionId: session.id,
        itemId: item.id,
        warehouseId: warehouse.id,
        locationId: null,
        systemQuantity: 0,
      },
    });

    const fixture: Fixture = {
      stamp,
      materialId: material.id,
      itemId: item.id,
      warehouseId: warehouse.id,
      sessionId: session.id,
      lineId: line.id,
    };

    if (input?.extraUncounted) {
      const extraMaterial = await prisma.material.create({
        data: {
          code: `B-${stamp}`,
          description: `Mat B ${stamp}`,
          unit: "KG",
          status: "ACTIVE",
          category: "TEST",
          currentCost: 1,
          averageCost: 1,
          standardCost: 1,
          quantity: 500,
        },
      });
      const extraItem = await prisma.inventoryItem.create({
        data: {
          code: `B-${stamp}`,
          description: extraMaterial.description,
          itemType: "RAW_MATERIAL",
          unit: "KG",
          status: "ACTIVE",
          controlsStock: true,
          materialId: extraMaterial.id,
          defaultWarehouseId: warehouse.id,
        },
      });
      const extraLine = await prisma.inventoryCountLine.create({
        data: {
          sessionId: session.id,
          itemId: extraItem.id,
          warehouseId: warehouse.id,
          locationId: null,
          systemQuantity: 0,
        },
      });
      fixture.extraMaterialId = extraMaterial.id;
      fixture.extraItemId = extraItem.id;
      fixture.extraLineId = extraLine.id;
    }

    created.push(fixture);
    return fixture;
  }

  it("1. linked + no balance + count > 0 → movement + balance + Material.quantity", async () => {
    const f = await seedLinkedWithoutBalance();
    const beforeBalance = await prisma.inventoryBalance.count({ where: { itemId: f.itemId } });
    const beforeMovements = await prisma.inventoryMovement.count({ where: { itemId: f.itemId } });
    assert.equal(beforeBalance, 0);
    assert.equal(beforeMovements, 0);

    const recorded = await recordInventoryCount(prisma, {
      sessionId: f.sessionId,
      lineId: f.lineId,
      countedQuantity: 1375,
      justification: "Contagem física 1375 kg",
    });
    assert.equal(recorded.snapshot.expectedQuantity, 0);
    assert.equal(recorded.snapshot.countedQuantity, 1375);
    assert.equal(recorded.snapshot.adjustmentDelta, 1375);

    const afterRecordBalance = await prisma.inventoryBalance.findFirst({
      where: { itemId: f.itemId },
    });
    assert.ok(afterRecordBalance);
    assert.equal(Number(afterRecordBalance.physicalQuantity), 0);

    await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    await approveInventoryCountSession(prisma, f.sessionId, OPERATOR);
    const result = await generateInventoryCountAdjustments(prisma, f.sessionId, OPERATOR);

    const movement = await prisma.inventoryMovement.findFirstOrThrow({
      where: { itemId: f.itemId },
    });
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { itemId: f.itemId },
    });
    const material = await prisma.material.findUniqueOrThrow({ where: { id: f.materialId } });
    const line = await prisma.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });
    const session = await prisma.inventoryCountSession.findUniqueOrThrow({
      where: { id: f.sessionId },
    });

    assert.equal(result.movementsCreated, 1);
    assert.equal(movement.movementType, "POSITIVE_ADJUSTMENT");
    assert.equal(Number(movement.quantity), 1375);
    assert.equal(Number(balance.physicalQuantity), 1375);
    assert.equal(Number(material.quantity), 1375);
    assert.equal(line.generatedMovementId, movement.id);
    assert.equal(session.status, "ADJUSTED");
  });

  it("2. linked + no balance + count = 0 → balance 0 + Material.quantity 0", async () => {
    const f = await seedLinkedWithoutBalance();
    const recorded = await recordInventoryCount(prisma, {
      sessionId: f.sessionId,
      lineId: f.lineId,
      countedQuantity: 0,
    });
    assert.equal(recorded.snapshot.expectedQuantity, 0);
    assert.equal(recorded.snapshot.countedQuantity, 0);
    assert.equal(recorded.snapshot.adjustmentDelta, 0);

    const finalized = await finalizeInventoryCountSession(prisma, f.sessionId, OPERATOR);
    assert.equal(finalized.status, "APPROVED");
    const result = await generateInventoryCountAdjustments(prisma, f.sessionId, OPERATOR);
    assert.equal(result.movementsCreated, 0);

    const movements = await prisma.inventoryMovement.count({ where: { itemId: f.itemId } });
    const balance = await prisma.inventoryBalance.findFirstOrThrow({
      where: { itemId: f.itemId },
    });
    const material = await prisma.material.findUniqueOrThrow({ where: { id: f.materialId } });
    const line = await prisma.inventoryCountLine.findUniqueOrThrow({ where: { id: f.lineId } });

    assert.equal(movements, 0);
    assert.equal(Number(balance.physicalQuantity), 0);
    assert.equal(Number(material.quantity), 0);
    assert.ok(line.countedQuantity != null);
    assert.equal(Number(line.countedQuantity), 0);
  });

  it("3. sessão parcial não reconcilia material não contado", async () => {
    const f = await seedLinkedWithoutBalance({ extraUncounted: true });
    await recordInventoryCount(prisma, {
      sessionId: f.sessionId,
      lineId: f.lineId,
      countedQuantity: 1300,
      justification: "Contagem A",
    });

    await finalizeCollectorSession(prisma, {
      sessionId: f.sessionId,
      deviceId: "collector-partial",
      allowUncounted: true,
    });
    const result = await generateInventoryCountAdjustments(prisma, f.sessionId, OPERATOR);

    const materialA = await prisma.material.findUniqueOrThrow({ where: { id: f.materialId } });
    const materialB = await prisma.material.findUniqueOrThrow({
      where: { id: f.extraMaterialId },
    });
    const balanceB = await prisma.inventoryBalance.findFirst({
      where: { itemId: f.extraItemId },
    });
    const movementsB = await prisma.inventoryMovement.count({
      where: { itemId: f.extraItemId },
    });
    const lineB = await prisma.inventoryCountLine.findUniqueOrThrow({
      where: { id: f.extraLineId },
    });

    assert.equal(result.movementsCreated, 1);
    assert.equal(Number(materialA.quantity), 1300);
    assert.equal(Number(materialB.quantity), 500);
    assert.equal(balanceB, null);
    assert.equal(movementsB, 0);
    assert.equal(lineB.countedQuantity, null);
    assert.equal(lineB.generatedMovementId, null);
  });

  it("4. zero counted lines bloqueia finalização", async () => {
    const f = await seedLinkedWithoutBalance({ extraUncounted: true });
    await assert.rejects(
      () =>
        finalizeCollectorSession(prisma, {
          sessionId: f.sessionId,
          deviceId: "collector-empty",
          allowUncounted: true,
        }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === COLLECTOR_NO_COUNTED_ITEMS
    );
    const session = await prisma.inventoryCountSession.findUniqueOrThrow({
      where: { id: f.sessionId },
    });
    assert.equal(session.status, "COUNTING");
  });
});

describe("contagem física → Suprimentos DB gate pending", { skip: !gate }, () => {
  it("reports PENDING when temporal DB URL absent", () => {
    assert.ok(Boolean(gate));
    console.log("[COUNT TO SUPPLIES] REAL DB GATE = PENDING HOMOLOGATION");
  });
});
