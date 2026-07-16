/**
 * Helpers de UI — Ordens de Produção (consulta read-only).
 */
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { OPERATIONS_ACTIONS, OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import type { ProductionOrderGridRow } from "@/src/lib/productionOrdersList.js";
import { HttpError } from "@/src/lib/http.js";

export const PRODUCTION_ORDERS_MODULE_ID = "production-orders" as const;
export const PRODUCTION_ORDERS_ROUTE_PATH = "/production-orders";
export const PRODUCTION_ORDERS_PAGE_TITLE = "Ordens de Produção";
export const PRODUCTION_ORDERS_PAGE_SUBTITLE =
  "Consulta e auditoria das ordens sincronizadas do Nomus.";
export const PRODUCTION_ORDERS_BREADCRUMB = "Operações / Ordens de Produção";

export const PRODUCTION_ORDERS_VIEW_LEGACY_PERMISSION =
  "operations.production-orders.view" as const;

export function canViewProductionOrders(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  if (check.canPerformAction?.(OPERATIONS_RESOURCE_KEYS.productionOrders, OPERATIONS_ACTIONS.view)) {
    return true;
  }
  if (check.hasPermission?.(PRODUCTION_ORDERS_VIEW_LEGACY_PERMISSION)) {
    return true;
  }
  return false;
}

export function canAccessProductionOrdersModule(check: PermissionChecker): boolean {
  return check.hasPermission(PRODUCTION_ORDERS_VIEW_LEGACY_PERMISSION);
}

export function formatProductionOrderDateTime(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatProductionOrderQuantity(
  quantity: string | null | undefined,
  unit: string | null | undefined
): string {
  if (quantity == null || quantity === "") return "—";
  const withUnit = unit?.trim() ? ` ${unit.trim()}` : "";
  return `${quantity}${withUnit}`;
}

export function formatProductionOrderStatusLabel(status: string | null | undefined): string {
  if (status == null || status === "") return "Sem status";
  return status;
}

export function formatProductionOrderPrimaryOrder(
  row: Pick<ProductionOrderGridRow, "currentSalesOrders">
): string {
  const first = row.currentSalesOrders[0];
  if (!first) return "—";
  return first.orderCode?.trim() || String(first.externalSalesOrderId);
}

export function formatProductionOrderPrimaryCustomer(
  row: Pick<ProductionOrderGridRow, "currentSalesOrders">
): string {
  const first = row.currentSalesOrders[0];
  if (!first?.customerName?.trim()) return "—";
  return first.customerName.trim();
}

export function resolveLatestSyncedAt(
  rows: ReadonlyArray<Pick<ProductionOrderGridRow, "syncedAt">>
): string | null {
  let latest: string | null = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    if (row.syncedAt == null || row.syncedAt === "") continue;
    const ms = Date.parse(row.syncedAt);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = row.syncedAt;
    }
  }
  return latest;
}

export function hasActiveProductionOrdersFilters(args: {
  search: string;
  status: string | null;
  tipo: string;
  company: string;
}): boolean {
  return Boolean(
    args.search.trim() ||
      args.status?.trim() ||
      args.tipo.trim() ||
      args.company.trim()
  );
}

export function classifyProductionOrdersListError(error: unknown): {
  kind: "access_denied" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar Ordens de Produção.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message: "API de Ordens de Produção indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar Ordens de Produção.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message: "API de Ordens de Produção indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message: error instanceof Error ? error.message : "Erro ao carregar Ordens de Produção.",
  };
}

export function buildStatusChipEntries(
  statusCounts: Record<string, number>
): Array<{ value: string | null; label: string; count: number }> {
  const entries = Object.entries(statusCounts)
    .map(([key, count]) => ({
      value: key === "" ? null : key,
      label: formatProductionOrderStatusLabel(key === "" ? null : key),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
  return entries;
}
