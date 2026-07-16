import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import {
  COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS,
  COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS,
  COMMISSIONS_RECALCULATE_PERMISSIONS,
  COMMISSIONS_VIEW_PERMISSIONS,
} from "@/src/lib/commissionsPermissions.js";
import type { CommissionsSectionId } from "@/src/lib/commissionsNavigation.js";
import {
  COMMISSIONS_SECTIONS,
  isCommissionsHiddenSection,
} from "@/src/lib/commissionsNavigation.js";
import {
  COMMISSIONS_LIVE_UI_TABS,
  TabResourceKeys,
} from "@/src/lib/moduleTabResources.js";

const LIVE_SECTION_RESOURCE: Partial<Record<CommissionsSectionId, string>> = {
  monthlyClosing: TabResourceKeys.COMISSOES_FECHAMENTO,
  closings: TabResourceKeys.COMISSOES_FECHAMENTOS,
  customerExclusions: TabResourceKeys.COMISSOES_EXCECOES,
  reports: TabResourceKeys.COMISSOES_RELATORIOS,
  reprocess: TabResourceKeys.COMISSOES_REPROCESSAR,
};

export function canAccessCommissionsModule(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
}

/**
 * Visibilidade de seção: OR legado + mapeamento para resourceKey (quando checker
 * expõe canViewResource — senão só legado).
 */
export function canViewCommissionsSection(
  sectionId: CommissionsSectionId,
  check: PermissionChecker & { canViewResource?: (key: string) => boolean }
): boolean {
  if (isCommissionsHiddenSection(sectionId)) {
    return false;
  }

  const resourceKey = LIVE_SECTION_RESOURCE[sectionId];
  if (resourceKey && typeof check.canViewResource === "function") {
    if (check.canViewResource(resourceKey)) return true;
  }

  if (sectionId === "monthlyClosing") {
    return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "closings") {
    return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "customerExclusions") {
    return check.hasAnyPermission([...COMMISSIONS_EXCEPTIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "reports") {
    return check.hasAnyPermission([...COMMISSIONS_VIEW_PERMISSIONS]);
  }
  if (sectionId === "reprocess") {
    return check.hasAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]);
  }
  return false;
}

export function resolveFirstAccessibleCommissionsPath(
  check: PermissionChecker & { canViewResource?: (key: string) => boolean }
): string | null {
  const section = COMMISSIONS_SECTIONS.find((s) => canViewCommissionsSection(s.id, check));
  return section?.path ?? null;
}

export function canManageReceiptClosing(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS]);
}

/** P13: fechamento = close/manage — não view. */
export function canCloseReceiptClosing(check: PermissionChecker): boolean {
  return canManageReceiptClosing(check);
}

/** P13: reprocessar comissões — manage de rules/payments (contrato reprocess). */
export function canReprocessCommissions(check: PermissionChecker): boolean {
  return (
    check.hasAnyPermission([...COMMISSIONS_RECALCULATE_PERMISSIONS]) ||
    check.hasAnyPermission([...COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS])
  );
}

export function listAllowedCommissionsLiveSectionIds(
  canViewResource: (key: string) => boolean
): Array<"monthlyClosing" | "closings" | "customerExclusions" | "reports" | "reprocess"> {
  return COMMISSIONS_LIVE_UI_TABS.filter((t) => canViewResource(t.resourceKey)).map((t) => t.id);
}
