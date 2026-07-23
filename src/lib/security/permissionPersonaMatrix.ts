/**
 * Matriz oficial de personas (Prompt 16) — dados compartilhados (sem side-effects de teste).
 */

import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { AppModuleId } from "@/src/lib/modulePermissions.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import type { NavigationAccessContext } from "@/src/lib/resourceNavigationAccess.js";

export type PersonaId =
  | "SUPER_ADMIN"
  | "ADMIN"
  | "gestor_comercial"
  | "vendedor"
  | "financeiro_somente_leitura"
  | "financeiro_operacional"
  | "engenharia"
  | "RH"
  | "viewer"
  | "leticia_ap_only"
  | "usuario_com_deny"
  | "legado_sem_grants_estruturados";

export type PersonaSpec = {
  id: PersonaId;
  label: string;
  role: AuthUser["role"];
  permissions: string[];
  expectViewModules: AppModuleId[];
  expectDenyModules: AppModuleId[];
  expectDenyPaths?: string[];
  notes?: string;
};

/** Bags típicas — alinhadas a aliases de seed / módulo legado. */
export const PERMISSION_PERSONA_MATRIX: readonly PersonaSpec[] = [
  {
    id: "SUPER_ADMIN",
    label: "SUPER_ADMIN",
    role: "SUPER_ADMIN",
    permissions: [],
    expectViewModules: [...SIDEBAR_MODULE_ORDER],
    expectDenyModules: [],
    notes: "Bypass total; anti-lockout do último SA é regra de admin API.",
  },
  {
    id: "ADMIN",
    label: "ADMIN",
    role: "ADMIN",
    permissions: [
      "dashboard.view",
      "finance.view",
      "crm.view",
      "sales_orders.view",
      "settings.view",
      "users.manage",
      "employees.view",
      "inventory.view",
    ],
    expectViewModules: [
      "dashboard",
      "finance",
      "crm-commercial",
      "sales-orders",
      "settings",
      "employees",
      "org-chart",
      "inventory",
    ],
    expectDenyModules: [],
    notes: "P07: bag explícita (sem overlay ROLE_MATRIX em bag vazia).",
  },
  {
    id: "gestor_comercial",
    label: "Gestor comercial",
    role: "COMMERCIAL_MANAGER",
    permissions: [
      "dashboard.view",
      "crm.view",
      "sales_orders.view",
      "customers.view",
      "proposals.view",
    ],
    expectViewModules: ["dashboard", "crm-commercial", "sales-orders", "customers", "proposals"],
    expectDenyModules: ["finance", "settings", "employees", "org-chart"],
    notes: "P07: bag explícita do papel comercial.",
  },
  {
    id: "vendedor",
    label: "Vendedor",
    role: "SELLER",
    permissions: ["crm.view", "sales_orders.view", "dashboard.view", "customers.view"],
    expectViewModules: ["dashboard", "crm-commercial", "sales-orders", "customers"],
    expectDenyModules: ["finance", "settings", "employees", "inventory", "products"],
    expectDenyPaths: ["/finance", "/settings"],
  },
  {
    id: "financeiro_somente_leitura",
    label: "Financeiro somente leitura",
    role: "VIEWER",
    permissions: [
      "dashboard.view",
      "finance.view",
      "finance.portfolioReconciliation.view",
      "finance.suppliers.view",
    ],
    expectViewModules: ["dashboard", "finance", "portfolio-reconciliation", "suppliers"],
    expectDenyModules: ["settings", "employees", "crm-commercial", "products", "proposals"],
    notes: "P10: chaves 1:1 / primary do contrato (sem ROLE_MATRIX).",
  },
  {
    id: "financeiro_operacional",
    label: "Financeiro operacional",
    role: "VIEWER",
    permissions: [
      "dashboard.view",
      "finance.view",
      "finance.accountsPayable.view",
      "finance.accountsReceivable.view",
      "finance.billing.sync",
      "finance.suppliers.view",
    ],
    expectViewModules: ["dashboard", "finance", "suppliers"],
    expectDenyModules: ["settings", "employees", "products", "sales-orders"],
  },
  {
    id: "engenharia",
    label: "Engenharia",
    role: "VIEWER",
    permissions: [
      "dashboard.view",
      "products.view",
      "simulations.view",
      "projects.view",
      "pricing.view",
    ],
    expectViewModules: ["dashboard", "products", "simulations", "projects", "pricing"],
    expectDenyModules: ["finance", "settings", "employees", "sales-orders", "crm-commercial"],
  },
  {
    id: "RH",
    label: "RH",
    role: "VIEWER",
    permissions: [
      "dashboard.view",
      "employees.view",
      "employees.dashboard.view",
      "guide.view",
    ],
    expectViewModules: [
      "dashboard",
      "employees-dashboard",
      "employees",
      "org-chart",
      "guide",
    ],
    expectDenyModules: ["finance", "settings", "crm-commercial", "products", "sales-orders"],
    notes:
      "Listagem com employees.view; dashboard com employees.dashboard.view; PII/salário exigem facetas ou employees.edit.",
  },
  {
    id: "viewer",
    label: "Viewer",
    role: "VIEWER",
    permissions: [],
    expectViewModules: [],
    expectDenyModules: [
      "dashboard",
      "sales-orders",
      "customers",
      "proposals",
      "products",
      "crm-commercial",
      "finance",
      "settings",
      "employees",
      "employees-dashboard",
      "org-chart",
    ],
    notes: "P07: bag vazia ⇒ nenhum módulo (sem ROLE_MATRIX.VIEWER).",
  },
  {
    id: "leticia_ap_only",
    label: "Leticia — somente Contas a Pagar",
    role: "VIEWER",
    permissions: ["finance.accountsPayable.view"],
    expectViewModules: ["finance"],
    expectDenyModules: [
      "employees",
      "employees-dashboard",
      "org-chart",
      "crm-commercial",
      "products",
      "sales-orders",
      "settings",
      "inventory",
      "proposals",
    ],
    expectDenyPaths: [
      "/finance/portfolio-reconciliation",
      "/employees",
      "/org-chart",
      "/machines",
      "/crm-commercial",
      "/settings",
    ],
    notes: "P18/P23: alias 1:1 AP; mega-key e finance shell não abrem AR/conciliação.",
  },
  {
    id: "usuario_com_deny",
    label: "Usuário com deny (pai)",
    role: "VIEWER",
    permissions: ["dashboard.view", "sales_orders.view"],
    expectViewModules: ["dashboard", "sales-orders"],
    expectDenyModules: ["finance", "crm-commercial", "settings", "products", "customers"],
    expectDenyPaths: ["/finance", "/crm-commercial", "/settings"],
    notes: "Bag não vazia → sem ROLE_MATRIX; só aliases explicitadas.",
  },
  {
    id: "legado_sem_grants_estruturados",
    label: "Usuário legado sem grants estruturados",
    role: "VIEWER",
    permissions: [
      "dashboard.view",
      "opex.view",
      "taxes.view",
      "reports.view",
      "materials.view",
    ],
    expectViewModules: ["dashboard", "opex", "taxes", "reports", "materials"],
    expectDenyModules: ["settings", "products", "sales-orders", "crm-commercial"],
    notes: "P10: projeção primary/1:1 no DTO sidebar (sem canAccessModule).",
  },
];

function personaChecker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: perms },
  };
}

function personaUser(role: AuthUser["role"], permissions: string[]): AuthUser {
  return {
    id: `persona-${role}`,
    name: "Persona",
    email: "persona@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    permissionsVersion: 0,
    accessProfileId: null,
    accessProfileName: null,
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
  };
}

/** Contexto de navegação para testes e comparações (P16/P23). */
export function buildPersonaContext(spec: PersonaSpec): NavigationAccessContext {
  const u = personaUser(spec.role, spec.permissions);
  return { user: u, checker: personaChecker(spec.permissions) };
}
