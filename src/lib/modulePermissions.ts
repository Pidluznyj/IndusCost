/** Mapa módulo → permissões (Fase 1K-D / 1K-D.2). Usa ids reais do Sidebar/App.tsx. */

import { canAccessCommissionsModule } from "@/src/lib/commissionsModulePermissions.js";
import { evaluateFleetRouteAccess } from "./fleetPermissionResolve.js";

export type AppModuleId =
  | "dashboard"
  | "employees"
  | "machines"
  | "materials"
  | "purchases"
  | "maintenance"
  | "inventory"
  | "operations-performance"
  | "projects"
  | "fleet"
  | "products"
  | "transformation-simulator"
  | "opex"
  | "taxes"
  | "pricing"
  | "proposals"
  | "sales-orders"
  | "customers"
  | "crm-commercial"
  | "commissions"
  | "simulations"
  | "reports"
  | "finance"
  | "suppliers"
  | "guide"
  | "settings";

export type PermissionChecker = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  authUser?: { effectivePermissions?: string[] } | null;
};

/** Ordem do menu lateral (Sidebar). */
export const SIDEBAR_MODULE_ORDER: AppModuleId[] = [
  "dashboard",
  "employees",
  "machines",
  "materials",
  "purchases",
  "maintenance",
  "inventory",
  "operations-performance",
  "projects",
  "fleet",
  "products",
  "transformation-simulator",
  "opex",
  "taxes",
  "pricing",
  "proposals",
  "sales-orders",
  "customers",
  "crm-commercial",
  "commissions",
  "simulations",
  "reports",
  "finance",
  "suppliers",
  "guide",
  "settings",
];

const CRM_MENU_PERMISSIONS = [
  "crm.view",
  "crm.general.view",
  "crm.seller.view",
  "crm.seller.own",
  "crm.seller.all",
] as const;

const SETTINGS_MENU_PERMISSIONS = ["settings.view", "users.manage"] as const;

/** Legado: costs.view liberava todos os módulos de custo/operação. */
const LEGACY_COSTS_VIEW = "costs.view";

export function canAccessModule(moduleId: AppModuleId, check: PermissionChecker): boolean {
  switch (moduleId) {
    case "dashboard":
      return check.hasPermission("dashboard.view");
    case "crm-commercial":
      return check.hasAnyPermission([...CRM_MENU_PERMISSIONS]);
    case "commissions":
      return canAccessCommissionsModule(check);
    case "customers":
      return check.hasPermission("customers.view");
    case "proposals":
      return check.hasPermission("proposals.view");
    case "sales-orders":
      return check.hasPermission("sales_orders.view");
    case "products":
      return check.hasPermission("products.view");
    case "transformation-simulator":
      return (
        check.hasPermission("products.view") ||
        check.hasPermission("simulations.view") ||
        check.hasPermission(LEGACY_COSTS_VIEW)
      );
    case "purchases":
      return check.hasPermission("purchases.view");
    case "pricing":
      return check.hasPermission("pricing.view");
    case "employees":
      return check.hasPermission("employees.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    case "machines":
      return check.hasPermission("machines.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    case "materials":
      return check.hasPermission("materials.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    case "opex":
      return check.hasPermission("opex.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    case "simulations":
      return check.hasPermission("simulations.view") || check.hasPermission(LEGACY_COSTS_VIEW);
    case "taxes":
      return check.hasPermission("taxes.view");
    case "settings":
      return check.hasAnyPermission([...SETTINGS_MENU_PERMISSIONS]);
    case "maintenance":
      return check.hasPermission("maintenance.view");
    case "inventory":
      return check.hasPermission("inventory.view");
    case "operations-performance":
      return check.hasAnyPermission([
        "operations.component-performance.view",
        "operations.component-performance.edit",
        "products.view",
      ]);
    case "projects":
      return check.hasPermission("projects.view");
    case "fleet": {
      const held = check.authUser?.effectivePermissions;
      if (held?.length) return evaluateFleetRouteAccess(held, "view");
      return check.hasPermission("fleet.view") || check.hasPermission("fleet.manage");
    }
    case "reports":
      return check.hasPermission("reports.view") || check.hasPermission("dashboard.view");
    case "finance":
      return (
        check.hasPermission("finance.view") ||
        check.hasPermission("finance.accountsReceivable.view") ||
        check.hasPermission("finance.accountsPayable.view") ||
        check.hasPermission("reports.view") ||
        check.hasPermission("settings.nomus.view") ||
        check.hasPermission("settings.view")
      );
    case "suppliers":
      return (
        check.hasPermission("finance.suppliers.view") ||
        check.hasPermission("finance.cost_centers.view") ||
        check.hasPermission("finance.view")
      );
    case "guide":
      return check.hasPermission("guide.view") || check.hasPermission("dashboard.view");
    default:
      return false;
  }
}

export function canAccessCrmGeneral(check: PermissionChecker): boolean {
  return check.hasPermission("crm.general.view");
}

export function canAccessCrmSeller(check: PermissionChecker): boolean {
  return (
    check.hasPermission("crm.seller.all") || check.hasPermission("crm.seller.own")
  );
}

/** Carteira de clientes / cockpit comercial (gestor ou vendedor). */
export function canAccessCrmPortfolio(check: PermissionChecker): boolean {
  return canAccessCrmGeneral(check) || canAccessCrmSeller(check);
}

/** Pode filtrar qualquer vendedor na gestão comercial (gestor). */
export function canFilterAllCrmSellers(check: PermissionChecker): boolean {
  return check.hasPermission("crm.seller.all");
}

/** Apenas dados do vendedor vinculado ao usuário (sem troca de filtro). */
export function isCrmOwnSellerOnly(check: PermissionChecker): boolean {
  return check.hasPermission("crm.seller.own") && !check.hasPermission("crm.seller.all");
}

export function isCrmSellerLinked(user: {
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
}): boolean {
  return user.externalSellerId != null || Boolean(user.sellerResponsibleName?.trim());
}

export function canAccessCrmAny(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...CRM_MENU_PERMISSIONS]);
}

export function canAccessSettingsMenu(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...SETTINGS_MENU_PERMISSIONS]);
}

