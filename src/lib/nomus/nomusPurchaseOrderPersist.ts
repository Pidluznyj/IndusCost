import { Prisma, type PrismaClient } from "@prisma/client";
import type { MappedNomusPurchaseOrder } from "./nomusPurchaseOrderTypes.js";
import { decidePurchaseOrderApply } from "./nomusPurchaseOrderSyncLogic.js";

function toDecimal(value: number | null | undefined): Prisma.Decimal | null {
  return value == null || !Number.isFinite(value) ? null : new Prisma.Decimal(value);
}

function headerData(row: MappedNomusPurchaseOrder, syncedAt: Date) {
  return {
    externalId: row.externalId,
    orderNumber: row.orderNumber,
    supplierExternalId: row.supplierExternalId,
    supplierName: row.supplierName,
    supplierTaxId: row.supplierTaxId,
    statusRaw: row.statusRaw,
    canceled: row.canceled,
    stage: row.stage,
    issuedAt: row.issuedAt,
    expectedAt: row.expectedAt,
    createdAtNomus: row.createdAtNomus,
    modifiedAtNomus: row.modifiedAtNomus,
    paymentTerms: row.paymentTerms,
    comments: row.comments,
    currency: row.currency,
    totalAmount: toDecimal(row.totalAmount),
    discountAmount: toDecimal(row.discountAmount),
    freightAmount: toDecimal(row.freightAmount),
    itemCount: row.itemCount,
    orderedQuantity: toDecimal(row.orderedQuantity),
    receivedQuantity: toDecimal(row.receivedQuantity),
    remainingQuantity: toDecimal(row.remainingQuantity),
    rawPayload: row.rawPayload as Prisma.InputJsonValue,
    payloadHash: row.payloadHash,
    syncedAt,
    lastSeenAt: syncedAt,
  };
}

function itemData(row: MappedNomusPurchaseOrder, purchaseOrderId: string) {
  return row.items.map((item) => ({
    purchaseOrderId,
    lineIndex: item.lineIndex,
    lineExternalId: item.lineExternalId,
    productExternalId: item.productExternalId,
    productCode: item.productCode,
    description: item.description,
    unit: item.unit,
    orderedQuantity: toDecimal(item.orderedQuantity),
    receivedQuantity: toDecimal(item.receivedQuantity),
    remainingQuantity: toDecimal(item.remainingQuantity),
    unitPrice: toDecimal(item.unitPrice),
    totalAmount: toDecimal(item.totalAmount),
    rawPayload: item.rawPayload as Prisma.InputJsonValue,
    payloadHash: item.payloadHash,
  }));
}

export type PurchaseOrderApplyCounts = {
  created: number;
  updated: number;
  unchanged: number;
  errors: number;
};

export async function applyNomusPurchaseOrderRows(
  prisma: PrismaClient,
  rows: MappedNomusPurchaseOrder[],
  syncedAt: Date
): Promise<PurchaseOrderApplyCounts> {
  const counts: PurchaseOrderApplyCounts = {
    created: 0,
    updated: 0,
    unchanged: 0,
    errors: 0,
  };

  for (const row of rows) {
    try {
      const existing = await prisma.nomusPurchaseOrder.findUnique({
        where: { externalId: row.externalId },
        select: { id: true, payloadHash: true },
      });
      const decision = decidePurchaseOrderApply(existing?.payloadHash, row.payloadHash);

      if (decision === "create") {
        await prisma.nomusPurchaseOrder.create({
          data: {
            ...headerData(row, syncedAt),
            firstSeenAt: syncedAt,
            items: {
              create: row.items.map((item) => ({
                lineIndex: item.lineIndex,
                lineExternalId: item.lineExternalId,
                productExternalId: item.productExternalId,
                productCode: item.productCode,
                description: item.description,
                unit: item.unit,
                orderedQuantity: toDecimal(item.orderedQuantity),
                receivedQuantity: toDecimal(item.receivedQuantity),
                remainingQuantity: toDecimal(item.remainingQuantity),
                unitPrice: toDecimal(item.unitPrice),
                totalAmount: toDecimal(item.totalAmount),
                rawPayload: item.rawPayload as Prisma.InputJsonValue,
                payloadHash: item.payloadHash,
              })),
            },
          },
        });
        counts.created += 1;
        continue;
      }

      if (!existing) {
        counts.errors += 1;
        continue;
      }

      if (decision === "unchanged") {
        await prisma.nomusPurchaseOrder.update({
          where: { externalId: row.externalId },
          data: { syncedAt, lastSeenAt: syncedAt },
        });
        counts.unchanged += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.nomusPurchaseOrderItem.deleteMany({
          where: { purchaseOrderId: existing.id },
        });
        await tx.nomusPurchaseOrder.update({
          where: { id: existing.id },
          data: headerData(row, syncedAt),
        });
        if (row.items.length > 0) {
          await tx.nomusPurchaseOrderItem.createMany({
            data: itemData(row, existing.id),
          });
        }
      });
      counts.updated += 1;
    } catch {
      counts.errors += 1;
    }
  }

  return counts;
}
