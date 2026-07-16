/**
 * Permissões — Financeiro > Conciliação de Carteira (módulo + abas).
 *
 * Motor central: catálogo + DTO (P12). Frontend esconde; APIs validam.
 *
 * P09/P12: Contas a Pagar NÃO entra no OR legado de portfolio (sem bleed AP→conciliação).
 */

export const FINANCE_PORTFOLIO_RECONCILIATION_VIEW =
  "finance.portfolioReconciliation.view" as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW =
  "finance.portfolioReconciliation.conciliation.view" as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW =
  "finance.portfolioReconciliation.intelligence.view" as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW =
  "finance.portfolioReconciliation.orderToCashAudit.view" as const;

/**
 * OR legado residual — esvaziado em P17 (chave própria obrigatória).
 * Mantido export vazio para imports de teste que assertam ausência de AP.
 */
export const FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS = [] as const;

/**
 * @deprecated Preferir `FINANCE_PORTFOLIO_RECONCILIATION_MODULE_API_PERMISSIONS`.
 * Mantido como alias do OR legado + chave dedicada para imports existentes.
 */
export const FINANCE_PORTFOLIO_RECONCILIATION_VIEW_PERMISSIONS = [
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
] as const;

export type FinancePortfolioReconciliationPermissionCheck = {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
};

export type PortfolioReconciliationTabId =
  | "conciliation"
  | "intelligence"
  | "order-to-cash-audit";

function hasLegacyPortfolioAccess(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return auth.hasAnyPermission([
    ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
  ]);
}

function hasDedicatedModuleAccess(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_VIEW);
}

/** Menu / módulo: chave dedicada, qualquer aba dedicada, OU legado. */
export function canViewFinancePortfolioReconciliation(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return (
    hasDedicatedModuleAccess(auth) ||
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW) ||
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW) ||
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW) ||
    hasLegacyPortfolioAccess(auth)
  );
}

/** Aba Conciliação. */
export function canViewPortfolioConciliationTab(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return (
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW) ||
    hasDedicatedModuleAccess(auth) ||
    hasLegacyPortfolioAccess(auth)
  );
}

/** Aba Inteligência da Carteira. */
export function canViewPortfolioIntelligenceTab(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return (
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW) ||
    hasDedicatedModuleAccess(auth) ||
    hasLegacyPortfolioAccess(auth)
  );
}

/** Aba Auditoria Pedido → Caixa. */
export function canViewPortfolioOrderToCashAuditTab(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return (
    auth.hasPermission(FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW) ||
    hasDedicatedModuleAccess(auth) ||
    hasLegacyPortfolioAccess(auth)
  );
}

export function canViewPortfolioReconciliationTab(
  auth: FinancePortfolioReconciliationPermissionCheck,
  tab: PortfolioReconciliationTabId
): boolean {
  switch (tab) {
    case "conciliation":
      return canViewPortfolioConciliationTab(auth);
    case "intelligence":
      return canViewPortfolioIntelligenceTab(auth);
    case "order-to-cash-audit":
      return canViewPortfolioOrderToCashAuditTab(auth);
    default:
      return false;
  }
}

export function listVisiblePortfolioReconciliationTabs(
  auth: FinancePortfolioReconciliationPermissionCheck
): PortfolioReconciliationTabId[] {
  const order: PortfolioReconciliationTabId[] = [
    "conciliation",
    "intelligence",
    "order-to-cash-audit",
  ];
  return order.filter((tab) => canViewPortfolioReconciliationTab(auth, tab));
}

export function resolveDefaultPortfolioReconciliationTab(
  auth: FinancePortfolioReconciliationPermissionCheck
): PortfolioReconciliationTabId | null {
  return listVisiblePortfolioReconciliationTabs(auth)[0] ?? null;
}

/** TraceJson técnico completo — apenas admin/configuração. */
export function canViewPortfolioReconciliationTechnicalTrace(
  auth: FinancePortfolioReconciliationPermissionCheck
): boolean {
  return (
    auth.hasPermission("users.manage") ||
    auth.hasPermission("settings.view") ||
    auth.hasPermission("accessProfiles.manage")
  );
}

/** Listas para `requireAnyPermission` nas APIs (backend). */
export const FINANCE_PORTFOLIO_RECONCILIATION_MODULE_API_PERMISSIONS = [
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
] as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_API_PERMISSIONS = [
  FINANCE_PORTFOLIO_RECONCILIATION_CONCILIATION_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
] as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_API_PERMISSIONS = [
  FINANCE_PORTFOLIO_RECONCILIATION_INTELLIGENCE_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
] as const;

export const FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_API_PERMISSIONS = [
  FINANCE_PORTFOLIO_RECONCILIATION_ORDER_TO_CASH_AUDIT_VIEW,
  FINANCE_PORTFOLIO_RECONCILIATION_VIEW,
  ...FINANCE_PORTFOLIO_RECONCILIATION_LEGACY_VIEW_PERMISSIONS,
] as const;
