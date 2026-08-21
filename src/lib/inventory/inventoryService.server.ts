/**
 * Serviço server-only de movimentações de estoque (OP-09).
 * Ledger imutável: saldo só muda via createInventoryMovement / reverseInventoryMovement.
 * Correção = estorno (REVERSAL) vinculado; sem update/delete de fato confirmado.
 */
import {
  Prisma,
  type InventoryMovement,
  type InventoryMovementType,
  type PrismaClient,
} from "@prisma/client";
import { writeInventoryAuditLog } from "./inventoryAudit.server.js";
import {
  applyMovementImpactToBalance,
  applyMovementToBalance,
  applyTransferDestinationImpact,
  assertBalanceFormula,
  resolveReversalImpact,
} from "./inventoryBalanceMath.js";
import { inventoryBalanceLockKey } from "./inventoryLedgerConcurrency.js";
import { validateMovementRequest } from "./inventoryMovementRules.js";
import { assertInventoryMovementPermission } from "./inventoryPermissionChecks.js";
import {
  decimalOrNull,
  decimalQuantity,
  getOrCreateBalancesForUpdateOrdered,
  getOrCreateInventoryBalanceForUpdate,
  mapBalanceRowToSnapshot,
  persistInventoryBalanceSnapshot,
  type InventoryTx,
} from "./inventoryRepository.server.js";
import {
  buildInventoryBalanceKey,
  InventoryValidationError,
  type InventoryBalanceSnapshot,
  type InventoryItemType,
} from "./inventoryTypes.js";
import {
  assertInitialBalanceScopeEligible,
  buildInitialBalanceIdempotencyKey,
  validateInitialBalancePayload,
  type InitialBalancePayload,
} from "./inventoryInitialBalance.js";
import { resolveAllowOverReservation, INVENTORY_OVER_RESERVATION_POLICY } from "./inventoryReservationPolicy.js";

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
  /** Custo unitário informativo (não fiscal). */
  unitCost?: number | null;
  costCenterId?: string | null;
  financialCostCenterId?: string | null;
  originType?:
    | "MANUAL"
    | "PURCHASE"
    | "SALES_ORDER"
    | "PRODUCTION_ORDER"
    | "COUNT_SESSION"
    | "REVERSAL"
    | "INTEGRATION"
    | "OTHER";
  originId?: string | null;
  idempotencyKey?: string | null;
  responsibleUserId?: string | null;
  movementDate?: Date;
  purchaseOrderId?: string | null;
  salesOrderId?: string | null;
  productionOrderId?: string | null;
  lotNumber?: string | null;
  serialNumber?: string | null;
  reversedMovementId?: string | null;
  /** Referência de evidência (doc/path/URL). */
  evidenceRef?: string | null;
  /** Tipo da reserva (somente RESERVE). */
  reservationType?:
    | "SALES_ORDER"
    | "PRODUCTION_ORDER"
    | "INTERNAL_REQUISITION"
    | "MAINTENANCE"
    | "QUALITY"
    | "MANUAL";
  /** Motivo tipado do bloqueio (somente BLOCK). */
  blockReasonType?:
    | "QUALITY"
    | "QUARANTINE"
    | "DAMAGE"
    | "AUDIT"
    | "MANUAL"
    | "OTHER";
  expiresAt?: Date | null;
};

export type CreateInventoryMovementContext = {
  userId?: string | null;
  deviceId?: string | null;
  permissions?: readonly string[];
  allowNegativeStock?: boolean;
  /** Política explícita: permite reserva/bloqueio acima do disponível (exige override). */
  allowOverReservation?: boolean;
  requestId?: string;
};

export type InventoryMovementResult = {
  movement: InventoryMovement;
  balance?: InventoryBalanceSnapshot;
  sourceBalance?: InventoryBalanceSnapshot;
  destinationBalance?: InventoryBalanceSnapshot;
  reservationId?: string | null;
  blockId?: string | null;
  idempotent?: boolean;
};

const ENTRY_TYPES = new Set<InventoryMovementType>([
  "MANUAL_ENTRY",
  "PURCHASE_ENTRY",
  "PURCHASE_RECEIPT",
  "PRODUCTION_ENTRY",
  "RETURN",
  "POSITIVE_ADJUSTMENT",
  "INITIAL_BALANCE",
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
  "QUARANTINE_IN",
  "QUARANTINE_OUT",
]);

type ItemRow = {
  id: string;
  status: string;
  itemType: InventoryItemType;
  unit: string;
  controlsStock: boolean;
  controlsLocation: boolean;
  allowsReservation: boolean;
  allowsBlock: boolean;
  materialId: string | null;
  materialCodeSnapshot: string | null;
  materialDescriptionSnapshot: string | null;
  lastKnownCost: unknown;
  averageCost: unknown;
};

function hasPermission(context: CreateInventoryMovementContext, key: string): boolean {
  return context.permissions?.includes(key) ?? false;
}

