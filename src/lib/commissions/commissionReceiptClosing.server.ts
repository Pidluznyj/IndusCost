import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toPrismaDecimal } from "./commission-money.js";
import type { CommissionMonthlyPayableQuery, CommissionMonthlyPayableSummary } from "./commissionMonthlyPayable.js";
import { loadCommissionReceiptPreview } from "./commissionReceiptEngine.server.js";
import {
  aggregateMonthlyPayableFromLedgerLines,
  appendReceiptClosingNote,
  buildReceiptClosingHashFromPreview,
  buildReceiptClosingPreviewPayload,
  buildReceiptClosingReprocessPreview,
  buildReceiptClosingSnapshotFromPreview,
  formatReceiptClosingCancelNote,
  formatReceiptClosingReprocessNote,
  mapLedgerRowToSnapshot,
  mapPreviewLineToLedgerCreateData,
  ReceiptClosingDuplicateError,
  ReceiptClosingValidationError,
  RECEIPT_CLOSING_SOURCE,
  type ReceiptClosingApplyResult,
  type ReceiptClosingPreviewPayload,
  type ReceiptClosingReprocessPreview,
  type ReceiptClosingSnapshot,
  validateReceiptClosingCancelReason,
  validateReceiptClosingPreviewForApply,
} from "./commissionReceiptClosing.js";

export type ReceiptClosingFilters = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  nomusBase?: number | null;
  nomusCommission?: number | null;
  includeExcluded?: boolean;
  includeExceptions?: boolean;
};

type DbClient = Pick<
  PrismaClient,
  | "commissionMonthlyClosing"
  | "commissionReceiptLedgerLine"
  | "$transaction"
>;

function mapClosingRowToSnapshot(row: {
  id: string;
  year: number;
  month: number;
  status: ReceiptClosingSnapshot["status"];
  calculationHash: string | null;
  totalReceivedAmount: Prisma.Decimal;
  totalCommissionableBase: Prisma.Decimal;
  totalExpectedCommission: Prisma.Decimal;
  totalReleasedCommission: Prisma.Decimal;
  totalExcludedAmount: Prisma.Decimal;
  totalExceptionAmount: Prisma.Decimal;
  lineCount: number;
  closedAt: Date | null;
  closedBy: string | null;
  notes: string | null;
}): ReceiptClosingSnapshot {
  return {
    closingId: row.id,
    year: row.year,
    month: row.month,
    status: row.status,
    calculationHash: row.calculationHash,
    totalReceivedAmount: Number(row.totalReceivedAmount),
    totalCommissionableBase: Number(row.totalCommissionableBase),
    totalExpectedCommission: Number(row.totalExpectedCommission),
    totalReleasedCommission: Number(row.totalReleasedCommission),
    totalExcludedAmount: Number(row.totalExcludedAmount),
    totalExceptionAmount: Number(row.totalExceptionAmount),
    lineCount: row.lineCount,
    closedAt: row.closedAt?.toISOString() ?? null,
    closedBy: row.closedBy,
    notes: row.notes,
  };
}

export async function findClosedReceiptClosing(
  db: DbClient,
  year: number,
  month: number
): Promise<ReceiptClosingSnapshot | null> {
  const row = await db.commissionMonthlyClosing.findFirst({
    where: {
      year,
      month,
      source: RECEIPT_CLOSING_SOURCE,
      status: "CLOSED",
    },
    orderBy: { closedAt: "desc" },
  });
  return row ? mapClosingRowToSnapshot(row) : null;
}

export async function loadReceiptClosingLedgerLines(
  db: Pick<PrismaClient, "commissionReceiptLedgerLine">,
  closingId: string
) {
  const rows = await db.commissionReceiptLedgerLine.findMany({
    where: { closingId },
    orderBy: [{ settlementDate: "asc" }, { nomusReceivableId: "asc" }, { productCode: "asc" }],
  });
  return rows.map(mapLedgerRowToSnapshot);
}

