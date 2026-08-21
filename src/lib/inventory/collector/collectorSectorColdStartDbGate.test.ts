/**
 * Cold-start Collector em PostgreSQL real (opt-in).
 *
 * Cenário: warehouse ACTIVE + Materials elegíveis + sem InventoryItem parcial
 * + sem InventoryBalance → prepare materializa links → sessão → linhas > 0
 * → contagem → finalize → apply → physicalQuantity.
 *
 * Opt-in: INVENTORY_TEMPORAL_DB_URL (mesmo gate descartável dos outros DB gates).
 * Sem URL → skip (PENDING HOMOLOGATION), sem inventar PASS.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  applyCollectorSessionAdjustments,
  createAndStartCollectorSectorSession,
  finalizeCollectorSession,
  listCollectorSessionItemsBlind,
} from "./collectorAutonomousSession.server.js";
import {
  diagnoseRawMaterialCollectorColdStart,
  prepareRawMaterialSectorForCounting,
  resolveCollectorSectorOperationalContext,
} from "./collectorSectorPrepare.server.js";
import { recordInventoryCount } from "./../inventoryCountApplicationService.server.js";
import {
  DB_GATE_PENDING,
  assertDisposableTemporalDb,
  resolveTemporalDbUrl,
} from "./../inventoryCountDbGateSupport.js";

const dbUrl = resolveTemporalDbUrl();
const gate = dbUrl ? false : DB_GATE_PENDING;

function client(): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl as string } } });
}

describe("Collector cold-start DB gate", { skip: gate }, () => {
  let prisma: PrismaClient;
  const suffix = `cs-${Date.now().toString(36)}`;
  let warehouseId = "";
  let materialIds: string[] = [];
  let deviceId = "";
  let sessionId = "";
  let existingItemId = "";

  before(async () => {
    assertDisposableTemporalDb(dbUrl as string);
    prisma = client();
    await prisma.$connect();

    const wh = await prisma.inventoryWarehouse.create({
      data: {
        code: `WH-${suffix}`,
        name: `ColdStart ${suffix}`,
        status: "ACTIVE",
      },
    });
    warehouseId = wh.id;

    const m1 = await prisma.material.create({
      data: {
        code: `MP-A-${suffix}`,
        description: `Mat A ${suffix}`,
        unit: "KG",
        status: "ACTIVE",
        category: "TEST",
        currentCost: 1,
        averageCost: 1,
        standardCost: 1,
        quantity: 50,
      },
    });
    const m2 = await prisma.material.create({
      data: {
        code: `MP-B-${suffix}`,
        description: `Mat B ${suffix}`,
        unit: "KG",
        status: "ACTIVE",
        category: "TEST",
        currentCost: 1,
        averageCost: 1,
        standardCost: 1,
        quantity: 0,
      },
    });
    materialIds = [m1.id, m2.id];

    // Um item já vinculado (sem balance) — prepare não deve duplicar.
    const existing = await prisma.inventoryItem.create({
      data: {
        code: m1.code,
        description: m1.description,
        itemType: "RAW_MATERIAL",
        unit: m1.unit,
        status: "ACTIVE",
        controlsStock: true,
        materialId: m1.id,
        materialCodeSnapshot: m1.code,
        materialDescriptionSnapshot: m1.description,
        materialUnitSnapshot: m1.unit,
        defaultWarehouseId: warehouseId,
      },
    });
    existingItemId = existing.id;

    const device = await prisma.inventoryCollectorDevice.create({
      data: {
        name: `Device ${suffix}`,
        tailscaleStableNodeId: `node-${suffix}`,
        active: true,
        canManageCountSessions: true,
        canApplyCountAdjustments: true,
      },
    });
    deviceId = device.id;
  });

  after(async () => {
    if (!prisma) return;
    try {
      if (sessionId) {
        await prisma.inventoryCountLine.deleteMany({ where: { sessionId } });
        await prisma.inventoryCountSession.deleteMany({ where: { id: sessionId } });
      }
      const items = await prisma.inventoryItem.findMany({
        where: { materialId: { in: materialIds } },
        select: { id: true },
      });
      const itemIds = items.map((i) => i.id);
      if (itemIds.length) {
        await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.inventoryBalance.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.inventoryCountLine.deleteMany({ where: { itemId: { in: itemIds } } });
        await prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      }
      await prisma.inventoryCollectorDevice.deleteMany({ where: { id: deviceId } });
      await prisma.material.deleteMany({ where: { id: { in: materialIds } } });
      await prisma.inventoryWarehouse.deleteMany({ where: { id: warehouseId } });
      await prisma.inventoryAuditLog.deleteMany({
        where: {
          OR: [
            { entityId: warehouseId },
            { entityId: { in: itemIdsSafe() } },
            { afterJson: { path: ["deviceId"], equals: deviceId } },
          ],
        },
      });
    } finally {
      await prisma.$disconnect();
    }

    function itemIdsSafe() {
      return [existingItemId].filter(Boolean);
    }
  });

  it("context soft: warehouse ACTIVE sem presence ainda resolve", async () => {
    const ctx = await resolveCollectorSectorOperationalContext(prisma, "RAW_MATERIAL");
    assert.ok(ctx.warehouses.some((w) => w.id === warehouseId));
    assert.notEqual(ctx.operationalState, "CONFIGURATION_REQUIRED");
  });

  it("prepare: materializa missing InventoryItem sem balance e sem duplicar", async () => {
    const beforeBal = await prisma.inventoryBalance.count({
      where: { warehouseId },
    });
    const prep = await prepareRawMaterialSectorForCounting(prisma, {
      warehouseId,
      deviceId,
      deviceName: "gate",
    });
    assert.ok(prep.materialsEligible >= 2);
    assert.ok(prep.itemsEnsured >= 1, "deve criar link do material B");
    assert.equal(prep.warehouseId, warehouseId);

    const links = await prisma.inventoryItem.findMany({
      where: { materialId: { in: materialIds }, status: "ACTIVE" },
    });
    assert.equal(links.length, 2);

    const afterBal = await prisma.inventoryBalance.count({
      where: { warehouseId },
    });
    assert.equal(afterBal, beforeBal, "prepare NÃO inventa InventoryBalance");

    const prep2 = await prepareRawMaterialSectorForCounting(prisma, {
      warehouseId,
      deviceId,
    });
    assert.equal(prep2.itemsEnsured, 0);
    assert.equal(
      await prisma.inventoryItem.count({
        where: { materialId: { in: materialIds }, status: "ACTIVE" },
      }),
      2
    );

    const audit = await prisma.inventoryAuditLog.findFirst({
      where: { action: "COLLECTOR_SECTOR_PREPARED", entityId: warehouseId },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(audit);
    assert.equal(audit?.userId, null);
  });

  it("session + blind + count + finalize + apply atualiza physicalQuantity", async () => {
    const created = await createAndStartCollectorSectorSession(prisma, {
      sector: "RAW_MATERIAL",
      warehouseId,
      deviceId,
      deviceName: "gate",
    });
    sessionId = created.session.id;
    assert.ok(created.diagnostics.linesCreated >= 2);
    assert.equal(created.reused, false);

    const blind = await listCollectorSessionItemsBlind(prisma, sessionId);
    assert.ok(blind.items.length >= 2);
    for (const item of blind.items) {
      assert.equal("expectedQuantity" in item, false);
      assert.equal("systemQuantity" in item, false);
      assert.equal("adjustmentDelta" in item, false);
      assert.ok(item.countedQuantity === null || typeof item.countedQuantity === "number");
    }

    for (const item of blind.items) {
      await recordInventoryCount(
        prisma,
        {
          sessionId,
          lineId: item.lineId,
          countedQuantity: item.code.includes("MP-A") ? 100 : 0,
          expectedVersion: item.version,
          operationId: `op-${item.lineId}`,
          actorType: "DEVICE",
          deviceId,
        },
        { userId: null }
      );
    }

    const summary = await finalizeCollectorSession(prisma, {
      sessionId,
      deviceId,
      allowUncounted: false,
    });
    assert.ok(summary.divergences.length >= 1);

    const apply = await applyCollectorSessionAdjustments(prisma, {
      sessionId,
      deviceId,
      operationId: `apply-${suffix}`,
    });
    assert.ok(apply.movementsCreated >= 1 || apply.alreadyApplied);

    const itemA = await prisma.inventoryItem.findFirst({
      where: { materialId: materialIds[0], status: "ACTIVE" },
    });
    assert.ok(itemA);
    const bal = await prisma.inventoryBalance.findFirst({
      where: { itemId: itemA!.id, warehouseId },
    });
    assert.ok(bal, "ajuste cria balance via motor canônico");
    assert.equal(Number(bal!.physicalQuantity), 100);

    // Material.quantity legado NÃO foi escrito pelo collector
    const mat = await prisma.material.findUnique({ where: { id: materialIds[0] } });
    assert.equal(Number(mat!.quantity), 50);

    const diag = await diagnoseRawMaterialCollectorColdStart(prisma);
    assert.ok(diag.materialsEligibleForInventory >= 2);
  });
});

describe("Collector cold-start DB gate pending marker", { skip: !gate }, () => {
  it("reports PENDING when temporal DB URL absent", () => {
    assert.ok(Boolean(gate));
    console.log("[COLLECTOR COLD-START] REAL DB GATE = PENDING HOMOLOGATION");
  });
});
