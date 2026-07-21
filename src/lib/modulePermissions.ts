/** Mapa módulo → permissões (Fase 1K-D / 1K-D.2). Usa ids reais do Sidebar/App.tsx. */

import { canAccessCommissionsModule } from "@/src/lib/commissionsModulePermissions.js";
import { resolveCrmCommercialPersona } from "@/src/lib/crmCommercialPersona.js";
import { evaluateFleetRouteAccess } from "./fleetPermissionResolve.js";
import { PRODUCT_TAB_RESOURCE_KEYS } from "@/src/lib/moduleTabResources.js";

export type AppModuleId =
  | "dashboard"
  | "employees"
  | "org-chart"
  | "machines"
  | "materials"
  | "purchases"
  | "sc-purchases"
  | "maintenance"
  | "inventory"
  | "sc-inventory"
  | "sc-receiving"
  | "operations-performance"
  | "production-orders"
  | "projects"
  | "fleet"
  | "products"
  | "transformation-simulator"
  | "opex"
  | "taxes"
  | "pricing"
  | "proposals"
  | "sales-orders"
  | "sales-order-flow"
  | "output-documents"
  | "customers"
  | "crm-commercial"
  | "commissions"
  | "simulations"
  | "reports"
  | "finance"
  | "suppliers"
  | "portfolio-reconciliation"
  | "guide"
  | "settings";

export type PermissionChecker = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  authUser?: {
    effectivePermissions?: string[];
    role?: import("@prisma/client").AppUserRole;
  } | null;
};

/** Ordem do menu lateral (Sidebar). */
export const SIDEBAR_MODULE_ORDER: AppModuleId[] = [
  "dashboard",
  "employees",
  "org-chart",
  "machines",
  "materials",
  "purchases",
  "sc-purchases",
  "maintenance",
  "inventory",
  "sc-inventory",
  "sc-receiving",
  "operations-performance",
  "production-orders",
  "projects",
  "fleet",
  "products",
  "transformation-simulator",
  "opex",
  "taxes",
  "pricing",
  "proposals",
  "sales-orders",
  "sales-order-flow",
  "output-documents",
  "customers",
  "crm-commercial",
  "commissions",
  "simulations",
  "reports",
  "finance",
  "suppliers",
  "portfolio-reconciliation",
  "guide",
  "settings",
];

const SETTINGS_MENU_PERMISSIONS = ["settings.view", "users.manage"] as const;

/** Legado P09: costs.view só em opex (camada identificada). Cross-module removido. */
const LEGACY_COSTS_VIEW_OPEX_ONLY = "costs.view";

export function canAccessModule(moduleId: AppModuleId, check: PermissionChecker): boolean {
  switch (moduleId) {
    case "dashboard":
      return check.hasPermission("dashboard.view");
    case "crm-commercial":
      return canAccessCrmAny(check);
    case "commissions":
      return canAccessCommissionsModule(check);
    case "customers":
      return check.hasPermission("customers.view");
    case "proposals":
      return check.hasPermission("proposals.view");
    case "sales-orders":
      return check.hasPermission("sales_orders.view");
    case "sales-order-flow":
      return check.hasPermission("sales_orders.flow.view");
    case "output-documents":
      return check.hasPermission("output_documents.view");
    case "products":
      return check.hasPermission("products.view");
    case "transformation-simulator":
      return (
        check.hasPermission("products.view") ||
        check.hasPermission("simulations.view")
      );
    case "purchases":
      return check.hasPermission("purchases.view");
    case "sc-purchases":
      return check.hasPermission("operations.supply_chain.purchases.view");
    case "sc-inventory":
      return check.hasPermission("operations.supply_chain.inventory.view");
    case "sc-receiving":
      return check.hasPermission("operations.supply_chain.receiving.view");
    case "pricing":
      return check.hasPermission("pricing.view");
    case "employees":
      return check.hasPermission("employees.view");
    case "org-chart":
      return check.hasPermission("employees.view");
    case "machines":
      return check.hasPermission("machines.view");
    case "materials":
      return check.hasPermission("materials.view");
    case "opex":
      return (
        check.hasPermission("opex.view") ||
        check.hasPermission(LEGACY_COSTS_VIEW_OPEX_ONLY)
      );
    case "simulations":
      return check.hasPermission("simulations.view");
    case "taxes":
      return check.hasPermission("taxes.view");
    case "settings":
      return check.hasAnyPermission([...SETTINGS_MENU_PERMISSIONS]);
    case "maintenance":
      return check.hasPermission("maintenance.view");
    case "inventory":
      return check.hasPermission("inventory.view");
    case "operations-performance":
      // PERM-42: sem bleed de products.view
      return check.hasAnyPermission([
        "operations.component-performance.view",
        "operations.component-performance.edit",
      ]);
    case "production-orders":
      return check.hasPermission("operations.production-orders.view");
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
      // PERM-41/42: Fornecedores isolado de Centros de Custo / finance.view
      return check.hasPermission("finance.suppliers.view");
    case "portfolio-reconciliation":
      return (
        check.hasPermission("finance.portfolioReconciliation.view") ||
        check.hasPermission("finance.portfolioReconciliation.conciliation.view") ||
        check.hasPermission("finance.portfolioReconciliation.intelligence.view") ||
        check.hasPermission("finance.portfolioReconciliation.orderToCashAudit.view") ||
        check.hasPermission("finance.portfolioReconciliation.orderStatusPedidos.view")
      );
    case "guide":
      // PERM-42: sem bleed de dashboard.view
      return check.hasPermission("guide.view");
    default:
      return false;
  }
}

