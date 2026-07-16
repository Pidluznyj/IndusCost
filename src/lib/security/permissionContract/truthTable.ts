/**
 * Tabela-verdade do modelo alvo (P01 / PERM-30).
 *
 * Delega 100% ao resolvedor canônico `resolveEffectiveAccess`.
 * Não lê AppUser.permissions[].
 */

import {
  canRevealNavigation,
  resolveEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/resolveEffectiveAccess.ts";
import type { EffectiveAccessSource } from "@/src/lib/security/effectiveAccess/types.ts";
import {
  getPermissionContractResource,
  isKnownPermissionAction,
  isKnownPermissionResource,
  supportsPermissionAction,
} from "./helpers.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import type {
  PermissionContractResource,
  PermissionTruthDecision,
  PermissionTruthResolveResult,
  PermissionTruthSubject,
} from "./types.ts";

function mapSourceToReason(source: EffectiveAccessSource): PermissionTruthResolveResult["reason"] {
  switch (source) {
    case "SUPER_ADMIN":
      return "SUPER_ADMIN_BYPASS";
    case "OVERRIDE_DENY":
      return "OVERRIDE_DENY";
    case "OVERRIDE_ALLOW":
      return "OVERRIDE_ALLOW";
    case "ANCESTOR_VIEW_DENY":
      return "ANCESTOR_VIEW_DENY";
    case "UNKNOWN_RESOURCE":
      return "UNKNOWN_RESOURCE";
    case "UNSUPPORTED_ACTION":
      return "UNSUPPORTED_ACTION";
    case "DENY_DEFAULT":
      return "DEFAULT_DENY";
    case "PROFILE":
    case "ROLE":
    case "STRUCTURED_GRANT":
    case "LEGACY_PROJECTED":
      return "BASELINE_ALLOW";
    default:
      return "DEFAULT_DENY";
  }
}

/**
 * Resolve allow/deny para resourceKey × action via resolvedor canônico.
 * `subject.baseline` → profileSnapshot (substitui role; `{}` = vazio).
 */
export function resolvePermissionTruth(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionTruthResolveResult {
  const result = resolveEffectiveAccess(
    {
      userId: "truth-table",
      role: subject.role,
      // baseline explícito (mesmo {}) substitui role — alinhado ao contrato P01
      profileSnapshot: subject.baseline !== undefined ? subject.baseline : null,
      overrides: subject.overrides ?? {},
      legacyCompatMode: false,
      legacyPermissions: [],
    },
    resources
  );

  const cell = result.byResourceAction[resourceKey]?.[
    action as keyof (typeof result.byResourceAction)[string]
  ];

  if (!cell) {
    if (!isKnownPermissionResource(resourceKey, resources)) {
      return { decision: "deny", reason: "UNKNOWN_RESOURCE" };
    }
    if (!isKnownPermissionAction(action)) {
      return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
    }
    if (!supportsPermissionAction(resourceKey, action, resources)) {
      return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
    }
    return { decision: "deny", reason: "DEFAULT_DENY" };
  }

  const decision: PermissionTruthDecision = cell.decision === "allow" ? "allow" : "deny";
  return { decision, reason: mapSourceToReason(cell.source) };
}

export function canPerformPermissionTruth(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return resolvePermissionTruth(subject, resourceKey, action, resources).decision === "allow";
}

/**
 * Navegação / accordion — mesma regra do resolvedor canônico.
 */
export function canRevealPermissionNavigation(
  subject: PermissionTruthSubject,
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  const result = resolveEffectiveAccess(
    {
      userId: "truth-table",
      role: subject.role,
      profileSnapshot: subject.baseline !== undefined ? subject.baseline : null,
      overrides: subject.overrides ?? {},
      legacyCompatMode: false,
      legacyPermissions: [],
    },
    resources
  );
  return canRevealNavigation(result, resourceKey);
}

/** Caso Leticia: VIEWER só Contas a Pagar (baseline vazio + override allow). */
export function leticiaAccountsPayableOnlySubject(): PermissionTruthSubject {
  return {
    role: "VIEWER",
    baseline: {},
    overrides: {
      "finance.accounts_payable": { view: "allow" },
    },
  };
}

export type LeticiaExpectation = {
  resourceKey: string;
  canPerformView: boolean;
  canRevealNavigation: boolean;
};

/** Expectativas do caso Leticia (modelo alvo). */
export function listLeticiaAccountsPayableExpectations(): LeticiaExpectation[] {
  return [
    {
      resourceKey: "finance.accounts_payable",
      canPerformView: true,
      canRevealNavigation: true,
    },
    {
      resourceKey: "finance",
      canPerformView: false,
      canRevealNavigation: true,
    },
    {
      resourceKey: "finance.portfolio_reconciliation",
      canPerformView: false,
      canRevealNavigation: false,
    },
    {
      resourceKey: "finance.accounts_receivable",
      canPerformView: false,
      canRevealNavigation: false,
    },
    {
      resourceKey: "finance.cash_flow",
      canPerformView: false,
      canRevealNavigation: false,
    },
    {
      resourceKey: "admin.employees",
      canPerformView: false,
      canRevealNavigation: false,
    },
    {
      resourceKey: "operations.machines",
      canPerformView: false,
      canRevealNavigation: false,
    },
    {
      resourceKey: "engineering",
      canPerformView: false,
      canRevealNavigation: false,
    },
  ];
}

/** Avalia o caso Leticia contra o contrato. */
export function evaluateLeticiaAccountsPayableCase(
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): {
  subject: PermissionTruthSubject;
  results: Array<
    LeticiaExpectation & {
      actualPerform: boolean;
      actualReveal: boolean;
      ok: boolean;
    }
  >;
  allOk: boolean;
} {
  const subject = leticiaAccountsPayableOnlySubject();
  const results = listLeticiaAccountsPayableExpectations().map((exp) => {
    const actualPerform = canPerformPermissionTruth(
      subject,
      exp.resourceKey,
      "view",
      resources
    );
    const actualReveal = canRevealPermissionNavigation(
      subject,
      exp.resourceKey,
      resources
    );
    const ok =
      actualPerform === exp.canPerformView &&
      actualReveal === exp.canRevealNavigation;
    return { ...exp, actualPerform, actualReveal, ok };
  });
  return { subject, results, allOk: results.every((r) => r.ok) };
}

/** Garante que recursos citados na tabela existem no contrato. */
export function assertTruthTableResourcesExist(
  resourceKeys: readonly string[],
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): string[] {
  return resourceKeys.filter((k) => !getPermissionContractResource(k, resources));
}

export function decisionLabel(d: PermissionTruthDecision): string {
  return d === "allow" ? "ALLOW" : "DENY";
}
