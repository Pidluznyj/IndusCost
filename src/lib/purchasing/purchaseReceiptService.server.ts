/**
 * Serviço de Recebimento de Compra (OP-22).
 * Confirmação gera PURCHASE_RECEIPT no ledger SC; estorno gera REVERSAL (não apaga).
 * Sem Nomus / Contas a Pagar / custo publicado.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  createInventoryMovementInTx,
  reverseInventoryMovementInTx,
  type CreateInventoryMovementContext,
} from "@/src/lib/inventory/inventoryService.server.js";
import { InventoryValidationError } from "@/src/lib/inventory/inventoryTypes.js";
import {
  resolvePurchaseOrderTransition,
  type PurchaseOrderAction,
  type PurchaseOrderStatusName,
} from "./purchaseOrderWorkflow.js";
import {
  assertAcceptanceWithinOpenBalance,
  assertCanConfirmReceipt,
  assertCanReverseConfirmedReceipt,
  assertDraftEditable,
  buildReceiptConfirmIdempotencyKey,
  buildReceiptLineMovementIdempotencyKey,
  buildReceiptLineOriginId,
  computeEffectiveLineCost,
  computeQuantityPending,
  PurchaseReceiptError,
  resolvePurchaseOrderReceiptStatus,
  type PurchaseReceiptStatusName,
} from "./purchaseReceiptWorkflow.js";

export type ReceiptActor = {
  userId: string;
  userName?: string | null;
  permissions?: readonly string[];
};

export type ReceiptLineInput = {
  purchaseOrderItemId: string;
  quantityReceived: number;
  quantityAccepted: number;
  quantityRejected?: number;
  lotNumber?: string | null;
  unitCostSnapshot?: number | null;
  effectiveUnitCost?: number | null;
  notes?: string | null;
};

export type CreateReceiptInput = {
  purchaseOrderId: string;
  warehouseId: string;
  locationId?: string | null;
  receivedAt?: string | Date | null;
  documentNumber?: string | null;
  entryDocumentRef?: string | null;
  nfeNumber?: string | null;
  nfeId?: string | null;
  freightValueActual?: number | null;
  expensesActual?: number | null;
  notes?: string | null;
  responsibleUserId?: string | null;
  responsibleUserName?: string | null;
  items: ReceiptLineInput[];
  idempotencyKey?: string | null;
};

const DETAIL_INCLUDE = {
  items: { orderBy: { createdAt: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
  purchaseOrder: {
    select: {
      id: true,
      code: true,
      status: true,
      supplierDisplayNameSnapshot: true,
    },
  },
} as const;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toDec(v: number | null | undefined): Prisma.Decimal | null {
  if (v == null || !Number.isFinite(v)) return null;
  return new Prisma.Decimal(v);
}

function parseDate(v: string | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function nextReceiptCode(db: PrismaClient | Prisma.TransactionClient): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `REC-${year}-`;
  const last = await db.purchaseReceipt.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let seq = 1;
  if (last?.code) {
    const part = last.code.slice(prefix.length);
    const n = Number(part);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(5, "0")}`;
}

async function writeHistory(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    receiptId: string;
    action: string;
    fromStatus?: PurchaseReceiptStatusName | null;
    toStatus?: PurchaseReceiptStatusName | null;
    reason?: string | null;
    notes?: string | null;
    userId?: string | null;
    userName?: string | null;
    metaJson?: Prisma.InputJsonValue;
  }
) {
  await db.purchaseReceiptHistoryEvent.create({
    data: {
      receiptId: input.receiptId,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      metaJson: input.metaJson ?? undefined,
    },
  });
}

async function loadConfirmedAcceptedByPoItem(
  db: PrismaClient | Prisma.TransactionClient,
  purchaseOrderId: string,
  excludeReceiptId?: string
): Promise<Map<string, number>> {
  const receipts = await db.purchaseReceipt.findMany({
    where: {
      purchaseOrderId,
      status: "APROVADO",
      ...(excludeReceiptId ? { id: { not: excludeReceiptId } } : {}),
    },
    select: {
      items: { select: { purchaseOrderItemId: true, quantityAccepted: true } },
    },
  });
  const map = new Map<string, number>();
  for (const r of receipts) {
    for (const item of r.items) {
      const prev = map.get(item.purchaseOrderItemId) ?? 0;
      map.set(item.purchaseOrderItemId, prev + num(item.quantityAccepted));
    }
  }
  return map;
}

async function resolveInventoryItemId(
  db: PrismaClient | Prisma.TransactionClient,
  poItem: {
    inventoryItemId: string | null;
    materialId: string | null;
  }
): Promise<string> {
  if (poItem.inventoryItemId) {
    const item = await db.inventoryItem.findUnique({
      where: { id: poItem.inventoryItemId },
      select: { id: true, status: true, controlsStock: true },
    });
    if (!item || item.status !== "ACTIVE") {
      throw new PurchaseReceiptError(
        "Item logístico vinculado ao pedido está inativo ou ausente.",
        "INVENTORY_ITEM_INVALID"
      );
    }
    return item.id;
  }
  if (!poItem.materialId) {
    throw new PurchaseReceiptError(
      "Linha do pedido sem matéria-prima oficial nem item logístico.",
      "MATERIAL_REQUIRED"
    );
  }
  const linked = await db.inventoryItem.findFirst({
    where: { materialId: poItem.materialId, status: "ACTIVE", controlsStock: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!linked) {
    throw new PurchaseReceiptError(
      "Não há item logístico ativo vinculado à matéria-prima oficial da linha.",
      "INVENTORY_ITEM_REQUIRED"
    );
  }
  return linked.id;
}

async function syncPurchaseOrderStatusFromReceipts(
  db: PrismaClient | Prisma.TransactionClient,
  purchaseOrderId: string,
  actor: ReceiptActor
) {
  const po = await db.purchaseOrder.findUnique({
    where: { id: purchaseOrderId },
    include: { items: { select: { id: true, quantityOrdered: true } } },
  });
  if (!po) return;
  if (po.status !== "CONFIRMADO" && po.status !== "PARCIALMENTE_RECEBIDO" && po.status !== "RECEBIDO") {
    return;
  }

  const acceptedMap = await loadConfirmedAcceptedByPoItem(db, purchaseOrderId);
  const agg = po.items.map((it) => ({
    purchaseOrderItemId: it.id,
    quantityOrdered: num(it.quantityOrdered),
    quantityAcceptedConfirmed: acceptedMap.get(it.id) ?? 0,
  }));
  const next = resolvePurchaseOrderReceiptStatus(agg);
  const current = po.status as PurchaseOrderStatusName;
  const resolved: PurchaseOrderStatusName = next ?? "CONFIRMADO";
  if (current === resolved) return;

  // O recebimento gravava o status direto, por fora da máquina de estados —
  // inclusive o RECEBIDO → CONFIRMADO do estorno, que nem sequer era uma
  // transição declarada. Agora o alvo calculado é validado pela máquina, que
  // volta a ser fonte única. O conjunto é fechado: `current` só pode ser
  // CONFIRMADO | PARCIALMENTE_RECEBIDO | RECEBIDO (guarda acima) e `resolved`
  // só pode ser esses mesmos três, então são 6 pares possíveis — todos
  // declarados. Se algum dia surgir um sétimo, isto falha alto em vez de
  // gravar um status que a máquina não reconhece.
  const action: PurchaseOrderAction =
    resolved === "RECEBIDO"
      ? "MARK_RECEIVED"
      : resolved === "PARCIALMENTE_RECEBIDO"
        ? "MARK_PARTIAL_RECEIVED"
        : "REOPEN_FROM_RECEIPT";
  resolvePurchaseOrderTransition(current, action);

  await db.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: {
      status: resolved,
      futureEntryPending: resolved !== "RECEBIDO",
    },
  });
  await db.purchaseOrderHistoryEvent.create({
    data: {
      purchaseOrderId,
      action: `RECEIPT_${resolved}`,
      fromStatus: current,
      toStatus: resolved,
      userId: actor.userId,
      userName: actor.userName ?? null,
      metaJson: { source: "purchase-receipt", createsAccountsPayable: false, writesNomus: false },
    },
  });
}

export async function listPurchaseReceipts(
  prisma: PrismaClient,
  filters?: { purchaseOrderId?: string; status?: string }
) {
  return prisma.purchaseReceipt.findMany({
    where: {
      ...(filters?.purchaseOrderId ? { purchaseOrderId: filters.purchaseOrderId } : {}),
      ...(filters?.status ? { status: filters.status as PurchaseReceiptStatusName } : {}),
    },
    include: {
      purchaseOrder: { select: { id: true, code: true, status: true } },
      items: true,
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getPurchaseReceiptDetail(prisma: PrismaClient, id: string) {
  const row = await prisma.purchaseReceipt.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
  if (!row) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");

  const acceptedMap = await loadConfirmedAcceptedByPoItem(prisma, row.purchaseOrderId);
  const poItems = await prisma.purchaseOrderItem.findMany({
    where: { purchaseOrderId: row.purchaseOrderId },
    select: { id: true, quantityOrdered: true },
  });
  const pendingByItem = Object.fromEntries(
    poItems.map((it) => [
      it.id,
      computeQuantityPending(num(it.quantityOrdered), acceptedMap.get(it.id) ?? 0),
    ])
  );

  return {
    ...row,
    pendingByItem,
    meta: {
      postsPurchaseReceiptLedger: row.status === "APROVADO",
      createsAccountsPayable: false,
      writesNomusStock: false,
      updatesPublishedCost: false,
    },
  };
}

export async function createPurchaseReceiptDraft(
  prisma: PrismaClient,
  input: CreateReceiptInput,
  actor: ReceiptActor
) {
  if (!input.items?.length) {
    throw new PurchaseReceiptError("Informe ao menos uma linha de recebimento.", "ITEMS_REQUIRED");
  }
  if (!input.warehouseId?.trim()) {
    throw new PurchaseReceiptError("Almoxarifado destino é obrigatório.", "WAREHOUSE_REQUIRED");
  }

  const po = await prisma.purchaseOrder.findUnique({
    where: { id: input.purchaseOrderId },
    include: { items: true },
  });
  if (!po) throw new PurchaseReceiptError("Pedido de compra não encontrado.", "PO_NOT_FOUND");
  if (po.status !== "CONFIRMADO" && po.status !== "PARCIALMENTE_RECEBIDO") {
    throw new PurchaseReceiptError(
      "Só pedidos CONFIRMADO ou PARCIALMENTE_RECEBIDO aceitam recebimento.",
      "PO_STATUS_INVALID"
    );
  }

  const warehouse = await prisma.inventoryWarehouse.findUnique({
    where: { id: input.warehouseId },
    select: { id: true, code: true, status: true },
  });
  if (!warehouse || warehouse.status !== "ACTIVE") {
    throw new PurchaseReceiptError("Almoxarifado inválido ou inativo.", "WAREHOUSE_INVALID");
  }

  const acceptedMap = await loadConfirmedAcceptedByPoItem(prisma, po.id);
  const poItemById = new Map(po.items.map((i) => [i.id, i]));

  for (const line of input.items) {
    const poItem = poItemById.get(line.purchaseOrderItemId);
    if (!poItem) {
      throw new PurchaseReceiptError("Linha de pedido inválida neste PC.", "PO_ITEM_INVALID");
    }
    assertAcceptanceWithinOpenBalance(
      {
        purchaseOrderItemId: line.purchaseOrderItemId,
        quantityOrdered: num(poItem.quantityOrdered),
        quantityReceived: line.quantityReceived,
        quantityAccepted: line.quantityAccepted,
        quantityRejected: line.quantityRejected ?? 0,
      },
      acceptedMap.get(line.purchaseOrderItemId) ?? 0
    );
  }

  const code = await nextReceiptCode(prisma);
  const receivedAt = parseDate(input.receivedAt) ?? new Date();

  const created = await prisma.$transaction(async (tx) => {
    const receipt = await tx.purchaseReceipt.create({
      data: {
        code,
        purchaseOrderId: po.id,
        status: "RASCUNHO",
        receivedAt,
        warehouseId: warehouse.id,
        warehouseCodeSnapshot: warehouse.code,
        locationId: input.locationId ?? null,
        documentNumber: input.documentNumber?.trim() || null,
        entryDocumentRef: input.entryDocumentRef?.trim() || input.nfeNumber?.trim() || null,
        nfeNumber: input.nfeNumber?.trim() || null,
        nfeId: input.nfeId?.trim() || null,
        freightValueActual: toDec(input.freightValueActual ?? null),
        expensesActual: toDec(input.expensesActual ?? null),
        notes: input.notes?.trim() || null,
        responsibleUserId: input.responsibleUserId ?? actor.userId,
        responsibleUserName: input.responsibleUserName ?? actor.userName ?? null,
        items: {
          create: input.items.map((line) => {
            const poItem = poItemById.get(line.purchaseOrderItemId)!;
            const effectiveUnit = line.effectiveUnitCost ?? line.unitCostSnapshot ?? num(poItem.unitPriceSnapshot);
            const effectiveLine = computeEffectiveLineCost({
              quantityAccepted: line.quantityAccepted,
              effectiveUnitCost: effectiveUnit,
              unitCostSnapshot: line.unitCostSnapshot ?? null,
            });
            return {
              purchaseOrderItemId: line.purchaseOrderItemId,
              materialId: poItem.materialId,
              materialCodeSnapshot: poItem.materialCodeSnapshot,
              materialDescriptionSnapshot: poItem.materialDescriptionSnapshot,
              quantityReceived: new Prisma.Decimal(line.quantityReceived),
              quantityAccepted: new Prisma.Decimal(line.quantityAccepted),
              quantityRejected: new Prisma.Decimal(line.quantityRejected ?? 0),
              unit: poItem.unit,
              lotNumber: line.lotNumber?.trim() || null,
              unitCostSnapshot: toDec(line.unitCostSnapshot ?? num(poItem.unitPriceSnapshot)),
              effectiveUnitCost: toDec(effectiveUnit),
              effectiveLineCost: toDec(effectiveLine),
              notes: line.notes?.trim() || null,
            };
          }),
        },
      },
      include: DETAIL_INCLUDE,
    });

    await writeHistory(tx, {
      receiptId: receipt.id,
      action: "CREATE_DRAFT",
      fromStatus: null,
      toStatus: "RASCUNHO",
      userId: actor.userId,
      userName: actor.userName,
      metaJson: { createsAccountsPayable: false, writesNomus: false },
    });

    return receipt;
  });

  return created;
}

export async function confirmPurchaseReceipt(
  prisma: PrismaClient,
  receiptId: string,
  actor: ReceiptActor,
  options?: { idempotencyKey?: string | null }
) {
  const confirmKey = buildReceiptConfirmIdempotencyKey(receiptId, options?.idempotencyKey);

  const existing = await prisma.purchaseReceipt.findUnique({
    where: { id: receiptId },
    include: DETAIL_INCLUDE,
  });
  if (!existing) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");

  if (existing.status === "APROVADO" && existing.confirmIdempotencyKey === confirmKey) {
    return { receipt: existing, idempotent: true as const };
  }
  if (existing.status === "APROVADO") {
    return { receipt: existing, idempotent: true as const };
  }

  assertCanConfirmReceipt(existing.status);
  assertDraftEditable(existing.status);

  if (!existing.warehouseId) {
    throw new PurchaseReceiptError("Almoxarifado é obrigatório para confirmar.", "WAREHOUSE_REQUIRED");
  }
  if (!existing.items.length) {
    throw new PurchaseReceiptError("Recebimento sem linhas.", "ITEMS_REQUIRED");
  }

  const inventoryContext: CreateInventoryMovementContext = {
    userId: actor.userId,
    permissions: actor.permissions ?? [
      "inventory.movement.create",
      "inventory.movements.create",
      "inventory.manage",
    ],
  };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.purchaseReceipt.findUnique({
        where: { id: receiptId },
        include: {
          items: true,
          purchaseOrder: { select: { id: true, code: true, status: true } },
        },
      });
      if (!locked) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");
      if (locked.status === "APROVADO") {
        const full = await tx.purchaseReceipt.findUnique({
          where: { id: receiptId },
          include: DETAIL_INCLUDE,
        });
        return { receipt: full!, idempotent: true as const };
      }
      assertCanConfirmReceipt(locked.status);

      const acceptedMap = await loadConfirmedAcceptedByPoItem(tx, locked.purchaseOrderId, locked.id);
      const poItems = await tx.purchaseOrderItem.findMany({
        where: { purchaseOrderId: locked.purchaseOrderId },
      });
      const poItemById = new Map(poItems.map((i) => [i.id, i]));

      const movementIds: string[] = [];
      const now = new Date();

      for (const line of locked.items) {
        const poItem = poItemById.get(line.purchaseOrderItemId);
        if (!poItem) {
          throw new PurchaseReceiptError("Linha de pedido inválida.", "PO_ITEM_INVALID");
        }
        assertAcceptanceWithinOpenBalance(
          {
            purchaseOrderItemId: line.purchaseOrderItemId,
            quantityOrdered: num(poItem.quantityOrdered),
            quantityReceived: num(line.quantityReceived),
            quantityAccepted: num(line.quantityAccepted),
            quantityRejected: num(line.quantityRejected),
          },
          acceptedMap.get(line.purchaseOrderItemId) ?? 0
        );

        const acceptedQty = num(line.quantityAccepted);
        if (acceptedQty <= 0) {
          continue; // rejeitada/zero não gera ledger
        }

        const inventoryItemId = await resolveInventoryItemId(tx, poItem);
        const unitCost =
          line.effectiveUnitCost != null
            ? num(line.effectiveUnitCost)
            : line.unitCostSnapshot != null
              ? num(line.unitCostSnapshot)
              : null;

        const posted = await createInventoryMovementInTx(
          tx,
          prisma,
          {
            itemId: inventoryItemId,
            destinationWarehouseId: locked.warehouseId!,
            destinationLocationId: locked.locationId,
            movementType: "PURCHASE_RECEIPT",
            quantity: acceptedQty,
            unit: line.unit,
            reason: `Recebimento ${locked.code} / PC ${locked.purchaseOrder.code}`,
            notes: line.notes ?? locked.notes,
            documentNumber: locked.documentNumber ?? locked.entryDocumentRef ?? locked.nfeNumber,
            unitCost,
            originType: "PURCHASE",
            originId: buildReceiptLineOriginId(line.id),
            idempotencyKey: buildReceiptLineMovementIdempotencyKey(line.id),
            responsibleUserId: locked.responsibleUserId ?? actor.userId,
            movementDate: locked.receivedAt ?? now,
            purchaseOrderId: locked.purchaseOrderId,
            lotNumber: line.lotNumber,
            evidenceRef: locked.entryDocumentRef ?? locked.nfeNumber,
          },
          inventoryContext
        );

        movementIds.push(posted.movement.id);
        await tx.purchaseReceiptItem.update({
          where: { id: line.id },
          data: { inventoryMovementId: posted.movement.id },
        });
      }

      const updated = await tx.purchaseReceipt.update({
        where: { id: locked.id },
        data: {
          status: "APROVADO",
          approvedAt: now,
          approvedByUserId: actor.userId,
          confirmedAt: now,
          confirmedByUserId: actor.userId,
          confirmIdempotencyKey: confirmKey,
          inventoryMovementId: movementIds[0] ?? null,
        },
        include: DETAIL_INCLUDE,
      });

      await writeHistory(tx, {
        receiptId: locked.id,
        action: "CONFIRM",
        fromStatus: locked.status as PurchaseReceiptStatusName,
        toStatus: "APROVADO",
        userId: actor.userId,
        userName: actor.userName,
        metaJson: {
          movementIds,
          movementType: "PURCHASE_RECEIPT",
          createsAccountsPayable: false,
          writesNomus: false,
          updatesPublishedCost: false,
        },
      });

      await syncPurchaseOrderStatusFromReceipts(tx, locked.purchaseOrderId, actor);

      return { receipt: updated, idempotent: false as const };
    });

    return result;
  } catch (e) {
    if (e instanceof PurchaseReceiptError) throw e;
    if (e instanceof InventoryValidationError) {
      throw new PurchaseReceiptError(e.message, e.code);
    }
    throw e;
  }
}

export async function reversePurchaseReceipt(
  prisma: PrismaClient,
  receiptId: string,
  actor: ReceiptActor,
  reason: string
) {
  if (!reason?.trim()) {
    throw new PurchaseReceiptError("Motivo do estorno é obrigatório.", "REASON_REQUIRED");
  }

  const existing = await prisma.purchaseReceipt.findUnique({
    where: { id: receiptId },
    include: DETAIL_INCLUDE,
  });
  if (!existing) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");
  if (existing.status === "ESTORNADO") {
    return { receipt: existing, idempotent: true as const };
  }
  assertCanReverseConfirmedReceipt(existing.status);

  const inventoryContext: CreateInventoryMovementContext = {
    userId: actor.userId,
    permissions: actor.permissions ?? [
      "inventory.movement.create",
      "inventory.movements.create",
      "inventory.manage",
    ],
  };

  const result = await prisma.$transaction(async (tx) => {
    const locked = await tx.purchaseReceipt.findUnique({
      where: { id: receiptId },
      include: { items: true },
    });
    if (!locked) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");
    if (locked.status === "ESTORNADO") {
      const full = await tx.purchaseReceipt.findUnique({
        where: { id: receiptId },
        include: DETAIL_INCLUDE,
      });
      return { receipt: full!, idempotent: true as const };
    }
    assertCanReverseConfirmedReceipt(locked.status);

    const reversalIds: string[] = [];
    for (const line of locked.items) {
      if (!line.inventoryMovementId) continue;
      const reversed = await reverseInventoryMovementInTx(
        tx,
        prisma,
        line.inventoryMovementId,
        inventoryContext,
        reason.trim(),
        { idempotent: true }
      );
      reversalIds.push(reversed.movement.id);
      await tx.purchaseReceiptItem.update({
        where: { id: line.id },
        data: { reversalMovementId: reversed.movement.id },
      });
    }

    const now = new Date();
    const updated = await tx.purchaseReceipt.update({
      where: { id: locked.id },
      data: {
        status: "ESTORNADO",
        reversedAt: now,
        reversedByUserId: actor.userId,
        reverseReason: reason.trim(),
        reversalMovementId: reversalIds[0] ?? null,
      },
      include: DETAIL_INCLUDE,
    });

    await writeHistory(tx, {
      receiptId: locked.id,
      action: "REVERSE",
      fromStatus: "APROVADO",
      toStatus: "ESTORNADO",
      reason: reason.trim(),
      userId: actor.userId,
      userName: actor.userName,
      metaJson: {
        reversalIds,
        originalMovementsPreserved: true,
        createsAccountsPayable: false,
        writesNomus: false,
      },
    });

    await syncPurchaseOrderStatusFromReceipts(tx, locked.purchaseOrderId, actor);
    return { receipt: updated, idempotent: false as const };
  });

  return result;
}

export async function cancelPurchaseReceiptDraft(
  prisma: PrismaClient,
  receiptId: string,
  actor: ReceiptActor,
  reason?: string | null
) {
  const existing = await prisma.purchaseReceipt.findUnique({ where: { id: receiptId } });
  if (!existing) throw new PurchaseReceiptError("Recebimento não encontrado.", "NOT_FOUND");
  assertDraftEditable(existing.status);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.purchaseReceipt.update({
      where: { id: receiptId },
      data: { status: "CANCELADO" },
      include: DETAIL_INCLUDE,
    });
    await writeHistory(tx, {
      receiptId,
      action: "CANCEL_DRAFT",
      fromStatus: existing.status as PurchaseReceiptStatusName,
      toStatus: "CANCELADO",
      reason: reason ?? null,
      userId: actor.userId,
      userName: actor.userName,
    });
    return updated;
  });
}

export function mapPurchaseReceiptError(e: unknown): { status: number; body: Record<string, unknown> } {
  if (e instanceof PurchaseReceiptError) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  if (e instanceof InventoryValidationError) {
    return { status: 400, body: { error: e.message, code: e.code } };
  }
  console.error("purchase-receipt error:", e);
  return { status: 500, body: { error: "Erro no recebimento de compra." } };
}