export function resolveCrmPersonaForChecker(check: PermissionChecker) {
  return resolveCrmCommercialPersona({
    role: check.authUser?.role ?? "VIEWER",
    canViewShell: check.hasPermission("crm.view"),
    canViewGeneral: check.hasPermission("crm.general.view"),
    canViewSellerTab: check.hasPermission("crm.seller.view"),
    canViewPortfolio: check.hasPermission("crm.customer_cockpit.view"),
    canViewCustomer360: check.hasAnyPermission([
      "customers.commercial360.view",
      "customers.view",
    ]),
    canViewOwn: check.hasPermission("crm.seller.own"),
    canViewAll: check.hasPermission("crm.seller.all"),
  });
}

export function canAccessCrmGeneral(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).canViewGeneral;
}

export function canAccessCrmSeller(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).canViewSeller;
}

/** Carteira de clientes / cockpit comercial (gestor ou vendedor). */
export function canAccessCrmPortfolio(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).canViewPortfolio;
}

/** Pode filtrar qualquer vendedor na gestão comercial (gestor). Role SELLER nunca. */
export function canFilterAllCrmSellers(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).canFilterAllSellers;
}

/**
 * Apenas dados do vendedor vinculado ao usuário (sem troca de filtro).
 * Role SELLER é sempre own — mesmo se a bag tiver crm.seller.all por engano.
 */
export function isCrmOwnSellerOnly(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).sellerLocked;
}

export function isCrmSellerLinked(user: {
  externalSellerId: number | null;
  sellerResponsibleName: string | null;
}): boolean {
  return user.externalSellerId != null || Boolean(user.sellerResponsibleName?.trim());
}

export function canAccessCrmAny(check: PermissionChecker): boolean {
  return resolveCrmPersonaForChecker(check).canUseCrm;
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

/** Path autenticado → módulo da sidebar (P11 — deep links finance/crm). */
export function resolveModuleIdFromPath(pathname: string): AppModuleId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";

  if (normalized.startsWith("/finance/suppliers")) {
    return "suppliers";
  }
  if (normalized.startsWith("/finance/portfolio-reconciliation")) {
    return "portfolio-reconciliation";
  }
  if (normalized === "/finance" || normalized.startsWith("/finance/")) {
    return "finance";
  }

  if (normalized.startsWith("/crm/customers")) {
    return "customers";
  }
  if (normalized === "/crm" || normalized.startsWith("/crm/")) {
    return "crm-commercial";
  }
  if (
    normalized === "/commercial/sales-order-flow" ||
    normalized.startsWith("/commercial/sales-order-flow/")
  ) {
    return "sales-order-flow";
  }
  if (normalized === "/supply-chain/purchases" || normalized.startsWith("/supply-chain/purchases/")) {
    return "sc-purchases";
  }
  if (normalized === "/supply-chain/inventory" || normalized.startsWith("/supply-chain/inventory/")) {
    return "sc-inventory";
  }
  if (normalized === "/supply-chain/receiving" || normalized.startsWith("/supply-chain/receiving/")) {
    return "sc-receiving";
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
      if (moduleId === "sc-purchases") return "/supply-chain/purchases";
      if (moduleId === "sc-inventory") return "/supply-chain/inventory";
      if (moduleId === "sc-receiving") return "/supply-chain/receiving";
      if (moduleId === "sales-order-flow") return "/commercial/sales-order-flow";
      return `/${moduleId}`;
    }
  }
  return null;
}

