/**
 * Resolução de permissões da Gestão de Frota com compatibilidade retroativa.
 * Chaves legadas (fleet.view, fleet.manage, …) implicam permissões granulares equivalentes.
 * Backend: usar canFleet() / expandFleetPermissions() — não confiar só em hasPermission() do appAuth
 * para checagens granulares (hasPermission continua exato para chaves gravadas no usuário).
 */

/** Permissões legadas — mantidas no catálogo e no banco. */
export const FLEET_LEGACY_PERMISSIONS = [
  "fleet.view",
  "fleet.manage",
  "fleet.vehicles.edit",
  "fleet.reservations.create",
  "fleet.reservations.approve",
  "fleet.maintenance.manage",
  "fleet.financial.view",
  "fleet.settings.manage",
] as const;

export type FleetLegacyPermission = (typeof FLEET_LEGACY_PERMISSIONS)[number];

/** Permissões granulares (catálogo + guards). */
export const FLEET_GRANULAR_PERMISSIONS = [
  "fleet.dashboard.view",
  "fleet.vehicles.view",
  "fleet.vehicles.create",
  "fleet.vehicles.edit",
  "fleet.vehicles.status.manage",
  "fleet.contracts.view",
  "fleet.contracts.manage",
  "fleet.documents.view",
  "fleet.documents.manage",
  "fleet.drivers.view",
  "fleet.drivers.manage",
  "fleet.reservations.view",
  "fleet.reservations.create",
  "fleet.reservations.approve",
  "fleet.reservations.manage",
  "fleet.usage.checkout",
  "fleet.usage.checkin",
  "fleet.maintenance.view",
  "fleet.maintenance.manage",
  "fleet.costs.view",
  "fleet.costs.manage",
  "fleet.financial.view",
  "fleet.reports.view",
  "fleet.settings.manage",
] as const;

export type FleetGranularPermission = (typeof FLEET_GRANULAR_PERMISSIONS)[number];

export const FLEET_ALL_PERMISSION_KEYS = [
  ...FLEET_LEGACY_PERMISSIONS,
  ...FLEET_GRANULAR_PERMISSIONS,
] as const;

const VIEW_GRANTS: FleetGranularPermission[] = [
  "fleet.dashboard.view",
  "fleet.vehicles.view",
  "fleet.contracts.view",
  "fleet.documents.view",
  "fleet.drivers.view",
  "fleet.reservations.view",
  "fleet.maintenance.view",
  "fleet.costs.view",
  "fleet.reports.view",
];

/** Implicações entre permissões granulares (quem tem a chave da esquerda recebe também as da direita). */
const GRANULAR_IMPLIES: Partial<Record<string, readonly string[]>> = {
  "fleet.vehicles.create": ["fleet.vehicles.view"],
  "fleet.vehicles.edit": ["fleet.vehicles.view"],
  "fleet.vehicles.status.manage": ["fleet.vehicles.view"],
  "fleet.contracts.manage": ["fleet.contracts.view"],
  "fleet.documents.manage": ["fleet.documents.view"],
  "fleet.drivers.manage": ["fleet.drivers.view"],
  "fleet.reservations.create": [
    "fleet.reservations.view",
    "fleet.usage.checkout",
    "fleet.usage.checkin",
  ],
  "fleet.reservations.approve": ["fleet.reservations.view"],
  "fleet.reservations.manage": ["fleet.reservations.view"],
  "fleet.usage.checkout": ["fleet.reservations.view"],
  "fleet.usage.checkin": ["fleet.reservations.view"],
  "fleet.maintenance.manage": ["fleet.maintenance.view"],
  "fleet.costs.manage": ["fleet.costs.view", "fleet.financial.view"],
  "fleet.financial.view": ["fleet.costs.view", "fleet.reports.view"],
};

/** Legado → granular (compatibilidade usuários existentes). */
const LEGACY_IMPLIES: Partial<Record<FleetLegacyPermission, readonly string[]>> = {
  "fleet.view": VIEW_GRANTS,
  "fleet.vehicles.edit": [
    "fleet.vehicles.view",
    "fleet.vehicles.create",
    "fleet.vehicles.edit",
    "fleet.vehicles.status.manage",
    "fleet.contracts.view",
    "fleet.contracts.manage",
    "fleet.documents.view",
    "fleet.documents.manage",
  ],
  "fleet.reservations.create": [
    "fleet.reservations.view",
    "fleet.reservations.create",
    "fleet.usage.checkout",
    "fleet.usage.checkin",
  ],
  "fleet.reservations.approve": ["fleet.reservations.view", "fleet.reservations.approve"],
  "fleet.maintenance.manage": ["fleet.maintenance.view", "fleet.maintenance.manage"],
  "fleet.financial.view": [
    "fleet.financial.view",
    "fleet.costs.view",
    "fleet.costs.manage",
    "fleet.reports.view",
  ],
};

