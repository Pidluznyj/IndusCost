import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";

export class ProjectsAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectsAccessError";
  }
}

export const PROJECTS_VIEW_PERMISSIONS = ["projects.view"] as const;
export const PROJECTS_MANAGE_PERMISSIONS = ["projects.manage"] as const;
export const PROJECTS_APPROVE_PERMISSIONS = ["projects.approve"] as const;
export const PROJECTS_CONVERT_PERMISSIONS = ["projects.convert"] as const;

export const PROJECTS_LOOKUP_PERMISSIONS = [
  ...PROJECTS_VIEW_PERMISSIONS,
  ...PROJECTS_MANAGE_PERMISSIONS,
] as const;

export function canViewProjects(
  check: PermissionChecker & { canViewResource?: (key: string) => boolean }
): boolean {
  if (typeof check.canViewResource === "function") {
    if (check.canViewResource("engineering.projects")) return true;
  }
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

export function assertProjectsDeleteSuperAdmin(user: AppAuthContext | null): void {
  if (!user) {
    throw new ProjectsAccessError("Autenticação necessária.");
  }
  if (user.role !== "SUPER_ADMIN") {
    throw new ProjectsAccessError("Somente super administrador pode excluir projetos.");
  }
}

export function canDeleteProject(check: { isSuperAdmin: () => boolean }): boolean {
  return check.isSuperAdmin();
}
