import type { AppAuthContext } from "@/src/lib/auth/appAuth.shared.js";
import {
  hasAnyPermission,
  hasPermission,
} from "@/src/lib/auth/appAuth.shared.js";
import { evaluateFleetRouteAccess } from "@/src/lib/fleetPermissionResolve.js";

export {
  formatExecutiveCompactCurrency,
  formatExecutiveCurrency,
  formatExecutiveDecimal,
  formatExecutiveInteger,
  formatExecutivePercent,
  formatMetricCount,
  formatMetricCurrency,
} from "@/src/lib/executiveDashboardFormatters.js";

export function safeMetricNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      return safeMetricNumber((value as { toNumber: () => number }).toNumber());
    } catch {
      return safeMetricNumber(String(value));
    }
  }
  return safeMetricNumber(value);
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

export function startOfPreviousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1, 0, 0, 0, 0);
}

export function endOfPreviousMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
}

export function canSeeCommercial(user: AppAuthContext): boolean {
  return hasAnyPermission(user, [
    "sales_orders.view",
    "proposals.view",
    "reports.view",
    "crm.view",
    "customers.view",
  ]);
}

export function canSeeSalesOrders(user: AppAuthContext): boolean {
  return hasPermission(user, "sales_orders.view") || hasPermission(user, "reports.view");
}

export function canSeeProposals(user: AppAuthContext): boolean {
  return hasPermission(user, "proposals.view");
}

export function canSeeCustomers(user: AppAuthContext): boolean {
  return hasPermission(user, "customers.view");
}

export function canSeeCrmActivity(user: AppAuthContext): boolean {
  return hasAnyPermission(user, ["crm.view", "crm.customer_cockpit.view", "customers.view"]);
}

export function canSeeProducts(user: AppAuthContext): boolean {
  return hasPermission(user, "products.view");
}

export function canSeeNomus(user: AppAuthContext): boolean {
  return hasAnyPermission(user, [
    "products.view",
    "products.tab.bom",
    "products.tab.tree",
    "products.tab.cost",
    "products.edit",
    "settings.nomus.view",
  ]);
}

export function canSeeFleet(user: AppAuthContext): boolean {
  const held = user.effectivePermissions;
  if (held?.length) return evaluateFleetRouteAccess(held, "view");
  return hasPermission(user, "fleet.view") || hasPermission(user, "fleet.manage");
}

export function canSeePeople(user: AppAuthContext): boolean {
  return hasPermission(user, "employees.view");
}

export function unavailableSection<T extends { available: boolean }>(
  base: T,
  reason: string
): T {
  return { ...base, available: false, unavailableReason: reason };
}
