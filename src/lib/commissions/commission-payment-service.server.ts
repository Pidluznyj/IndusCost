import type { PrismaClient } from "@prisma/client";
import { decimalToNumber, roundMoney, toPrismaDecimal, clampPaymentAmount } from "./commission-money.js";
import { computeBalanceAfterRelease } from "./commission-release-service.js";

export type UnpaidReleasedCommissionRow = {
  commissionRecordId: string;
  commissionPersonId: string;
  orderCode: string | null;
  productCode: string | null;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  availableToPay: number;
};

export async function listUnpaidReleasedCommissions(
  db: Pick<PrismaClient, "commissionRecord">,
  input?: { commissionPersonId?: string; from?: Date; to?: Date }
): Promise<UnpaidReleasedCommissionRow[]> {
  const rows = await db.commissionRecord.findMany({
    where: {
      commissionPersonId: input?.commissionPersonId,
      status: { in: ["PARTIALLY_RELEASED", "RELEASED", "PAID_PARTIAL"] },
      calculatedAt:
        input?.from && input?.to
          ? { gte: input.from, lte: input.to }
          : undefined,
    },
    select: {
      id: true,
      commissionPersonId: true,
      orderCode: true,
      productCode: true,
      commissionAmount: true,
      releasedAmount: true,
      paidAmount: true,
      balanceAmount: true,
    },
    orderBy: [{ calculatedAt: "desc" }],
  });

  return rows
    .map((row) => {
      const commissionAmount = decimalToNumber(row.commissionAmount);
      const releasedAmount = decimalToNumber(row.releasedAmount);
      const paidAmount = decimalToNumber(row.paidAmount);
      const availableToPay = roundMoney(Math.max(0, releasedAmount - paidAmount));
      return {
        commissionRecordId: row.id,
        commissionPersonId: row.commissionPersonId,
        orderCode: row.orderCode,
        productCode: row.productCode,
        commissionAmount,
        releasedAmount,
        paidAmount,
        balanceAmount: decimalToNumber(row.balanceAmount),
        availableToPay,
      };
    })
    .filter((row) => row.availableToPay > 0);
}

export async function createCommissionPaymentBatch(
  db: PrismaClient,
  input: {
    periodStart: Date;
    periodEnd: Date;
    commissionPersonId: string;
    recordIds: string[];
    notes?: string | null;
    createdBy?: string | null;
  }
): Promise<{ batchId: string; totalSelected: number }> {
  return db.$transaction(async (tx) => {
    const records = await tx.commissionRecord.findMany({
      where: {
        id: { in: input.recordIds },
        commissionPersonId: input.commissionPersonId,
      },
      select: {
        id: true,
        releasedAmount: true,
        paidAmount: true,
      },
    });

    let totalSelected = 0;
    const items: Array<{ commissionRecordId: string; amountToPay: number }> = [];

    for (const record of records) {
      const released = decimalToNumber(record.releasedAmount);
      const paid = decimalToNumber(record.paidAmount);
      const amountToPay = roundMoney(Math.max(0, released - paid));
      if (amountToPay <= 0) continue;
      totalSelected = roundMoney(totalSelected + amountToPay);
      items.push({ commissionRecordId: record.id, amountToPay });
    }

    if (items.length === 0) {
      throw new Error("Nenhum registro com valor liberado disponível para pagamento.");
    }

    const batch = await tx.commissionPaymentBatch.create({
      data: {
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        commissionPersonId: input.commissionPersonId,
        status: "DRAFT",
        totalSelected: toPrismaDecimal(totalSelected),
        totalReleased: toPrismaDecimal(totalSelected),
        notes: input.notes ?? null,
        createdBy: input.createdBy ?? null,
      },
    });

    for (const item of items) {
      await tx.commissionPaymentBatchItem.create({
        data: {
          batchId: batch.id,
          commissionRecordId: item.commissionRecordId,
          amountToPay: toPrismaDecimal(item.amountToPay),
          status: "DRAFT",
        },
      });
    }

    return { batchId: batch.id, totalSelected };
  });
}

