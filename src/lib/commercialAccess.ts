/**
 * Comercial — matriz de acesso (P19).
 * Actions do contrato apenas — sem inventar CRUD; preservar vendedores / comissão paga / ledger / pedidos / Formação de Preço.
 */

export const COMMERCIAL_RESOURCE_KEYS = {
  home: "commercial",
  crm: "commercial.crm",
  crmGeneral: "commercial.crm.general",
  crmSeller: "commercial.crm.seller",
  crmPortfolio: "commercial.crm.portfolio",
  crmCustomer360: "commercial.crm.customer_360",
  crmActivities: "commercial.crm.activities",
  crmAssignSeller: "commercial.crm.assign_seller",
  customers: "commercial.customers",
  proposals: "commercial.proposals",
  proposalsIndicators: "commercial.proposals.indicators",
  salesOrders: "commercial.sales_orders",
  salesOrdersDetail: "commercial.sales_orders.detail",
  salesOrdersInvoice: "commercial.sales_orders.invoice",
  /** Canônica — lista/resumo. */
  outputDocuments: "commercial.output_documents",
  outputDocumentsDetail: "commercial.output_documents.detail",
  outputDocumentsFinancial: "commercial.output_documents.financial",
  outputDocumentsAudit: "commercial.output_documents.audit",
  outputDocumentsRaw: "commercial.output_documents.raw",
  pricing: "commercial.pricing",
  commissions: "commercial.commissions",
  commissionsMonthlyClosing: "commercial.commissions.monthly_closing",
  commissionsClosings: "commercial.commissions.closings",
  commissionsCustomerExclusions: "commercial.commissions.customer_exclusions",
  commissionsReports: "commercial.commissions.reports",
  commissionsReprocess: "commercial.commissions.reprocess",
} as const;

export const COMMERCIAL_ACTIONS = {
  view: "view",
  create: "create",
  update: "update",
  delete: "delete",
  export: "export",
  execute: "execute",
  manage: "manage",
  close: "close",
  reprocess: "reprocess",
} as const;

