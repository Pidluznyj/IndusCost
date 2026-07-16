/**
 * Financeiro (exceto Contas a Pagar P18) — matriz P17.
 * Actions do contrato apenas; AP isolado; finance.view não abre tudo via bags.
 *
 * Contas a Pagar permanece em financeAccountsPayableAccess.ts.
 */

export const FINANCE_MODULE_RESOURCE_KEYS = {
  home: "finance",
  cashFlow: "finance.cash_flow",
  accountsReceivable: "finance.accounts_receivable",
  billing: "finance.billing",
  salesOrders: "finance.sales_orders",
  costCenters: "finance.cost_centers",
  executiveReport: "finance.executive_report",
  suppliers: "finance.suppliers",
  suppliersServiceTermination: "finance.suppliers.service_termination",
  portfolio: "finance.portfolio_reconciliation",
  portfolioOrderStatus: "finance.portfolio_reconciliation.order_status",
  portfolioOrderToCashAudit: "finance.portfolio_reconciliation.order_to_cash_audit",
  opex: "finance.opex",
  taxes: "finance.taxes",
  taxApuration: "finance.tax_apuration",
  reports: "finance.reports",
} as const;

/** AP — referência cruzada (não migrar aqui). */
export const FINANCE_AP_RESOURCE_KEY_REF = "finance.accounts_payable" as const;

export const FINANCE_MODULE_ACTIONS = {
  view: "view",
  export: "export",
  manage: "manage",
  execute: "execute",
  update: "update",
  create: "create",
} as const;

/**
 * Chaves que NUNCA abrem seções irmãs do financeiro via bag OR.
 * AP em particular não abre fluxo/AR/faturamento/conciliação/etc.
 */
export const FINANCE_SIBLING_ISOLATION_KEYS = [
  "finance.accountsPayable.view",
  "finance.accounts_payable",
] as const;

