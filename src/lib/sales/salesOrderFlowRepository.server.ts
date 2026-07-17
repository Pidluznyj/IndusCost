/**
 * OP-53 — Repositories do Fluxo de Pedidos (snapshots, eventos, management).
 *
 * - Sem regras de negócio (apenas I/O Prisma)
 * - Decimal preservado (Prisma.Decimal nas escritas/leituras)
 * - Transação recebida por parâmetro quando a operação exige atomicidade
 * - Sem gravação em SalesOrder / SalesOrderItem oficiais
 * - Sem consultas Nomus
 * - Leituras em lote via `IN` (sem N+1)
 */

import { Prisma, type PrismaClient } from "@prisma/client";

export type SalesOrderFlowRepositoryDb = Pick<
  PrismaClient,
  | "salesOrderItemFlowSnapshot"
  | "salesOrderFlowSnapshot"
  | "salesOrderFlowEvent"
  | "salesOrderFlowManagement"
>;

/** Cliente de transação ou PrismaClient completo — para operações que exigem `tx`. */
export type SalesOrderFlowTx = Prisma.TransactionClient | SalesOrderFlowRepositoryDb;

export type DecimalInput = Prisma.Decimal | number | string;

export function toFlowDecimal(value: DecimalInput): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

export function toNullableFlowDecimal(
  value: DecimalInput | null | undefined
): Prisma.Decimal | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return toFlowDecimal(value);
}

function dedupeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

