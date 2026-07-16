/**
 * Contas a Pagar — matriz de acesso piloto (P18).
 * Actions do contrato apenas — sem inventar CRUD.
 *
 * | action  | uso |
 * |---------||-----|
 * | view    | sidebar/rota/abas/GET dashboard/titles/due-radar/status/summary |
 * | export  | CSV / due-radar export |
 * | manage  | classificação / alocação CC / batch apply |
 * | execute | sync Nomus AP (run) |
 */

export const FINANCE_AP_RESOURCE_KEY = "finance.accounts_payable" as const;

export const FINANCE_AP_ACTIONS = {
  view: "view",
  export: "export",
  manage: "manage",
  execute: "execute",
} as const;

export type FinanceApContractAction =
  (typeof FINANCE_AP_ACTIONS)[keyof typeof FINANCE_AP_ACTIONS];

/** Endpoints cobertos pelo piloto AP (documentação / testes). */
export const FINANCE_AP_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/finance/accounts-payable/dashboard", action: "view" },
  { method: "GET", path: "/api/finance/accounts-payable/titles", action: "view" },
  {
    method: "GET",
    path: "/api/finance/accounts-payable/titles/:id/classification",
    action: "view",
  },
  { method: "GET", path: "/api/finance/accounts-payable/export", action: "export" },
  { method: "GET", path: "/api/finance/accounts-payable/due-radar", action: "view" },
  {
    method: "GET",
    path: "/api/finance/accounts-payable/due-radar/export-data",
    action: "export",
  },
  {
    method: "GET",
    path: "/api/finance/accounts-payable/due-radar/export.xlsx",
    action: "export",
  },
  {
    method: "GET",
    path: "/api/finance/accounts-payable/classification-summary",
    action: "view",
  },
  { method: "GET", path: "/api/finance/accounts-payable/unclassified", action: "view" },
  {
    method: "POST",
    path: "/api/finance/accounts-payable/classify-batch-preview",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/finance/accounts-payable/classify-batch-apply",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/finance/accounts-payable/:id/cost-center-allocation",
    action: "manage",
  },
  {
    method: "POST",
    path: "/api/finance/accounts-payable/:id/cost-center-reclassification",
    action: "manage",
  },
  { method: "GET", path: "/api/nomus/accounts-payable/summary", action: "view" },
  {
    method: "GET",
    path: "/api/settings/nomus-sync/accounts-payable-status",
    action: "view",
  },
  {
    method: "POST",
    path: "/api/settings/nomus-sync/accounts-payable-run",
    action: "execute",
  },
] as const;

/**
 * Nota oficial (não alterar cálculos): eixo Data de Vencimento =
 * NomusAccountsPayable.dueDate — competência/filtros/agrupamento AP.
 */
export const FINANCE_AP_DUE_DATE_AXIS_NOTE =
  "Eixo oficial Contas a Pagar: Data de Vencimento (NomusAccountsPayable.dueDate).";
