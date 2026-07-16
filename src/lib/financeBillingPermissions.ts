/** Permissões UI Financeiro > Faturamento — contrato finance.billing. */

export type FinanceBillingPermissionCheck = {
  hasPermission: (key: string) => boolean;
};

/** Contrato: finance.billing.view | sales_orders.view | finance.view — sem AR/AP/reports. */
export function canViewFinanceBilling(auth: FinanceBillingPermissionCheck): boolean {
  return (
    auth.hasPermission("finance.billing.view") ||
    auth.hasPermission("sales_orders.view") ||
    auth.hasPermission("finance.view")
  );
}

/** @deprecated Preferir requireResource. */
export const FINANCE_BILLING_VIEW_PERMISSIONS = [
  "finance.billing.view",
  "sales_orders.view",
  "finance.view",
] as const;

/** Alinhado ao Admin (`settings.nomus.sync` apenas). */
export function canRunFinanceBillingNfeSync(auth: FinanceBillingPermissionCheck): boolean {
  return auth.hasPermission("settings.nomus.sync");
}
