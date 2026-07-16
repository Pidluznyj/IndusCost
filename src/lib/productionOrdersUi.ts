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
  const normalized = quantity.trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  const display = match
    ? (() => {
        const [, sign, integerRaw, fractionRaw = ""] = match;
        const integer = integerRaw.replace(/^0+(?=\d)/, "");
        const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        const fraction = fractionRaw.replace(/0+$/, "");
        return `${sign}${grouped}${fraction ? `,${fraction}` : ""}`;
      })()
    : normalized;
  const withUnit = unit?.trim() ? ` ${unit.trim()}` : "";
  return `${display}${withUnit}`;
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

export function productionOrderExtraSalesOrderCount(
  row: Pick<ProductionOrderGridRow, "currentSalesOrders">
): number {
  return Math.max(0, row.currentSalesOrders.length - 1);
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
  from?: string;
  to?: string;
}): boolean {
  return Boolean(
    args.search.trim() ||
      args.status?.trim() ||
      args.tipo.trim() ||
      args.company.trim() ||
      args.from?.trim() ||
      args.to?.trim()
  );
}

export function isProductionOrdersDateRangeInvalid(from: string, to: string): boolean {
  return Boolean(from && to && from > to);
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
  const preferredOrder = ["liberada", "planejada", "pendente", "encerrada", "concluida", "cancelada"];
  const rank = (value: string | null): number => {
    const folded = foldProductionOrderStatus(value);
    const index = preferredOrder.findIndex((known) => folded.includes(known));
    return index === -1 ? preferredOrder.length : index;
  };
  const entries = Object.entries(statusCounts)
    .filter(([key]) => key !== "")
    .map(([key, count]) => ({
      value: key === "" ? null : key,
      label: formatProductionOrderStatusLabel(key === "" ? null : key),
      count,
    }))
    .sort(
      (a, b) =>
        rank(a.value) - rank(b.value) ||
        b.count - a.count ||
        a.label.localeCompare(b.label, "pt-BR")
    );
  return entries;
}

function foldProductionOrderStatus(status: string | null | undefined): string {
  return (status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export type ProductionOrderStatusTone =
  | "completed"
  | "released"
  | "pending"
  | "cancelled"
  | "unknown";

export function resolveProductionOrderStatusTone(
  status: string | null | undefined
): ProductionOrderStatusTone {
  const folded = foldProductionOrderStatus(status);
  if (folded.includes("cancel")) return "cancelled";
  if (folded.includes("encerr") || folded.includes("conclu")) return "completed";
  if (folded.includes("liberad")) return "released";
  if (folded.includes("planej") || folded.includes("pendent")) return "pending";
  return "unknown";
}

export function productionOrderStatusBadgeClass(
  status: string | null | undefined
): string {
  const base =
    "inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  switch (resolveProductionOrderStatusTone(status)) {
    case "completed":
      return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
    case "released":
      return `${base} border-sky-200 bg-sky-50 text-sky-800`;
    case "pending":
      return `${base} border-amber-200 bg-amber-50 text-amber-800`;
    case "cancelled":
      return `${base} border-rose-200 bg-rose-50 text-rose-800`;
    default:
      return `${base} border-slate-200 bg-slate-50 text-slate-700`;
  }
}

export function productionOrderStatusOverlayTone(
  status: string | null | undefined
): "emerald" | "sky" | "amber" | "rose" | "slate" {
  switch (resolveProductionOrderStatusTone(status)) {
    case "completed":
      return "emerald";
    case "released":
      return "sky";
    case "pending":
      return "amber";
    case "cancelled":
      return "rose";
    default:
      return "slate";
  }
}