export const FINANCE_MODULE_PILOT_ENDPOINTS = [
  // Home / shell — view no parent
  { method: "GET", path: "/finance", resourceKey: "finance", action: "view" },

  // Fluxo de Caixa (contrato: só view)
  { method: "GET", path: "/api/finance/cash-flow/dashboard", resourceKey: "finance.cash_flow", action: "view" },
  { method: "GET", path: "/api/finance/cash-flow/export", resourceKey: "finance.cash_flow", action: "view" },
  { method: "GET", path: "/api/finance/cash-flow/daily-radar/export.xlsx", resourceKey: "finance.cash_flow", action: "view" },

  // Contas a Receber
  { method: "GET", path: "/api/finance/accounts-receivable/dashboard", resourceKey: "finance.accounts_receivable", action: "view" },
  { method: "GET", path: "/api/finance/accounts-receivable/export", resourceKey: "finance.accounts_receivable", action: "export" },
  { method: "GET", path: "/api/finance/accounts-receivable/due-radar", resourceKey: "finance.accounts_receivable", action: "view" },
  { method: "GET", path: "/api/finance/accounts-receivable/due-radar/export.xlsx", resourceKey: "finance.accounts_receivable", action: "export" },

  // Faturamento
  { method: "GET", path: "/api/finance/billing/dashboard", resourceKey: "finance.billing", action: "view" },
  { method: "GET", path: "/api/finance/billing/export", resourceKey: "finance.billing", action: "export" },
  { method: "POST", path: "/api/finance/billing/sync", resourceKey: "finance.billing", action: "execute" },

  // Pedidos financeiro
  { method: "GET", path: "/api/finance/sales-orders/dashboard", resourceKey: "finance.sales_orders", action: "view" },
  { method: "GET", path: "/api/finance/sales-orders/export", resourceKey: "finance.sales_orders", action: "view" },

  // Centros de custo
  { method: "GET", path: "/api/finance/cost-centers", resourceKey: "finance.cost_centers", action: "view" },
  { method: "POST", path: "/api/finance/cost-centers", resourceKey: "finance.cost_centers", action: "manage" },

  // Relatório Presidencial
  { method: "GET", path: "/api/finance/executive-report", resourceKey: "finance.executive_report", action: "view" },

  // Fornecedores
  { method: "GET", path: "/api/finance/suppliers", resourceKey: "finance.suppliers", action: "view" },
  { method: "POST", path: "/api/finance/suppliers/apply", resourceKey: "finance.suppliers", action: "manage" },
  { method: "GET", path: "/api/suppliers/:id/service-terminations", resourceKey: "finance.suppliers.service_termination", action: "view" },
  { method: "POST", path: "/api/suppliers/:id/service-terminations", resourceKey: "finance.suppliers.service_termination", action: "create" },
  { method: "PUT", path: "/api/suppliers/service-terminations/:id", resourceKey: "finance.suppliers.service_termination", action: "update" },
  { method: "POST", path: "/api/suppliers/service-terminations/:id/finalize", resourceKey: "finance.suppliers.service_termination", action: "execute" },
  { method: "GET", path: "/api/suppliers/service-terminations/:id/export*", resourceKey: "finance.suppliers.service_termination", action: "export" },
  { method: "POST", path: "/api/suppliers/service-terminations/:id/cancel", resourceKey: "finance.suppliers.service_termination", action: "manage" },

  // Conciliação / Inteligência / Status / Pedido→Caixa
  { method: "GET", path: "/api/finance/portfolio-reconciliation", resourceKey: "finance.portfolio_reconciliation", action: "view" },
  { method: "GET", path: "/api/finance/portfolio-reconciliation/intelligence", resourceKey: "finance.portfolio_reconciliation", action: "view" },
  {
    method: "GET",
    path: "/api/finance/portfolio-reconciliation/order-status-pedidos",
    resourceKey: "finance.portfolio_reconciliation.order_status",
    action: "view",
  },
  {
    method: "GET",
    path: "/api/finance/portfolio-reconciliation/order-to-cash-audit",
    resourceKey: "finance.portfolio_reconciliation.order_to_cash_audit",
    action: "view",
  },

  // OPEX
  { method: "GET", path: "/api/indirect-costs", resourceKey: "finance.opex", action: "view" },
  { method: "POST", path: "/api/indirect-costs", resourceKey: "finance.opex", action: "update" },

  // Tributos
  { method: "GET", path: "/api/tax-rules", resourceKey: "finance.taxes", action: "view" },
  { method: "GET", path: "/api/finance/fiscal-settlements/reports", resourceKey: "finance.tax_apuration", action: "view" },

  // Relatórios
  { method: "GET", path: "/api/reports/data", resourceKey: "finance.reports", action: "view" },
] as const;

/** Recursos que Leticia (AP-only) deve negar. */
export const FINANCE_LETICIA_DENIED_RESOURCE_KEYS = [
  FINANCE_MODULE_RESOURCE_KEYS.home,
  FINANCE_MODULE_RESOURCE_KEYS.cashFlow,
  FINANCE_MODULE_RESOURCE_KEYS.accountsReceivable,
  FINANCE_MODULE_RESOURCE_KEYS.billing,
  FINANCE_MODULE_RESOURCE_KEYS.salesOrders,
  FINANCE_MODULE_RESOURCE_KEYS.costCenters,
  FINANCE_MODULE_RESOURCE_KEYS.executiveReport,
  FINANCE_MODULE_RESOURCE_KEYS.suppliers,
  FINANCE_MODULE_RESOURCE_KEYS.suppliersServiceTermination,
  FINANCE_MODULE_RESOURCE_KEYS.portfolio,
  FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderStatus,
  FINANCE_MODULE_RESOURCE_KEYS.portfolioOrderToCashAudit,
  FINANCE_MODULE_RESOURCE_KEYS.opex,
  FINANCE_MODULE_RESOURCE_KEYS.taxes,
  FINANCE_MODULE_RESOURCE_KEYS.taxApuration,
  FINANCE_MODULE_RESOURCE_KEYS.reports,
] as const;
