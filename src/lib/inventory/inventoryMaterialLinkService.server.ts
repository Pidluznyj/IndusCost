/**
 * Ativação de matéria-prima oficial como item controlado pelo estoque (OP-08).
 * Lê MP apenas via createOfficialDataProviders — nunca escreve em Material.
 */
import type { InventoryItem, PrismaClient } from "@prisma/client";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import {
  assertDefaultLocationBelongsToWarehouse,
  assertNoActiveMaterialDuplicate,
  assertOfficialMaterialEligibleForStock,
  buildMaterialSnapshots,
  type LinkOfficialMaterialInput,
} from "./inventoryMaterialLinkRules.js";
import { InventoryValidationError } from "./inventoryTypes.js";

export type InventoryMaterialLinkActor = {
  id: string;
  name?: string | null;
};

function decimalOrNull(value: number | null | undefined) {
  if (value == null) return null;
  return value;
}

async function resolveDefaultScope(
  db: PrismaClient,
  input: Pick<LinkOfficialMaterialInput, "defaultWarehouseId" | "defaultLocationId">
): Promise<{ defaultWarehouseId: string | null; defaultLocationId: string | null }> {
  let defaultWarehouseId = input.defaultWarehouseId;
  let defaultLocationId = input.defaultLocationId;
  let locationWarehouseId: string | null = null;

  if (defaultLocationId) {
    const loc = await db.inventoryLocation.findUnique({
      where: { id: defaultLocationId },
      select: { id: true, warehouseId: true, status: true },
    });
    if (!loc) {
      throw new InventoryValidationError("Local padrão não encontrado.", "LOCATION_NOT_FOUND");
    }
    if (loc.status !== "ACTIVE") {
      throw new InventoryValidationError("Local padrão precisa estar ativo.", "LOCATION_INACTIVE");
    }
    locationWarehouseId = loc.warehouseId;
    if (!defaultWarehouseId) {
      defaultWarehouseId = loc.warehouseId;
    }
  }

  if (defaultWarehouseId) {
    const wh = await db.inventoryWarehouse.findUnique({
      where: { id: defaultWarehouseId },
      select: { id: true, status: true },
    });
    if (!wh) {
      throw new InventoryValidationError("Almoxarifado padrão não encontrado.", "WAREHOUSE_NOT_FOUND");
    }
    if (wh.status !== "ACTIVE") {
      throw new InventoryValidationError(
        "Almoxarifado padrão precisa estar ativo.",
        "WAREHOUSE_INACTIVE"
      );
    }
  }

  assertDefaultLocationBelongsToWarehouse(
    locationWarehouseId,
    defaultWarehouseId,
    Boolean(defaultLocationId)
  );

  return { defaultWarehouseId, defaultLocationId };
}

export async function searchOfficialMaterialsForInventory(
  db: PrismaClient,
  query: { q?: string; limit?: number }
) {
  const providers = createOfficialDataProviders(db);
  return providers.materials.list({
    q: query.q,
    limit: query.limit ?? 30,
    activeOnly: true,
  });
}

export async function linkOfficialMaterialToStockControl(
  db: PrismaClient,
  input: LinkOfficialMaterialInput,
  actor: InventoryMaterialLinkActor
): Promise<InventoryItem> {
  const providers = createOfficialDataProviders(db);
  const material = assertOfficialMaterialEligibleForStock(
    await providers.materials.findById(input.materialId)
  );
  const snapshots = buildMaterialSnapshots(material);

  const scope = await resolveDefaultScope(db, input);

  const existingActive = await db.inventoryItem.findFirst({
    where: { materialId: material.id, status: "ACTIVE" },
    select: { id: true },
  });
  assertNoActiveMaterialDuplicate(existingActive?.id);

  const inactiveSame = await db.inventoryItem.findFirst({
    where: { materialId: material.id, status: "INACTIVE" },
    orderBy: { updatedAt: "desc" },
  });

  const codeTaken = await db.inventoryItem.findFirst({
    where: {
      code: { equals: snapshots.code, mode: "insensitive" },
      ...(inactiveSame ? { id: { not: inactiveSame.id } } : {}),
      OR: [{ materialId: null }, { materialId: { not: material.id } }],
    },
    select: { id: true },
  });
  if (codeTaken) {
    throw new InventoryValidationError(
      `Já existe item de estoque com o código ${snapshots.code} sem vínculo a esta MP.`,
      "INVENTORY_CODE_CONFLICT"
    );
  }

  const data = {
    code: snapshots.code,
    description: snapshots.description,
    itemType: "RAW_MATERIAL" as const,
    unit: snapshots.unit,
    status: input.status,
    family: snapshots.materialCategorySnapshot,
    group: null as string | null,
    controlsLot: input.controlsLot,
    controlsExpiration: false,
    controlsLocation: Boolean(scope.defaultLocationId),
    controlsQuality: false,
    controlsStock: input.controlsStock,
    allowsReservation: input.allowsReservation,
    allowsBlock: input.allowsBlock,
    minimumStock: decimalOrNull(input.minimumStock),
    safetyStock: decimalOrNull(input.safetyStock),
    maximumStock: null as number | null,
    reorderPoint: decimalOrNull(input.safetyStock),
    materialId: snapshots.materialId,
    materialCodeSnapshot: snapshots.materialCodeSnapshot,
    materialDescriptionSnapshot: snapshots.materialDescriptionSnapshot,
    materialUnitSnapshot: snapshots.materialUnitSnapshot,
    materialCategorySnapshot: snapshots.materialCategorySnapshot,
    defaultWarehouseId: scope.defaultWarehouseId,
    defaultLocationId: scope.defaultLocationId,
    notes: input.notes,
    updatedByUserId: actor.id,
  };

  const item = inactiveSame
    ? await db.inventoryItem.update({
        where: { id: inactiveSame.id },
        data: {
          ...data,
          preferredSupplierName: inactiveSame.preferredSupplierName,
        },
      })
    : await db.inventoryItem.create({
        data: {
          ...data,
          createdByUserId: actor.id,
        },
      });

  await writeInventoryAuditLog(db, {
    entityType: "InventoryItem",
    entityId: item.id,
    action: inactiveSame ? "RELINK_OFFICIAL_MATERIAL" : "LINK_OFFICIAL_MATERIAL",
    afterJson: {
      materialId: item.materialId,
      materialCodeSnapshot: item.materialCodeSnapshot,
      defaultWarehouseId: item.defaultWarehouseId,
      defaultLocationId: item.defaultLocationId,
      controlsStock: item.controlsStock,
    },
    userId: actor.id,
    userName: actor.name,
  });

  return item;
}

