/**
 * Controle de rollout da Central de Tesouraria — client-safe.
 * Ordem recomendada + mapeamento UI ↔ flag. Sem Express/Prisma.
 */

import type { TreasuryFeatureFlagId } from "./treasuryFeatureFlags.js";

/** Ordem recomendada de ativação progressiva (Prompt 65). */
export const TREASURY_ROLLOUT_ACTIVATION_ORDER = [
  "treasury.enabled",
  "treasury.accounts.enabled",
  "treasury.balances.enabled",
  "treasury.dashboard.enabled",
  "treasury.receivables.enabled",
  "treasury.promises.enabled",
  "treasury.payables.enabled",
  "treasury.payablesProgramming.enabled",
  "treasury.projection.enabled",
  "treasury.transfers.enabled",
  "treasury.exceptions.enabled",
  "treasury.ofxImport.enabled",
  "treasury.reconciliation.enabled",
  "treasury.dailyClosing.enabled",
  "treasury.reports.enabled",
] as const satisfies readonly TreasuryFeatureFlagId[];

export type TreasuryRolloutUiSectionId =
  | "home"
  | "today"
  | "accounts"
  | "balances"
  | "receivables"
  | "payables"
  | "agenda"
  | "projections"
  | "projection"
  | "caixa"
  | "payment-schedule"
  | "transfers"
  | "manual-entries"
  | "bank-movements"
  | "bank"
  | "ofx"
  | "reconcile"
  | "exceptions"
  | "alert-settings"
  | "closing"
  | "reports"
  | "audit"
  | "advanced";

/**
 * Flag exigida para exibir cada aba/rota de UI.
 * `null` = só a mestra (já exigida para abrir o módulo).
 * `balances` não tem aba própria (rota aninhada em contas).
 */
export const TREASURY_UI_SECTION_FEATURE_FLAG: Record<
  TreasuryRolloutUiSectionId,
  TreasuryFeatureFlagId | null
> = {
  home: "treasury.dashboard.enabled",
  today: "treasury.dashboard.enabled",
  accounts: "treasury.accounts.enabled",
  balances: "treasury.balances.enabled",
  receivables: "treasury.receivables.enabled",
  payables: "treasury.payables.enabled",
  agenda: "treasury.projection.enabled",
  projections: "treasury.projection.enabled",
  projection: "treasury.projection.enabled",
  /** Caixa: sem subflag própria — segue a mestra, como audit/advanced. */
  caixa: null,
  "payment-schedule": "treasury.payablesProgramming.enabled",
  transfers: "treasury.transfers.enabled",
  "manual-entries": "treasury.accounts.enabled",
  "bank-movements": "treasury.reconciliation.enabled",
  bank: "treasury.ofxImport.enabled",
  ofx: "treasury.ofxImport.enabled",
  reconcile: "treasury.reconciliation.enabled",
  exceptions: "treasury.exceptions.enabled",
  "alert-settings": "treasury.exceptions.enabled",
  closing: "treasury.dailyClosing.enabled",
  reports: "treasury.reports.enabled",
  /** Auditoria permanece sob a mestra (operacional/controle). */
  audit: null,
  /** Hub avançado: mestra; papel ADMIN/SUPER_ADMIN é checado na UI. */
  advanced: null,
};

export type TreasuryFeatureFlagsMap = Record<TreasuryFeatureFlagId, boolean>;

export function isTreasuryUiSectionEnabled(
  sectionId: TreasuryRolloutUiSectionId,
  flags: Partial<TreasuryFeatureFlagsMap> | null | undefined
): boolean {
  if (!flags || flags["treasury.enabled"] !== true) return false;
  const required = TREASURY_UI_SECTION_FEATURE_FLAG[sectionId];
  if (required == null) return true;
  return flags[required] === true;
}

export function filterTreasuryUiSections<T extends { id: string }>(
  sections: readonly T[],
  flags: Partial<TreasuryFeatureFlagsMap> | null | undefined
): T[] {
  return sections.filter((section) =>
    isTreasuryUiSectionEnabled(section.id as TreasuryRolloutUiSectionId, flags)
  );
}

/** Primeira rota habilitada; fallback base do módulo. */
export function resolveTreasuryUiLandingPath(
  sections: readonly { id: string; path: string }[],
  flags: Partial<TreasuryFeatureFlagsMap> | null | undefined,
  fallbackPath: string
): string {
  const visible = filterTreasuryUiSections(sections, flags);
  return visible[0]?.path ?? fallbackPath;
}

/**
 * Landing apenas entre seções realmente liberadas.
 * `null` = nenhuma aba habilitada — o shell NÃO deve Navigate para um fallback
 * desabilitado (evita loop Navigate→mesma rota no FlagGate).
 */
export function resolveTreasuryUiEnabledLandingPath(
  sections: readonly { id: string; path: string }[],
  flags: Partial<TreasuryFeatureFlagsMap> | null | undefined,
  /**
   * Seção preferida como pouso inicial (ex.: "caixa" na Central de
   * Tesouraria). Só vence quando está liberada pelas flags; caso contrário
   * cai na primeira seção visível — comportamento original preservado.
   */
  preferredSectionId?: string
): string | null {
  const visible = filterTreasuryUiSections(sections, flags);
  if (preferredSectionId) {
    const preferred = visible.find((s) => s.id === preferredSectionId);
    if (preferred) return preferred.path;
  }
  return visible[0]?.path ?? null;
}

export type TreasuryFlagGateDecision =
  | { action: "loading" }
  | { action: "render" }
  | { action: "redirect"; to: string }
  | { action: "blocked" };

/**
 * Decisão pura do gate de seção (sem React Router).
 * Redirect só quando há landing habilitada distinta do path atual (sem loop).
 */
export function resolveTreasuryFlagGateDecision(input: {
  flags: Partial<TreasuryFeatureFlagsMap> | null | undefined;
  sectionId: TreasuryRolloutUiSectionId;
  alsoRequire?: readonly TreasuryFeatureFlagId[];
  landingPath: string | null;
  currentPath?: string | null;
}): TreasuryFlagGateDecision {
  const { flags, sectionId, alsoRequire, landingPath, currentPath } = input;
  if (!flags) return { action: "loading" };

  const required = TREASURY_UI_SECTION_FEATURE_FLAG[sectionId];
  const enabled =
    flags["treasury.enabled"] === true &&
    (required == null || flags[required] === true) &&
    (alsoRequire ?? []).every((id) => flags[id] === true);

  if (enabled) return { action: "render" };

  if (landingPath && landingPath !== currentPath) {
    return { action: "redirect", to: landingPath };
  }

  return { action: "blocked" };
}
