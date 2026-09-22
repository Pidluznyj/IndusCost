/**
 * Permissões Pessoas / RH — contrato canônico (admin.employees.*) + legado.
 * Facetas finas OR com employees.edit / people.* para preservar acesso efetivo.
 */

export const EMPLOYEES_VIEW_PERMISSIONS = [
  "employees.view",
  "employees.edit",
] as const;

/** Dashboard de Pessoas — headcount/qualidade; R$ ainda exige sensitive_data. */
export const EMPLOYEES_DASHBOARD_VIEW_PERMISSIONS = [
  "employees.dashboard.view",
  "employees.edit",
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
  dashboard: "admin.employees.dashboard",
  personalData: "admin.employees.personal_data",
  administrativeData: "admin.employees.administrative_data",
  sensitiveData: "admin.employees.sensitive_data",
  links: "admin.employees.links",
  userLink: "admin.employees.user_link",
  epi: "admin.employees.epi",
  career: "admin.employees.career",
  compensationEvents: "admin.employees.compensation_events",
  compensationValues: "admin.employees.compensation_values",
  benefits: "admin.employees.benefits",
  documents: "admin.employees.documents",
  absences: "admin.employees.absences",
  history: "admin.employees.history",
  notes: "admin.employees.notes",
  notesRestricted: "admin.employees.notes_restricted",
  team: "admin.employees.team",
} as const;

export type EmployeePermissionBag = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission?: (permissions: readonly string[]) => boolean;
  /** Deny explícito do motor oficial — vence allow/alias/herança. */
  isDenied?: (permission: string) => boolean;
  /**
   * Recursos `view` já resolvidos por requireResource (deny aplicado).
   * Quando presente, valores financeiros exigem `admin.employees.compensation_values`.
   */
  canonicalViewResources?: readonly string[];
};

/** Fotografia canônica do request (espelho de `AppAuthContext.canonicalAccess`). */
export type EmployeeCanonicalAccessSnapshot = {
  viewResources: readonly string[];
  updateResources?: readonly string[];
  /** Ações create canônicas — compat: bags gravados antes do pin só têm employees.create. */
  createResources?: readonly string[];
  /** Denies individuais explícitos no formato "resourceKey:action". */
  overrideDenied?: readonly string[];
};

const COMPENSATION_VALUES_LEGACY_KEY = "employees.compensation.values.view";
const COMPENSATION_VALUES_VIEW_DENY = `${EMPLOYEE_RESOURCE_KEYS.compensationValues}:view`;

/**
 * Bag oficial do servidor para Pessoas / RH.
 *
 * Editor de RH := `employees.edit` legado OU `admin.employees:update` canônico
 * (SUPER_ADMIN sempre). O editor responde `employees.edit` = true (alias amplo →
 * todas as capabilities da ficha) e enxerga VALORES de remuneração, salvo deny
 * individual explícito em `admin.employees.compensation_values:view` (deny > allow).
 * Quem não é editor mantém exatamente o comportamento anterior.
 */
export function buildEmployeePermissionBag(input: {
  hasLegacyPermission: (permission: string) => boolean;
  canonicalAccess?: EmployeeCanonicalAccessSnapshot | null;
}): EmployeePermissionBag & { isHrEditor: boolean } {
  const canonical = input.canonicalAccess ?? null;
  // Editor de RH := employees.edit legado OU admin.employees:update canônico OU
  // admin.employees:create canônico. O create entra por compatibilidade: nas telas de
  // permissão criar/editar são o mesmo eixo ("Executar") e os bags gravados antes do pin
  // de employees.edit (permissionDualWrite/aliasIndex.ts) só carregam employees.create —
  // a matriz mostrava "editar" marcado enquanto o motor negava o update.
  const isHrEditor =
    input.hasLegacyPermission("employees.edit") ||
    Boolean(canonical?.updateResources?.includes(EMPLOYEE_RESOURCE_KEYS.module)) ||
    Boolean(canonical?.createResources?.includes(EMPLOYEE_RESOURCE_KEYS.module));

  const has = (permission: string) =>
    (isHrEditor && permission === "employees.edit") ||
    input.hasLegacyPermission(permission);

  let viewResources: readonly string[] | undefined = canonical?.viewResources;
  if (
    viewResources &&
    isHrEditor &&
    !viewResources.includes(EMPLOYEE_RESOURCE_KEYS.compensationValues) &&
    !canonical?.overrideDenied?.includes(COMPENSATION_VALUES_VIEW_DENY)
  ) {
    viewResources = [...viewResources, EMPLOYEE_RESOURCE_KEYS.compensationValues].sort();
  }

  return {
    isHrEditor,
    hasPermission: has,
    hasAnyPermission: (list) => list.some((p) => has(p)),
    canonicalViewResources: viewResources,
    isDenied: (permission) => {
      if (!viewResources) return false;
      if (permission === COMPENSATION_VALUES_LEGACY_KEY) {
        return !viewResources.includes(EMPLOYEE_RESOURCE_KEYS.compensationValues);
      }
      return false;
    },
  };
}

function hasAny(check: EmployeePermissionBag, keys: readonly string[]): boolean {
  if (typeof check.hasAnyPermission === "function") {
    return check.hasAnyPermission(keys);
  }
  return keys.some((k) => check.hasPermission(k));
}

export function canListEmployees(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_VIEW_PERMISSIONS);
}

export function canViewEmployeesDashboard(check: EmployeePermissionBag): boolean {
  return hasAny(check, EMPLOYEES_DASHBOARD_VIEW_PERMISSIONS);
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

export class EmployeesAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmployeesAccessError";
  }
}

/** Exclusão definitiva de colaborador — somente SUPER_ADMIN. */
export function canDeleteEmployee(check: { isSuperAdmin: () => boolean }): boolean {
  return check.isSuperAdmin();
}

export function assertEmployeesDeleteSuperAdmin(user: {
  role?: string | null;
} | null): void {
  if (!user) {
    throw new EmployeesAccessError("Autenticação necessária.");
  }
  if (user.role !== "SUPER_ADMIN") {
    throw new EmployeesAccessError(
      "Somente super administrador pode excluir colaboradores definitivamente."
    );
  }
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
/**
 * Gate do botão Editar/Novo no cliente — mesma regra do servidor (Editor de RH):
 * com DTO canônico, só `admin.employees:update|create`; sem DTO, cai no bag legado.
 * Antes, "ver" no Dashboard de Pessoas bastava para o botão aparecer (o DTO legado
 * lista `employees.edit` sob o dashboard) e o salvar tomava 403.
 */
export function resolveEmployeesEditorClientGate(input: {
  isSuperAdmin: boolean;
  hasCanonicalDto: boolean;
  canPerformAction: (resourceKey: string, action: "create" | "update") => boolean;
  legacyCanEdit: () => boolean;
  legacyCanCreate: () => boolean;
}): { canEdit: boolean; canCreate: boolean } {
  if (input.isSuperAdmin) return { canEdit: true, canCreate: true };
  if (input.hasCanonicalDto) {
    const editor =
      input.canPerformAction(EMPLOYEE_RESOURCE_KEYS.module, "update") ||
      input.canPerformAction(EMPLOYEE_RESOURCE_KEYS.module, "create");
    return { canEdit: editor, canCreate: editor };
  }
  const canEdit = input.legacyCanEdit();
  return { canEdit, canCreate: canEdit || input.legacyCanCreate() };
}