function assertMovementAuthorized(
  context: CreateInventoryMovementContext,
  movementType: InventoryMovementType
): void {
  // DEVICE autorizado pelo Device Registry na porta Collector — sem permissão humana.
  if (context.deviceId) return;
  try {
    assertInventoryMovementPermission(context.permissions, movementType);
  } catch (e: unknown) {
    const code =
      e && typeof e === "object" && "code" in e && typeof e.code === "string"
        ? e.code
        : "NOT_AUTHORIZED";
    throw new InventoryValidationError("Sem permissão para registrar esta movimentação.", code);
  }
}

function resolveAllowNegative(context: CreateInventoryMovementContext): boolean {
  return (
    context.allowNegativeStock === true || hasPermission(context, "inventory.movements.override")
  );
}

function resolveMovementAvailablePolicy(context: CreateInventoryMovementContext): {
  allowNegativeStock: boolean;
  allowNegativeAvailable: boolean;
} {
  const allowNegativeStock = resolveAllowNegative(context);
  const allowOver = resolveAllowOverReservation({
    allowOverReservation: context.allowOverReservation,
    permissions: context.permissions,
  });
  return {
    allowNegativeStock,
    allowNegativeAvailable: allowNegativeStock || allowOver,
  };
}

async function assertActiveItem(tx: InventoryTx, itemId: string): Promise<ItemRow> {
  const item = await tx.inventoryItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      status: true,
      itemType: true,
      unit: true,
      controlsStock: true,
      allowsReservation: true,
      allowsBlock: true,
      materialId: true,
      materialCodeSnapshot: true,
      materialDescriptionSnapshot: true,
      lastKnownCost: true,
      averageCost: true,
      controlsLocation: true,
    },
  });
  if (!item) throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  if (item.status !== "ACTIVE") {
    throw new InventoryValidationError("Item de estoque inativo.", "ITEM_INACTIVE");
  }
  if (item.controlsStock === false) {
    throw new InventoryValidationError(
      "Item não controla estoque — movimentação bloqueada.",
      "ITEM_STOCK_CONTROL_DISABLED"
    );
  }
  return item as ItemRow;
}