export async function updateOfficialMaterialStockLink(
  db: PrismaClient,
  itemId: string,
  patch: Partial<Omit<LinkOfficialMaterialInput, "materialId">>,
  actor: InventoryMaterialLinkActor
): Promise<InventoryItem> {
  const existing = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }
  if (!existing.materialId) {
    throw new InventoryValidationError(
      "Item sem vínculo a matéria-prima oficial.",
      "ITEM_NOT_MATERIAL_LINKED"
    );
  }

  const nextWarehouse =
    patch.defaultWarehouseId !== undefined ? patch.defaultWarehouseId : existing.defaultWarehouseId;
  const nextLocation =
    patch.defaultLocationId !== undefined ? patch.defaultLocationId : existing.defaultLocationId;

  const scope = await resolveDefaultScope(db, {
    defaultWarehouseId: nextWarehouse,
    defaultLocationId: nextLocation,
  });

  if (patch.status === "ACTIVE" && existing.status !== "ACTIVE") {
    const otherActive = await db.inventoryItem.findFirst({
      where: {
        materialId: existing.materialId,
        status: "ACTIVE",
        id: { not: itemId },
      },
      select: { id: true },
    });
    assertNoActiveMaterialDuplicate(otherActive?.id);
  }

  // Atualiza snapshots a partir do oficial (leitura) — não edita Material.
  const providers = createOfficialDataProviders(db);
  const material = assertOfficialMaterialEligibleForStock(
    await providers.materials.findById(existing.materialId)
  );
  const snapshots = buildMaterialSnapshots(material);

  const updated = await db.inventoryItem.update({
    where: { id: itemId },
    data: {
      description: snapshots.description,
      unit: snapshots.unit,
      family: snapshots.materialCategorySnapshot,
      materialCodeSnapshot: snapshots.materialCodeSnapshot,
      materialDescriptionSnapshot: snapshots.materialDescriptionSnapshot,
      materialUnitSnapshot: snapshots.materialUnitSnapshot,
      materialCategorySnapshot: snapshots.materialCategorySnapshot,
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.controlsStock !== undefined ? { controlsStock: patch.controlsStock } : {}),
      ...(patch.controlsLot !== undefined ? { controlsLot: patch.controlsLot } : {}),
      ...(patch.allowsReservation !== undefined
        ? { allowsReservation: patch.allowsReservation }
        : {}),
      ...(patch.allowsBlock !== undefined ? { allowsBlock: patch.allowsBlock } : {}),
      ...(patch.minimumStock !== undefined ? { minimumStock: patch.minimumStock } : {}),
      ...(patch.safetyStock !== undefined
        ? { safetyStock: patch.safetyStock, reorderPoint: patch.safetyStock }
        : {}),
      defaultWarehouseId: scope.defaultWarehouseId,
      defaultLocationId: scope.defaultLocationId,
      controlsLocation: Boolean(scope.defaultLocationId),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      updatedByUserId: actor.id,
    },
  });

  await writeInventoryAuditLog(db, {
    entityType: "InventoryItem",
    entityId: itemId,
    action: "UPDATE_MATERIAL_LINK",
    beforeJson: {
      materialId: existing.materialId,
      status: existing.status,
      defaultWarehouseId: existing.defaultWarehouseId,
    },
    afterJson: {
      materialId: updated.materialId,
      status: updated.status,
      defaultWarehouseId: updated.defaultWarehouseId,
    },
    userId: actor.id,
    userName: actor.name,
  });

  return updated;
}
