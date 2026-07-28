/**
 * Serviço de locais / inativação segura de almoxarifados — server-only (OP-07).
 */
import type { InventoryLocation, Prisma, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import {
  assertCanDeactivateLocation,
  assertCanDeactivateWarehouse,
  assertLocationCodeNotDuplicate,
  assertNoLocationCycle,
  assertParentHierarchy,
  assertValidLocationCode,
  assertValidLocationName,
  type InventoryLocationHierarchyNode,
} from "./inventoryLocationRules.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import type { CreateInventoryLocationInput } from "./inventoryValidation.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type InventoryActor = {
  id: string;
  name?: string | null;
};

async function loadLocationActiveLinks(db: Db, locationId: string) {
  const [balanceAgg, reservationCount, blockCount, childCount, movementCount] = await Promise.all([
    db.inventoryBalance.aggregate({
      where: {
        locationId,
        OR: [
          { physicalQuantity: { gt: 0 } },
          { reservedQuantity: { gt: 0 } },
          { blockedQuantity: { gt: 0 } },
          { quarantineQuantity: { gt: 0 } },
        ],
      },
      _count: { _all: true },
    }),
    db.inventoryReservation.count({
      where: { locationId, status: "ACTIVE" },
    }),
    db.inventoryBlock.count({
      where: { locationId, status: "ACTIVE" },
    }),
    db.inventoryLocation.count({
      where: { parentLocationId: locationId, status: "ACTIVE" },
    }),
    db.inventoryMovement.count({
      where: {
        OR: [{ sourceLocationId: locationId }, { destinationLocationId: locationId }],
      },
    }),
  ]);

  return {
    hasPositiveBalance: balanceAgg._count._all > 0,
    hasActiveReservation: reservationCount > 0,
    hasActiveBlock: blockCount > 0,
    hasActiveChildren: childCount > 0,
    isReferencedByMovements: movementCount > 0,
  };
}

async function loadWarehouseActiveLinks(db: Db, warehouseId: string) {
  const [balanceAgg, reservationCount, openCount] = await Promise.all([
    db.inventoryBalance.aggregate({
      where: {
        warehouseId,
        OR: [
          { physicalQuantity: { gt: 0 } },
          { reservedQuantity: { gt: 0 } },
          { blockedQuantity: { gt: 0 } },
          { quarantineQuantity: { gt: 0 } },
        ],
      },
      _count: { _all: true },
    }),
    db.inventoryReservation.count({
      where: { warehouseId, status: "ACTIVE" },
    }),
    db.inventoryCountSession.count({
      where: {
        warehouseId,
        status: { in: ["OPEN", "COUNTING", "WAITING_APPROVAL"] },
      },
    }),
  ]);

  return {
    hasPositiveBalance: balanceAgg._count._all > 0,
    hasActiveReservation: reservationCount > 0,
    hasOpenCountSession: openCount > 0,
    hasActiveLocationsWithStock: balanceAgg._count._all > 0,
  };
}

async function ensureParent(
  db: Db,
  warehouseId: string,
  parentLocationId: string | null,
  locationId: string | null
) {
  if (!parentLocationId) return null;
  const parent = await db.inventoryLocation.findUnique({ where: { id: parentLocationId } });
  if (!parent) {
    throw new InventoryValidationError("Local pai não encontrado.", "LOCATION_PARENT_NOT_FOUND");
  }
  assertParentHierarchy(locationId, warehouseId, {
    id: parent.id,
    warehouseId: parent.warehouseId,
    parentLocationId: parent.parentLocationId,
    status: parent.status,
    code: parent.code,
    name: parent.name,
  });
  return parent;
}

async function clearOtherDefaults(
  db: Db,
  warehouseId: string,
  keepLocationId?: string | null
): Promise<void> {
  await db.inventoryLocation.updateMany({
    where: {
      warehouseId,
      isDefault: true,
      ...(keepLocationId ? { id: { not: keepLocationId } } : {}),
    },
    data: { isDefault: false },
  });
}

export async function createInventoryLocation(
  db: PrismaClient,
  warehouseId: string,
  input: CreateInventoryLocationInput,
  actor: InventoryActor
): Promise<InventoryLocation> {
  const warehouse = await db.inventoryWarehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) {
    throw new InventoryValidationError("Almoxarifado não encontrado.", "WAREHOUSE_NOT_FOUND");
  }

  const code = assertValidLocationCode(input.code);
  const name = assertValidLocationName(input.name);

  const siblings = await db.inventoryLocation.findMany({
    where: { warehouseId },
    select: { id: true, code: true },
  });
  assertLocationCodeNotDuplicate(
    code,
    siblings.map((s) => s.code)
  );

  await ensureParent(db, warehouseId, input.parentLocationId, null);

  const created = await db.$transaction(async (tx) => {
    if (input.isDefault) {
      await clearOtherDefaults(tx, warehouseId);
    }
    return tx.inventoryLocation.create({
      data: {
        warehouseId,
        code,
        name,
        status: input.status,
        locationType: input.locationType,
        isDefault: input.isDefault,
        parentLocationId: input.parentLocationId,
        aisle: input.aisle,
        shelf: input.shelf,
        position: input.position,
        notes: input.notes,
        createdByUserId: actor.id,
        updatedByUserId: actor.id,
      },
    });
  });

  await writeInventoryAuditLog(db, {
    entityType: "InventoryLocation",
    entityId: created.id,
    action: "CREATE",
    afterJson: created,
    userId: actor.id,
    userName: actor.name,
  });

  return created;
}

