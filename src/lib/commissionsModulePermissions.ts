import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  COMMISSIONS_AUDIT_VIEW_PERMISSIONS,
  COMMISSIONS_CONFIRMED_VIEW_PERMISSIONS,
  COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS,
  COMMISSIONS_FORECAST_VIEW_PERMISSIONS,
  COMMISSIONS_PAYMENTS_VIEW_PERMISSIONS,
  COMMISSIONS_PEOPLE_VIEW_PERMISSIONS,
  COMMISSIONS_RELEASE_VIEW_PERMISSIONS,
  COMMISSIONS_RULES_VIEW_PERMISSIONS,
  COMMISSIONS_SETTINGS_VIEW_PERMISSIONS,
  COMMISSIONS_VIEW_PERMISSIONS,
} from "@/src/lib/commissionsPermissions.js";import type { CommissionsSectionId } from "@/src/lib/commissionsNavigation.js";

export function canAccessCommissionsModule(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
}

export function canViewCommissionsSection(
  sectionId: CommissionsSectionId,
  check: PermissionChecker
): boolean {
  switch (sectionId) {
    case "dashboard":
      return check.hasAnyPermission([...COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS]);
    case "forecast":
      return check.hasAnyPermission([...COMMISSIONS_FORECAST_VIEW_PERMISSIONS]);
    case "confirmed":
      return check.hasAnyPermission([...COMMISSIONS_CONFIRMED_VIEW_PERMISSIONS]);
    case "releases":
      return check.hasAnyPermission([...COMMISSIONS_RELEASE_VIEW_PERMISSIONS]);
    case "payments":
      return check.hasAnyPermission([...COMMISSIONS_PAYMENTS_VIEW_PERMISSIONS]);
    case "persons":
      return check.hasAnyPermission([...COMMISSIONS_PEOPLE_VIEW_PERMISSIONS]);
    case "rules":
      return check.hasAnyPermission([...COMMISSIONS_RULES_VIEW_PERMISSIONS]);
    case "audit":
      return check.hasAnyPermission([...COMMISSIONS_AUDIT_VIEW_PERMISSIONS]);
    case "settings":
      return check.hasAnyPermission([...COMMISSIONS_SETTINGS_VIEW_PERMISSIONS]);
    default:
      return false;
  }
}
