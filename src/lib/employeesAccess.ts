/**
 * Pessoas / RH — matriz de acesso piloto (P15).
 * Actions do contrato — sem inventar CRUD; sem costs.view.
 *
 * | resourceKey | actions |
 * |-------------|---------|
 * | admin.employees | view, create, update |
 * | admin.employees.dashboard | view |
 * | admin.employees.personal_data | view |
 * | admin.employees.administrative_data | view |
 * | admin.employees.sensitive_data | view |
 * | admin.employees.links | view, manage |
 * | admin.employees.user_link | manage |
 * | admin.employees.epi | manage |
 */

export const EMPLOYEES_RESOURCE_KEYS = {
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

export const EMPLOYEES_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  manage: "manage",
} as const;

/** DELETE/status usam update (contrato sem delete). */
export type EmployeesContractAction =
  (typeof EMPLOYEES_ACTIONS)[keyof typeof EMPLOYEES_ACTIONS];

export const EMPLOYEES_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/employees", resourceKey: "admin.employees", action: "view" },
  {
    method: "GET",
    path: "/api/employees/dashboard-summary",
    resourceKey: "admin.employees.dashboard",
    action: "view",
  },
  { method: "POST", path: "/api/employees", resourceKey: "admin.employees", action: "create" },
  { method: "PUT", path: "/api/employees/:id", resourceKey: "admin.employees", action: "update" },
  { method: "DELETE", path: "/api/employees/:id", resourceKey: "admin.employees", action: "update" },
  { method: "PATCH", path: "/api/employees/:id/status", resourceKey: "admin.employees", action: "update" },
  {
    method: "GET",
    path: "/api/employees/lookups/*",
    resourceKey: "admin.employees",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/employees/org/*",
    resourceKey: "admin.employees",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/employees/org/*",
    resourceKey: "admin.employees",
    action: "create",
  },
  {
    method: "PUT",
    path: "/api/employees/org/*",
    resourceKey: "admin.employees",
    action: "update",
  },
  {
    method: "GET",
    path: "/api/employees/:id/user-link-status",
    resourceKey: "admin.employees.user_link",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/employees/:id/link-user",
    resourceKey: "admin.employees.user_link",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/employees/:id/unlink-user",
    resourceKey: "admin.employees.user_link",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/employees/:id/system-links",
    resourceKey: "admin.employees.links",
    action: "view",
  },
  {
    method: "DELETE",
    path: "/api/employees/:id/person-link",
    resourceKey: "admin.employees.links",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/people/preview-employee-link",
    resourceKey: "admin.employees.links",
    action: "manage",
  },
  { method: "GET", path: "/api/people/search", resourceKey: "admin.employees", action: "view" },
  { method: "GET", path: "/api/people/resolve", resourceKey: "admin.employees", action: "view" },
  {
    method: "GET",
    path: "/api/employees/:id/profile",
    resourceKey: "admin.employees",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/employees/:id/compensation",
    resourceKey: "admin.employees.compensation_events",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/employees/:id/compensation-adjustments",
    resourceKey: "admin.employees.compensation_values",
    action: "manage",
  },
  {
    method: "GET",
    path: "/api/employees/:id/history",
    resourceKey: "admin.employees.history",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/employees/:id/documents/:documentId/download",
    resourceKey: "admin.employees.documents",
    action: "view",
  },
  { method: "GET", path: "/api/people/:id/links", resourceKey: "admin.employees", action: "view" },
] as const;

/** P09/P15: costs.view e chaves financeiras NÃO abrem RH. */
export const EMPLOYEES_FORBIDDEN_FINANCE_KEYS = [
  "costs.view",
  "finance.view",
  "finance.accountsPayable.view",
  "finance.accountsReceivable.view",
] as const;
