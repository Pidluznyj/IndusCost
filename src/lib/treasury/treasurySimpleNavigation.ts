/**
 * Navegação simples da Tesouraria — client-safe.
 * Primária: Hoje / Contas / Conferir banco / Próximos dias.
 * Avançada: catálogo técnico preservado (ADMIN / SUPER_ADMIN).
 */

import type { AppUserRole } from "@/src/lib/appAuthClient.js";
import type { TreasuryFeatureFlagId } from "./treasuryFeatureFlags.js";
import type { TreasuryRolloutUiSectionId } from "./treasuryRollout.js";

export const TREASURY_SIMPLE_UI_BASE_PATH = "/finance/treasury" as const;

export type TreasurySimplePrimarySectionId =
  | "today"
  | "accounts"
  | "bank"
  | "projection";

export type TreasurySimpleNavSection = {
  id: TreasuryRolloutUiSectionId;
  path: string;
  label: string;
};

/** Abas da experiência padrão (não inclui ferramentas técnicas). */
export const TREASURY_UI_PRIMARY_SECTIONS = [
  {
    id: "today",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/today`,
    label: "Hoje",
  },
  {
    id: "accounts",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/accounts`,
    label: "Contas",
  },
  {
    id: "bank",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/bank`,
    label: "Conferir banco",
  },
  {
    id: "projection",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/projection`,
    label: "Próximos dias",
  },
] as const satisfies readonly TreasurySimpleNavSection[];

/**
 * Catálogo de recursos avançados — permanece no código/rotas.
 * Labels simples onde o produto pediu renomeação de navegação.
 */
export const TREASURY_UI_ADVANCED_SECTIONS = [
  {
    id: "receivables",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/receivables`,
    label: "Recebimentos",
  },
  {
    id: "payables",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/payables`,
    label: "Pagamentos",
  },
  {
    id: "agenda",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/agenda`,
    label: "Agenda financeira",
  },
  {
    id: "projections",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/projections`,
    label: "Comparação de cenários",
  },
  {
    id: "payment-schedule",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/payment-schedule`,
    label: "Programação",
  },
  {
    id: "transfers",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/transfers`,
    label: "Transferências",
  },
  {
    id: "manual-entries",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/manual-entries`,
    label: "Lançamentos manuais",
  },
  {
    id: "bank-movements",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/bank-movements`,
    label: "Movimentos bancários",
  },
  {
    id: "ofx",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/ofx`,
    label: "Importação OFX",
  },
  {
    id: "reconcile",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/reconcile`,
    label: "Conciliação avançada",
  },
  {
    id: "exceptions",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/exceptions`,
    label: "Exceções",
  },
  {
    id: "alert-settings",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/alert-settings`,
    label: "Alertas",
  },
  {
    id: "closing",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/closing`,
    label: "Fechar o dia",
  },
  {
    id: "reports",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/reports`,
    label: "Relatórios",
  },
  {
    id: "audit",
    path: `${TREASURY_SIMPLE_UI_BASE_PATH}/audit`,
    label: "Auditoria",
  },
] as const satisfies readonly TreasurySimpleNavSection[];

export const TREASURY_UI_ADVANCED_HUB_PATH =
  `${TREASURY_SIMPLE_UI_BASE_PATH}/advanced` as const;

/** Roles com acesso ao hub “Recursos avançados”. */
export const TREASURY_ADVANCED_NAV_ROLES = [
  "ADMIN",
  "SUPER_ADMIN",
] as const satisfies readonly AppUserRole[];

export function canAccessTreasuryAdvancedNavigation(
  role: string | null | undefined
): boolean {
  if (!role) return false;
  return (TREASURY_ADVANCED_NAV_ROLES as readonly string[]).includes(role);
}

export function isTreasuryPrimaryPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return TREASURY_UI_PRIMARY_SECTIONS.some(
    (s) =>
      normalized === s.path ||
      (s.id === "today" &&
        normalized.startsWith(`${TREASURY_SIMPLE_UI_BASE_PATH}/today/`)) ||
      (s.id === "accounts" &&
        normalized.startsWith(`${TREASURY_SIMPLE_UI_BASE_PATH}/accounts/`))
  );
}

export function isTreasuryAdvancedPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === TREASURY_UI_ADVANCED_HUB_PATH) return true;
  return TREASURY_UI_ADVANCED_SECTIONS.some(
    (s) => normalized === s.path || normalized.startsWith(`${s.path}/`)
  );
}

/** Alias de seção primária → flag (espelha rollout). */
export const TREASURY_PRIMARY_SECTION_FEATURE_FLAG: Record<
  TreasurySimplePrimarySectionId,
  TreasuryFeatureFlagId | null
> = {
  today: "treasury.dashboard.enabled",
  accounts: "treasury.accounts.enabled",
  bank: "treasury.ofxImport.enabled",
  projection: "treasury.projection.enabled",
};
