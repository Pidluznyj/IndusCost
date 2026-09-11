/**
 * Vínculo administrativo: InventoryItem existente → Material oficial.
 * Preserva id, ledger, reservas, bloqueios e locais. Projeta Material.quantity.
 * Não cria movimento. Não altera InventoryBalance diretamente.
 */
import type { InventoryItem, PrismaClient } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import {
  assertExistingInventoryItemCanLinkOfficialMaterial,
  buildMaterialSnapshots,
} from "./inventoryMaterialLinkRules.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import { unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";
import {
  sumCanonicalPhysicalQuantity,
  toInventoryDecimal,
  reconcileMaterialQuantityFromInventoryInTx,
} from "./materialInventoryProjection.server.js";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";

export type LinkExistingOfficialMaterialActor = {
  id: string;
  name?: string | null;
};

export type LinkExistingInventoryItemToOfficialMaterialResult = {
  item: InventoryItem;
  status: "LINKED" | "ALREADY_LINKED";
  idempotent: boolean;
  codesDiffer: boolean;
  movementsCreated: 0;
  inventoryBalanceDirectWrites: 0;
  projection: {
    before: string;
    after: string;
    changed: boolean;
    status: string;
  } | null;
};

export type ExistingItemOfficialMaterialLinkPreview = {
  item: {
    id: string;
    code: string;
    description: string;
    unit: string;
    itemType: string;
    materialId: string | null;
  };
  canonicalPhysicalQuantity: string;
  material: {
    id: string;
    code: string;
    description: string;
    unit: string;
    quantity: string;
    status: string | null;
    category: string | null;
  };
  codesDiffer: boolean;
  unitCompatible: boolean;
  alreadyLinked: boolean;
  otherActiveItemId: string | null;
};

async function canonicalPhysicalForItem(
  db: PrismaClient,
  itemId: string,
  controlsLocation: boolean
): Promise<string> {
  const balances = await db.inventoryBalance.findMany({
    where: { itemId },
    select: { locationId: true, physicalQuantity: true },
  });
  return sumCanonicalPhysicalQuantity(balances, controlsLocation === true).toString();
}

function fingerprintBalances(
  rows: Array<{
    id: string;
    physicalQuantity: unknown;
    reservedQuantity: unknown;
    blockedQuantity: unknown;
    quarantineQuantity: unknown;
    availableQuantity: unknown;
  }>
): string {
  return rows
    .map(
      (r) =>
        `${r.id}:${toInventoryDecimal(r.physicalQuantity).toString()}:${toInventoryDecimal(r.reservedQuantity).toString()}:${toInventoryDecimal(r.blockedQuantity).toString()}:${toInventoryDecimal(r.quarantineQuantity).toString()}:${toInventoryDecimal(r.availableQuantity).toString()}`
    )
    .sort()
    .join("|");
}

export async function previewExistingInventoryItemOfficialMaterialLink(
  db: PrismaClient,
  itemId: string,
  materialId: string
): Promise<ExistingItemOfficialMaterialLinkPreview> {
  const item = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }
  const providers = createOfficialDataProviders(db);
  const material = await providers.materials.findById(materialId);
  if (!material) {
    throw new InventoryValidationError(
      "Matéria-prima oficial não encontrada.",
      "OFFICIAL_MATERIAL_NOT_FOUND"
    );
  }
  const qtyRow = await db.material.findUnique({
    where: { id: materialId },
    select: { quantity: true },
  });
  const otherActive = await db.inventoryItem.findFirst({
    where: { materialId, status: "ACTIVE", id: { not: itemId } },
    select: { id: true },
  });
  const canonicalPhysicalQuantity = await canonicalPhysicalForItem(
    db,
    item.id,
    item.controlsLocation === true
  );
  return {
    item: {
      id: item.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
      itemType: item.itemType,
      materialId: item.materialId,
    },
    canonicalPhysicalQuantity,
    material: {
      id: material.id,
      code: material.code,
      description: material.description,
      unit: material.unit,
      quantity: toInventoryDecimal(qtyRow?.quantity ?? 0).toString(),
      status: material.status,
      category: material.category,
    },
    codesDiffer: item.code.trim() !== material.code.trim(),
    unitCompatible: unitsCompatible(item.unit, material.unit),
    alreadyLinked: item.materialId === material.id,
    otherActiveItemId: otherActive?.id ?? null,
  };
}