export async function previewCommissionReceiptClosing(
  filters: ReceiptClosingFilters
): Promise<ReceiptClosingPreviewPayload> {
  const [preview, existingClosing] = await Promise.all([
    loadCommissionReceiptPreview(filters),
    findClosedReceiptClosing(prisma, filters.year, filters.month),
  ]);
  return buildReceiptClosingPreviewPayload(preview, existingClosing);
}

export async function getMonthlyPayableFromClosedReceiptLedger(
  query: CommissionMonthlyPayableQuery
): Promise<CommissionMonthlyPayableSummary | null> {
  const closing = await findClosedReceiptClosing(prisma, query.year, query.month);
  if (!closing) return null;
  const lines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
  return aggregateMonthlyPayableFromLedgerLines(lines, query);
}

async function createClosingWithLines(
  tx: Pick<PrismaClient, "commissionMonthlyClosing" | "commissionReceiptLedgerLine">,
  input: {
    preview: Awaited<ReturnType<typeof loadCommissionReceiptPreview>>;
    userId: string;
    notes?: string | null;
    calculationHash: string;
  }
): Promise<ReceiptClosingApplyResult> {
  const closing = await tx.commissionMonthlyClosing.create({
    data: {
      year: input.preview.year,
      month: input.preview.month,
      status: "CLOSED",
      source: RECEIPT_CLOSING_SOURCE,
      totalReceivedAmount: toPrismaDecimal(input.preview.totalReceivedAmount),
      totalCommissionableBase: toPrismaDecimal(input.preview.totalCommissionableBase),
      totalExpectedCommission: toPrismaDecimal(input.preview.totalExpectedCommission),
      totalReleasedCommission: toPrismaDecimal(input.preview.totalReleasedCommission),
      totalExcludedAmount: toPrismaDecimal(input.preview.totalExcludedAmount),
      totalExceptionAmount: toPrismaDecimal(input.preview.totalExceptionAmount),
      lineCount: input.preview.lines.length,
      calculationHash: input.calculationHash,
      notes: input.notes ?? null,
      createdBy: input.userId,
      closedBy: input.userId,
      closedAt: new Date(),
    },
  });

  if (input.preview.lines.length > 0) {
    await tx.commissionReceiptLedgerLine.createMany({
      data: input.preview.lines.map((line) =>
        mapPreviewLineToLedgerCreateData(line, closing.id)
      ),
    });
  }

  return {
    closingId: closing.id,
    calculationHash: input.calculationHash,
    summary: buildReceiptClosingSnapshotFromPreview(input.preview, closing.id, "CLOSED", {
      calculationHash: input.calculationHash,
      closedBy: input.userId,
      closedAt: closing.closedAt,
      notes: input.notes ?? null,
    }),
    lineCount: input.preview.lines.length,
  };
}

export async function applyCommissionReceiptClosing(
  db: DbClient,
  input: ReceiptClosingFilters & {
    userId: string;
    notes?: string | null;
  }
): Promise<ReceiptClosingApplyResult> {
  const existing = await findClosedReceiptClosing(db, input.year, input.month);
  if (existing) {
    throw new ReceiptClosingDuplicateError(existing.closingId);
  }

  const preview = await loadCommissionReceiptPreview(input);
  validateReceiptClosingPreviewForApply(preview);
  const calculationHash = buildReceiptClosingHashFromPreview(preview);

  try {
    return await db.$transaction(async (tx) => {
      const locked = await tx.commissionMonthlyClosing.findFirst({
        where: {
          year: input.year,
          month: input.month,
          source: RECEIPT_CLOSING_SOURCE,
          status: "CLOSED",
        },
      });
      if (locked) {
        throw new ReceiptClosingDuplicateError(locked.id);
      }
      return createClosingWithLines(tx, {
        preview,
        userId: input.userId,
        notes: input.notes,
        calculationHash,
      });
    });
  } catch (error) {
    if (
      error != null &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      const duplicate = await findClosedReceiptClosing(db, input.year, input.month);
      throw new ReceiptClosingDuplicateError(
        duplicate?.closingId ?? "unknown",
        "Fechamento duplicado bloqueado pela constraint única do banco."
      );
    }
    throw error;
  }
}

