/**
 * Serviço server-only de movimentações de estoque.
 * Saldo nunca é editado diretamente — apenas via createInventoryMovement.
 */
import { Prisma, type InventoryMovementType, type PrismaClient } from "@prisma/client";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import {
  applyMovementToBalance,
  applyTransferDestinationImpact,
} from "./inventoryBalanceMath.js";
import { validateMovementRequest } from "./inventoryMovementRules.js";
import {
  decimalQuantity,
  getOrCreateInventoryBalanceForUpdate,
  mapBalanceRowToSnapshot,
  persistInventoryBalanceSnapshot,
  type InventoryTx,
} from "./inventoryRepository.server.js";
import {
  InventoryValidationError,
  type InventoryBalanceSnapshot,
  type InventoryItemType,
} from "./inventoryTypes.js";

export type CreateInventoryMovementInput = {
  itemId: string;
  sourceWarehouseId?: string | null;
  destinationWarehouseId?: string | null;
  sourceLocationId?: string | null;
  destinationLocationId?: string | null;
  movementType: InventoryMovementType;
  quantity: number;
  unit: string;
  reason: string;
  notes?: string | null;
  documentNumber?: string | null;
  costCenterId?: string | null;
  financialCostCenterId?: string | null;
  originType?: "MANUAL" | "PURCHASE" | "SALES_ORDER" | "PRODUCTION_ORDER" | "COUNT_SESSION" | "REVERSAL" | "INTEGRATION" | "OTHER";
  originId?: string | null;
  responsibleUserId?: string | null;
  movementDate?: Date;
  purchaseOrderId?: string | null;
  salesOrderId?: string | null;
  productionOrderId?: string | null;
};

export type CreateInventoryMovementContext = {
  userId: string;
  permissions?: readonly string[];
  allowNegativeStock?: boolean;
  requestId?: string;
};

const ENTRY_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PRODUCTION_ENTRY",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
]);

const SOURCE_WAREHOUSE_TYPES = new Set<InventoryMovementType>([
  "MANUAL_EXIT",
  "REQUISITION_EXIT",
  "PRODUCTION_EXIT",
  "LOSS",
  "SCRAP",
  "NEGATIVE_ADJUSTMENT",
  "TRANSFER",
  "BLOCK",
  "UNBLOCK",
  "RESERVE",
  "CANCEL_RESERVATION",
]);

function hasPermission(context: CreateInventoryMovementContext, key: string): boolean {
  return context.permissions?.includes(key) ?? false;
}

function resolveAllowNegative(context: CreateInventoryMovementContext): boolean {
  return (
    context.allowNegativeStock === true ||
    hasPermission(context, "inventory.movements.override")
  );
}

async function assertActiveItem(tx: InventoryTx, itemId: string) {
  const item = await tx.inventoryItem.findUnique({
    where: { id: itemId },
    select: { id: true, status: true, itemType: true, unit: true },
  });
  if (!item) throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  if (item.status !== "ACTIVE") {
    throw new InventoryValidationError("Item de estoque inativo.", "ITEM_INACTIVE");
  }
  return item;
}

async function assertActiveWarehouse(tx: InventoryTx, warehouseId: string, label: string) {
  const wh = await tx.inventoryWarehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, status: true, allowsMovements: true },
  });
  if (!wh) throw new InventoryValidationError(`${label} não encontrado.`, "WAREHOUSE_NOT_FOUND");
  if (wh.status !== "ACTIVE") {
    throw new InventoryValidationError(`${label} inativo.`, "WAREHOUSE_INACTIVE");
  }
  if (!wh.allowsMovements) {
    throw new InventoryValidationError(`${label} não permite movimentações.`, "WAREHOUSE_LOCKED");
  }
  return wh;
}

function movementBalanceSnapshots(before: InventoryBalanceSnapshot, after: InventoryBalanceSnapshot) {
  return {
    previousPhysicalBalance: before.physicalQuantity,
    nextPhysicalBalance: after.physicalQuantity,
    previousReservedBalance: before.reservedQuantity,
    nextReservedBalance: after.reservedQuantity,
    previousBlockedBalance: before.blockedQuantity,
    nextBlockedBalance: after.blockedQuantity,
    previousQuarantineBalance: before.quarantineQuantity,
    nextQuarantineBalance: after.quarantineQuantity,
    previousAvailableBalance: before.availableQuantity,
    nextAvailableBalance: after.availableQuantity,
  };
}