const MANAGE_GRANTS: readonly string[] = [
  ...FLEET_LEGACY_PERMISSIONS.filter((k) => k !== "fleet.settings.manage"),
  ...FLEET_GRANULAR_PERMISSIONS.filter((k) => k !== "fleet.settings.manage"),
];

function addImplied(set: Set<string>, key: string): void {
  if (set.has(key)) return;
  set.add(key);
  const granular = GRANULAR_IMPLIES[key];
  if (granular) for (const g of granular) addImplied(set, g);
  const legacy = LEGACY_IMPLIES[key as FleetLegacyPermission];
  if (legacy) for (const g of legacy) addImplied(set, g);
}

/** Expande permissões explícitas do usuário com aliases legados e implicações granulares. */
export function expandFleetPermissions(held: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of held) {
    const key = raw.trim();
    if (!key) continue;
    addImplied(out, key);
    if (key === "fleet.manage") {
      for (const g of MANAGE_GRANTS) addImplied(out, g);
    }
  }
  return out;
}

/** OR: usuário possui ao menos uma permissão requerida (após expansão). */
export function canFleet(held: readonly string[], requiredAny: readonly string[]): boolean {
  if (requiredAny.length === 0) return true;
  const expanded = expandFleetPermissions(held);
  return requiredAny.some((p) => expanded.has(p));
}

export function canViewFleetFinancial(held: readonly string[]): boolean {
  return canFleet(held, ["fleet.financial.view", "fleet.costs.manage", "fleet.manage"]);
}

export function canManageFleetSettings(held: readonly string[]): boolean {
  return canFleet(held, ["fleet.settings.manage"]);
}

/** Guards de rotas — listas incluem legado + granular. */
export const FLEET_ROUTE_GUARDS = {
  view: [
    "fleet.view",
    "fleet.manage",
    "fleet.dashboard.view",
    "fleet.vehicles.view",
    "fleet.contracts.view",
    "fleet.documents.view",
    "fleet.drivers.view",
    "fleet.reservations.view",
    "fleet.maintenance.view",
    "fleet.costs.view",
    "fleet.reports.view",
  ],
  vehiclesEdit: [
    "fleet.vehicles.edit",
    "fleet.manage",
    "fleet.vehicles.create",
    "fleet.vehicles.edit",
    "fleet.vehicles.status.manage",
    "fleet.contracts.manage",
    "fleet.documents.manage",
  ],
  manage: ["fleet.manage"],
  driversManage: ["fleet.manage", "fleet.drivers.manage"],
  reservationsCreate: [
    "fleet.reservations.create",
    "fleet.manage",
    "fleet.reservations.create",
    "fleet.usage.checkout",
    "fleet.usage.checkin",
  ],
  reservationsApprove: [
    "fleet.reservations.approve",
    "fleet.manage",
    "fleet.reservations.approve",
  ],
  reservationsManage: [
    "fleet.manage",
    "fleet.reservations.manage",
    "fleet.reservations.approve",
  ],
  maintenanceManage: [
    "fleet.maintenance.manage",
    "fleet.manage",
    "fleet.maintenance.manage",
  ],
  financialWrite: [
    "fleet.financial.view",
    "fleet.manage",
    "fleet.costs.manage",
    "fleet.financial.view",
  ],
  settingsManage: ["fleet.settings.manage"],
  checklistOps: [
    "fleet.reservations.create",
    "fleet.manage",
    "fleet.usage.checkout",
    "fleet.usage.checkin",
  ],
  attachmentWrite: [
    "fleet.manage",
    "fleet.financial.view",
    "fleet.costs.manage",
    "fleet.reservations.create",
    "fleet.maintenance.manage",
    "fleet.documents.manage",
    "fleet.contracts.manage",
  ],
  importManage: ["fleet.manage"],
} as const;

export type FleetRouteGuardKey = keyof typeof FLEET_ROUTE_GUARDS;

export function evaluateFleetRouteAccess(
  userPermissions: readonly string[],
  guard: FleetRouteGuardKey
): boolean {
  return canFleet(userPermissions, FLEET_ROUTE_GUARDS[guard]);
}

/** Alias histórico. */
export const canAccessFleetRoute = evaluateFleetRouteAccess;

export const FLEET_API_FORBIDDEN_STATUS = 403;

export const FLEET_FORBIDDEN_MESSAGE =
  "Você não tem permissão para acessar este recurso.";