function assertItemFlagsForMovement(item: ItemRow, movementType: InventoryMovementType): void {
  if (
    (movementType === "RESERVE" || movementType === "CANCEL_RESERVATION") &&
    item.allowsReservation === false
  ) {
    throw new InventoryValidationError(
      "Item não permite reserva.",
      "ITEM_RESERVATION_DISABLED"
    );
  }
  if ((movementType === "BLOCK" || movementType === "UNBLOCK") && item.allowsBlock === false) {
    throw new InventoryValidationError("Item não permite bloqueio.", "ITEM_BLOCK_DISABLED");
  }
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
  assertBalanceFormula(after);
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

async function findIdempotentMovement(
  tx: InventoryTx,
  input: CreateInventoryMovementInput
): Promise<InventoryMovement | null> {
  if (input.idempotencyKey?.trim()) {
    if (typeof tx.inventoryMovement.findFirst !== "function") return null;
    return tx.inventoryMovement.findFirst({
      where: { idempotencyKey: input.idempotencyKey.trim() },
    });
  }
  const originId = input.originId?.trim();
  if (originId) {
    if (typeof tx.inventoryMovement.findFirst !== "function") return null;
    return tx.inventoryMovement.findFirst({
      where: {
        originType: input.originType ?? "MANUAL",
        originId,
      },
    });
  }
  return null;
}

async function createMovementRecord(
  tx: InventoryTx,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext,
  item: ItemRow,
  before: InventoryBalanceSnapshot,
  after: InventoryBalanceSnapshot,
  extra?: {
    reservationId?: string | null;
    reversedMovementId?: string | null;
    blockId?: string | null;
  }
) {
  const movementDate = input.movementDate ?? new Date();
  const snapshots = movementBalanceSnapshots(before, after);
  const unitCost =
    input.unitCost != null
      ? input.unitCost
      : item.lastKnownCost != null
        ? Number(item.lastKnownCost)
        : item.averageCost != null
          ? Number(item.averageCost)
          : null;

  const noteParts: string[] = [];
  if (input.notes?.trim()) noteParts.push(input.notes.trim());
  if (context.deviceId) noteParts.push(`deviceId=${context.deviceId}`);

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
      notes: noteParts.length > 0 ? noteParts.join(" | ") : null,
      responsibleUserId: input.responsibleUserId ?? context.userId ?? null,
      createdByUserId: context.userId ?? null,
      movementDate,
      originType: input.originType ?? "MANUAL",
      originId: input.originId?.trim() || null,
      idempotencyKey: input.idempotencyKey?.trim() || null,
      documentNumber: input.documentNumber?.trim() || null,
      evidenceRef: input.evidenceRef?.trim() || null,
      unitCost: decimalOrNull(Number.isFinite(unitCost as number) ? (unitCost as number) : null),
      costCenterId: input.costCenterId ?? null,
      financialCostCenterId: input.financialCostCenterId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      salesOrderId: input.salesOrderId ?? null,
      productionOrderId: input.productionOrderId ?? null,
      lotNumber: input.lotNumber?.trim() || null,
      serialNumber: input.serialNumber?.trim() || null,
      materialId: item.materialId,
      materialCodeSnapshot: item.materialCodeSnapshot,
      materialDescriptionSnapshot: item.materialDescriptionSnapshot,
      reservationId: extra?.reservationId ?? null,
      blockId: extra?.blockId ?? null,
      reversedMovementId: extra?.reversedMovementId ?? input.reversedMovementId ?? null,
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
  item: ItemRow,
  warehouseId: string,
  locationId?: string | null
): Promise<InventoryMovementResult> {
  const movementDate = input.movementDate ?? new Date();
  const balanceRow = await getOrCreateInventoryBalanceForUpdate(
    tx,
    input.itemId,
    warehouseId,
    locationId
  );
  const before = mapBalanceRowToSnapshot(balanceRow);

  let after: InventoryBalanceSnapshot;
  if (input.movementType === "REVERSAL") {
    throw new InventoryValidationError(
      "Use reverseInventoryMovement para estornos.",
      "REVERSAL_USE_DEDICATED_API"
    );
  } else {
    after = validateMovementRequest(
      before,
      {
        movementType: input.movementType,
        quantity: input.quantity,
        reason: input.reason,
        costCenterId: input.costCenterId,
        itemType: item.itemType,
        sourceWarehouseId: input.sourceWarehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        sourceLocationId: input.sourceLocationId,
        destinationLocationId: input.destinationLocationId,
      },
      resolveMovementAvailablePolicy(context)
    );
  }

  let reservationId: string | null = null;
  let blockId: string | null = null;

  if (input.movementType === "RESERVE") {
    const reservationType = input.reservationType ?? "MANUAL";
    if (
      (reservationType === "SALES_ORDER" || reservationType === "PRODUCTION_ORDER") &&
      !INVENTORY_OVER_RESERVATION_POLICY.integrationsAutoReserveFromSalesOrder &&
      !INVENTORY_OVER_RESERVATION_POLICY.integrationsAutoReserveFromProductionOrder
    ) {
      // Fase 1: tipagem manual permitida como classificação, sem auto-orquestração OP/PV.
      // Mantém soft-ref via originType/originId apenas.
    }
    const reservation = await tx.inventoryReservation.create({
      data: {
        itemId: input.itemId,
        warehouseId,
        locationId: locationId ?? null,
        quantity: decimalQuantity(input.quantity),
        reservationType,
        status: "ACTIVE",
        reason: input.reason.trim(),
        originType: input.originType ?? "MANUAL",
        originId: input.originId ?? null,
        responsibleUserId: input.responsibleUserId ?? context.userId ?? null,
        expiresAt: input.expiresAt ?? null,
        createdByUserId: context.userId ?? null,
        notes: input.notes?.trim() || null,
      },
    });
    reservationId = reservation.id;
  }

  if (input.movementType === "BLOCK") {
    const block = await tx.inventoryBlock.create({
      data: {
        itemId: input.itemId,
        warehouseId,
        locationId: locationId ?? null,
        quantity: decimalQuantity(input.quantity),
        reasonType: input.blockReasonType ?? "MANUAL",
        status: "ACTIVE",
        reason: input.reason.trim(),
        originType: input.originType ?? "MANUAL",
        originId: input.originId ?? null,
        responsibleUserId: input.responsibleUserId ?? context.userId ?? null,
        createdByUserId: context.userId ?? null,
        notes: input.notes?.trim() || null,
      },
    });
    blockId = block.id;
  }

  if (input.movementType === "CANCEL_RESERVATION" && input.originId?.trim()) {
    reservationId = input.originId.trim();
  }
  if (input.movementType === "UNBLOCK" && input.originId?.trim()) {
    blockId = input.originId.trim();
  }

  const movement = await createMovementRecord(tx, input, context, item, before, after, {
    reservationId,
    blockId,
  });

  await persistInventoryBalanceSnapshot(tx, balanceRow.id, after, movementDate, movement.id);

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryMovement",
    entityId: movement.id,
    action: input.movementType,
    beforeJson: before,
    afterJson: after,
    userId: context.userId ?? null,
    reason: input.reason,
  });

  if (input.movementType === "RESERVE" && reservationId) {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryReservation",
      entityId: reservationId,
      action: "CREATE",
      afterJson: {
        itemId: input.itemId,
        quantity: input.quantity,
        warehouseId,
        reservationType: input.reservationType ?? "MANUAL",
        responsibleUserId: input.responsibleUserId ?? context.userId ?? null,
        expiresAt: input.expiresAt ?? null,
        originType: input.originType ?? "MANUAL",
        originId: input.originId ?? null,
      },
      userId: context.userId ?? null,
      reason: input.reason,
    });
  }

  if (input.movementType === "BLOCK" && blockId) {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryBlock",
      entityId: blockId,
      action: "CREATE",
      afterJson: {
        itemId: input.itemId,
        quantity: input.quantity,
        warehouseId,
        reasonType: input.blockReasonType ?? "MANUAL",
      },
      userId: context.userId ?? null,
      reason: input.reason,
    });
  }

  if (
    input.movementType === "QUARANTINE_IN" ||
    input.movementType === "QUARANTINE_OUT" ||
    input.movementType === "UNBLOCK"
  ) {
    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryBalance",
      entityId: balanceRow.id,
      action: input.movementType,
      beforeJson: before,
      afterJson: after,
      userId: context.userId ?? null,
      reason: input.reason,
    });
  }

  return { movement, balance: after, reservationId, blockId };
}

