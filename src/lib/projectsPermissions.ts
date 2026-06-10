import type { PermissionChecker } from "@/src/lib/modulePermissions.js";

export const PROJECTS_VIEW_PERMISSIONS = ["projects.view"] as const;
export const PROJECTS_MANAGE_PERMISSIONS = ["projects.manage"] as const;
export const PROJECTS_APPROVE_PERMISSIONS = ["projects.approve"] as const;
export const PROJECTS_CONVERT_PERMISSIONS = ["projects.convert"] as const;

export const PROJECTS_LOOKUP_PERMISSIONS = [
  ...PROJECTS_VIEW_PERMISSIONS,
  ...PROJECTS_MANAGE_PERMISSIONS,
] as const;

export function canViewProjects(check: PermissionChecker): boolean {
  return check.hasPermission("projects.view");
}

export function canManageProjects(check: PermissionChecker): boolean {
  return check.hasPermission("projects.manage");
}

export function canApproveProjects(check: PermissionChecker): boolean {
  return check.hasPermission("projects.approve");
}

export function canConvertProjects(check: PermissionChecker): boolean {
  return check.hasPermission("projects.convert");
}

/** Conversão oficial ainda não implementada — sempre false na API. */
export function isOfficialConversionEnabled(): boolean {
  return false;
}
