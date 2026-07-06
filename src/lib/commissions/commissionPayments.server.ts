import type { CommissionPersonType, Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import {
  applyCommissionPaymentBatchScope,
  applyCommissionRecordScope,
  mergePrismaWhere,
  type CommissionAccessScope,
} from "./commissionAccessScope.js";
import { decimalToNumber, roundMoney } from "./commission-money.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import type { CommissionPaymentsQuery } from "./commissionQuery.js";
import { paginatedMeta } from "./commissionQuery.js";

export { CommissionValidationError };

export type CommissionPaymentsCards = {
  unpaidReleasedAmount: number;
  draftBatchTotal: number;
  approvedBatchTotal: number;
  paidInPeriodTotal: number;
  balanceToPay: number;
};

export type CommissionPaymentBatchListItem = {
  id: string;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  commissionPersonName: string;
  commissionPersonType: string;
  status: string;
  totalReleased: number;
  totalSelected: number;
  totalPaid: number;
  paymentDate: string | null;
  itemsCount: number;
  createdAt: string;
};

export type CommissionPaymentsPagePayload = {
  cards: CommissionPaymentsCards;
  rows: CommissionPaymentBatchListItem[];
  items: CommissionPaymentBatchListItem[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionPaymentBatchDetailItem = {
  id: string;
  commissionRecordId: string;
  orderCode: string | null;
  productCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  nomusReceivableId: number | null;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  amountToPay: number;
  amountPaid: number;
  status: string;
  notes: string | null;
};

export type CommissionPaymentBatchDetailPayload = {
  id: string;
  periodStart: string;
  periodEnd: string;
  commissionPersonId: string;
  commissionPersonName: string;
  commissionPersonType: string;
  status: string;
  totalReleased: number;
  totalSelected: number;
  totalPaid: number;
  paymentDate: string | null;
  notes: string | null;
  items: CommissionPaymentBatchDetailItem[];
  createdAt: string;
};

export type UnpaidReleasedCommissionPayload = {
  commissionRecordId: string;
  commissionPersonId: string;
  orderCode: string | null;
  productCode: string | null;
  nfeNumber: string | null;
  customerName: string | null;
  status: string;
  commissionAmount: number;
  releasedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  availableToPay: number;
  nomusReceivableId: number | null;
};

function resolvePeriod(query: CommissionPaymentsQuery): { from: Date; to: Date } | null {
  if (query.from && query.to) return { from: query.from, to: query.to };
  if (query.year != null && query.month != null) {
    return {
      from: new Date(Date.UTC(query.year, query.month - 1, 1)),
      to: new Date(Date.UTC(query.year, query.month, 0, 23, 59, 59, 999)),
    };
  }
  if (query.year != null) {
    return {
      from: new Date(Date.UTC(query.year, 0, 1)),
      to: new Date(Date.UTC(query.year, 11, 31, 23, 59, 59, 999)),
    };
  }
  return null;
}

function buildBatchWhere(query: CommissionPaymentsQuery): Prisma.CommissionPaymentBatchWhereInput {
  const and: Prisma.CommissionPaymentBatchWhereInput[] = [];
  if (query.commissionPersonId) and.push({ commissionPersonId: query.commissionPersonId });
  if (query.status) {
    and.push({
      status: query.status as import("@prisma/client").CommissionPaymentBatchStatus,
    });
  }
  const period = resolvePeriod(query);
  if (period) {
    and.push({
      AND: [{ periodStart: { lte: period.to } }, { periodEnd: { gte: period.from } }],
    });
  }
  if (query.paymentDateFrom || query.paymentDateTo) {
    and.push({
      paymentDate: {
        ...(query.paymentDateFrom ? { gte: query.paymentDateFrom } : {}),
        ...(query.paymentDateTo ? { lte: query.paymentDateTo } : {}),
      },
    });
  }
  if (query.personType) {
    and.push({
      commissionPerson: { type: query.personType as CommissionPersonType },
    });
  }
  if (and.length === 0) return {};
  if (and.length === 1) return and[0]!;
  return { AND: and };
}

async function sumBatchTotals(
  where: Prisma.CommissionPaymentBatchWhereInput,
  status: import("@prisma/client").CommissionPaymentBatchStatus,
  field: "totalSelected" | "totalPaid"
): Promise<number> {
  const rows = await prisma.commissionPaymentBatch.findMany({
    where: { AND: [where, { status }] },
    select: { totalSelected: true, totalPaid: true },
  });
  return roundMoney(
    rows.reduce(
      (sum, row) => sum + decimalToNumber(field === "totalPaid" ? row.totalPaid : row.totalSelected),
      0
    )
  );
}

async function computeCards(
  query: CommissionPaymentsQuery,
  batchWhere: Prisma.CommissionPaymentBatchWhereInput,
  scope?: CommissionAccessScope
): Promise<CommissionPaymentsCards> {
  const period = resolvePeriod(query);
  const unpaidRows = await listUnpaidReleasedCommissionsDetailed(
    {
      commissionPersonId: query.commissionPersonId,
      from: period?.from,
      to: period?.to,
      personType: query.personType,
    },
    scope
  );
  const unpaidReleasedAmount = roundMoney(
    unpaidRows.reduce((sum, row) => sum + row.availableToPay, 0)
  );

  const [draftBatchTotal, approvedBatchTotal, paidInPeriodTotal] = await Promise.all([
    sumBatchTotals(batchWhere, "DRAFT", "totalSelected"),
    sumBatchTotals(batchWhere, "APPROVED", "totalSelected"),
    sumBatchTotals(batchWhere, "PAID", "totalPaid"),
  ]);

  const balanceToPay = roundMoney(
    Math.max(0, unpaidReleasedAmount - draftBatchTotal - approvedBatchTotal)
  );

  return {
    unpaidReleasedAmount,
    draftBatchTotal,
    approvedBatchTotal,
    paidInPeriodTotal,
    balanceToPay,
  };
}

function mapBatchRow(
  b: Awaited<
    ReturnType<
      typeof prisma.commissionPaymentBatch.findMany<{
        include: {
          commissionPerson: { select: { id: true; name: true; type: true } };
          _count: { select: { items: true } };
        };
      }>
    >
  >[number]
): CommissionPaymentBatchListItem {
  return {
    id: b.id,
    periodStart: b.periodStart.toISOString(),
    periodEnd: b.periodEnd.toISOString(),
    commissionPersonId: b.commissionPersonId,
    commissionPersonName: b.commissionPerson.name,
    commissionPersonType: b.commissionPerson.type,
    status: b.status,
    totalReleased: Number(b.totalReleased),
    totalSelected: Number(b.totalSelected),
    totalPaid: Number(b.totalPaid),
    paymentDate: b.paymentDate?.toISOString() ?? null,
    itemsCount: b._count.items,
    createdAt: b.createdAt.toISOString(),
  };
}

export async function listCommissionPaymentsPage(
  query: CommissionPaymentsQuery,
  scope?: CommissionAccessScope
): Promise<CommissionPaymentsPagePayload> {
  const where = mergePrismaWhere(
    buildBatchWhere(query),
    scope ? applyCommissionPaymentBatchScope(scope) : {}
  );
  const skip = (query.page - 1) * query.pageSize;

  const [cards, total, rows] = await Promise.all([
    computeCards(query, where, scope),
    prisma.commissionPaymentBatch.count({ where }),
    prisma.commissionPaymentBatch.findMany({
      where,
      include: {
        commissionPerson: { select: { id: true, name: true, type: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ createdAt: "desc" }],
      skip,
      take: query.pageSize,
    }),
  ]);

  const items = rows.map(mapBatchRow);
  return {
    cards,
    rows: items,
    items,
    pagination: paginatedMeta(total, query.page, query.pageSize),
  };
}

export async function listCommissionPaymentBatches(query: CommissionPaymentsQuery) {
  const payload = await listCommissionPaymentsPage(query);
  return { items: payload.items, pagination: payload.pagination };
}

export async function listUnpaidReleasedCommissionsDetailed(
  input?: {
    commissionPersonId?: string;
    from?: Date;
    to?: Date;
    personType?: string;
  },
  scope?: CommissionAccessScope
): Promise<UnpaidReleasedCommissionPayload[]> {
  const recordScope = scope
    ? applyCommissionRecordScope(scope, {
        commissionPersonId: input?.commissionPersonId ?? null,
      })
    : input?.commissionPersonId
      ? { commissionPersonId: input.commissionPersonId }
      : {};

  const rows = await prisma.commissionRecord.findMany({
    where: mergePrismaWhere(recordScope, {
      status: { in: ["PARTIALLY_RELEASED", "RELEASED", "PAID_PARTIAL"] },
      calculatedAt:
        input?.from && input?.to ? { gte: input.from, lte: input.to } : undefined,
      ...(input?.personType
        ? { commissionPerson: { type: input.personType as CommissionPersonType } }
        : {}),
    }),
    select: {
      id: true,
      commissionPersonId: true,
      orderCode: true,
      productCode: true,
      nfeNumber: true,
      customerName: true,
      status: true,
      commissionAmount: true,
      releasedAmount: true,
      paidAmount: true,
      balanceAmount: true,
      paymentSchedules: {
        where: { source: "ACCOUNTS_RECEIVABLE", nomusReceivableId: { not: null } },
        select: { nomusReceivableId: true },
        take: 1,
        orderBy: { installmentNumber: "asc" },
      },
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
        nfeNumber: row.nfeNumber,
        customerName: row.customerName,
        status: row.status,
        commissionAmount,
        releasedAmount,
        paidAmount,
        balanceAmount: decimalToNumber(row.balanceAmount),
        availableToPay,
        nomusReceivableId: row.paymentSchedules[0]?.nomusReceivableId ?? null,
      };
    })
    .filter((row) => row.availableToPay > 0);
}

export async function getCommissionPaymentBatchById(
  id: string,
  scope?: CommissionAccessScope
): Promise<CommissionPaymentBatchDetailPayload> {
  const batch = await prisma.commissionPaymentBatch.findFirst({
    where: mergePrismaWhere({ id }, scope ? applyCommissionPaymentBatchScope(scope) : {}),
    include: {
      commissionPerson: { select: { id: true, name: true, type: true } },
      items: {
        include: {
          commissionRecord: {
            select: {
              orderCode: true,
              productCode: true,
              nfeNumber: true,
              customerName: true,
              commissionAmount: true,
              releasedAmount: true,
              paidAmount: true,
              paymentSchedules: {
                where: { source: "ACCOUNTS_RECEIVABLE", nomusReceivableId: { not: null } },
                select: { nomusReceivableId: true },
                take: 1,
                orderBy: { installmentNumber: "asc" },
              },
            },
          },
        },
      },
    },
  });
  if (!batch) {
    throw new CommissionValidationError("NOT_FOUND", "Lote não encontrado.");
  }

  return {
    id: batch.id,
    periodStart: batch.periodStart.toISOString(),
    periodEnd: batch.periodEnd.toISOString(),
    commissionPersonId: batch.commissionPersonId,
    commissionPersonName: batch.commissionPerson.name,
    commissionPersonType: batch.commissionPerson.type,
    status: batch.status,
    totalReleased: Number(batch.totalReleased),
    totalSelected: Number(batch.totalSelected),
    totalPaid: Number(batch.totalPaid),
    paymentDate: batch.paymentDate?.toISOString() ?? null,
    notes: batch.notes,
    items: batch.items.map((item) => ({
      id: item.id,
      commissionRecordId: item.commissionRecordId,
      orderCode: item.commissionRecord.orderCode,
      productCode: item.commissionRecord.productCode,
      nfeNumber: item.commissionRecord.nfeNumber,
      customerName: item.commissionRecord.customerName,
      nomusReceivableId:
        item.commissionRecord.paymentSchedules[0]?.nomusReceivableId ?? null,
      commissionAmount: Number(item.commissionRecord.commissionAmount),
      releasedAmount: Number(item.commissionRecord.releasedAmount),
      paidAmount: Number(item.commissionRecord.paidAmount),
      amountToPay: Number(item.amountToPay),
      amountPaid: Number(item.amountPaid),
      status: item.status,
      notes: item.notes,
    })),
    createdAt: batch.createdAt.toISOString(),
  };
}
