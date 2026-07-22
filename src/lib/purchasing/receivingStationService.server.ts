/**
 * Estação operacional de Recebimento (OP-23) — agregação read-model.
 * Pedido confirmado ≠ estoque; só recebimento confirmado altera saldo físico.
 */
import type { PrismaClient } from "@prisma/client";
import { computeQuantityPending, PurchaseReceiptError } from "./purchaseReceiptWorkflow.js";

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export type ReceivingStationFilters = {
  q?: string;
  poStatus?: string;
  supplierId?: string;
  page?: number;
  pageSize?: number;
};

export type ReceivingLineTotals = {
  quantityOrdered: number;
  quantityReceived: number;
  quantityAcceptedConfirmed: number;
  quantityRejected: number;
  quantityCancelled: number;
  quantityPending: number;
  negotiatedUnitCost: number | null;
  receivedUnitCost: number | null;
};

/** Agrega totais por linha de PC a partir dos recebimentos. */
export function aggregateReceivingLineTotals(input: {
  quantityOrdered: number;
  negotiatedUnitCost: number | null;
  receipts: Array<{
    status: string;
    quantityReceived: number;
    quantityAccepted: number;
    quantityRejected: number;
    effectiveUnitCost: number | null;
    unitCostSnapshot: number | null;
  }>;
}): ReceivingLineTotals {
  let quantityReceived = 0;
  let quantityAcceptedConfirmed = 0;
  let quantityRejected = 0;
  let quantityCancelled = 0;
  let receivedCostSum = 0;
  let receivedCostQty = 0;

  for (const r of input.receipts) {
    if (r.status === "CANCELADO") {
      quantityCancelled += r.quantityReceived;
      continue;
    }
    if (r.status === "ESTORNADO") {
      quantityCancelled += r.quantityAccepted;
      quantityRejected += r.quantityRejected;
      quantityReceived += r.quantityReceived;
      continue;
    }
    quantityReceived += r.quantityReceived;
    quantityRejected += r.quantityRejected;
    if (r.status === "APROVADO") {
      quantityAcceptedConfirmed += r.quantityAccepted;
      const unit = r.effectiveUnitCost ?? r.unitCostSnapshot;
      if (unit != null && r.quantityAccepted > 0) {
        receivedCostSum += unit * r.quantityAccepted;
        receivedCostQty += r.quantityAccepted;
      }
    }
  }

  return {
    quantityOrdered: input.quantityOrdered,
    quantityReceived,
    quantityAcceptedConfirmed,
    quantityRejected,
    quantityCancelled,
    quantityPending: computeQuantityPending(input.quantityOrdered, quantityAcceptedConfirmed),
    negotiatedUnitCost: input.negotiatedUnitCost,
    receivedUnitCost: receivedCostQty > 0 ? receivedCostSum / receivedCostQty : null,
  };
}