export async function cancelCommissionReceiptClosing(
  db: Pick<PrismaClient, "commissionMonthlyClosing">,
  input: {
    closingId: string;
    userId: string;
    reason: string;
  }
): Promise<ReceiptClosingSnapshot> {
  const reason = validateReceiptClosingCancelReason(input.reason);
  const existing = await db.commissionMonthlyClosing.findUnique({
    where: { id: input.closingId },
  });
  if (!existing) {
    throw new ReceiptClosingValidationError("CLOSING_NOT_FOUND", "Fechamento não encontrado.");
  }
  if (existing.status !== "CLOSED") {
    throw new ReceiptClosingValidationError(
      "CLOSING_NOT_ACTIVE",
      `Somente fechamentos CLOSED podem ser cancelados (status atual: ${existing.status}).`
    );
  }

  const updated = await db.commissionMonthlyClosing.update({
    where: { id: input.closingId },
    data: {
      status: "CANCELLED",
      notes: appendReceiptClosingNote(
        existing.notes,
        formatReceiptClosingCancelNote(input.userId, reason)
      ),
    },
  });

  return mapClosingRowToSnapshot(updated);
}

export async function reprocessCommissionReceiptClosingPreview(
  filters: ReceiptClosingFilters
): Promise<ReceiptClosingReprocessPreview> {
  const existingClosing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (!existingClosing) {
    throw new ReceiptClosingValidationError(
      "NO_CLOSED_CLOSING",
      "Nenhum fechamento CLOSED encontrado para reprocessar."
    );
  }
  const preview = await loadCommissionReceiptPreview(filters);
  return buildReceiptClosingReprocessPreview(existingClosing, preview);
}

export async function reprocessCommissionReceiptClosingApply(
  db: DbClient,
  input: ReceiptClosingFilters & {
    userId: string;
    reason: string;
  }
): Promise<ReceiptClosingApplyResult & { supersededClosingId: string }> {
  const reason = validateReceiptClosingCancelReason(input.reason);
  const preview = await loadCommissionReceiptPreview(input);
  const calculationHash = buildReceiptClosingHashFromPreview(preview);

  return db.$transaction(async (tx) => {
    const existing = await tx.commissionMonthlyClosing.findFirst({
      where: {
        year: input.year,
        month: input.month,
        source: RECEIPT_CLOSING_SOURCE,
        status: "CLOSED",
      },
      orderBy: { closedAt: "desc" },
    });
    if (!existing) {
      throw new ReceiptClosingValidationError(
        "NO_CLOSED_CLOSING",
        "Nenhum fechamento CLOSED encontrado para reprocessar."
      );
    }

    const newClosing = await createClosingWithLines(tx, {
      preview,
      userId: input.userId,
      notes: formatReceiptClosingReprocessNote(input.userId, reason, "pending"),
      calculationHash,
    });

    await tx.commissionMonthlyClosing.update({
      where: { id: existing.id },
      data: {
        status: "REPROCESSED",
        supersededByClosingId: newClosing.closingId,
        notes: appendReceiptClosingNote(
          existing.notes,
          formatReceiptClosingReprocessNote(input.userId, reason, newClosing.closingId)
        ),
      },
    });

    await tx.commissionMonthlyClosing.update({
      where: { id: newClosing.closingId },
      data: {
        notes: formatReceiptClosingReprocessNote(input.userId, reason, newClosing.closingId),
      },
    });

    return { ...newClosing, supersededClosingId: existing.id };
  });
}
