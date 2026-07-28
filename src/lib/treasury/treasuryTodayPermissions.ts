/**
 * Permissões UI — Tesouraria de hoje (mesmo recurso do dashboard).
 */

import {
  canViewTreasuryDashboard,
  type TreasuryDashboardPermissionCheck,
} from "./treasuryDashboardPermissions.js";

export type TreasuryTodayPermissionCheck = TreasuryDashboardPermissionCheck;

export function canViewTreasuryToday(
  auth: TreasuryTodayPermissionCheck
): boolean {
  return canViewTreasuryDashboard(auth);
}
