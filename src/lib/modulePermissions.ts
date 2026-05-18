/** Mapa módulo → permissões (Fase 1K-D / 1K-D.2). Usa ids reais do Sidebar/App.tsx. */

export type AppModuleId =
  | "dashboard"
  | "employees"
  | "machines"
  | "materials"
  | "purchases"
  | "maintenance"
  | "products"
  | "opex"
  | "taxes"
  | "pricing"
  | "proposals"
  | "sales-orders"
  | "customers"
  | "crm-commercial"
  | "simulations"
  | "reports"
  | "guide"
  | "settings";

export type PermissionChecker = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
};

/** Ordem do menu lateral (Sidebar). */
export const SIDEBAR_MODULE_ORDER: AppModuleId[] = [
  "dashboard",
  "employees",
  "machines",
  "materials",
  "purchases",
  "maintenance",
  "products",
  "opex",
  "taxes",
  "pricing",
  "proposals",
  "sales-orders",
  "customers",
  "crm-commercial",
  "simulations",
  "reports",
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
    case "customers":
      return check.hasPermission("customers.view");
    case "proposals":
      return check.hasPermission("proposals.view");
    case "sales-orders":
      return check.hasPermission("sales_orders.view");
    case "products":
      return check.hasPermission("products.view");
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
      return check.hasPermission("taxes.view") || check.hasPermission("pricing.view");
    case "settings":
      return check.hasAnyPermission([...SETTINGS_MENU_PERMISSIONS]);
    case "maintenance":
      return (
        check.hasPermission("maintenance.view") ||
        check.hasPermission("settings.view")
      );
    case "reports":
      return check.hasPermission("reports.view") || check.hasPermission("dashboard.view");
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
  return check.hasAnyPermission(["crm.seller.view", "crm.seller.own", "crm.seller.all"]);
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
      return check.hasPermission("users.manage");
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
  const segment = pathname.replace(/^\//, "").split("/").filter(Boolean)[0];
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
  employees: "Colaboradores",
  machines: "Máquinas",
  materials: "Suprimentos",
  purchases: "Compras",
  maintenance: "Manutenção Predial",
  products: "Produtos",
  opex: "Custos Indiretos",
  taxes: "Tributos",
  pricing: "Formação de Preço",
  proposals: "Propostas",
  "sales-orders": "Pedidos de venda",
  customers: "Clientes",
  "crm-commercial": "CRM Comercial",
  simulations: "Simulações",
  reports: "Relatórios",
  guide: "Guia do Sistema",
  settings: "Configurações",
};

/** Mapeamento aba do modal de produto → permissão. */
export const PRODUCT_TAB_IDS = ["info", "bom", "routing", "tree", "cost", "composition"] as const;
export type ProductTabId = (typeof PRODUCT_TAB_IDS)[number];

export const PRODUCT_TAB_PERMISSIONS: Record<ProductTabId, string> = {
  info: "products.tab.info",
  bom: "products.tab.bom",
  routing: "products.tab.routing",
  tree: "products.tab.tree",
  cost: "products.tab.cost",
  composition: "products.tab.composition",
};

/** Abas visíveis no modal de produto (legado: só products.view → todas as abas). */
export function getVisibleProductTabs(check: PermissionChecker): ProductTabId[] {
  const hasAnyTabPerm = PRODUCT_TAB_IDS.some((id) =>
    check.hasPermission(PRODUCT_TAB_PERMISSIONS[id])
  );
  if (!hasAnyTabPerm && check.hasPermission("products.view")) {
    return [...PRODUCT_TAB_IDS];
  }
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
