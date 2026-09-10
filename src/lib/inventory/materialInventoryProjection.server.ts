/**
 * Projeção canônica Material.quantity ← InventoryBalance.physicalQuantity.
 *
 * InventoryMovement / InventoryBalance continuam a fonte oficial.
 * Material.quantity é espelho de compatibilidade (Suprimentos/Planejamento).
 *
 * Lock: SEMPRE depois dos locks de InventoryBalance do ledger.
 * Nunca inverter (Material → Balance) — deadlock com createInventoryMovement.
 */
import { Prisma } from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import { selectCanonicalPhysicalBalanceRows } from "./materialInventoryProjection.js";
import { enqueueMaterialStockSpreadsheetMirrorBestEffort } from "../materialStockSpreadsheetMirror/enqueue.server.js";

export const MATERIAL_QUANTITY_PROJECTED = "INVENTORY_QUANTITY_PROJECTED";

export type MaterialQuantityProjectionSource =
  | "INVENTORY_MOVEMENT"
  | "COUNT_SESSION"
  | "REVERSAL"
  | "RECONCILE";

export type MaterialQuantityProjectionContext = {
  source: MaterialQuantityProjectionSource;
  movementId?: string | null;
  countSessionId?: string | null;
  userId?: string | null;
  reason?: string | null;
};

export type MaterialQuantityProjectionResult = {
  materialId: string;
  inventoryItemId: string | null;
  before: Prisma.Decimal;
  after: Prisma.Decimal;
  changed: boolean;
  status:
    | "PROJECTED"
    | "UNCHANGED"
    | "NO_INVENTORY_LINK"
    | "MULTIPLE_ACTIVE_LINKS"
    | "MATERIAL_NOT_FOUND";
};

type ProjectionTx = {
  $queryRaw?: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
  material: {
    findUnique: (args: {
      where: { id: string };
      select?: Record<string, boolean>;
    }) => Promise<{
      id: string;
      quantity: unknown;
      unit?: string | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { quantity: Prisma.Decimal };
      select?: Record<string, boolean>;
    }) => Promise<{ id: string; quantity: unknown }>;
  };
  inventoryItem: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<
      Array<{
        id: string;
        materialId: string | null;
        unit: string;
        status: string;
        controlsLocation: boolean;
      }>
    >;
  };
  inventoryBalance: {
    findMany: (args: {
      where: Record<string, unknown>;
      select?: Record<string, boolean>;
    }) => Promise<Array<{ locationId: string | null; physicalQuantity: unknown }>>;
  };
  inventoryAuditLog?: {
    create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  };
};

export function toInventoryDecimal(value: unknown): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (value == null || value === "") return new Prisma.Decimal(0);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return new Prisma.Decimal(0);
    return new Prisma.Decimal(value.toString());
  }
  return new Prisma.Decimal(String(value));
}

export function sumCanonicalPhysicalQuantity(
  rows: readonly { locationId?: string | null; physicalQuantity: unknown }[],
  controlsLocation: boolean
): Prisma.Decimal {
  const selected = selectCanonicalPhysicalBalanceRows(rows, controlsLocation);
  let total = new Prisma.Decimal(0);
  for (const row of selected) {
    total = total.add(toInventoryDecimal(row.physicalQuantity));
  }
  return total;
}

function canProject(tx: unknown): tx is ProjectionTx {
  const candidate = tx as Partial<ProjectionTx> | null;
  return (
    typeof candidate?.material?.findUnique === "function" &&
    typeof candidate?.material?.update === "function" &&
    typeof candidate?.inventoryItem?.findMany === "function" &&
    typeof candidate?.inventoryBalance?.findMany === "function"
  );
}

async function lockMaterialForUpdate(tx: ProjectionTx, materialId: string): Promise<void> {
  if (typeof tx.$queryRaw !== "function") return;
  await tx.$queryRaw`SELECT 1 FROM "Material" WHERE id = ${materialId}::uuid FOR UPDATE`;
}