function asJsonInput(
  value: Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | null | undefined
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

// ---------------------------------------------------------------------------
// Item snapshots
// ---------------------------------------------------------------------------

export type SalesOrderItemFlowSnapshotWrite = {
  salesOrderId: string;
  salesOrderItemId: string;
  currentStage: string;
  stageReason?: string | null;
  fulfillmentClassification: string;
  requiresProductionClassification?: string | null;
  requiresProduction?: boolean | null;
  orderedQuantity?: DecimalInput | null;
  productionOrderQuantity?: DecimalInput;
  producedQuantity?: DecimalInput | null;
  documentedQuantity?: DecimalInput;
  invoicedQuantity?: DecimalInput;
  shippedQuantity?: DecimalInput;
  activeRemainingQuantity?: DecimalInput | null;
  shipTargetQuantity?: DecimalInput;
  cutQuantity?: DecimalInput;
  canceledQuantity?: DecimalInput;
  progressProductionOrder?: DecimalInput;
  progressProduced?: DecimalInput | null;
  progressDocumented?: DecimalInput;
  progressInvoiced?: DecimalInput;
  progressShipped?: DecimalInput;
  progressJson?: Prisma.InputJsonValue | null;
  inconsistenciesJson?: Prisma.InputJsonValue | null;
  nextAction?: string | null;
  responsibleArea?: string | null;
  stageEnteredAt?: Date | null;
  promisedDeliveryAt?: Date | null;
  isOverdue?: boolean;
  isActiveForKanban?: boolean;
  fingerprint: string;
  computationVersion: string;
  computedAt: Date;
};

function mapItemSnapshotCreateData(
  row: SalesOrderItemFlowSnapshotWrite
): Prisma.SalesOrderItemFlowSnapshotUncheckedCreateInput {
  return {
    salesOrderId: row.salesOrderId,
    salesOrderItemId: row.salesOrderItemId,
    currentStage: row.currentStage,
    stageReason: row.stageReason ?? null,
    fulfillmentClassification: row.fulfillmentClassification,
    requiresProductionClassification: row.requiresProductionClassification ?? null,
    requiresProduction: row.requiresProduction ?? null,
    orderedQuantity: toNullableFlowDecimal(row.orderedQuantity) ?? null,
    productionOrderQuantity: toFlowDecimal(row.productionOrderQuantity ?? 0),
    producedQuantity: toNullableFlowDecimal(row.producedQuantity) ?? null,
    documentedQuantity: toFlowDecimal(row.documentedQuantity ?? 0),
    invoicedQuantity: toFlowDecimal(row.invoicedQuantity ?? 0),
    shippedQuantity: toFlowDecimal(row.shippedQuantity ?? 0),
    activeRemainingQuantity: toNullableFlowDecimal(row.activeRemainingQuantity) ?? null,
    shipTargetQuantity: toFlowDecimal(row.shipTargetQuantity ?? 0),
    cutQuantity: toFlowDecimal(row.cutQuantity ?? 0),
    canceledQuantity: toFlowDecimal(row.canceledQuantity ?? 0),
    progressProductionOrder: toFlowDecimal(row.progressProductionOrder ?? 0),
    progressProduced: toNullableFlowDecimal(row.progressProduced) ?? null,
    progressDocumented: toFlowDecimal(row.progressDocumented ?? 0),
    progressInvoiced: toFlowDecimal(row.progressInvoiced ?? 0),
    progressShipped: toFlowDecimal(row.progressShipped ?? 0),
    progressJson: asJsonInput(row.progressJson),
    inconsistenciesJson: asJsonInput(row.inconsistenciesJson),
    nextAction: row.nextAction ?? null,
    responsibleArea: row.responsibleArea ?? null,
    stageEnteredAt: row.stageEnteredAt ?? null,
    promisedDeliveryAt: row.promisedDeliveryAt ?? null,
    isOverdue: row.isOverdue ?? false,
    isActiveForKanban: row.isActiveForKanban ?? true,
    fingerprint: row.fingerprint,
    computationVersion: row.computationVersion,
    computedAt: row.computedAt,
  };
}

function mapItemSnapshotUpdateData(
  row: SalesOrderItemFlowSnapshotWrite
): Prisma.SalesOrderItemFlowSnapshotUncheckedUpdateInput {
  const created = mapItemSnapshotCreateData(row);
  const { salesOrderItemId: _itemId, ...rest } = created;
  return rest;
}

export async function findSalesOrderItemFlowSnapshotsByOrderId(
  db: SalesOrderFlowRepositoryDb,
  salesOrderId: string
) {
  return db.salesOrderItemFlowSnapshot.findMany({
    where: { salesOrderId },
    orderBy: { salesOrderItemId: "asc" },
  });
}

/**
 * Leitura em lote sem N+1. Retorna Map salesOrderId → rows[].
 */
export async function findSalesOrderItemFlowSnapshotsByOrderIds(
  db: SalesOrderFlowRepositoryDb,
  salesOrderIds: readonly string[]
): Promise<Map<string, Awaited<ReturnType<typeof findSalesOrderItemFlowSnapshotsByOrderId>>>> {
  const ids = dedupeIds(salesOrderIds);
  const result = new Map<
    string,
    Awaited<ReturnType<typeof findSalesOrderItemFlowSnapshotsByOrderId>>
  >();
  for (const id of ids) result.set(id, []);
  if (ids.length === 0) return result;

  const rows = await db.salesOrderItemFlowSnapshot.findMany({
    where: { salesOrderId: { in: ids } },
    orderBy: [{ salesOrderId: "asc" }, { salesOrderItemId: "asc" }],
  });
  for (const row of rows) {
    const list = result.get(row.salesOrderId);
    if (list) list.push(row);
    else result.set(row.salesOrderId, [row]);
  }
  return result;
}

export async function findSalesOrderItemFlowSnapshotByItemId(
  db: SalesOrderFlowRepositoryDb,
  salesOrderItemId: string
) {
  return db.salesOrderItemFlowSnapshot.findUnique({
    where: { salesOrderItemId },
  });
}

export async function findSalesOrderItemFlowSnapshotsByFingerprint(
  db: SalesOrderFlowRepositoryDb,
  fingerprint: string
) {
  return db.salesOrderItemFlowSnapshot.findMany({
    where: { fingerprint },
    orderBy: { salesOrderItemId: "asc" },
  });
}

export type UpsertSalesOrderItemFlowSnapshotResult = {
  action: "create" | "update";
  id: string;
};

export async function upsertSalesOrderItemFlowSnapshot(
  db: SalesOrderFlowRepositoryDb,
  row: SalesOrderItemFlowSnapshotWrite
): Promise<UpsertSalesOrderItemFlowSnapshotResult> {
  const existing = await db.salesOrderItemFlowSnapshot.findUnique({
    where: { salesOrderItemId: row.salesOrderItemId },
    select: { id: true },
  });

  if (!existing) {
    const created = await db.salesOrderItemFlowSnapshot.create({
      data: mapItemSnapshotCreateData(row),
      select: { id: true },
    });
    return { action: "create", id: created.id };
  }

  const updated = await db.salesOrderItemFlowSnapshot.update({
    where: { salesOrderItemId: row.salesOrderItemId },
    data: mapItemSnapshotUpdateData(row),
    select: { id: true },
  });
  return { action: "update", id: updated.id };
}

export type ReplaceSalesOrderItemFlowSnapshotsResult = {
  deleted: number;
  upserted: UpsertSalesOrderItemFlowSnapshotResult[];
};

/**
 * Substituição segura dos snapshots de item de um pedido.
 * Exige `tx` do chamador (`$transaction`) para atomicidade:
 * remove órfãos do pedido e faz upsert dos rows informados.
 */
export async function replaceSalesOrderItemFlowSnapshotsForOrder(
  tx: SalesOrderFlowTx,
  salesOrderId: string,
  rows: readonly SalesOrderItemFlowSnapshotWrite[]
): Promise<ReplaceSalesOrderItemFlowSnapshotsResult> {
  const nextItemIds = rows.map((r) => r.salesOrderItemId);
  const deleteWhere =
    nextItemIds.length === 0
      ? { salesOrderId }
      : { salesOrderId, salesOrderItemId: { notIn: nextItemIds } };

  const deleted = await tx.salesOrderItemFlowSnapshot.deleteMany({
    where: deleteWhere,
  });

  const upserted: UpsertSalesOrderItemFlowSnapshotResult[] = [];
  for (const row of rows) {
    const write: SalesOrderItemFlowSnapshotWrite = {
      ...row,
      salesOrderId,
    };
    upserted.push(await upsertSalesOrderItemFlowSnapshot(tx, write));
  }

  return { deleted: deleted.count, upserted };
}

// ---------------------------------------------------------------------------
// Order snapshots
// ---------------------------------------------------------------------------

export type SalesOrderFlowSnapshotWrite = {
  salesOrderId: string;
  currentStage: string;
  bottleneckStage?: string | null;
  bottleneckSalesOrderItemId?: string | null;
  bottleneckReason?: string | null;
  nextAction?: string | null;
  responsibleArea?: string | null;
  totalItems?: number;
  activeItems?: number;
  completedItems?: number;
  pendingItems?: number;
  inconsistentItems?: number;
  canceledItems?: number;
  progressProductionOrder?: DecimalInput;
  progressProduced?: DecimalInput | null;
  progressDocumented?: DecimalInput;
  progressInvoiced?: DecimalInput;
  progressShipped?: DecimalInput;
  progressJson?: Prisma.InputJsonValue | null;
  orderValue?: DecimalInput;
  fulfilledValue?: DecimalInput;
  activeResidualValue?: DecimalInput;
  cutValue?: DecimalInput;
  canceledValue?: DecimalInput;
  firstShippedAt?: Date | null;
  lastShippedAt?: Date | null;
  completedAt?: Date | null;
  promisedDeliveryAt?: Date | null;
  isOverdue?: boolean;
  isInActiveOperationalColumn?: boolean;
  inconsistenciesJson?: Prisma.InputJsonValue | null;
  badgesJson?: Prisma.InputJsonValue | null;
  fingerprint: string;
  computationVersion: string;
  computedAt: Date;
};

function mapOrderSnapshotCreateData(
  row: SalesOrderFlowSnapshotWrite
): Prisma.SalesOrderFlowSnapshotUncheckedCreateInput {
  return {
    salesOrderId: row.salesOrderId,
    currentStage: row.currentStage,
    bottleneckStage: row.bottleneckStage ?? null,
    bottleneckSalesOrderItemId: row.bottleneckSalesOrderItemId ?? null,
    bottleneckReason: row.bottleneckReason ?? null,
    nextAction: row.nextAction ?? null,
    responsibleArea: row.responsibleArea ?? null,
    totalItems: row.totalItems ?? 0,
    activeItems: row.activeItems ?? 0,
    completedItems: row.completedItems ?? 0,
    pendingItems: row.pendingItems ?? 0,
    inconsistentItems: row.inconsistentItems ?? 0,
    canceledItems: row.canceledItems ?? 0,
    progressProductionOrder: toFlowDecimal(row.progressProductionOrder ?? 0),
    progressProduced: toNullableFlowDecimal(row.progressProduced) ?? null,
    progressDocumented: toFlowDecimal(row.progressDocumented ?? 0),
    progressInvoiced: toFlowDecimal(row.progressInvoiced ?? 0),
    progressShipped: toFlowDecimal(row.progressShipped ?? 0),
    progressJson: asJsonInput(row.progressJson),
    orderValue: toFlowDecimal(row.orderValue ?? 0),
    fulfilledValue: toFlowDecimal(row.fulfilledValue ?? 0),
    activeResidualValue: toFlowDecimal(row.activeResidualValue ?? 0),
    cutValue: toFlowDecimal(row.cutValue ?? 0),
    canceledValue: toFlowDecimal(row.canceledValue ?? 0),
    firstShippedAt: row.firstShippedAt ?? null,
    lastShippedAt: row.lastShippedAt ?? null,
    completedAt: row.completedAt ?? null,
    promisedDeliveryAt: row.promisedDeliveryAt ?? null,
    isOverdue: row.isOverdue ?? false,
    isInActiveOperationalColumn: row.isInActiveOperationalColumn ?? true,
    inconsistenciesJson: asJsonInput(row.inconsistenciesJson),
    badgesJson: asJsonInput(row.badgesJson),
    fingerprint: row.fingerprint,
    computationVersion: row.computationVersion,
    computedAt: row.computedAt,
  };
}

function mapOrderSnapshotUpdateData(
  row: SalesOrderFlowSnapshotWrite
): Prisma.SalesOrderFlowSnapshotUncheckedUpdateInput {
  const created = mapOrderSnapshotCreateData(row);
  const { salesOrderId: _orderId, ...rest } = created;
  return rest;
}

export async function findSalesOrderFlowSnapshotByOrderId(
  db: SalesOrderFlowRepositoryDb,
  salesOrderId: string
) {
  return db.salesOrderFlowSnapshot.findUnique({
    where: { salesOrderId },
  });
}

/**
 * Leitura em lote sem N+1. Retorna Map salesOrderId → snapshot | null.
 */
export async function findSalesOrderFlowSnapshotsByOrderIds(
  db: SalesOrderFlowRepositoryDb,
  salesOrderIds: readonly string[]
): Promise<Map<string, Awaited<ReturnType<typeof findSalesOrderFlowSnapshotByOrderId>>>> {
  const ids = dedupeIds(salesOrderIds);
  const result = new Map<
    string,
    Awaited<ReturnType<typeof findSalesOrderFlowSnapshotByOrderId>>
  >();
  for (const id of ids) result.set(id, null);
  if (ids.length === 0) return result;

  const rows = await db.salesOrderFlowSnapshot.findMany({
    where: { salesOrderId: { in: ids } },
  });
  for (const row of rows) {
    result.set(row.salesOrderId, row);
  }
  return result;
}

export async function findSalesOrderFlowSnapshotsByFingerprint(
  db: SalesOrderFlowRepositoryDb,
  fingerprint: string
) {
  return db.salesOrderFlowSnapshot.findMany({
    where: { fingerprint },
    orderBy: { salesOrderId: "asc" },
  });
}

export type UpsertSalesOrderFlowSnapshotResult = {
  action: "create" | "update";
  id: string;
};

export async function upsertSalesOrderFlowSnapshot(
  db: SalesOrderFlowRepositoryDb,
  row: SalesOrderFlowSnapshotWrite
): Promise<UpsertSalesOrderFlowSnapshotResult> {
  const existing = await db.salesOrderFlowSnapshot.findUnique({
    where: { salesOrderId: row.salesOrderId },
    select: { id: true },
  });

  if (!existing) {
    const created = await db.salesOrderFlowSnapshot.create({
      data: mapOrderSnapshotCreateData(row),
      select: { id: true },
    });
    return { action: "create", id: created.id };
  }

  const updated = await db.salesOrderFlowSnapshot.update({
    where: { salesOrderId: row.salesOrderId },
    data: mapOrderSnapshotUpdateData(row),
    select: { id: true },
  });
  return { action: "update", id: updated.id };
}

// ---------------------------------------------------------------------------
// Events (append-only)
// ---------------------------------------------------------------------------

export type SalesOrderFlowEventWrite = {
  salesOrderId: string;
  salesOrderItemId?: string | null;
  eventType: string;
  fromStage?: string | null;
  toStage?: string | null;
  dedupeKey: string;
  /** Alias sanitizado — persiste em payloadJson. */
  detailsJson?: Prisma.InputJsonValue | null;
  /** @deprecated Preferir detailsJson (mesmo destino). */
  payloadJson?: Prisma.InputJsonValue | null;
  actorId?: string | null;
  /** Melhor evidência real do fato. */
  occurredAt?: Date;
  /** Quando o IndusCost observou/materializou. */
  observedAt?: Date | null;
};

export type AppendSalesOrderFlowEventResult = {
  action: "created" | "duplicate";
  id: string;
};

export async function appendSalesOrderFlowEvent(
  db: SalesOrderFlowRepositoryDb,
  row: SalesOrderFlowEventWrite
): Promise<AppendSalesOrderFlowEventResult> {
  const existing = await db.salesOrderFlowEvent.findUnique({
    where: { dedupeKey: row.dedupeKey },
    select: { id: true },
  });
  if (existing) {
    return { action: "duplicate", id: existing.id };
  }

  const details = row.detailsJson !== undefined ? row.detailsJson : row.payloadJson;

  const created = await db.salesOrderFlowEvent.create({
    data: {
      salesOrderId: row.salesOrderId,
      salesOrderItemId: row.salesOrderItemId ?? null,
      eventType: row.eventType,
      fromStage: row.fromStage ?? null,
      toStage: row.toStage ?? null,
      dedupeKey: row.dedupeKey,
      payloadJson: asJsonInput(details),
      actorId: row.actorId ?? null,
      ...(row.occurredAt ? { occurredAt: row.occurredAt } : {}),
      ...(row.observedAt !== undefined ? { observedAt: row.observedAt } : {}),
    },
    select: { id: true },
  });
  return { action: "created", id: created.id };
}

export type SalesOrderFlowEventPageOptions = {
  /** Página (0-based). Default 0. */
  page?: number;
  /** Tamanho da página. Default 50. Cap 500. */
  pageSize?: number;
};

export type SalesOrderFlowEventPage = {
  items: Awaited<ReturnType<SalesOrderFlowRepositoryDb["salesOrderFlowEvent"]["findMany"]>>;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
};

export async function findSalesOrderFlowEventsByOrderId(
  db: SalesOrderFlowRepositoryDb,
  salesOrderId: string,
  options: SalesOrderFlowEventPageOptions = {}
): Promise<SalesOrderFlowEventPage> {
  const page = Math.max(0, options.page ?? 0);
  const pageSize = Math.min(500, Math.max(1, options.pageSize ?? 50));
  const skip = page * pageSize;

  const [total, items] = await Promise.all([
    db.salesOrderFlowEvent.count({ where: { salesOrderId } }),
    db.salesOrderFlowEvent.findMany({
      where: { salesOrderId },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
  ]);

  return {
    items,
    page,
    pageSize,
    total,
    hasMore: skip + items.length < total,
  };
}

// ---------------------------------------------------------------------------
// Management overlay
// ---------------------------------------------------------------------------

export type SalesOrderFlowManagementWrite = {
  salesOrderId: string;
  priority?: string;
  responsibleUserId?: string | null;
  responsibleName?: string | null;
  responsibleArea?: string | null;
  isBlocked?: boolean;
  blockReason?: string | null;
  reason?: string | null;
  expectedResolutionAt?: Date | null;
  internalNote?: string | null;
};

export type SalesOrderFlowManagementPatch = Omit<
  SalesOrderFlowManagementWrite,
  "salesOrderId"
>;

export async function findSalesOrderFlowManagementByOrderId(
  db: SalesOrderFlowRepositoryDb,
  salesOrderId: string
) {
  return db.salesOrderFlowManagement.findUnique({
    where: { salesOrderId },
  });
}

/**
 * Leitura em lote sem N+1. Retorna Map salesOrderId → management | null.
 */
export async function findSalesOrderFlowManagementByOrderIds(
  db: SalesOrderFlowRepositoryDb,
  salesOrderIds: readonly string[]
): Promise<Map<string, Awaited<ReturnType<typeof findSalesOrderFlowManagementByOrderId>>>> {
  const ids = dedupeIds(salesOrderIds);
  const result = new Map<
    string,
    Awaited<ReturnType<typeof findSalesOrderFlowManagementByOrderId>>
  >();
  for (const id of ids) result.set(id, null);
  if (ids.length === 0) return result;

  const rows = await db.salesOrderFlowManagement.findMany({
    where: { salesOrderId: { in: ids } },
  });
  for (const row of rows) {
    result.set(row.salesOrderId, row);
  }
  return result;
}

export type UpsertSalesOrderFlowManagementResult = {
  action: "create" | "update";
  id: string;
};

export async function upsertSalesOrderFlowManagement(
  db: SalesOrderFlowRepositoryDb,
  row: SalesOrderFlowManagementWrite
): Promise<UpsertSalesOrderFlowManagementResult> {
  const existing = await db.salesOrderFlowManagement.findUnique({
    where: { salesOrderId: row.salesOrderId },
    select: { id: true },
  });

  const data = {
    priority: row.priority ?? "NORMAL",
    responsibleUserId: row.responsibleUserId ?? null,
    responsibleName: row.responsibleName ?? null,
    responsibleArea: row.responsibleArea ?? null,
    isBlocked: row.isBlocked ?? false,
    blockReason: row.blockReason ?? null,
    reason: row.reason ?? null,
    expectedResolutionAt: row.expectedResolutionAt ?? null,
    internalNote: row.internalNote ?? null,
  };

  if (!existing) {
    const created = await db.salesOrderFlowManagement.create({
      data: {
        salesOrderId: row.salesOrderId,
        ...data,
      },
      select: { id: true },
    });
    return { action: "create", id: created.id };
  }

  const updated = await db.salesOrderFlowManagement.update({
    where: { salesOrderId: row.salesOrderId },
    data,
    select: { id: true },
  });
  return { action: "update", id: updated.id };
}

/**
 * Atualiza campos do management existente. Retorna null se o pedido não tiver overlay.
 */
export async function updateSalesOrderFlowManagement(
  db: SalesOrderFlowRepositoryDb,
  salesOrderId: string,
  patch: SalesOrderFlowManagementPatch
) {
  const existing = await db.salesOrderFlowManagement.findUnique({
    where: { salesOrderId },
    select: { id: true },
  });
  if (!existing) return null;

  const data: Prisma.SalesOrderFlowManagementUncheckedUpdateInput = {};
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.responsibleUserId !== undefined) {
    data.responsibleUserId = patch.responsibleUserId;
  }
  if (patch.responsibleName !== undefined) data.responsibleName = patch.responsibleName;
  if (patch.responsibleArea !== undefined) data.responsibleArea = patch.responsibleArea;
  if (patch.isBlocked !== undefined) data.isBlocked = patch.isBlocked;
  if (patch.blockReason !== undefined) data.blockReason = patch.blockReason;
  if (patch.reason !== undefined) data.reason = patch.reason;
  if (patch.expectedResolutionAt !== undefined) {
    data.expectedResolutionAt = patch.expectedResolutionAt;
  }
  if (patch.internalNote !== undefined) data.internalNote = patch.internalNote;

  return db.salesOrderFlowManagement.update({
    where: { salesOrderId },
    data,
  });
}