export const COMMERCIAL_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/crm/management-dashboard", resourceKey: "commercial.crm.general", action: "view" },
  { method: "GET", path: "/api/crm/seller-dashboard", resourceKey: "commercial.crm.seller", action: "view" },
  { method: "GET", path: "/api/crm/dashboard/basic", resourceKey: "commercial.crm", action: "view" },
  { method: "GET", path: "/api/crm/customers", resourceKey: "commercial.crm.portfolio", action: "view" },
  { method: "GET", path: "/api/crm/customers/:id/profile", resourceKey: "commercial.crm.customer_360", action: "view" },
  { method: "PUT", path: "/api/crm/customers/:id/profile", resourceKey: "commercial.crm.activities", action: "update" },
  { method: "GET", path: "/api/customers/:id/commercial-360", resourceKey: "commercial.crm.customer_360", action: "view" },
  { method: "GET", path: "/api/customers/:id/commercial-activities", resourceKey: "commercial.crm.customer_360", action: "view" },
  { method: "POST", path: "/api/customers/:id/commercial-activities", resourceKey: "commercial.crm.activities", action: "create" },
  { method: "PATCH", path: "/api/commercial-activities/:id", resourceKey: "commercial.crm.activities", action: "update" },
  { method: "GET", path: "/api/crm/customers/:id/commercial-intelligence", resourceKey: "commercial.crm.customer_360", action: "view" },
  { method: "GET", path: "/api/crm/customers/:id/commercial-owner", resourceKey: "commercial.crm.customer_360", action: "view" },
  { method: "GET", path: "/api/crm/commercial-sellers/active", resourceKey: "commercial.crm", action: "view" },
  { method: "PATCH", path: "/api/crm/customers/:id/commercial-owner", resourceKey: "commercial.crm.assign_seller", action: "manage" },

  { method: "GET", path: "/api/customers", resourceKey: "commercial.customers", action: "view" },
  { method: "POST", path: "/api/customers", resourceKey: "commercial.customers", action: "create" },
  { method: "PUT", path: "/api/customers/:id", resourceKey: "commercial.customers", action: "update" },
  { method: "DELETE", path: "/api/customers/:id", resourceKey: "commercial.customers", action: "update" },

  { method: "GET", path: "/api/proposals", resourceKey: "commercial.proposals", action: "view" },
  { method: "POST", path: "/api/proposals", resourceKey: "commercial.proposals", action: "create" },
  { method: "PUT", path: "/api/proposals/:id", resourceKey: "commercial.proposals", action: "update" },
  { method: "DELETE", path: "/api/proposals/:id", resourceKey: "commercial.proposals", action: "delete" },
  { method: "GET", path: "/api/proposals/:id/pdf*", resourceKey: "commercial.proposals", action: "export" },

  { method: "GET", path: "/api/sales-orders", resourceKey: "commercial.sales_orders", action: "view" },
  { method: "GET", path: "/api/sales-orders/management", resourceKey: "commercial.sales_orders", action: "view" },
  { method: "GET", path: "/api/sales-orders/report", resourceKey: "commercial.sales_orders", action: "view" },
  { method: "GET", path: "/api/sales-orders/export*", resourceKey: "commercial.sales_orders", action: "view" },
  { method: "GET", path: "/api/sales-orders/:id", resourceKey: "commercial.sales_orders.detail", action: "view" },
  { method: "GET", path: "/api/sales-orders/:id/detail", resourceKey: "commercial.sales_orders.detail", action: "view" },
  { method: "GET", path: "/api/sales-orders/:id/intelligence", resourceKey: "commercial.sales_orders.detail", action: "view" },
  { method: "GET", path: "/api/commercial/sales-order-flow/summary", resourceKey: "commercial.sales_orders", action: "view" },

  { method: "GET", path: "/api/commercial/output-documents/summary", resourceKey: "commercial.output_documents", action: "view" },
  { method: "GET", path: "/api/commercial/output-documents", resourceKey: "commercial.output_documents", action: "view" },
  { method: "GET", path: "/api/commercial/output-documents/:id", resourceKey: "commercial.output_documents.detail", action: "view" },

  { method: "GET", path: "/api/pricing", resourceKey: "commercial.pricing", action: "view" },
  { method: "POST", path: "/api/pricing/simulate*", resourceKey: "commercial.pricing", action: "execute" },
  { method: "POST", path: "/api/pricing/*", resourceKey: "commercial.pricing", action: "manage" },

  { method: "GET", path: "/api/commissions", resourceKey: "commercial.commissions", action: "view" },
  { method: "GET", path: "/api/commissions/receipt-closing*", resourceKey: "commercial.commissions.monthly_closing", action: "view" },
  { method: "POST", path: "/api/commissions/receipt-closing/apply", resourceKey: "commercial.commissions.monthly_closing", action: "close" },
  { method: "POST", path: "/api/commissions/payment-batches*", resourceKey: "commercial.commissions.monthly_closing", action: "manage" },
  { method: "GET", path: "/api/commissions/closings*", resourceKey: "commercial.commissions.closings", action: "view" },
  { method: "GET", path: "/api/commissions/*export*", resourceKey: "commercial.commissions.reports", action: "export" },
  { method: "POST", path: "/api/commissions/reprocess*", resourceKey: "commercial.commissions.reprocess", action: "reprocess" },
  { method: "POST", path: "/api/commissions/recalculate*", resourceKey: "commercial.commissions.reprocess", action: "execute" },
] as const;

/** Chaves que não devem abrir módulos comerciais via bleed. */
export const COMMERCIAL_FORBIDDEN_BLEED_KEYS = [
  "costs.view",
  "finance.view",
  "finance.accountsPayable.view",
  "settings.view",
] as const;