async function createMovementRecord(
  tx: InventoryTx,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext,
  before: InventoryBalanceSnapshot,
  after: InventoryBalanceSnapshot,
  extra?: { reservationId?: string | null }
) {
  const movementDate = input.movementDate ?? new Date();
  const snapshots = movementBalanceSnapshots(before, after);

  return tx.inventoryMovement.create({
    data: {
      itemId: input.itemId,
      sourceWarehouseId: input.sourceWarehouseId ?? null,
      destinationWarehouseId: input.destinationWarehouseId ?? null,
      sourceLocationId: input.sourceLocationId ?? null,
      destinationLocationId: input.destinationLocationId ?? null,
      movementType: input.movementType,
      quantity: decimalQuantity(input.quantity),
      unit: input.unit,
      reason: input.reason.trim(),
      notes: input.notes?.trim() || null,
      responsibleUserId: input.responsibleUserId ?? context.userId,
      movementDate,
      originType: input.originType ?? "MANUAL",
      originId: input.originId ?? null,
      documentNumber: input.documentNumber?.trim() || null,
      costCenterId: input.costCenterId ?? null,
      financialCostCenterId: input.financialCostCenterId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      salesOrderId: input.salesOrderId ?? null,
      productionOrderId: input.productionOrderId ?? null,
      reservationId: extra?.reservationId ?? null,
      ...snapshots,
      previousPhysicalBalance: decimalQuantity(snapshots.previousPhysicalBalance),
      nextPhysicalBalance: decimalQuantity(snapshots.nextPhysicalBalance),
      previousReservedBalance: decimalQuantity(snapshots.previousReservedBalance),
      nextReservedBalance: decimalQuantity(snapshots.nextReservedBalance),
      previousBlockedBalance: decimalQuantity(snapshots.previousBlockedBalance),
      nextBlockedBalance: decimalQuantity(snapshots.nextBlockedBalance),
      previousQuarantineBalance: decimalQuantity(snapshots.previousQuarantineBalance),
      nextQuarantineBalance: decimalQuantity(snapshots.nextQuarantineBalance),
      previousAvailableBalance: decimalQuantity(snapshots.previousAvailableBalance),
      nextAvailableBalance: decimalQuantity(snapshots.nextAvailableBalance),
    },
  });
}

async function executeSimpleMovement(
  tx: InventoryTx,
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext,
  itemType: InventoryItemType,
  warehouseId: string,
  locationId?: string | null
) {
  const movementDate = input.movementDate ?? new Date();
  const balanceRow = await getOrCreateInventoryBalanceForUpdate(
    tx,
    input.itemId,
    warehouseId,
    locationId
  );
  const before = mapBalanceRowToSnapshot(balanceRow);

  const after = validateMovementRequest(
    before,
    {
      movementType: input.movementType,
      quantity: input.quantity,
      reason: input.reason,
      costCenterId: input.costCenterId,
      itemType,
      sourceWarehouseId: input.sourceWarehouseId,
      destinationWarehouseId: input.destinationWarehouseId,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
    },
    { allowNegativeStock: resolveAllowNegative(context) }
  );

  await persistInventoryBalanceSnapshot(tx, balanceRow.id, after, movementDate);

  let reservationId: string | null = null;
  if (input.movementType === "RESERVE") {
    const reservation = await tx.inventoryReservation.create({
      data: {
        itemId: input.itemId,
        warehouseId,
        locationId: locationId ?? null,
        quantity: decimalQuantity(input.quantity),
        reservationType: "MANUAL",
        status: "ACTIVE",
        reason: input.reason.trim(),
        originType: input.originType ?? "MANUAL",
        originId: input.originId ?? null,
        createdByUserId: context.userId,
        notes: input.notes?.trim() || null,
      },
    });
    reservationId = reservation.id;
  }

  const movement = await createMovementRecord(tx, input, context, before, after, {
    reservationId,
  });

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryMovement",
    entityId: movement.id,
    action: input.movementType,
    beforeJson: before,
    afterJson: after,
    userId: context.userId,
    reason: input.reason,
  });

  return { movement, balance: after, reservationId };
}