export async function linkExistingInventoryItemToOfficialMaterial(
  db: PrismaClient,
  itemId: string,
  materialId: string,
  actor: LinkExistingOfficialMaterialActor
): Promise<LinkExistingInventoryItemToOfficialMaterialResult> {
  const existing = await db.inventoryItem.findUnique({ where: { id: itemId } });
  if (!existing) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }

  const providers = createOfficialDataProviders(db);
  const material = await providers.materials.findById(materialId);

  const otherActive = await db.inventoryItem.findFirst({
    where: { materialId, status: "ACTIVE", id: { not: itemId } },
    select: { id: true },
  });

  const decision = assertExistingInventoryItemCanLinkOfficialMaterial(
    existing,
    material,
    otherActive?.id ?? null
  );
  const snapshots = buildMaterialSnapshots(decision.official);
  const codesDiffer = existing.code.trim() !== snapshots.code;

  if (decision.idempotent) {
    return {
      item: existing,
      status: "ALREADY_LINKED",
      idempotent: true,
      codesDiffer,
      movementsCreated: 0,
      inventoryBalanceDirectWrites: 0,
      projection: null,
    };
  }

  return db.$transaction(async (tx) => {
    if (typeof tx.$queryRaw === "function") {
      await tx.$queryRaw`SELECT 1 FROM "InventoryBalance" WHERE "itemId" = ${itemId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT 1 FROM "InventoryItem" WHERE id = ${itemId}::uuid FOR UPDATE`;
    }

    const locked = await tx.inventoryItem.findUnique({ where: { id: itemId } });
    if (!locked) {
      throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
    }

    const otherActiveInTx = await tx.inventoryItem.findFirst({
      where: { materialId, status: "ACTIVE", id: { not: itemId } },
      select: { id: true },
    });
    const lockedDecision = assertExistingInventoryItemCanLinkOfficialMaterial(
      locked,
      material,
      otherActiveInTx?.id ?? null
    );
    if (lockedDecision.idempotent) {
      return {
        item: locked,
        status: "ALREADY_LINKED" as const,
        idempotent: true,
        codesDiffer: locked.code.trim() !== snapshots.code,
        movementsCreated: 0 as const,
        inventoryBalanceDirectWrites: 0 as const,
        projection: null,
      };
    }

    const movementCountBefore = await tx.inventoryMovement.count({ where: { itemId } });
    const balancesBefore = await tx.inventoryBalance.findMany({
      where: { itemId },
      select: {
        id: true,
        physicalQuantity: true,
        reservedQuantity: true,
        blockedQuantity: true,
        quarantineQuantity: true,
        availableQuantity: true,
      },
    });

    const item = await tx.inventoryItem.update({
      where: { id: itemId },
      data: {
        materialId: snapshots.materialId,
        materialCodeSnapshot: snapshots.materialCodeSnapshot,
        materialDescriptionSnapshot: snapshots.materialDescriptionSnapshot,
        materialUnitSnapshot: snapshots.materialUnitSnapshot,
        materialCategorySnapshot: snapshots.materialCategorySnapshot,
        updatedByUserId: actor.id,
      },
    });

    const projection = await reconcileMaterialQuantityFromInventoryInTx(tx, snapshots.materialId, {
      source: "RECONCILE",
      userId: actor.id,
      reason: "Projeção após vínculo de InventoryItem existente à MP oficial",
    });

    const movementCountAfter = await tx.inventoryMovement.count({ where: { itemId } });
    if (movementCountAfter !== movementCountBefore) {
      throw new InventoryValidationError(
        "Vínculo não pode criar movimentação de estoque.",
        "LINK_MUST_NOT_CREATE_MOVEMENT"
      );
    }
    const balancesAfter = await tx.inventoryBalance.findMany({
      where: { itemId },
      select: {
        id: true,
        physicalQuantity: true,
        reservedQuantity: true,
        blockedQuantity: true,
        quarantineQuantity: true,
        availableQuantity: true,
      },
    });
    if (fingerprintBalances(balancesBefore) !== fingerprintBalances(balancesAfter)) {
      throw new InventoryValidationError(
        "Vínculo não pode alterar InventoryBalance diretamente.",
        "LINK_MUST_NOT_WRITE_BALANCE"
      );
    }

    await writeInventoryAuditLogInTx(tx, {
      entityType: "InventoryItem",
      entityId: itemId,
      action: "LINK_EXISTING_ITEM_TO_OFFICIAL_MATERIAL",
      beforeJson: {
        itemId,
        materialId: locked.materialId,
        materialCodeSnapshot: locked.materialCodeSnapshot,
        code: locked.code,
        unit: locked.unit,
      },
      afterJson: {
        itemId,
        materialId: item.materialId,
        materialCodeSnapshot: item.materialCodeSnapshot,
        code: item.code,
        unit: item.unit,
        codesDiffer: item.code.trim() !== snapshots.code,
        projectionStatus: projection?.status ?? null,
        movementsCreated: 0,
        inventoryBalanceDirectWrites: 0,
      },
      userId: actor.id,
      userName: actor.name,
      reason: "Vínculo administrativo de item existente à matéria-prima oficial",
    });

    return {
      item,
      status: "LINKED" as const,
      idempotent: false,
      codesDiffer: item.code.trim() !== snapshots.code,
      movementsCreated: 0 as const,
      inventoryBalanceDirectWrites: 0 as const,
      projection: projection
        ? {
            before: projection.before.toString(),
            after: projection.after.toString(),
            changed: projection.changed,
            status: projection.status,
          }
        : null,
    };
  });
}
