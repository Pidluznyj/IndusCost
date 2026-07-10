import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS,
  COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS,
  COMMISSIONS_VIEW_PERMISSIONS,
} from "@/src/lib/commissionsPermissions.js";
import type { CommissionsSectionId } from "@/src/lib/commissionsNavigation.js";
import {
  COMMISSIONS_SECTIONS,
  isCommissionsHiddenSection,
} from "@/src/lib/commissionsNavigation.js";

export function canAccessCommissionsModule(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
}

export function canViewCommissionsSection(
  sectionId: CommissionsSectionId,
  check: PermissionChecker
): boolean {
  if (isCommissionsHiddenSection(sectionId)) {
    return false;
  }
  if (sectionId === "monthlyClosing") {
    return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "customerExclusions") {
    return check.hasAnyPermission([...COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "reports") {
    return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
  }
  return false;
}

export function resolveFirstAccessibleCommissionsPath(check: PermissionChecker): string | null {
  const section = COMMISSIONS_SECTIONS.find((s) => canViewCommissionsSection(s.id, check));
  return section?.path ?? null;
}

export function canManageReceiptClosing(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS]);
}
