/**
 * Tabela-verdade executável do modelo alvo (P01).
 *
 * Decisões fechadas:
 * - backend é a autoridade (este módulo é o contrato puro; runtime NÃO importa ainda)
 * - deny > allow > herança (baseline)
 * - ausência de override = herdar baseline
 * - recurso ou ação desconhecida = DENY
 * - VIEWER com baseline vazio = sem acesso
 * - perfil = snapshot (baseline)
 * - SUPER_ADMIN mantém bypass
 * - parent com view DENY explícito bloqueia filho
 * - parent sem grant NÃO apaga config do filho; filho allow não concede APIs do parent
 * - navegação: ancestral pode ser “virtual” se algum descendente tem view allow
 *
 * Não lê AppUser.permissions[] (compat temporária).
 */

import {
  getPermissionContractResource,
  isKnownPermissionAction,
  isKnownPermissionResource,
  listPermissionAncestors,
  listPermissionDescendants,
  supportsPermissionAction,
} from "./helpers.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import type {
  PermissionContractAction,
  PermissionContractResource,
  PermissionTruthDecision,
  PermissionTruthResolveResult,
  PermissionTruthSubject,
} from "./types.ts";

function isSuperAdmin(role: string): boolean {
  return role === "SUPER_ADMIN";
}

type LocalDecision = "allow" | "deny" | "none";

function localDecision(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: PermissionContractAction
): LocalDecision {
  const ov = subject.overrides?.[resourceKey]?.[action];
  if (ov === "deny") return "deny";
  if (ov === "allow") return "allow";
  if (subject.baseline?.[resourceKey]?.[action] === true) return "allow";
  return "none";
}

/**
 * Resolve allow/deny para resourceKey × action no modelo alvo.
 */
export function resolvePermissionTruth(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): PermissionTruthResolveResult {
  if (isSuperAdmin(subject.role)) {
    if (!isKnownPermissionResource(resourceKey, resources)) {
      return { decision: "deny", reason: "UNKNOWN_RESOURCE" };
    }
    if (!isKnownPermissionAction(action)) {
      return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
    }
    // Bypass: qualquer ação do contrato no recurso (mesmo se não listada? arquitetura: todas as ações do contrato)
    // Estrito: só ações suportadas pelo recurso; ações não suportadas = DENY mesmo para SA? 
    // Decisão: SUPER_ADMIN bypass total nas ações suportadas; unsupported ainda DENY (contrato).
    if (!supportsPermissionAction(resourceKey, action, resources)) {
      return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
    }
    return { decision: "allow", reason: "SUPER_ADMIN_BYPASS" };
  }

  if (!isKnownPermissionResource(resourceKey, resources)) {
    return { decision: "deny", reason: "UNKNOWN_RESOURCE" };
  }
  if (!isKnownPermissionAction(action)) {
    return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
  }
  if (!supportsPermissionAction(resourceKey, action, resources)) {
    return { decision: "deny", reason: "UNSUPPORTED_ACTION" };
  }

  // Parent explícito deny(view) bloqueia subárvore (navegação + API)
  for (const ancestor of listPermissionAncestors(resourceKey, resources)) {
    if (localDecision(subject, ancestor, "view") === "deny") {
      return { decision: "deny", reason: "ANCESTOR_VIEW_DENY" };
    }
  }

  const local = localDecision(subject, resourceKey, action as PermissionContractAction);
  if (local === "deny") {
    return { decision: "deny", reason: "OVERRIDE_DENY" };
  }
  if (local === "allow") {
    const fromOverride = subject.overrides?.[resourceKey]?.[action as PermissionContractAction];
    return {
      decision: "allow",
      reason: fromOverride === "allow" ? "OVERRIDE_ALLOW" : "BASELINE_ALLOW",
    };
  }

  // ausência = herdar; baseline já consultado → default DENY
  return { decision: "deny", reason: "DEFAULT_DENY" };
}

export function canPerformPermissionTruth(
  subject: PermissionTruthSubject,
  resourceKey: string,
  action: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  return resolvePermissionTruth(subject, resourceKey, action, resources).decision === "allow";
}

function hasViewAllow(
  subject: PermissionTruthSubject,
  resourceKey: string,
  resources: readonly PermissionContractResource[]
): boolean {
  return canPerformPermissionTruth(subject, resourceKey, "view", resources);
}

/**
 * Navegação / accordion: recurso revelável se
 * - tem view allow efetivo, OU
 * - é ancestral “virtual” de algum descendente com view allow, E não tem deny view local/ancestral.
 *
 * Não concede canPerform no parent genérico.
 */
export function canRevealPermissionNavigation(
  subject: PermissionTruthSubject,
  resourceKey: string,
  resources: readonly PermissionContractResource[] = PERMISSION_CONTRACT_RESOURCES
): boolean {
  if (!isKnownPermissionResource(resourceKey, resources)) return false;

  if (isSuperAdmin(subject.role)) {
    return supportsPermissionAction(resourceKey, "view", resources);
  }

  // Ancestral com deny view bloqueia
  for (const ancestor of listPermissionAncestors(resourceKey, resources)) {
    if (localDecision(subject, ancestor, "view") === "deny") return false;
  }
  if (localDecision(subject, resourceKey, "view") === "deny") return false;

  if (hasViewAllow(subject, resourceKey, resources)) return true;

  for (const desc of listPermissionDescendants(resourceKey, resources)) {
    if (hasViewAllow(subject, desc, resources)) return true;
  }
  return false;
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
      canPerformView: false, // Financeiro geral / APIs finance.view
      canRevealNavigation: true, // parent estritamente necessário (virtual)
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