async function executeTransfer(
  tx: InventoryTx,
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext,
  itemType: InventoryItemType
) {
  const sourceWh = input.sourceWarehouseId!;
  const destWh = input.destinationWarehouseId!;
  const movementDate = input.movementDate ?? new Date();

  const sourceRow = await getOrCreateInventoryBalanceForUpdate(
    tx,
    input.itemId,
    sourceWh,
    input.sourceLocationId
  );
  const beforeSource = mapBalanceRowToSnapshot(sourceRow);

  const afterSource = validateMovementRequest(
    beforeSource,
    {
      movementType: "TRANSFER",
      quantity: input.quantity,
      reason: input.reason,
      itemType,
      sourceWarehouseId: sourceWh,
      destinationWarehouseId: destWh,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
    },
    { allowNegativeStock: resolveAllowNegative(context) }
  );

  await persistInventoryBalanceSnapshot(tx, sourceRow.id, afterSource, movementDate);

  const destRow = await getOrCreateInventoryBalanceForUpdate(
    tx,
    input.itemId,
    destWh,
    input.destinationLocationId
  );
  const beforeDest = mapBalanceRowToSnapshot(destRow);
  const afterDest = applyTransferDestinationImpact(beforeDest, input.quantity);
  await persistInventoryBalanceSnapshot(tx, destRow.id, afterDest, movementDate);

  const movement = await createMovementRecord(tx, input, context, beforeSource, afterSource);

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryMovement",
    entityId: movement.id,
    action: "TRANSFER",
    beforeJson: { source: beforeSource, destination: beforeDest },
    afterJson: { source: afterSource, destination: afterDest },
    userId: context.userId,
    reason: input.reason,
  });

  return {
    movement,
    sourceBalance: afterSource,
    destinationBalance: afterDest,
  };
}

export async function createInventoryMovement(
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext
) {
  if (!input.reason?.trim()) {
    throw new InventoryValidationError("Motivo é obrigatório.", "REASON_REQUIRED");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new InventoryValidationError("Quantidade inválida.", "INVALID_QUANTITY");
  }

  return prisma.$transaction(async (tx) => {
    const item = await assertActiveItem(tx, input.itemId);

    if (ENTRY_TYPES.has(input.movementType)) {
      const wh = input.destinationWarehouseId ?? input.sourceWarehouseId;
      if (!wh) throw new InventoryValidationError("Almoxarifado de destino é obrigatório.", "WAREHOUSE_REQUIRED");
      await assertActiveWarehouse(tx, wh, "Almoxarifado de destino");
      return executeSimpleMovement(
        tx,
        prisma,
        { ...input, destinationWarehouseId: wh },
        context,
        item.itemType,
        wh,
        input.destinationLocationId ?? input.sourceLocationId
      );
    }

    if (input.movementType === "TRANSFER") {
      if (!input.sourceWarehouseId || !input.destinationWarehouseId) {
        throw new InventoryValidationError("Transferência exige origem e destino.", "TRANSFER_WAREHOUSE");
      }
      await assertActiveWarehouse(tx, input.sourceWarehouseId, "Almoxarifado de origem");
      await assertActiveWarehouse(tx, input.destinationWarehouseId, "Almoxarifado de destino");
      return executeTransfer(tx, prisma, input, context, item.itemType);
    }

    if (SOURCE_WAREHOUSE_TYPES.has(input.movementType)) {
      const wh = input.sourceWarehouseId ?? input.destinationWarehouseId;
      if (!wh) throw new InventoryValidationError("Almoxarifado de origem é obrigatório.", "WAREHOUSE_REQUIRED");
      await assertActiveWarehouse(tx, wh, "Almoxarifado de origem");
      return executeSimpleMovement(
        tx,
        prisma,
        { ...input, sourceWarehouseId: wh },
        context,
        item.itemType,
        wh,
        input.sourceLocationId ?? input.destinationLocationId
      );
    }

    throw new InventoryValidationError(`Tipo de movimento não suportado: ${input.movementType}.`);
  });
}

/** Cancela reserva ativa e registra movimento CANCEL_RESERVATION. */
export async function cancelInventoryReservation(
  prisma: PrismaClient,
  reservationId: string,
  context: CreateInventoryMovementContext,
  reason: string
) {
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.inventoryReservation.findUnique({ where: { id: reservationId } });
    if (!reservation) {
      throw new InventoryValidationError("Reserva não encontrada.", "RESERVATION_NOT_FOUND");
    }
    if (reservation.status !== "ACTIVE") {
      throw new InventoryValidationError("Reserva não está ativa.", "RESERVATION_NOT_ACTIVE");
    }

    const item = await assertActiveItem(tx, reservation.itemId);
    await assertActiveWarehouse(tx, reservation.warehouseId, "Almoxarifado");

    const qty = Number(reservation.quantity);
    const result = await executeSimpleMovement(
      tx,
      prisma,
      {
        itemId: reservation.itemId,
        sourceWarehouseId: reservation.warehouseId,
        sourceLocationId: reservation.locationId,
        movementType: "CANCEL_RESERVATION",
        quantity: qty,
        unit: item.unit,
        reason,
        originType: "MANUAL",
        originId: reservationId,
      },
      context,
      item.itemType,
      reservation.warehouseId,
      reservation.locationId
    );

    await tx.inventoryReservation.update({
      where: { id: reservationId },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledByUserId: context.userId,
      },
    });

    return result;
  });
}