async function executeTransfer(
  tx: InventoryTx,
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext,
  item: ItemRow
): Promise<InventoryMovementResult> {
  const sourceWh = input.sourceWarehouseId!;
  const destWh = input.destinationWarehouseId!;
  const movementDate = input.movementDate ?? new Date();

  const locked = await getOrCreateBalancesForUpdateOrdered(tx, [
    { itemId: input.itemId, warehouseId: sourceWh, locationId: input.sourceLocationId },
    { itemId: input.itemId, warehouseId: destWh, locationId: input.destinationLocationId },
  ]);

  const sourceRow = locked.get(
    inventoryBalanceLockKey({
      itemId: input.itemId,
      warehouseId: sourceWh,
      locationId: input.sourceLocationId,
    })
  )!;
  const destRow = locked.get(
    inventoryBalanceLockKey({
      itemId: input.itemId,
      warehouseId: destWh,
      locationId: input.destinationLocationId,
    })
  )!;

  const beforeSource = mapBalanceRowToSnapshot(sourceRow);
  const afterSource = validateMovementRequest(
    beforeSource,
    {
      movementType: "TRANSFER",
      quantity: input.quantity,
      reason: input.reason,
      itemType: item.itemType,
      sourceWarehouseId: sourceWh,
      destinationWarehouseId: destWh,
      sourceLocationId: input.sourceLocationId,
      destinationLocationId: input.destinationLocationId,
    },
    { allowNegativeStock: resolveAllowNegative(context), allowNegativeAvailable: resolveAllowNegative(context) }
  );

  const beforeDest = mapBalanceRowToSnapshot(destRow);
  const afterDest = applyTransferDestinationImpact(beforeDest, input.quantity);

  const movement = await createMovementRecord(
    tx,
    input,
    context,
    item,
    beforeSource,
    afterSource
  );

  await persistInventoryBalanceSnapshot(tx, sourceRow.id, afterSource, movementDate, movement.id);
  await persistInventoryBalanceSnapshot(tx, destRow.id, afterDest, movementDate, movement.id);

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryMovement",
    entityId: movement.id,
    action: "TRANSFER",
    beforeJson: { source: beforeSource, destination: beforeDest },
    afterJson: { source: afterSource, destination: afterDest },
    userId: context.userId ?? null,
    reason: input.reason,
  });

  return {
    movement,
    sourceBalance: afterSource,
    destinationBalance: afterDest,
    balance: afterSource,
  };
}

async function rebuildBalanceFromMovement(
  movement: InventoryMovement
): Promise<InventoryBalanceSnapshot> {
  return {
    physicalQuantity: Number(movement.nextPhysicalBalance),
    reservedQuantity: Number(movement.nextReservedBalance),
    blockedQuantity: Number(movement.nextBlockedBalance),
    quarantineQuantity: Number(movement.nextQuarantineBalance),
    availableQuantity: Number(movement.nextAvailableBalance),
  };
}

async function assertInitialBalanceGuards(
  tx: InventoryTx,
  input: CreateInventoryMovementInput,
  item: ItemRow,
  warehouseId: string,
  locationId?: string | null
): Promise<void> {
  if (item.controlsLocation && !locationId?.trim()) {
    throw new InventoryValidationError(
      "Local é obrigatório para item com controle de localização.",
      "LOCATION_REQUIRED"
    );
  }
  if (!input.movementDate) {
    throw new InventoryValidationError("Data da contagem é obrigatória.", "INVALID_DATE");
  }
  if (!input.responsibleUserId?.trim()) {
    throw new InventoryValidationError("Responsável é obrigatório.", "FIELD_REQUIRED");
  }

  const balanceKey = buildInventoryBalanceKey(warehouseId, locationId);
  const existingInitials = await tx.inventoryMovement.findMany({
    where: {
      itemId: input.itemId,
      movementType: "INITIAL_BALANCE",
      destinationWarehouseId: warehouseId,
      ...(locationId
        ? { destinationLocationId: locationId }
        : { destinationLocationId: null }),
    },
    select: { id: true },
  });

  let hasActiveInitialBalance = false;
  for (const initial of existingInitials) {
    const reversal = await tx.inventoryMovement.findFirst({
      where: { reversedMovementId: initial.id, movementType: "REVERSAL" },
      select: { id: true },
    });
    if (!reversal) {
      hasActiveInitialBalance = true;
      break;
    }
  }

  const balanceRow = await tx.inventoryBalance.findUnique({
    where: { itemId_balanceKey: { itemId: input.itemId, balanceKey } },
  });
  const physicalQuantity = balanceRow ? Number(balanceRow.physicalQuantity) : 0;

  assertInitialBalanceScopeEligible({
    physicalQuantity,
    hasActiveInitialBalance,
  });
}

/**
 * Registra movimentação no ledger (transação + lock de saldo).
 * Idempotente quando `idempotencyKey` ou `originType+originId` já existir.
 * Use `createInventoryMovementInTx` quando já estiver dentro de uma transação atômica.
 */
