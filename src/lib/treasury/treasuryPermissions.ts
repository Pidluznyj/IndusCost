/**
 * Resolução de capacidades da Tesouraria via `authorizeRequireResource`
 * (deny > allow > baseline; chaves desconhecidas negadas).
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  authorizeRequireResource,
  type AuthorizeRequireResourceOptions,
} from "@/src/lib/security/requireResource.js";
import {
  TREASURY_ACTIONS,
  TREASURY_RESOURCE_KEYS,
  type TreasuryAction,
  type TreasuryResourceKey,
} from "./treasuryAccess.js";

export type TreasuryCapabilityId =
  | "viewModule"
  | "viewDashboard"
  | "viewAgenda"
  | "viewReceivables"
  | "manageReceivables"
  | "promiseReceivables"
  | "collectReceivables"
  | "viewPayables"
  | "managePayables"
  | "programPayables"
  | "viewAccounts"
  | "manageAccounts"
  | "manageBalances"
  | "viewTransfers"
  | "manageTransfers"
  | "viewManualEntries"
  | "manageManualEntries"
  | "viewReconciliation"
  | "manageReconciliation"
  | "reverseReconciliation"
  | "viewExceptions"
  | "manageExceptions"
  | "viewClosing"
  | "closeDay"
  | "reopenDay"
  | "viewAudit"
  | "viewReports"
  | "export";

export const TREASURY_CAPABILITY_MATRIX: Record<
  TreasuryCapabilityId,
  { resourceKey: TreasuryResourceKey; action: TreasuryAction | "reverse" }
> = {
  viewModule: { resourceKey: TREASURY_RESOURCE_KEYS.root, action: TREASURY_ACTIONS.view },
  viewDashboard: {
    resourceKey: TREASURY_RESOURCE_KEYS.dashboard,
    action: TREASURY_ACTIONS.view,
  },
  viewAgenda: { resourceKey: TREASURY_RESOURCE_KEYS.agenda, action: TREASURY_ACTIONS.view },
  viewReceivables: {
    resourceKey: TREASURY_RESOURCE_KEYS.receivables,
    action: TREASURY_ACTIONS.view,
  },
  manageReceivables: {
    resourceKey: TREASURY_RESOURCE_KEYS.receivables,
    action: TREASURY_ACTIONS.manage,
  },
  promiseReceivables: {
    resourceKey: TREASURY_RESOURCE_KEYS.receivablesPromise,
    action: TREASURY_ACTIONS.execute,
  },
  collectReceivables: {
    resourceKey: TREASURY_RESOURCE_KEYS.receivablesCollection,
    action: TREASURY_ACTIONS.execute,
  },
  viewPayables: {
    resourceKey: TREASURY_RESOURCE_KEYS.payables,
    action: TREASURY_ACTIONS.view,
  },
  managePayables: {
    resourceKey: TREASURY_RESOURCE_KEYS.payables,
    action: TREASURY_ACTIONS.manage,
  },
  programPayables: {
    resourceKey: TREASURY_RESOURCE_KEYS.payablesProgram,
    action: TREASURY_ACTIONS.execute,
  },
  viewAccounts: {
    resourceKey: TREASURY_RESOURCE_KEYS.accounts,
    action: TREASURY_ACTIONS.view,
  },
  manageAccounts: {
    resourceKey: TREASURY_RESOURCE_KEYS.accounts,
    action: TREASURY_ACTIONS.manage,
  },
  manageBalances: {
    resourceKey: TREASURY_RESOURCE_KEYS.balances,
    action: TREASURY_ACTIONS.manage,
  },
  viewTransfers: {
    resourceKey: TREASURY_RESOURCE_KEYS.transfers,
    action: TREASURY_ACTIONS.view,
  },
  manageTransfers: {
    resourceKey: TREASURY_RESOURCE_KEYS.transfers,
    action: TREASURY_ACTIONS.manage,
  },
  viewManualEntries: {
    resourceKey: TREASURY_RESOURCE_KEYS.manualEntries,
    action: TREASURY_ACTIONS.view,
  },
  manageManualEntries: {
    resourceKey: TREASURY_RESOURCE_KEYS.manualEntries,
    action: TREASURY_ACTIONS.manage,
  },
  viewReconciliation: {
    resourceKey: TREASURY_RESOURCE_KEYS.reconciliation,
    action: TREASURY_ACTIONS.view,
  },
  manageReconciliation: {
    resourceKey: TREASURY_RESOURCE_KEYS.reconciliation,
    action: TREASURY_ACTIONS.manage,
  },
  reverseReconciliation: {
    resourceKey: TREASURY_RESOURCE_KEYS.reconciliationReverse,
    action: TREASURY_ACTIONS.execute,
  },
  viewExceptions: {
    resourceKey: TREASURY_RESOURCE_KEYS.exceptions,
    action: TREASURY_ACTIONS.view,
  },
  manageExceptions: {
    resourceKey: TREASURY_RESOURCE_KEYS.exceptions,
    action: TREASURY_ACTIONS.manage,
  },
  viewClosing: {
    resourceKey: TREASURY_RESOURCE_KEYS.closing,
    action: TREASURY_ACTIONS.view,
  },
  closeDay: {
    resourceKey: TREASURY_RESOURCE_KEYS.closing,
    action: TREASURY_ACTIONS.close,
  },
  reopenDay: {
    resourceKey: TREASURY_RESOURCE_KEYS.closing,
    action: TREASURY_ACTIONS.reopen,
  },
  viewAudit: { resourceKey: TREASURY_RESOURCE_KEYS.audit, action: TREASURY_ACTIONS.view },
  viewReports: {
    resourceKey: TREASURY_RESOURCE_KEYS.reports,
    action: TREASURY_ACTIONS.view,
  },
  export: { resourceKey: TREASURY_RESOURCE_KEYS.root, action: TREASURY_ACTIONS.export },
};

export function canTreasuryCapability(
  user: AppAuthContext | null | undefined,
  capability: TreasuryCapabilityId,
  options?: AuthorizeRequireResourceOptions
): boolean {
  const target = TREASURY_CAPABILITY_MATRIX[capability];
  const decision = authorizeRequireResource(
    user ?? null,
    target.resourceKey,
    target.action,
    options
  );
  return decision.ok;
}

export function resolveTreasuryCapabilities(
  user: AppAuthContext | null | undefined,
  options?: AuthorizeRequireResourceOptions
): Record<TreasuryCapabilityId, boolean> {
  const out = {} as Record<TreasuryCapabilityId, boolean>;
  for (const key of Object.keys(TREASURY_CAPABILITY_MATRIX) as TreasuryCapabilityId[]) {
    out[key] = canTreasuryCapability(user, key, options);
  }
  return out;
}
