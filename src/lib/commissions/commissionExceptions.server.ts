import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { paginatedMeta } from "./commissionQuery.js";

export type CommissionExceptionRow = {
  id: string;
  customerExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string | null;
  commissionPersonName: string | null;
  productCode: string | null;
  productExternalId: number | null;
  reason: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommissionExceptionsPagePayload = {
  rows: CommissionExceptionRow[];
  pagination: ReturnType<typeof paginatedMeta>;
};

export type CommissionExceptionsQuery = {
  search: string | null;
  active: boolean | null;
  commissionPersonId: string | null;
  page: number;
  pageSize: number;
};

function mapRow(row: {
  id: string;
  customerExternalId: number | null;
  customerName: string | null;
  commissionPersonId: string | null;
  productCode: string | null;
  productExternalId: number | null;
  reason: string;
  startDate: Date;
  endDate: Date | null;
  active: boolean;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  commissionPerson: { name: string } | null;
}): CommissionExceptionRow {
  return {
    id: row.id,
    customerExternalId: row.customerExternalId,
    customerName: row.customerName,
    commissionPersonId: row.commissionPersonId,
    commissionPersonName: row.commissionPerson?.name ?? null,
    productCode: row.productCode,
    productExternalId: row.productExternalId,
    reason: row.reason,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate?.toISOString() ?? null,
    active: row.active,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCommissionExceptionsPage(
  query: CommissionExceptionsQuery
): Promise<CommissionExceptionsPagePayload> {
  const and: Prisma.CommissionCustomerExceptionWhereInput[] = [];
  if (query.active != null) and.push({ active: query.active });
  if (query.commissionPersonId) and.push({ commissionPersonId: query.commissionPersonId });
  if (query.search) {
    and.push({
      OR: [
        { customerName: { contains: query.search, mode: "insensitive" } },
        { productCode: { contains: query.search, mode: "insensitive" } },
        { reason: { contains: query.search, mode: "insensitive" } },
      ],
    });
  }
  const where: Prisma.CommissionCustomerExceptionWhereInput =
    and.length > 0 ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.commissionCustomerException.count({ where }),
    prisma.commissionCustomerException.findMany({
      where,
      include: { commissionPerson: { select: { name: true } } },
      orderBy: [{ active: "desc" }, { startDate: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    rows: rows.map(mapRow),
    pagination: paginatedMeta(query.page, query.pageSize, total),
  };
}

export async function createCommissionCustomerException(input: {
  customerExternalId?: number | null;
  customerName?: string | null;
  commissionPersonId?: string | null;
  productCode?: string | null;
  productExternalId?: number | null;
  reason: string;
  startDate: Date;
  endDate?: Date | null;
  active?: boolean;
  createdByUserId?: string | null;
  metadataJson?: Record<string, unknown>;
}): Promise<CommissionExceptionRow> {
  const row = await prisma.commissionCustomerException.create({
    data: {
      customerExternalId: input.customerExternalId ?? null,
      customerName: input.customerName?.trim() || null,
      commissionPersonId: input.commissionPersonId ?? null,
      productCode: input.productCode?.trim() || null,
      productExternalId: input.productExternalId ?? null,
      reason: input.reason.trim(),
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      active: input.active ?? true,
      createdByUserId: input.createdByUserId ?? null,
      updatedByUserId: input.createdByUserId ?? null,
      metadataJson: input.metadataJson as Prisma.InputJsonValue | undefined,
    },
    include: { commissionPerson: { select: { name: true } } },
  });
  return mapRow(row);
}

export async function updateCommissionCustomerException(
  id: string,
  input: {
    customerExternalId?: number | null;
    customerName?: string | null;
    commissionPersonId?: string | null;
    productCode?: string | null;
    productExternalId?: number | null;
    reason?: string;
    startDate?: Date;
    endDate?: Date | null;
    active?: boolean;
    updatedByUserId?: string | null;
    metadataJson?: Record<string, unknown>;
  }
): Promise<CommissionExceptionRow | null> {
  const existing = await prisma.commissionCustomerException.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.commissionCustomerException.update({
    where: { id },
    data: {
      customerExternalId: input.customerExternalId,
      customerName: input.customerName?.trim(),
      commissionPersonId: input.commissionPersonId,
      productCode: input.productCode?.trim(),
      productExternalId: input.productExternalId,
      reason: input.reason?.trim(),
      startDate: input.startDate,
      endDate: input.endDate,
      active: input.active,
      updatedByUserId: input.updatedByUserId ?? undefined,
      metadataJson: input.metadataJson as Prisma.InputJsonValue | undefined,
    },
    include: { commissionPerson: { select: { name: true } } },
  });
  return mapRow(row);
}

export async function toggleCommissionCustomerExceptionActive(
  id: string,
  updatedByUserId?: string | null
): Promise<CommissionExceptionRow | null> {
  const existing = await prisma.commissionCustomerException.findUnique({ where: { id } });
  if (!existing) return null;
  const row = await prisma.commissionCustomerException.update({
    where: { id },
    data: {
      active: !existing.active,
      updatedByUserId: updatedByUserId ?? undefined,
    },
    include: { commissionPerson: { select: { name: true } } },
  });
  return mapRow(row);
}