export async function createInventoryMovementInTx(
  tx: InventoryTx,
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext
): Promise<InventoryMovementResult> {
  if (input.movementType === "REVERSAL") {
    throw new InventoryValidationError(
      "Estorno deve usar reverseInventoryMovement.",
      "REVERSAL_USE_DEDICATED_API"
    );
  }
  if (!input.reason?.trim()) {
    throw new InventoryValidationError("Motivo é obrigatório.", "REASON_REQUIRED");
  }
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new InventoryValidationError("Quantidade inválida.", "INVALID_QUANTITY");
  }
  assertMovementAuthorized(context, input.movementType);

  const existing = await findIdempotentMovement(tx, input);
  if (existing) {
    return {
      movement: existing,
      balance: await rebuildBalanceFromMovement(existing),
      idempotent: true,
    };
  }

  const item = await assertActiveItem(tx, input.itemId);
  assertItemFlagsForMovement(item, input.movementType);

  if (ENTRY_TYPES.has(input.movementType)) {
    const wh = input.destinationWarehouseId ?? input.sourceWarehouseId;
    if (!wh) {
      throw new InventoryValidationError(
        "Almoxarifado de destino é obrigatório.",
        "WAREHOUSE_REQUIRED"
      );
    }
    await assertActiveWarehouse(tx, wh, "Almoxarifado de destino");
    const locationId = input.destinationLocationId ?? input.sourceLocationId;
    if (input.movementType === "INITIAL_BALANCE") {
      await assertInitialBalanceGuards(tx, input, item, wh, locationId);
    }
    return executeSimpleMovement(
      tx,
      prisma,
      { ...input, destinationWarehouseId: wh },
      context,
      item,
      wh,
      locationId
    );
  }

  if (input.movementType === "TRANSFER") {
    if (!input.sourceWarehouseId || !input.destinationWarehouseId) {
      throw new InventoryValidationError(
        "Transferência exige origem e destino.",
        "TRANSFER_WAREHOUSE"
      );
    }
    await assertActiveWarehouse(tx, input.sourceWarehouseId, "Almoxarifado de origem");
    await assertActiveWarehouse(tx, input.destinationWarehouseId, "Almoxarifado de destino");
    return executeTransfer(tx, prisma, input, context, item);
  }

  if (SOURCE_WAREHOUSE_TYPES.has(input.movementType)) {
    const wh = input.sourceWarehouseId ?? input.destinationWarehouseId;
    if (!wh) {
      throw new InventoryValidationError(
        "Almoxarifado de origem é obrigatório.",
        "WAREHOUSE_REQUIRED"
      );
    }
    await assertActiveWarehouse(tx, input.sourceWarehouseId ?? wh, "Almoxarifado de origem");
    return executeSimpleMovement(
      tx,
      prisma,
      { ...input, sourceWarehouseId: wh },
      context,
      item,
      wh,
      input.sourceLocationId ?? input.destinationLocationId
    );
  }

  throw new InventoryValidationError(
    `Tipo de movimento não suportado: ${input.movementType}.`,
    "UNSUPPORTED_MOVEMENT_TYPE"
  );
}

export async function createInventoryMovement(
  prisma: PrismaClient,
  input: CreateInventoryMovementInput,
  context: CreateInventoryMovementContext
): Promise<InventoryMovementResult> {
  try {
    return await prisma.$transaction(async (tx) =>
      createInventoryMovementInTx(tx, prisma, input, context)
    );
  } catch (e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      // Corrida de idempotência — retorna o movimento já gravado.
      const raced = await prisma.$transaction(async (tx) => findIdempotentMovement(tx, input));
      if (raced) {
        return {
          movement: raced,
          balance: await rebuildBalanceFromMovement(raced),
          idempotent: true,
        };
      }
    }
    throw e;
  }
}

/**
 * Implantação inicial de estoque (OP-10) — sempre via ledger INITIAL_BALANCE.
 * Não preenche InventoryBalance diretamente.
 */
