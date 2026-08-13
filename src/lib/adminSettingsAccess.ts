/**
 * Administração — Configurações / Guia (P19).
 * Usuários e Permissões (admin.settings.security) já em P14 — não re-migrar.
 * Actions do contrato apenas; preservar sync Nomus.
 */

export const ADMIN_SETTINGS_RESOURCE_KEYS = {
  settings: "admin.settings",
  security: "admin.settings.security",
  nomusSync: "admin.settings.nomus_sync",
  branding: "admin.settings.branding",
  globalParams: "admin.settings.global_params",
  operational: "admin.settings.operational",
  priceTables: "admin.settings.price_tables",
  guide: "admin.guide",
} as const;

export const ADMIN_SETTINGS_ACTIONS = {
  view: "view",
  update: "update",
  manage: "manage",
  execute: "execute",
} as const;

export const ADMIN_SETTINGS_PILOT_ENDPOINTS = [
  { method: "GET", path: "/api/settings/globals", resourceKey: "admin.settings.global_params", action: "view" },
  { method: "PUT", path: "/api/settings/globals", resourceKey: "admin.settings.global_params", action: "update" },
  { method: "POST", path: "/api/settings/apply-hh-hm-simulation", resourceKey: "admin.settings.global_params", action: "update" },

  { method: "GET", path: "/api/branding-settings", resourceKey: "admin.settings.branding", action: "view" },
  { method: "PUT", path: "/api/branding-settings", resourceKey: "admin.settings.branding", action: "update" },

  { method: "GET", path: "/api/roles", resourceKey: "admin.settings.operational", action: "view" },
  { method: "POST", path: "/api/roles", resourceKey: "admin.settings.operational", action: "manage" },
  { method: "GET", path: "/api/payroll-components", resourceKey: "admin.settings.operational", action: "view" },
  { method: "POST", path: "/api/payroll-components", resourceKey: "admin.settings.operational", action: "manage" },

  // GET /api/price-tables: consumo compartilhado (proposals|pricing|settings) — não é piloto admin-only.
  // POST generate-draft / publish: somente SUPER_ADMIN (ver server.ts requireSuperAdmin).

  { method: "GET", path: "/api/settings/nomus-sync/logs*", resourceKey: "admin.settings.nomus_sync", action: "view" },
  { method: "GET", path: "/api/settings/nomus-sync/*-status", resourceKey: "admin.settings.nomus_sync", action: "view" },
  { method: "GET", path: "/api/settings/nomus-sync/source-reconciliation-records", resourceKey: "admin.settings.nomus_sync", action: "view" },
  { method: "POST", path: "/api/settings/nomus-sync/*-run", resourceKey: "admin.settings.nomus_sync", action: "execute" },
  { method: "GET", path: "/api/settings/system/sales-order-flow/status", resourceKey: "admin.settings", action: "view" },
  { method: "GET", path: "/api/settings/system/supply-chain/status", resourceKey: "admin.settings", action: "view" },

  { method: "GET", path: "/guide", resourceKey: "admin.guide", action: "view" },
] as const;

/** Security já migrado em P14 — referência. */
export const ADMIN_SETTINGS_SECURITY_ALREADY_MIGRATED = true;

export const ADMIN_SETTINGS_FORBIDDEN_BLEED_KEYS = [
  "costs.view",
  "finance.accountsPayable.view",
  "crm.view",
] as const;

/** Hub Administração → Configurações: somente SUPER_ADMIN autenticado. */
export function canOpenAdminSettingsHub(user: {
  role?: string | null;
} | null | undefined): boolean {
  return String(user?.role ?? "").trim().toUpperCase() === "SUPER_ADMIN";
}