export async function updateInventoryLocation(
  db: PrismaClient,
  warehouseId: string,
  locationId: string,
  patch: Partial<CreateInventoryLocationInput>,
  actor: InventoryActor
): Promise<InventoryLocation> {
  const existing = await db.inventoryLocation.findFirst({
    where: { id: locationId, warehouseId },
  });
  if (!existing) {
    throw new InventoryValidationError("Local não encontrado.", "LOCATION_NOT_FOUND");
  }

  const nextCode = patch.code !== undefined ? assertValidLocationCode(patch.code) : existing.code;
  const nextName = patch.name !== undefined ? assertValidLocationName(patch.name) : existing.name;
  const nextParentId =
    patch.parentLocationId !== undefined ? patch.parentLocationId : existing.parentLocationId;

  if (patch.code !== undefined) {
    const siblings = await db.inventoryLocation.findMany({
      where: { warehouseId, id: { not: locationId } },
      select: { code: true },
    });
    assertLocationCodeNotDuplicate(
      nextCode,
      siblings.map((s) => s.code)
    );
  }

  await ensureParent(db, warehouseId, nextParentId, locationId);

  if (nextParentId) {
    const all = await db.inventoryLocation.findMany({
      where: { warehouseId },
      select: {
        id: true,
        warehouseId: true,
        parentLocationId: true,
        status: true,
        code: true,
        name: true,
      },
    });
    const map = new Map<string, InventoryLocationHierarchyNode>(
      all.map((row) => [row.id, row])
    );
    assertNoLocationCycle(locationId, nextParentId, map);
  }

  if (patch.status === "INACTIVE" && existing.status === "ACTIVE") {
    assertCanDeactivateLocation(await loadLocationActiveLinks(db, locationId));
  }

  const nextIsDefault =
    patch.isDefault !== undefined
      ? patch.isDefault
      : patch.status === "INACTIVE"
        ? false
        : existing.isDefault;

  const updated = await db.$transaction(async (tx) => {
    if (nextIsDefault) {
      await clearOtherDefaults(tx, warehouseId, locationId);
    }
    return tx.inventoryLocation.update({
      where: { id: locationId },
      data: {
        code: nextCode,
        name: nextName,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.locationType !== undefined ? { locationType: patch.locationType } : {}),
        isDefault: nextIsDefault,
        parentLocationId: nextParentId,
        ...(patch.aisle !== undefined ? { aisle: patch.aisle } : {}),
        ...(patch.shelf !== undefined ? { shelf: patch.shelf } : {}),
        ...(patch.position !== undefined ? { position: patch.position } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedByUserId: actor.id,
      },
    });
  });

  await writeInventoryAuditLog(db, {
    entityType: "InventoryLocation",
    entityId: locationId,
    action: patch.status && patch.status !== existing.status ? "STATUS_CHANGE" : "UPDATE",
    beforeJson: existing,
    afterJson: updated,
    userId: actor.id,
    userName: actor.name,
  });

  return updated;
}

export async function setInventoryLocationStatus(
  db: PrismaClient,
  warehouseId: string,
  locationId: string,
  status: "ACTIVE" | "INACTIVE",
  actor: InventoryActor
): Promise<InventoryLocation> {
  return updateInventoryLocation(db, warehouseId, locationId, { status }, actor);
}

export async function assertWarehouseCanBeDeactivated(
  db: PrismaClient,
  warehouseId: string
): Promise<void> {
  assertCanDeactivateWarehouse(await loadWarehouseActiveLinks(db, warehouseId));
}