export async function approveCommissionPaymentBatch(
  db: Pick<PrismaClient, "commissionPaymentBatch" | "commissionPaymentBatchItem">,
  batchId: string,
  approvedBy?: string | null
): Promise<void> {
  const batch = await db.commissionPaymentBatch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  if (!batch) throw new Error("Lote não encontrado.");
  if (batch.status !== "DRAFT") throw new Error("Somente lotes em rascunho podem ser aprovados.");

  await db.commissionPaymentBatch.update({
    where: { id: batchId },
    data: { status: "APPROVED", approvedBy: approvedBy ?? null },
  });
  await db.commissionPaymentBatchItem.updateMany({
    where: { batchId, status: "DRAFT" },
    data: { status: "APPROVED" },
  });
}

export async function markCommissionPaymentBatchPaid(
  db: PrismaClient,
  input: {
    batchId: string;
    paymentDate: Date;
    paidBy?: string | null;
  }
): Promise<{ totalPaid: number }> {
  return db.$transaction(async (tx) => {
    const batch = await tx.commissionPaymentBatch.findUnique({
      where: { id: input.batchId },
      include: {
        items: {
          where: { status: { in: ["DRAFT", "APPROVED"] } },
          select: {
            id: true,
            commissionRecordId: true,
            amountToPay: true,
            amountPaid: true,
          },
        },
      },
    });

    if (!batch) throw new Error("Lote não encontrado.");
    if (batch.status === "PAID") throw new Error("Lote já está pago.");
    if (batch.status === "CANCELLED") throw new Error("Lote cancelado não pode ser pago.");

    let totalPaid = 0;

    for (const item of batch.items) {
      const record = await tx.commissionRecord.findUnique({
        where: { id: item.commissionRecordId },
        select: {
          commissionAmount: true,
          releasedAmount: true,
          paidAmount: true,
        },
      });
      if (!record) continue;

      const released = decimalToNumber(record.releasedAmount);
      const alreadyPaid = decimalToNumber(record.paidAmount);
      const maxPay = roundMoney(released - alreadyPaid);
      const requested = decimalToNumber(item.amountToPay);
      const payAmount = clampPaymentAmount(requested, maxPay);
      if (payAmount <= 0) {
        throw new Error(
          `Pagamento bloqueado: valor solicitado excede liberado no registro ${item.commissionRecordId}.`
        );
      }

      const newPaid = roundMoney(alreadyPaid + payAmount);
      const commissionAmount = decimalToNumber(record.commissionAmount);
      const newBalance = computeBalanceAfterRelease(commissionAmount, released, newPaid);

      await tx.commissionPaymentBatchItem.update({
        where: { id: item.id },
        data: {
          amountPaid: toPrismaDecimal(payAmount),
          status: "PAID",
        },
      });

      await tx.commissionRecord.update({
        where: { id: item.commissionRecordId },
        data: {
          paidAmount: toPrismaDecimal(newPaid),
          balanceAmount: toPrismaDecimal(newBalance),
          paidAt: input.paymentDate,
          status:
            newPaid >= commissionAmount && commissionAmount > 0
              ? "PAID_TOTAL"
              : newPaid > 0
                ? "PAID_PARTIAL"
                : undefined,
        },
      });

      totalPaid = roundMoney(totalPaid + payAmount);
    }

    await tx.commissionPaymentBatch.update({
      where: { id: input.batchId },
      data: {
        status: "PAID",
        paymentDate: input.paymentDate,
        paidBy: input.paidBy ?? null,
        totalPaid: toPrismaDecimal(totalPaid),
      },
    });

    return { totalPaid };
  });
}

export async function cancelCommissionPaymentBatch(
  db: Pick<PrismaClient, "commissionPaymentBatch" | "commissionPaymentBatchItem">,
  batchId: string
): Promise<void> {
  const batch = await db.commissionPaymentBatch.findUnique({
    where: { id: batchId },
    select: { status: true },
  });
  if (!batch) throw new Error("Lote não encontrado.");
  if (batch.status === "PAID") throw new Error("Lote pago não pode ser cancelado.");

  await db.commissionPaymentBatch.update({
    where: { id: batchId },
    data: { status: "CANCELLED" },
  });
  await db.commissionPaymentBatchItem.updateMany({
    where: { batchId },
    data: { status: "CANCELLED" },
  });
}