export async function listReceivingStationBoard(
  prisma: PrismaClient,
  filters: ReceivingStationFilters = {}
) {
  const page = Number.isFinite(filters.page) && (filters.page as number) > 0 ? Math.floor(filters.page!) : 1;
  const pageSizeRaw =
    Number.isFinite(filters.pageSize) && (filters.pageSize as number) > 0
      ? Math.floor(filters.pageSize!)
      : 20;
  const pageSize = Math.min(100, pageSizeRaw);

  const orders = await prisma.purchaseOrder.findMany({
    where: {
      status: filters.poStatus
        ? (filters.poStatus as "CONFIRMADO" | "PARCIALMENTE_RECEBIDO" | "RECEBIDO")
        : { in: ["CONFIRMADO", "PARCIALMENTE_RECEBIDO", "RECEBIDO"] },
      ...(filters.supplierId ? { supplierId: filters.supplierId } : {}),
      ...(filters.q?.trim()
        ? {
            OR: [
              { code: { contains: filters.q.trim(), mode: "insensitive" } },
              {
                supplierDisplayNameSnapshot: {
                  contains: filters.q.trim(),
                  mode: "insensitive",
                },
              },
            ],
          }
        : {}),
    },
    include: {
      items: {
        select: {
          id: true,
          quantityOrdered: true,
          unitPriceSnapshot: true,
        },
      },
      receipts: {
        include: {
          items: {
            select: {
              purchaseOrderItemId: true,
              quantityReceived: true,
              quantityAccepted: true,
              quantityRejected: true,
              effectiveUnitCost: true,
              unitCostSnapshot: true,
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 500,
  });

  const rows = orders.map((po) => {
    let quantityOrdered = 0;
    let quantityAcceptedConfirmed = 0;
    let quantityPending = 0;
    let quantityRejected = 0;
    let quantityCancelled = 0;
    let quantityReceived = 0;

    for (const item of po.items) {
      const itemReceipts = po.receipts.flatMap((r) =>
        r.items
          .filter((li) => li.purchaseOrderItemId === item.id)
          .map((li) => ({
            status: r.status,
            quantityReceived: num(li.quantityReceived),
            quantityAccepted: num(li.quantityAccepted),
            quantityRejected: num(li.quantityRejected),
            effectiveUnitCost: li.effectiveUnitCost != null ? num(li.effectiveUnitCost) : null,
            unitCostSnapshot: li.unitCostSnapshot != null ? num(li.unitCostSnapshot) : null,
          }))
      );
      const totals = aggregateReceivingLineTotals({
        quantityOrdered: num(item.quantityOrdered),
        negotiatedUnitCost: item.unitPriceSnapshot != null ? num(item.unitPriceSnapshot) : null,
        receipts: itemReceipts,
      });
      quantityOrdered += totals.quantityOrdered;
      quantityAcceptedConfirmed += totals.quantityAcceptedConfirmed;
      quantityPending += totals.quantityPending;
      quantityRejected += totals.quantityRejected;
      quantityCancelled += totals.quantityCancelled;
      quantityReceived += totals.quantityReceived;
    }

    return {
      id: po.id,
      code: po.code,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: po.supplierDisplayNameSnapshot,
      itemCount: po.items.length,
      receiptCount: po.receipts.length,
      quantityOrdered,
      quantityReceived,
      quantityAcceptedConfirmed,
      quantityRejected,
      quantityCancelled,
      quantityPending,
      confirmedAt: po.confirmedAt?.toISOString() ?? null,
      updatedAt: po.updatedAt.toISOString(),
      futureEntryPending: po.futureEntryPending,
      href: `/purchases/receiving/${po.id}`,
    };
  });

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;

  return {
    rows: rows.slice(start, start + pageSize),
    pagination: { page, pageSize, total, totalPages },
    meta: {
      featureFlag: "SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED",
      confirmedOrderIsNotStock: true,
      onlyConfirmedReceiptChangesPhysicalBalance: true,
      createsAccountsPayable: false,
      writesNomusStock: false,
    },
  };
}

export async function getReceivingStationOrderDetail(prisma: PrismaClient, orderId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { lineNumber: "asc" } },
      history: { orderBy: { createdAt: "asc" }, take: 100 },
      receipts: {
        include: {
          items: true,
          history: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!po) throw new PurchaseReceiptError("Pedido de compra não encontrado.", "PO_NOT_FOUND");

  const receiptIds = po.receipts.map((r) => r.id);
  const movementIds = po.receipts.flatMap((r) =>
    r.items
      .flatMap((i) => [i.inventoryMovementId, i.reversalMovementId])
      .filter((id): id is string => Boolean(id))
  );

  const [evidences, movements, warehouses] = await Promise.all([
    receiptIds.length
      ? prisma.purchaseEvidence.findMany({
          where: {
            deletedAt: null,
            OR: [
              { entityType: "RECEIPT", entityId: { in: receiptIds } },
              { entityType: "PURCHASE_ORDER", entityId: orderId },
            ],
          },
          orderBy: { uploadedAt: "desc" },
          take: 100,
          select: {
            id: true,
            entityType: true,
            entityId: true,
            originalFileName: true,
            evidenceType: true,
            description: true,
            uploadedByName: true,
            uploadedAt: true,
          },
        })
      : Promise.resolve([]),
    movementIds.length
      ? prisma.inventoryMovement.findMany({
          where: { id: { in: movementIds } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            movementType: true,
            quantity: true,
            unit: true,
            lotNumber: true,
            documentNumber: true,
            unitCost: true,
            destinationWarehouseId: true,
            destinationLocationId: true,
            purchaseOrderId: true,
            originId: true,
            reversedMovementId: true,
            createdAt: true,
            reason: true,
          },
        })
      : Promise.resolve([]),
    prisma.inventoryWarehouse.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
      take: 100,
    }),
  ]);

  const locationIds = [
    ...new Set(po.receipts.map((r) => r.locationId).filter((id): id is string => Boolean(id))),
  ];
  const locations = locationIds.length
    ? await prisma.inventoryLocation.findMany({
        where: { id: { in: locationIds } },
        select: { id: true, code: true, name: true, warehouseId: true },
      })
    : [];
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const lines = po.items.map((item) => {
    const itemReceipts = po.receipts.flatMap((r) =>
      r.items
        .filter((li) => li.purchaseOrderItemId === item.id)
        .map((li) => ({
          status: r.status,
          quantityReceived: num(li.quantityReceived),
          quantityAccepted: num(li.quantityAccepted),
          quantityRejected: num(li.quantityRejected),
          effectiveUnitCost: li.effectiveUnitCost != null ? num(li.effectiveUnitCost) : null,
          unitCostSnapshot: li.unitCostSnapshot != null ? num(li.unitCostSnapshot) : null,
          lotNumber: li.lotNumber,
          receiptId: r.id,
          receiptCode: r.code,
        }))
    );
    const totals = aggregateReceivingLineTotals({
      quantityOrdered: num(item.quantityOrdered),
      negotiatedUnitCost: item.unitPriceSnapshot != null ? num(item.unitPriceSnapshot) : null,
      receipts: itemReceipts,
    });
    return {
      id: item.id,
      lineNumber: item.lineNumber,
      description: item.description,
      materialId: item.materialId,
      materialCode: item.materialCodeSnapshot,
      unit: item.unit,
      lots: [...new Set(itemReceipts.map((r) => r.lotNumber).filter(Boolean))],
      ...totals,
      receiptLines: itemReceipts,
    };
  });

  return {
    order: {
      id: po.id,
      code: po.code,
      status: po.status,
      supplierId: po.supplierId,
      supplierName: po.supplierDisplayNameSnapshot,
      supplierDocument: po.supplierDocumentSnapshot,
      confirmedAt: po.confirmedAt?.toISOString() ?? null,
      futureEntryPending: po.futureEntryPending,
      currency: po.currency,
      notes: po.notes,
    },
    lines,
    receipts: po.receipts.map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      receivedAt: r.receivedAt?.toISOString() ?? null,
      warehouseId: r.warehouseId,
      warehouseCode: r.warehouseCodeSnapshot,
      locationId: r.locationId,
      location: r.locationId ? locationById.get(r.locationId) ?? null : null,
      documentNumber: r.documentNumber,
      entryDocumentRef: r.entryDocumentRef,
      nfeNumber: r.nfeNumber,
      freightValueActual: r.freightValueActual != null ? num(r.freightValueActual) : null,
      expensesActual: r.expensesActual != null ? num(r.expensesActual) : null,
      notes: r.notes,
      responsibleUserName: r.responsibleUserName,
      confirmedAt: r.confirmedAt?.toISOString() ?? null,
      reversedAt: r.reversedAt?.toISOString() ?? null,
      reverseReason: r.reverseReason,
      items: r.items.map((i) => ({
        id: i.id,
        purchaseOrderItemId: i.purchaseOrderItemId,
        quantityReceived: num(i.quantityReceived),
        quantityAccepted: num(i.quantityAccepted),
        quantityRejected: num(i.quantityRejected),
        unit: i.unit,
        lotNumber: i.lotNumber,
        negotiatedUnitCostHint: null as number | null,
        effectiveUnitCost: i.effectiveUnitCost != null ? num(i.effectiveUnitCost) : null,
        effectiveLineCost: i.effectiveLineCost != null ? num(i.effectiveLineCost) : null,
        inventoryMovementId: i.inventoryMovementId,
        reversalMovementId: i.reversalMovementId,
      })),
      history: r.history,
    })),
    orderHistory: po.history,
    evidences,
    inventoryMovements: movements.map((m) => ({
      ...m,
      quantity: num(m.quantity),
      unitCost: m.unitCost != null ? num(m.unitCost) : null,
      createdAt: m.createdAt.toISOString(),
    })),
    warehouses,
    banners: {
      confirmedOrderIsNotStock:
        "Pedido confirmado cria compromisso operacional, mas não altera saldo físico de estoque.",
      onlyConfirmedReceiptChangesBalance:
        "Somente o recebimento confirmado gera movimento PURCHASE_RECEIPT e altera o saldo físico no ledger SC.",
      noNomusNoAp: "Não escreve no estoque oficial Nomus nem em Contas a Pagar.",
    },
    meta: {
      featureFlag: "SUPPLY_CHAIN_RECEIVING_MODULE_ENABLED",
      confirmedOrderIsNotStock: true,
      onlyConfirmedReceiptChangesPhysicalBalance: true,
      createsAccountsPayable: false,
      writesNomusStock: false,
      updatesPublishedCost: false,
    },
  };
}