export async function createInitialInventoryBalance(
  prisma: PrismaClient,
  raw: InitialBalancePayload & { unit?: string },
  context: CreateInventoryMovementContext
): Promise<InventoryMovementResult> {
  const payload = validateInitialBalancePayload({
    ...raw,
    responsibleUserId: raw.responsibleUserId || context.userId || null,
  });

  const item = await prisma.inventoryItem.findUnique({
    where: { id: payload.itemId },
    select: { unit: true, controlsLocation: true },
  });
  if (!item) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }
  if (item.controlsLocation && !payload.locationId) {
    throw new InventoryValidationError(
      "Local é obrigatório para item com controle de localização.",
      "LOCATION_REQUIRED"
    );
  }

  const baseKey = buildInitialBalanceIdempotencyKey(
    payload.itemId,
    payload.warehouseId,
    payload.locationId
  );

  // Após estorno, a chave base permanece no ledger imutável — gera geração seguinte.
  const priorInitials = await prisma.inventoryMovement.findMany({
    where: {
      itemId: payload.itemId,
      movementType: "INITIAL_BALANCE",
      destinationWarehouseId: payload.warehouseId,
      ...(payload.locationId
        ? { destinationLocationId: payload.locationId }
        : { destinationLocationId: null }),
    },
    select: { id: true, idempotencyKey: true },
    orderBy: { createdAt: "asc" },
  });

  let generation = 0;
  for (const prior of priorInitials) {
    const reversal = await prisma.inventoryMovement.findFirst({
      where: { reversedMovementId: prior.id, movementType: "REVERSAL" },
      select: { id: true },
    });
    if (reversal) generation += 1;
  }

  const originId = generation === 0 ? baseKey : `${baseKey}:g${generation}`;
  const idempotencyKey = originId;

  return createInventoryMovement(
    prisma,
    {
      itemId: payload.itemId,
      destinationWarehouseId: payload.warehouseId,
      destinationLocationId: payload.locationId,
      movementType: "INITIAL_BALANCE",
      quantity: payload.quantity,
      unit: raw.unit ?? item.unit,
      reason: payload.justification,
      notes: payload.notes,
      documentNumber: payload.documentNumber,
      evidenceRef: payload.evidenceRef,
      unitCost: payload.unitCost,
      responsibleUserId: payload.responsibleUserId,
      movementDate: payload.countDate,
      originType: "OTHER",
      originId,
      idempotencyKey,
    },
    context
  );
}

/**
 * Estorno: gera REVERSAL imutável vinculado ao original (sem editar/apagar o fato).
 * Use `reverseInventoryMovementInTx` dentro de transação atômica do domínio chamador.
 */
