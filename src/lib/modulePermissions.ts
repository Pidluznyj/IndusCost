/** Mapa módulo → permissões (Fase 1K-D). Usa ids reais do Sidebar/App.tsx. */

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

const CRM_PERMISSIONS = [
  "crm.general.view",
  "crm.seller.view",
  "crm.seller.own",
  "crm.seller.all",
] as const;

const SETTINGS_PERMISSIONS = ["settings.view", "users.manage"] as const;

export function canAccessModule(moduleId: AppModuleId, check: PermissionChecker): boolean {
  switch (moduleId) {
    case "dashboard":
      return check.hasPermission("dashboard.view");
    case "crm-commercial":
      return check.hasAnyPermission([...CRM_PERMISSIONS]);
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
    case "machines":
    case "materials":
    case "opex":
    case "simulations":
      return check.hasPermission("costs.view");
    case "taxes":
      return check.hasPermission("pricing.view");
    case "settings":
      return check.hasAnyPermission([...SETTINGS_PERMISSIONS]);
    case "maintenance":
      return check.hasPermission("settings.view");
    case "reports":
      return check.hasPermission("dashboard.view");
    case "guide":
      return check.hasPermission("dashboard.view");
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

export function canAccessCrmAny(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...CRM_PERMISSIONS]);
}

export function canAccessSettingsMenu(check: PermissionChecker): boolean {
  return check.hasAnyPermission([...SETTINGS_PERMISSIONS]);
}

export function canManageUsers(check: PermissionChecker): boolean {
  return check.hasPermission("users.manage");
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
