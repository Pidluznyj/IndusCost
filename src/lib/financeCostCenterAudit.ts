import { prisma } from "@/src/lib/prisma.js";

export const FINANCE_COST_CENTER_AUDIT_VIEW_PERMISSIONS = [
  "finance.cost_center_audit.view",
  "finance.ap_allocations.view",
  "finance.view",
] as const;

export const FINANCE_COST_CENTER_AUDIT_SORT_FIELDS = [
  "createdAt",
  "userName",
  "action",
  "entityType",
] as const;

export type FinanceCostCenterAuditSortField = (typeof FINANCE_COST_CENTER_AUDIT_SORT_FIELDS)[number];

export type FinanceCostCenterAuditListQuery = {
  entityType?: string;
  userName?: string;
  action?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: FinanceCostCenterAuditSortField;
  sortDirection?: "asc" | "desc";
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

function parseDateStart(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseDateEnd(value: string | undefined): Date | undefined {
  if (!value?.trim()) return undefined;
  const d = new Date(`${value.trim()}T23:59:59.999Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
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
  const action =
    typeof query.action === "string" && query.action.trim() ? query.action.trim() : undefined;
  const search =
    typeof query.search === "string" && query.search.trim() ? query.search.trim() : undefined;
  const dateFrom =
    typeof query.dateFrom === "string" && query.dateFrom.trim() ? query.dateFrom.trim() : undefined;
  const dateTo =
    typeof query.dateTo === "string" && query.dateTo.trim() ? query.dateTo.trim() : undefined;
  const sortByRaw = typeof query.sortBy === "string" ? query.sortBy : "";
  const sortBy = FINANCE_COST_CENTER_AUDIT_SORT_FIELDS.includes(
    sortByRaw as FinanceCostCenterAuditSortField
  )
    ? (sortByRaw as FinanceCostCenterAuditSortField)
    : "createdAt";
  const sortDirection = query.sortDirection === "asc" ? "asc" : "desc";

  return {
    entityType,
    userName,
    action,
    search,
    dateFrom,
    dateTo,
    page: parsePositiveInt(query.page, 1, 10_000),
    limit: parsePositiveInt(query.limit, 50, 500),
    sortBy,
    sortDirection,
  };
}

export async function listFinanceCostCenterAuditLogs(
  query: FinanceCostCenterAuditListQuery
): Promise<FinanceCostCenterAuditListPayload> {
  const page = query.page ?? 1;
  const limit = query.limit ?? 50;
  const createdAt: { gte?: Date; lte?: Date } = {};
  const dateFrom = parseDateStart(query.dateFrom);
  const dateTo = parseDateEnd(query.dateTo);
  if (dateFrom) createdAt.gte = dateFrom;
  if (dateTo) createdAt.lte = dateTo;

  const where = {
    ...(query.entityType
      ? { entityType: { contains: query.entityType, mode: "insensitive" as const } }
      : {}),
    ...(query.userName
      ? { userName: { contains: query.userName, mode: "insensitive" as const } }
      : {}),
    ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
    ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
    ...(query.search
      ? {
          OR: [
            { action: { contains: query.search, mode: "insensitive" as const } },
            { entityId: { contains: query.search, mode: "insensitive" as const } },
            { entityType: { contains: query.search, mode: "insensitive" as const } },
            { userName: { contains: query.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const sortBy = query.sortBy ?? "createdAt";
  const sortDirection = query.sortDirection ?? "desc";

  const [total, rows] = await Promise.all([
    prisma.financialCostCenterAuditLog.count({ where }),
    prisma.financialCostCenterAuditLog.findMany({
      where,
      orderBy: { [sortBy]: sortDirection },
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