export async function reverseInventoryMovementInTx(
  tx: InventoryTx,
  prisma: PrismaClient,
  originalMovementId: string,
  context: CreateInventoryMovementContext,
  reason: string,
  options?: { idempotent?: boolean }
): Promise<InventoryMovementResult> {
  if (!reason?.trim()) {
    throw new InventoryValidationError("Motivo do estorno é obrigatório.", "REASON_REQUIRED");
  }
  assertMovementAuthorized(context, "REVERSAL");

  const original = await tx.inventoryMovement.findUnique({
    where: { id: originalMovementId },
  });
  if (!original) {
    throw new InventoryValidationError("Movimentação original não encontrada.", "MOVEMENT_NOT_FOUND");
  }
  if (original.movementType === "REVERSAL") {
    throw new InventoryValidationError(
      "Não é possível estornar um estorno.",
      "CANNOT_REVERSE_REVERSAL"
    );
  }

  const already = await tx.inventoryMovement.findFirst({
    where: { reversedMovementId: original.id },
  });
  if (already) {
    if (options?.idempotent) {
      return {
        movement: already,
        balance: await rebuildBalanceFromMovement(already),
        idempotent: true,
      };
    }
    throw new InventoryValidationError("Movimentação já foi estornada.", "ALREADY_REVERSED");
  }

  const item = await assertActiveItem(tx, original.itemId);
  const qty = Number(original.quantity);
  const impact = resolveReversalImpact(original.movementType, qty);
  const movementDate = new Date();

  if (original.movementType === "TRANSFER") {
    if (!original.sourceWarehouseId || !original.destinationWarehouseId) {
      throw new InventoryValidationError(
        "Transferência original sem origem/destino.",
        "TRANSFER_WAREHOUSE"
      );
    }
    await assertActiveWarehouse(tx, original.sourceWarehouseId, "Almoxarifado de origem");
    await assertActiveWarehouse(tx, original.destinationWarehouseId, "Almoxarifado de destino");

    const locked = await getOrCreateBalancesForUpdateOrdered(tx, [
      {
        itemId: original.itemId,
        warehouseId: original.sourceWarehouseId,
        locationId: original.sourceLocationId,
      },
      {
        itemId: original.itemId,
        warehouseId: original.destinationWarehouseId,
        locationId: original.destinationLocationId,
      },
    ]);
    const sourceRow = locked.get(
      inventoryBalanceLockKey({
        itemId: original.itemId,
        warehouseId: original.sourceWarehouseId,
        locationId: original.sourceLocationId,
      })
    )!;
    const destRow = locked.get(
      inventoryBalanceLockKey({
        itemId: original.itemId,
        warehouseId: original.destinationWarehouseId,
        locationId: original.destinationLocationId,
      })
    )!;

    const beforeSource = mapBalanceRowToSnapshot(sourceRow);
    const beforeDest = mapBalanceRowToSnapshot(destRow);
    const afterSource = applyMovementImpactToBalance(beforeSource, {
      physicalDelta: qty,
      reservedDelta: 0,
      blockedDelta: 0,
      quarantineDelta: 0,
    });
    const afterDest = applyMovementImpactToBalance(beforeDest, {
      physicalDelta: -qty,
      reservedDelta: 0,
      blockedDelta: 0,
      quarantineDelta: 0,
    });
    if (afterDest.physicalQuantity < 0 && !resolveAllowNegative(context)) {
      throw new InventoryValidationError(
        "Estorno deixaria saldo físico negativo no destino.",
        "INSUFFICIENT_PHYSICAL"
      );
    }

    const movement = await createMovementRecord(
      tx,
      {
        itemId: original.itemId,
        sourceWarehouseId: original.destinationWarehouseId,
        destinationWarehouseId: original.sourceWarehouseId,
        sourceLocationId: original.destinationLocationId,
        destinationLocationId: original.sourceLocationId,
        movementType: "REVERSAL",
        quantity: qty,
        unit: original.unit,
        reason: reason.trim(),
        originType: "REVERSAL",
        originId: original.id,
        documentNumber: original.documentNumber,
        unitCost: original.unitCost != null ? Number(original.unitCost) : null,
        costCenterId: original.costCenterId,
        financialCostCenterId: original.financialCostCenterId,
      },
      context,
      item,
      beforeSource,
      afterSource,
      { reversedMovementId: original.id }
    );

    await persistInventoryBalanceSnapshot(
      tx,
      sourceRow.id,
      afterSource,
      movementDate,
      movement.id
    );
    await persistInventoryBalanceSnapshot(tx, destRow.id, afterDest, movementDate, movement.id);

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryMovement",
      entityId: movement.id,
      action: "REVERSAL",
      beforeJson: { originalId: original.id, source: beforeSource, destination: beforeDest },
      afterJson: { source: afterSource, destination: afterDest },
      userId: context.userId ?? null,
      reason: reason.trim(),
    });

    return {
      movement,
      sourceBalance: afterSource,
      destinationBalance: afterDest,
      balance: afterSource,
    };
  }

  const warehouseId = ENTRY_TYPES.has(original.movementType)
    ? original.destinationWarehouseId ?? original.sourceWarehouseId
    : original.sourceWarehouseId ?? original.destinationWarehouseId;
  if (!warehouseId) {
    throw new InventoryValidationError("Almoxarifado do movimento original ausente.", "WAREHOUSE_REQUIRED");
  }
  await assertActiveWarehouse(tx, warehouseId, "Almoxarifado");

  const locationId = ENTRY_TYPES.has(original.movementType)
    ? original.destinationLocationId ?? original.sourceLocationId
    : original.sourceLocationId ?? original.destinationLocationId;

  const balanceRow = await getOrCreateInventoryBalanceForUpdate(
    tx,
    original.itemId,
    warehouseId,
    locationId
  );
  const before = mapBalanceRowToSnapshot(balanceRow);
  const after = applyMovementImpactToBalance(before, impact);

  if (after.physicalQuantity < 0 && !resolveAllowNegative(context)) {
    throw new InventoryValidationError(
      "Estorno deixaria saldo físico negativo.",
      "INSUFFICIENT_PHYSICAL"
    );
  }
  if (after.reservedQuantity < 0 || after.blockedQuantity < 0) {
    throw new InventoryValidationError(
      "Estorno deixaria saldo reservado/bloqueado inválido.",
      "REVERSAL_BALANCE_INVALID"
    );
  }

  const movement = await createMovementRecord(
    tx,
    {
      itemId: original.itemId,
      sourceWarehouseId: original.sourceWarehouseId,
      destinationWarehouseId: original.destinationWarehouseId,
      sourceLocationId: original.sourceLocationId,
      destinationLocationId: original.destinationLocationId,
      movementType: "REVERSAL",
      quantity: qty,
      unit: original.unit,
      reason: reason.trim(),
      originType: "REVERSAL",
      originId: original.id,
      documentNumber: original.documentNumber,
      unitCost: original.unitCost != null ? Number(original.unitCost) : null,
      costCenterId: original.costCenterId,
      financialCostCenterId: original.financialCostCenterId,
    },
    context,
    item,
    before,
    after,
    { reversedMovementId: original.id }
  );

  await persistInventoryBalanceSnapshot(tx, balanceRow.id, after, movementDate, movement.id);

  if (original.movementType === "BLOCK" && original.blockId) {
    await tx.inventoryBlock.updateMany({
      where: { id: original.blockId, status: "ACTIVE" },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedByuserId: context.userId ?? null,
      },
    });
  }
  if (original.movementType === "RESERVE" && original.reservationId) {
    await tx.inventoryReservation.updateMany({
      where: { id: original.reservationId, status: "ACTIVE" },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledByuserId: context.userId ?? null,
      },
    });
  }

  await writeInventoryAuditLog(prisma, {
    entityType: "InventoryMovement",
    entityId: movement.id,
    action: "REVERSAL",
    beforeJson: { originalId: original.id, before },
    afterJson: after,
    userId: context.userId ?? null,
    reason: reason.trim(),
  });

  return { movement, balance: after };
}

export async function reverseInventoryMovement(
  prisma: PrismaClient,
  originalMovementId: string,
  context: CreateInventoryMovementContext,
  reason: string
): Promise<InventoryMovementResult> {
  return prisma.$transaction(async (tx) =>
    reverseInventoryMovementInTx(tx, prisma, originalMovementId, context, reason)
  );
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
      item,
      reservation.warehouseId,
      reservation.locationId
    );

    await tx.inventoryReservation.update({
      where: { id: reservationId },
      data: {
        status: "CANCELED",
        canceledAt: new Date(),
        canceledByuserId: context.userId ?? null,
      },
    });

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryReservation",
      entityId: reservationId,
      action: "CANCEL",
      userId: context.userId ?? null,
      reason,
    });

    return result;
  });
}

