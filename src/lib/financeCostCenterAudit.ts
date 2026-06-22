import { prisma } from "@/src/lib/prisma.js";

export const FINANCE_COST_CENTER_AUDIT_VIEW_PERMISSIONS = [
  "finance.cost_center_audit.view",
  "finance.ap_allocations.view",
  "finance.view",
] as const;

export type FinanceCostCenterAuditListQuery = {
  entityType?: string;
  userName?: string;
  page?: number;
  limit?: number;
};

export type FinanceCostCenterAuditLogItem = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userName: string | null;
  createdAt: string;
};

export type FinanceCostCenterAuditListPayload = {
  page: number;
  limit: number;
  total: number;
  items: FinanceCostCenterAuditLogItem[];
};

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

export function parseFinanceCostCenterAuditListQuery(
  query: Record<string, unknown>
): FinanceCostCenterAuditListQuery {
  const entityType =
    typeof query.entityType === "string" && query.entityType.trim()
      ? query.entityType.trim()
      : undefined;
  const userName =
    typeof query.userName === "string" && query.userName.trim()
      ? query.userName.trim()
      : undefined;
  return {
    entityType,
    userName,
    page: parsePositiveInt(query.page, 1, 10_000),
    limit: parsePositiveInt(query.limit, 100, 500),
  };
}

export async function listFinanceCostCenterAuditLogs(
  query: FinanceCostCenterAuditListQuery
): Promise<FinanceCostCenterAuditListPayload> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 100;
  const where = {
    ...(query.entityType ? { entityType: { contains: query.entityType, mode: "insensitive" as const } } : {}),
    ...(query.userName
      ? { userName: { contains: query.userName, mode: "insensitive" as const } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.financialCostCenterAuditLog.count({ where }),
    prisma.financialCostCenterAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        action: true,
        userName: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    page,
    limit,
    total,
    items: rows.map((row) => ({
      id: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      action: row.action,
      userName: row.userName,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