export const MODULE_LABELS: Record<AppModuleId, string> = {
  dashboard: "Dashboard",
  employees: "Pessoas / RH",
  "org-chart": "Organograma",
  machines: "Máquinas",
  materials: "Suprimentos",
  purchases: "Compras",
  "sc-purchases": "Compras SC",
  maintenance: "Manutenção Predial",
  inventory: "Estoque / Almoxarifado",
  "sc-inventory": "Estoque SC",
  "sc-receiving": "Recebimentos",
  "operations-performance": "Performance",
  "production-orders": "Ordens de Produção",
  projects: "Projetos",
  fleet: "Gestão de Frota",
  products: "Produtos",
  "transformation-simulator": "Simulador de Custo de Injeção",
  opex: "Custos Indiretos",
  taxes: "Tributos",
  pricing: "Formação de Preço",
  proposals: "Propostas",
  "sales-orders": "Pedidos de venda",
  "sales-order-flow": "Fluxo de Pedidos",
  "output-documents": "Documentos de Saída",
  customers: "Clientes",
  "crm-commercial": "CRM Comercial",
  commissions: "Comissões",
  simulations: "Simulações",
  reports: "Relatórios",
  finance: "Financeiro",
  suppliers: "Fornecedores",
  "portfolio-reconciliation": "Conciliação de Carteira",
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

/** Abas visíveis no modal de produto — resourceKey (se informado) OU permissão tab legada. */
export function getVisibleProductTabs(
  check: PermissionChecker & { canViewResource?: (resourceKey: string) => boolean }
): ProductTabId[] {
  return PRODUCT_TAB_IDS.filter((id) => {
    const resourceKey = PRODUCT_TAB_RESOURCE_KEYS[id];
    if (resourceKey && typeof check.canViewResource === "function") {
      if (check.canViewResource(resourceKey)) return true;
    }
    return check.hasPermission(PRODUCT_TAB_PERMISSIONS[id]);
  });
}

export type ActionAwarePermissionChecker = PermissionChecker & {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
};

export function canCreateProposal(check: ActionAwarePermissionChecker): boolean {
  if (typeof check.canPerformAction === "function") {
    return (
      check.canPerformAction("commercial.proposals", "create") ||
      check.canPerformAction("commercial.proposals", "update")
    );
  }
  return check.hasPermission("proposals.create") || check.hasPermission("proposals.edit");
}

export function canEditProposal(check: ActionAwarePermissionChecker): boolean {
  if (typeof check.canPerformAction === "function") {
    return (
      check.canPerformAction("commercial.proposals", "update") ||
      check.canPerformAction("commercial.proposals", "edit")
    );
  }
  return check.hasPermission("proposals.edit");
}

export function canDeleteProposal(check: ActionAwarePermissionChecker): boolean {
  if (typeof check.canPerformAction === "function") {
    return check.canPerformAction("commercial.proposals", "delete");
  }
  return check.hasPermission("proposals.delete");
}

export function canPrintProposal(check: ActionAwarePermissionChecker): boolean {
  if (typeof check.canPerformAction === "function") {
    return (
      check.canPerformAction("commercial.proposals", "export") ||
      check.canPerformAction("commercial.proposals", "print")
    );
  }
  return check.hasPermission("proposals.print");
}

export function canViewProposalIndicators(check: PermissionChecker): boolean {
  return check.hasPermission("proposals.indicators.view");
}