/**
 * Recalcula Material.quantity a partir do saldo físico canônico agregado
 * do InventoryItem ACTIVE vinculado por materialId.
 */
export async function reconcileMaterialQuantityFromInventoryInTx(
  tx: unknown,
  materialId: string,
  context?: MaterialQuantityProjectionContext
): Promise<MaterialQuantityProjectionResult | null> {
  if (!materialId?.trim() || !canProject(tx)) return null;

  await lockMaterialForUpdate(tx, materialId);

  const material = await tx.material.findUnique({
    where: { id: materialId },
    select: { id: true, quantity: true, unit: true },
  });
  if (!material) {
    return {
      materialId,
      inventoryItemId: null,
      before: new Prisma.Decimal(0),
      after: new Prisma.Decimal(0),
      changed: false,
      status: "MATERIAL_NOT_FOUND",
    };
  }

  const before = toInventoryDecimal(material.quantity);

  const items = await tx.inventoryItem.findMany({
    where: { materialId, status: "ACTIVE" },
    select: {
      id: true,
      materialId: true,
      unit: true,
      status: true,
      controlsLocation: true,
    },
  });

  if (items.length === 0) {
    return {
      materialId,
      inventoryItemId: null,
      before,
      after: before,
      changed: false,
      status: "NO_INVENTORY_LINK",
    };
  }

  if (items.length > 1) {
    return {
      materialId,
      inventoryItemId: null,
      before,
      after: before,
      changed: false,
      status: "MULTIPLE_ACTIVE_LINKS",
    };
  }

  const item = items[0]!;
  const balances = await tx.inventoryBalance.findMany({
    where: { itemId: item.id },
    select: { locationId: true, physicalQuantity: true },
  });

  const canonical = sumCanonicalPhysicalQuantity(balances, item.controlsLocation === true);

  if (canonical.eq(before)) {
    return {
      materialId,
      inventoryItemId: item.id,
      before,
      after: before,
      changed: false,
      status: "UNCHANGED",
    };
  }

  await tx.material.update({
    where: { id: materialId },
    data: { quantity: canonical },
    select: { id: true, quantity: true },
  });

  if (typeof tx.inventoryAuditLog?.create === "function") {
    await writeInventoryAuditLogInTx(tx, {
      entityType: "Material",
      entityId: materialId,
      action: MATERIAL_QUANTITY_PROJECTED,
      beforeJson: { quantity: before.toString() },
      afterJson: {
        quantity: canonical.toString(),
        inventoryItemId: item.id,
        source: context?.source ?? "RECONCILE",
        movementId: context?.movementId ?? null,
        countSessionId: context?.countSessionId ?? null,
      },
      userId: context?.userId ?? null,
      reason: context?.reason ?? "Projeção do saldo físico oficial do Inventory",
    });
  }

  if (
    tx &&
    typeof tx === "object" &&
    "materialStockSpreadsheetOutbox" in tx
  ) {
    await enqueueMaterialStockSpreadsheetMirrorBestEffort(tx, {
      materialId,
      eventType: "MATERIAL_MASTER",
    });
  }

  return {
    materialId,
    inventoryItemId: item.id,
    before,
    after: canonical,
    changed: true,
    status: "PROJECTED",
  };
}

export async function reconcileMaterialQuantitiesFromInventoryInTx(
  tx: unknown,
  materialIds: readonly string[],
  context?: MaterialQuantityProjectionContext
): Promise<MaterialQuantityProjectionResult[]> {
  const unique = [
    ...new Set(materialIds.filter((id) => typeof id === "string" && id.trim().length > 0)),
  ].sort((a, b) => a.localeCompare(b));
  const results: MaterialQuantityProjectionResult[] = [];
  for (const id of unique) {
    const result = await reconcileMaterialQuantityFromInventoryInTx(tx, id, context);
    if (result) results.push(result);
  }
  return results;
}
