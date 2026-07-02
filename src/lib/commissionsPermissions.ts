/** Permissões do módulo Comissões — alinhadas ao blueprint e às rotas REST. */

export const COMMISSIONS_VIEW_PERMISSIONS = [
  "commissions.view",
  "commissions.dashboard.view",
  "commissions.forecast.view",
  "commissions.confirmed.view",
  "commissions.release.view",
  "commissions.payments.view",
  "commissions.people.view",
  "commissions.rules.view",
  "commissions.audit.view",
  "commissions.settings.view",
] as const;

export const COMMISSIONS_DASHBOARD_VIEW_PERMISSIONS = [
  "commissions.dashboard.view",
  "commissions.view",
] as const;

export const COMMISSIONS_FORECAST_VIEW_PERMISSIONS = [
  "commissions.forecast.view",
  "commissions.view",
] as const;

export const COMMISSIONS_CONFIRMED_VIEW_PERMISSIONS = [
  "commissions.confirmed.view",
  "commissions.view",
] as const;

export const COMMISSIONS_APURACAO_VIEW_PERMISSIONS = [
  "commissions.confirmed.view",
  "commissions.dashboard.view",
  "commissions.view",
] as const;

export const COMMISSIONS_RELEASE_VIEW_PERMISSIONS = [
  "commissions.release.view",
  "commissions.view",
] as const;

export const COMMISSIONS_PAYMENTS_VIEW_PERMISSIONS = [
  "commissions.payments.view",
  "commissions.view",
] as const;

export const COMMISSIONS_PAYMENTS_MANAGE_PERMISSIONS = [
  "commissions.payments.manage",
] as const;

export const COMMISSIONS_PEOPLE_VIEW_PERMISSIONS = [
  "commissions.people.view",
  "commissions.view",
] as const;

export const COMMISSIONS_PEOPLE_MANAGE_PERMISSIONS = [
  "commissions.people.manage",
] as const;

export const COMMISSIONS_RULES_VIEW_PERMISSIONS = [
  "commissions.rules.view",
  "commissions.view",
] as const;

export const COMMISSIONS_RULES_MANAGE_PERMISSIONS = [
  "commissions.rules.manage",
] as const;

export const COMMISSIONS_AUDIT_VIEW_PERMISSIONS = [
  "commissions.audit.view",
  "commissions.view",
] as const;

export const COMMISSIONS_SETTINGS_VIEW_PERMISSIONS = [
  "commissions.settings.view",
  "commissions.view",
] as const;

export const COMMISSIONS_SETTINGS_MANAGE_PERMISSIONS = [
  "commissions.settings.view",
  "commissions.people.manage",
] as const;

export const COMMISSIONS_RECALCULATE_PERMISSIONS = [
  "commissions.rules.manage",
  "commissions.payments.manage",
] as const;

export const COMMISSIONS_SELLER_ALL_PERMISSION = "commissions.seller.all" as const;
export const COMMISSIONS_SELLER_OWN_PERMISSION = "commissions.seller.own" as const;