export function canManageUsers(check: PermissionChecker): boolean {
  return check.hasPermission("users.manage");
}

export function canViewAccessProfiles(check: PermissionChecker): boolean {
  return (
    check.hasPermission("accessProfiles.view") ||
    check.hasPermission("accessProfiles.manage") ||
    check.hasPermission("users.manage")
  );
}

export function canManageAccessProfiles(check: PermissionChecker): boolean {
  return (
    check.hasPermission("accessProfiles.manage") || check.hasPermission("users.manage")
  );
}

export function canAccessSettingsSection(
  section:
    | "globals"
    | "branding"
    | "operational"
    | "nomusSync"
    | "priceTables"
    | "security"
    | "integrations"
    | "system",
  check: PermissionChecker
): boolean {
  const legacy = check.hasPermission("settings.view");
  switch (section) {
    case "security":
      return (
        check.hasPermission("users.manage") ||
        check.hasPermission("accessProfiles.view") ||
        check.hasPermission("accessProfiles.manage")
      );
    case "branding":
      return check.hasPermission("settings.branding.view") || legacy;
    case "globals":
      return check.hasPermission("settings.global_params.view") || legacy;
    case "operational":
      return check.hasPermission("settings.operational.view") || legacy;
    case "nomusSync":
      return check.hasPermission("settings.nomus.view") || legacy;
    case "priceTables":
      return check.hasPermission("settings.price_tables.view") || legacy;
    case "integrations":
    case "system":
      return legacy;
    default:
      return false;
  }
}

/** Primeiro segmento da rota autenticada → módulo. */
export function resolveModuleIdFromPath(pathname: string): AppModuleId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/finance/suppliers") {
    return "suppliers";
  }
  const segment = normalized.replace(/^\//, "").split("/").filter(Boolean)[0];
  if (!segment) return null;
  if (SIDEBAR_MODULE_ORDER.includes(segment as AppModuleId)) {
    return segment as AppModuleId;
  }
  return null;
}

export function getFirstAllowedModulePath(check: PermissionChecker): string | null {
  for (const moduleId of SIDEBAR_MODULE_ORDER) {
    if (canAccessModule(moduleId, check)) {
      return `/${moduleId}`;
    }
  }
  return null;
}

export const MODULE_LABELS: Record<AppModuleId, string> = {
  dashboard: "Dashboard",
  employees: "Pessoas / RH",
  machines: "Máquinas",
  materials: "Suprimentos",
  purchases: "Compras",
  maintenance: "Manutenção Predial",
  inventory: "Estoque / Almoxarifado",
  "operations-performance": "Performance",
  projects: "Projetos",
  fleet: "Gestão de Frota",
  products: "Produtos",
  "transformation-simulator": "Simulador de Custo de Injeção",
  opex: "Custos Indiretos",
  taxes: "Tributos",
  pricing: "Formação de Preço",
  proposals: "Propostas",
  "sales-orders": "Pedidos de venda",
  customers: "Clientes",
  "crm-commercial": "CRM Comercial",
  commissions: "Comissões",
  simulations: "Simulações",
  reports: "Relatórios",
  finance: "Financeiro",
  suppliers: "Fornecedores",
  guide: "Guia do Sistema",
  settings: "Configurações",
};

/** Mapeamento aba do modal de produto → permissão. */
export const PRODUCT_TAB_IDS = [
  "info",
  "bom",
  "routing",
  "tree",
  "cost",
  "composition",
  "history",
] as const;
export type ProductTabId = (typeof PRODUCT_TAB_IDS)[number];

export const PRODUCT_TAB_PERMISSIONS: Record<ProductTabId, string> = {
  info: "products.tab.info",
  bom: "products.tab.bom",
  routing: "products.tab.routing",
  tree: "products.tab.tree",
  cost: "products.tab.cost",
  composition: "products.tab.composition",
  // Mesma permissão de info — aba é apenas leitura.
  history: "products.tab.info",
};

/** Abas visíveis no modal de produto — exige permissão tab explícita. */
export function getVisibleProductTabs(check: PermissionChecker): ProductTabId[] {
  return PRODUCT_TAB_IDS.filter((id) => check.hasPermission(PRODUCT_TAB_PERMISSIONS[id]));
}

export function canCreateProposal(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.create") || check.hasPermission("proposals.edit");
}

export function canEditProposal(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.edit");
}

export function canDeleteProposal(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.delete");
}

export function canPrintProposal(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.print");
}

export function canViewProposalIndicators(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.indicators.view");
}
