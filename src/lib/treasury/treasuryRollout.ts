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
  | "accounts"
  | "balances"
  | "receivables"
  | "payables"
  | "agenda"
  | "projections"
  | "payment-schedule"
  | "transfers"
  | "manual-entries"
  | "bank-movements"
  | "ofx"
  | "reconcile"
  | "exceptions"
  | "closing"
  | "reports"
  | "audit";

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
  accounts: "treasury.accounts.enabled",
  balances: "treasury.balances.enabled",
  receivables: "treasury.receivables.enabled",
  payables: "treasury.payables.enabled",
  agenda: "treasury.projection.enabled",
  projections: "treasury.projection.enabled",
  "payment-schedule": "treasury.payablesProgramming.enabled",
  transfers: "treasury.transfers.enabled",
  "manual-entries": "treasury.accounts.enabled",
  "bank-movements": "treasury.reconciliation.enabled",
  ofx: "treasury.ofxImport.enabled",
  reconcile: "treasury.reconciliation.enabled",
  exceptions: "treasury.exceptions.enabled",
  closing: "treasury.dailyClosing.enabled",
  reports: "treasury.reports.enabled",
  /** Auditoria permanece sob a mestra (operacional/controle). */
  audit: null,
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
