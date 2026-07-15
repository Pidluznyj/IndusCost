/**
 * Permissões Pessoas / RH — contrato canônico (admin.employees.*) + legado.
 * Facetas finas OR com employees.edit / people.* para preservar acesso efetivo.
 */

export const EMPLOYEES_VIEW_PERMISSIONS = [
  "employees.view",
  "employees.edit",
  "costs.view",
] as const;

export const EMPLOYEES_CREATE_PERMISSIONS = [
  "employees.create",
  "employees.edit",
] as const;

export const EMPLOYEES_UPDATE_PERMISSIONS = ["employees.edit"] as const;

export const EMPLOYEES_PERSONAL_DATA_VIEW_PERMISSIONS = [
  "employees.personal_data.view",
  "people.pii.view",
  "employees.edit",
] as const;

export const EMPLOYEES_ADMINISTRATIVE_DATA_VIEW_PERMISSIONS = [
  "employees.administrative_data.view",
  "employees.edit",
] as const;

export const EMPLOYEES_SENSITIVE_DATA_VIEW_PERMISSIONS = [
  "employees.sensitive_data.view",
  "employees.edit",
] as const;

export const EMPLOYEES_LINKS_VIEW_PERMISSIONS = [
  "employees.links.view",
  "employees.view",
  "employees.edit",
  "people.search",
] as const;

export const EMPLOYEES_LINKS_MANAGE_PERMISSIONS = [
  "employees.links.manage",
  "people.link.manage",
  "employees.edit",
  "users.manage",
] as const;

export const EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS = [
  "employees.user_link.manage",
  "employees.edit",
  "users.manage",
] as const;

export const EMPLOYEES_EPI_MANAGE_PERMISSIONS = [
  "employees.epi.manage",
  "employees.edit",
] as const;

export const EMPLOYEES_PEOPLE_SEARCH_PERMISSIONS = [
  "people.search",
  "employees.view",
  "employees.edit",
  "users.manage",
] as const;

/** ResourceKeys do contrato (espelho FE). */
export const EMPLOYEE_RESOURCE_KEYS = {
  module: "admin.employees",
  personalData: "admin.employees.personal_data",
  administrativeData: "admin.employees.administrative_data",
  sensitiveData: "admin.employees.sensitive_data",
  links: "admin.employees.links",
  userLink: "admin.employees.user_link",
  epi: "admin.employees.epi",
} as const;

export type EmployeePermissionBag = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission?: (permissions: readonly string[]) => boolean;
};

function hasAny(check: EmployeePermissionBag, keys: readonly string[]): boolean {
  if (typeof check.hasAnyPermission === "function") {
    return check.hasAnyPermission(keys);
  }
  return keys.some((k) => check.hasPermission(k));
}

export function canListEmployees(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_VIEW_PERMISSIONS);
}

export function canCreateEmployees(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_CREATE_PERMISSIONS);
}

export function canUpdateEmployees(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_UPDATE_PERMISSIONS);
}

export function canViewEmployeePersonalData(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_PERSONAL_DATA_VIEW_PERMISSIONS);
}

export function canViewEmployeeAdministrativeData(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_ADMINISTRATIVE_DATA_VIEW_PERMISSIONS);
}

export function canViewEmployeeSensitiveData(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_SENSITIVE_DATA_VIEW_PERMISSIONS);
}

export function canViewEmployeeLinks(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_LINKS_VIEW_PERMISSIONS);
}

export function canManageEmployeeLinks(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_LINKS_MANAGE_PERMISSIONS);
}

export function canManageEmployeeUserLink(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_USER_LINK_MANAGE_PERMISSIONS);
}

export function canManageEmployeeEpi(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_EPI_MANAGE_PERMISSIONS);
}

export function canSearchCanonicalPeople(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_PEOPLE_SEARCH_PERMISSIONS);
}

/** Caps do agregador de vínculos a partir do bag legado. */
export function buildEmployeeSystemLinksCapsFromPermissions(
  permissions: readonly string[],
  role?: string | null
): {
  canViewPii: boolean;
  canViewUsers: boolean;
  canViewCommissions: boolean;
  canViewCustomers: boolean;
  canViewFleet: boolean;
  canViewEmployees: boolean;
  canOpenAudit: boolean;
  canManagePersonLink: boolean;
} {
  const isAdmin = role === "SUPER_ADMIN" || role === "ADMIN";
  const set = new Set(permissions);
  const has = (p: string) => isAdmin || set.has(p);
  const check: EmployeePermissionBag = {
    hasPermission: has,
    hasAnyPermission: (keys) => keys.some((k) => has(k)),
  };

  return {
    canViewPii: canViewEmployeePersonalData(check),
    canViewUsers: has("users.manage") || has("settings.view"),
    canViewCommissions: has("commissions.view"),
    canViewCustomers: has("customers.view"),
    canViewFleet: has("fleet.view"),
    canViewEmployees: canListEmployees(check),
    canOpenAudit: canManageEmployeeLinks(check) || has("employees.edit"),
    canManagePersonLink: canManageEmployeeLinks(check),
  };
}
