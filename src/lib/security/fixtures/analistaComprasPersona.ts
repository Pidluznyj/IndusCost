/**
 * PERM-43 — fixture de aceite "Analista de Compras".
 * Não cria perfil em produção; uso em testes / homologação.
 */

import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import type { NavigationAccessContext } from "@/src/lib/resourceNavigationAccess.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { effectiveAccessDtoFromAllowedResources } from "@/src/lib/sidebarEffectiveAccess.js";

export const ANALISTA_COMPRAS_PERSONA_ID = "analista_compras" as const;
export const ANALISTA_COMPRAS_LABEL = "Analista de Compras" as const;

/** resourceKey → actions (contrato). */
export type AnalistaComprasGrantMap = Readonly<
  Record<string, readonly string[]>
>;

/**
 * Matriz oficial do cenário de aceite.
 * Dashboard: só `dashboard` (sem abas extras inventadas).
 */
export const ANALISTA_COMPRAS_GRANTS: AnalistaComprasGrantMap = {
  dashboard: ["view"],

  // Engenharia — Suprimentos / MP / MI (+ CRUD)
  [ENGINEERING_RESOURCE_KEYS.materials]: ["view", "update"],
  [ENGINEERING_RESOURCE_KEYS.marketIntelligence]: ["view"],
  [ENGINEERING_RESOURCE_KEYS.marketIntelligenceHome]: ["view"],
  [ENGINEERING_RESOURCE_KEYS.marketIntelligenceMaterial360]: ["view"],
  [ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes]: [
    "view",
    "update",
    "approve",
  ],

  // Financeiro parcial
  "finance.accounts_payable": ["view"],
  [FINANCE_MODULE_RESOURCE_KEYS.costCenters]: ["view", "manage"],
  [FINANCE_MODULE_RESOURCE_KEYS.suppliers]: ["view", "manage"],

  // Operações
  [OPERATIONS_RESOURCE_KEYS.inventory]: ["view", "manage"],
  [OPERATIONS_RESOURCE_KEYS.inventoryItems]: ["view", "manage"],
  [OPERATIONS_RESOURCE_KEYS.inventoryWarehouses]: ["view", "manage"],
  [OPERATIONS_RESOURCE_KEYS.inventoryMovements]: ["view", "create"],
  [OPERATIONS_RESOURCE_KEYS.inventoryCounts]: ["view", "manage", "approve"],
  [OPERATIONS_RESOURCE_KEYS.purchases]: ["view", "create", "update", "delete"],
  [OPERATIONS_RESOURCE_KEYS.maintenance]: ["view", "manage"],
  [OPERATIONS_RESOURCE_KEYS.fleet]: ["view", "manage"],
};

/** Recursos explicitamente negados (assertivas de regressão). */
export const ANALISTA_COMPRAS_DENIED_RESOURCES = [
  ENGINEERING_RESOURCE_KEYS.products,
  ENGINEERING_RESOURCE_KEYS.simulations,
  ENGINEERING_RESOURCE_KEYS.projects,
  ENGINEERING_RESOURCE_KEYS.transformationSimulator,
  "commercial.pricing",
  "commercial.proposals",
  "commercial.sales_orders",
  "commercial.customers",
  "commercial.crm",
  "commercial.commissions",
  "finance.cash_flow",
  "finance.accounts_receivable",
  "finance.billing",
  "finance.sales_orders",
  "finance.executive_report",
  "finance.dre",
  "finance.portfolio_reconciliation",
  "finance.opex",
  "finance.taxes",
  "finance.reports",
  OPERATIONS_RESOURCE_KEYS.machines,
  OPERATIONS_RESOURCE_KEYS.performance,
  OPERATIONS_RESOURCE_KEYS.productionOrders,
  "admin.employees",
  "admin.employees.dashboard",
  "admin.settings",
  "admin.guide",
] as const;

export const ANALISTA_COMPRAS_EXPECT_MODULES = [
  "dashboard",
  "materials",
  "finance",
  "suppliers",
  "inventory",
  "purchases",
  "maintenance",
  "fleet",
] as const;

export const ANALISTA_COMPRAS_DENY_MODULES = [
  "products",
  "simulations",
  "projects",
  "transformation-simulator",
  "pricing",
  "proposals",
  "sales-orders",
  "customers",
  "crm-commercial",
  "commissions",
  "portfolio-reconciliation",
  "opex",
  "taxes",
  "reports",
  "machines",
  "operations-performance",
  "production-orders",
  "employees",
  "employees-dashboard",
  "org-chart",
  "settings",
  "guide",
] as const;

/**
 * Paths de módulos distintos (canAccessPath).
 * Seções irmãs de `/finance/*` compartilham o módulo `finance` — negação via abas/API.
 */