/** Libera bloqueio ativo (histórico preservado) e registra UNBLOCK no ledger. */
export async function releaseInventoryBlock(
  prisma: PrismaClient,
  blockId: string,
  context: CreateInventoryMovementContext,
  reason: string
): Promise<InventoryMovementResult> {
  if (!reason?.trim()) {
    throw new InventoryValidationError("Motivo da liberação é obrigatório.", "REASON_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const block = await tx.inventoryBlock.findUnique({ where: { id: blockId } });
    if (!block) {
      throw new InventoryValidationError("Bloqueio não encontrado.", "BLOCK_NOT_FOUND");
    }
    if (block.status !== "ACTIVE") {
      throw new InventoryValidationError("Bloqueio não está ativo.", "BLOCK_NOT_ACTIVE");
    }

    const item = await assertActiveItem(tx, block.itemId);
    await assertActiveWarehouse(tx, block.warehouseId, "Almoxarifado");

    const qty = Number(block.quantity);
    const result = await executeSimpleMovement(
      tx,
      prisma,
      {
        itemId: block.itemId,
        sourceWarehouseId: block.warehouseId,
        sourceLocationId: block.locationId,
        movementType: "UNBLOCK",
        quantity: qty,
        unit: item.unit,
        reason: reason.trim(),
        originType: "MANUAL",
        originId: blockId,
        responsibleuserId: context.userId ?? null,
      },
      context,
      item,
      block.warehouseId,
      block.locationId
    );

    await tx.inventoryBlock.update({
      where: { id: blockId },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
        releasedByuserId: context.userId ?? null,
      },
    });

    await writeInventoryAuditLog(prisma, {
      entityType: "InventoryBlock",
      entityId: blockId,
      action: "RELEASE",
      userId: context.userId ?? null,
      reason: reason.trim(),
    });

    return { ...result, blockId };
  });
}

/**
 * Transferência rastreável físico ↔ local de quarentena (locationType QUARANTINE).
 * Usa TRANSFER no ledger; não integra OP/PV.
 */
export async function transferBetweenPhysicalAndQuarantine(
  prisma: PrismaClient,
  input: {
    itemId: string;
    quantity: number;
    reason: string;
    sourceWarehouseId: string;
    sourceLocationId?: string | null;
    destinationWarehouseId: string;
    destinationLocationId: string;
    /** true = destino deve ser QUARANTINE; false = origem deve ser QUARANTINE */
    toQuarantine: boolean;
    notes?: string | null;
    responsibleUserId?: string | null;
  },
  context: CreateInventoryMovementContext
): Promise<InventoryMovementResult> {
  if (!input.reason?.trim()) {
    throw new InventoryValidationError("Motivo é obrigatório.", "REASON_REQUIRED");
  }

  const quarantineLocationId = input.toQuarantine
    ? input.destinationLocationId
    : input.sourceLocationId;
  if (!quarantineLocationId?.trim()) {
    throw new InventoryValidationError(
      "Local de quarentena é obrigatório para esta transferência.",
      "LOCATION_REQUIRED"
    );
  }

  const location = await prisma.inventoryLocation.findUnique({
    where: { id: quarantineLocationId },
    select: { id: true, locationType: true, warehouseId: true, status: true },
  });
  if (!location) {
    throw new InventoryValidationError("Local não encontrado.", "LOCATION_NOT_FOUND");
  }
  if (location.locationType !== "QUARANTINE") {
    throw new InventoryValidationError(
      "Transferência físico↔quarentena exige local com tipo QUARANTINE.",
      "QUARANTINE_LOCATION_REQUIRED"
    );
  }
  if (location.status !== "ACTIVE") {
    throw new InventoryValidationError("Local de quarentena inativo.", "LOCATION_INACTIVE");
  }

  const item = await prisma.inventoryItem.findUnique({
    where: { id: input.itemId },
    select: { unit: true },
  });
  if (!item) {
    throw new InventoryValidationError("Item de estoque não encontrado.", "ITEM_NOT_FOUND");
  }

  return createInventoryMovement(
    prisma,
    {
      itemId: input.itemId,
      sourceWarehouseId: input.sourceWarehouseId,
      sourceLocationId: input.sourceLocationId ?? null,
      destinationWarehouseId: input.destinationWarehouseId,
      destinationLocationId: input.destinationLocationId,
      movementType: "TRANSFER",
      quantity: input.quantity,
      unit: item.unit,
      reason: input.reason.trim(),
      notes:
        (input.notes?.trim() || "") +
        (input.toQuarantine ? " [PHYSICAL→QUARANTINE]" : " [QUARANTINE→PHYSICAL]"),
      originType: "OTHER",
      originId: `quarantine-transfer:${input.toQuarantine ? "in" : "out"}:${Date.now()}`,
      responsibleUserId: input.responsibleUserId ?? context.userId ?? null,
    },
    context
  );
}

/** Exportado para testes de impacto puro em estorno. */
export { applyMovementToBalance, resolveReversalImpact };
