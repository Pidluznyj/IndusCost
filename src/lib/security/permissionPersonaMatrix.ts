/**
 * Matriz oficial de personas (Prompt 16) — dados compartilhados (sem side-effects de teste).
 */

import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { AppModuleId } from "@/src/lib/modulePermissions.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";

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
    permissions: [],
    expectViewModules: [
      "dashboard",
      "finance",
      "crm-commercial",
      "sales-orders",
      "settings",
      "employees",
      "inventory",
    ],
    expectDenyModules: [],
    notes: "ROLE_MATRIX cobre view amplo; manage ACL fino não incluso por padrão.",
  },
  {
    id: "gestor_comercial",
    label: "Gestor comercial",
    role: "COMMERCIAL_MANAGER",
    permissions: [],
    expectViewModules: ["dashboard", "crm-commercial", "sales-orders", "customers", "proposals"],
    expectDenyModules: ["finance", "settings", "employees"],
  },
  {
    id: "vendedor",
    label: "Vendedor",
    role: "SELLER",
    permissions: ["crm.view", "sales_orders.view", "dashboard.view", "customers.view"],
    expectViewModules: ["dashboard", "crm-commercial", "sales-orders", "customers"],
    expectDenyModules: ["finance", "settings", "employees", "inventory"],
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
      "suppliers.view",
    ],
    expectViewModules: ["dashboard", "finance", "portfolio-reconciliation", "suppliers"],
    expectDenyModules: ["settings", "employees", "crm-commercial"],
    notes: "VIEWER matrix nega CRM; bag libera financeiro via aliases.",
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
      "suppliers.view",
    ],
    expectViewModules: ["dashboard", "finance", "suppliers"],
    expectDenyModules: ["settings", "employees"],
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
    expectDenyModules: ["finance", "settings", "employees"],
  },
  {
    id: "RH",
    label: "RH",
    role: "VIEWER",
    permissions: ["dashboard.view", "employees.view", "guide.view"],
    expectViewModules: ["dashboard", "employees", "guide"],
    expectDenyModules: ["finance", "settings", "crm-commercial"],
    notes: "Dados sensíveis de ficha exigem employees.edit (máscara Prompt 15).",
  },
  {
    id: "viewer",
    label: "Viewer",
    role: "VIEWER",
    permissions: [],
    expectViewModules: ["dashboard", "sales-orders", "customers", "proposals", "products"],
    expectDenyModules: ["crm-commercial", "finance", "settings", "employees"],
  },
  {
    id: "usuario_com_deny",
    label: "Usuário com deny (pai)",
    role: "VIEWER",
    permissions: ["dashboard.view", "sales_orders.view"],
    expectViewModules: ["dashboard", "sales-orders"],
    expectDenyModules: ["finance", "crm-commercial", "settings"],
    expectDenyPaths: ["/finance", "/crm-commercial", "/settings"],
    notes: "Sem aliases financeiro/CRM → view recurso negada (efeito deny implícito).",
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
    expectDenyModules: ["settings"],
    notes: "opex/taxes/reports sem resourceKey → fallback canAccessModule.",
  },
];
