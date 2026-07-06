import type { PermissionChecker } from "../modulePermissions.js";
import { COST_TO_CASH_TRACE_VIEW_PERMISSIONS } from "./costToCashTraceApi.js";

export function canViewCostToCashTracePage(check: PermissionChecker): boolean {
  return check.hasAnyPermission([
    ...COST_TO_CASH_TRACE_VIEW_PERMISSIONS,
    "reports.view",
    "dashboard.view",
  ]);
}
