/**
 * Auditoria do módulo Estoque — server-only.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export type InventoryAuditInput = {
  entityType: string;
  entityId: string;
  action: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  userId?: string | null;
  userName?: string | null;
  reason?: string | null;
};

export async function writeInventoryAuditLog(
  prisma: PrismaClient,
  input: InventoryAuditInput
): Promise<void> {
  await prisma.inventoryAuditLog.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      beforeJson:
        input.beforeJson === undefined
          ? undefined
          : (input.beforeJson as Prisma.InputJsonValue),
      afterJson:
        input.afterJson === undefined
          ? undefined
          : (input.afterJson as Prisma.InputJsonValue),
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      reason: input.reason ?? null,
    },
  });
}

export type ListInventoryAuditQuery = {
  page: number;
  pageSize: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
};

export function serializeInventoryAuditLog(row: {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  beforeJson: unknown;
  afterJson: unknown;
  userId: string | null;
  userName: string | null;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    beforeJson: row.beforeJson ?? null,
    afterJson: row.afterJson ?? null,
    userId: row.userId,
    userName: row.userName,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listInventoryAuditLogs(
  prisma: PrismaClient,
  query: ListInventoryAuditQuery
) {
  const where: Prisma.InventoryAuditLogWhereInput = {
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" } } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
  };
  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.inventoryAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: query.pageSize,
    }),
    prisma.inventoryAuditLog.count({ where }),
  ]);
  return {
    rows: rows.map(serializeInventoryAuditLog),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