export const ANALISTA_COMPRAS_DENY_PATHS = [
  "/products",
  "/simulations",
  "/projects",
  "/transformation-simulator",
  "/pricing",
  "/proposals",
  "/sales-orders",
  "/customers",
  "/crm",
  "/commissions",
  "/portfolio-reconciliation",
  "/machines",
  "/operations-performance",
  "/production-orders",
  "/employees",
  "/employees-dashboard",
  "/org-chart",
  "/settings",
  "/guide",
] as const;

/** Seções financeiras negadas (abas / forceDenied — não path-level do módulo). */
export const ANALISTA_COMPRAS_DENY_FINANCE_SECTIONS = [
  "cash-flow",
  "accounts-receivable",
  "billing",
  "sales-orders",
  "executive-report",
] as const;

export const ANALISTA_COMPRAS_ALLOW_PATHS = [
  "/dashboard",
  "/materials",
  "/materials/market-intelligence",
  "/finance",
  "/finance/accounts-payable",
  "/finance/cost-centers",
  "/finance/suppliers",
  "/inventory",
  "/purchases",
  "/maintenance",
  "/fleet",
] as const;

export function analistaComprasResourceKeys(): string[] {
  return Object.keys(ANALISTA_COMPRAS_GRANTS).sort();
}

export function buildAnalistaComprasDto(options?: {
  permissionsVersion?: number;
  grants?: AnalistaComprasGrantMap;
}): EffectiveAccessMeDto {
  const grants = options?.grants ?? ANALISTA_COMPRAS_GRANTS;
  const keys = Object.keys(grants);
  const base = effectiveAccessDtoFromAllowedResources(keys, {
    role: "VIEWER",
    permissionsVersion: options?.permissionsVersion ?? 1,
  });
  const actionsByResource: EffectiveAccessMeDto["actionsByResource"] = {};
  const capabilities: EffectiveAccessMeDto["capabilities"] = {};
  for (const [resourceKey, acts] of Object.entries(grants)) {
    const list = [...acts];
    actionsByResource[resourceKey] = list;
    capabilities[resourceKey] = {
      canView: list.includes("view"),
      canExecute: list.some((a) =>
        ["execute", "create", "update", "manage", "approve", "delete"].includes(a)
      ),
      canManage: list.includes("manage"),
    };
  }
  return {
    ...base,
    permissionsVersion: options?.permissionsVersion ?? 1,
    actionsByResource,
    capabilities,
    navigationReveal: keys.filter((k) => (grants[k] ?? []).includes("view")),
    allowedResources: [...keys].sort(),
  };
}

export function analistaComprasAuthUser(
  overrides?: Partial<AuthUser>
): AuthUser {
  return {
    id: "u-analista-compras",
    name: ANALISTA_COMPRAS_LABEL,
    email: "analista.compras@example.com",
    role: "VIEWER",
    permissions: [],
    effectivePermissions: [],
    accessProfileId: null,
    accessProfileName: ANALISTA_COMPRAS_LABEL,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    permissionsVersion: 1,
    ...overrides,
  };
}

export function analistaComprasNavContext(options?: {
  permissionsVersion?: number;
  grants?: AnalistaComprasGrantMap;
}): NavigationAccessContext {
  return {
    user: analistaComprasAuthUser({
      permissionsVersion: options?.permissionsVersion ?? 1,
    }),
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: buildAnalistaComprasDto(options),
    authLoading: false,
    authError: null,
  };
}

/** Bag legada aproximada (APIs com legacyCompat + profileSnapshot). */
export function analistaComprasLegacyBag(): string[] {
  return [
    "dashboard.view",
    "materials.view",
    "materials.edit",
    "materials.market_intelligence.home.view",
    "materials.market_intelligence.material_360.view",
    "materials.market_intelligence.quotes.view",
    "materials.market_quote.approve",
    "finance.accountsPayable.view",
    "finance.cost_centers.view",
    "finance.cost_centers.manage",
    "finance.suppliers.view",
    "finance.suppliers.manage",
    "purchases.view",
    "purchases.create",
    "purchases.edit",
    "purchases.delete",
    "maintenance.view",
    "maintenance.manage",
    "fleet.view",
    "fleet.manage",
  ];
}

export function analistaComprasAppAuth(
  permissions: string[] = analistaComprasLegacyBag()
): AppAuthContext {
  const u = analistaComprasAuthUser();
  return {
    ...u,
    permissions,
    effectivePermissions: permissions,
    sessionId: "s-analista-compras",
  };
}

/**
 * Simula bump de permissionsVersion + revoke de um grant (sem logout).
 * O cliente deve recarregar `/me` e refletir o novo DTO.
 */
export function applyAnalistaComprasPermissionRevoke(
  previous: EffectiveAccessMeDto,
  revokeResourceKey: string
): EffectiveAccessMeDto {
  const nextGrants: Record<string, readonly string[]> = {
    ...ANALISTA_COMPRAS_GRANTS,
  };
  delete nextGrants[revokeResourceKey];
  return buildAnalistaComprasDto({
    permissionsVersion: (previous.permissionsVersion ?? 0) + 1,
    grants: nextGrants,
  });
}
