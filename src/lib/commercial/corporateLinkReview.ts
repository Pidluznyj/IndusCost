/**
 * Confirmação administrativa de vínculo entre clientes.
 * Não confirma pelo nome. SUPER_ADMIN revisa pelo papel; os demais, pela permissão de Financeiro ou Diretoria.
 * A exceção de um CNPJ não é este módulo: cada cliente continua com a sua, e o SUPER_ADMIN segue sem concedê-la
 * pelo papel (resolveCommercialCreditExceptionPermission não muda).
 */

import {
  COMMERCIAL_CREDIT_EXCEPTION_MIN_JUSTIFICATION,
  resolveCommercialCreditExceptionPermission,
} from "./commercialCreditDecision.js";

export const CORPORATE_LINK_ACTIONS = ["confirm", "reject", "close"] as const;
export type CorporateLinkAction = (typeof CORPORATE_LINK_ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const CORPORATE_LINK_REVIEW_FORBIDDEN_MESSAGE = "Esta validação requer autorização de Financeiro ou Diretoria.";

export type CorporateLinkReviewActor = {
  role: string;
  assignedPermissions: readonly string[];
  isActive?: boolean;
};

/** Base gravada na auditoria. Pelo papel, `permission` fica nula: nenhuma chave individual é simulada. */
export type CorporateLinkReviewAuthorization =
  | { ok: true; basis: "ROLE_SUPER_ADMIN"; permission: null }
  | { ok: true; basis: "ASSIGNED_PERMISSION"; permission: string }
  | { ok: false; code: "EXCEPTION_FORBIDDEN" };

/**
 * Regra ÚNICA de quem revisa vínculo: tela (canReviewCorporateLinks), POST e varredura do Radar passam por aqui.
 * SUPER_ADMIN ativo: autorizado pelo papel, com ou sem chave atribuída.
 * Demais: permissões atribuídas (cadastro oficial), nunca a lista efetiva compacta da sessão.
 */
export function resolveCorporateLinkReviewAuthorization(actor: CorporateLinkReviewActor): CorporateLinkReviewAuthorization {
  if (actor.isActive === false) return { ok: false, code: "EXCEPTION_FORBIDDEN" };
  if (actor.role === "SUPER_ADMIN") return { ok: true, basis: "ROLE_SUPER_ADMIN", permission: null };
  const permission = resolveCommercialCreditExceptionPermission(actor);
  if (permission.ok) return { ok: true, basis: "ASSIGNED_PERMISSION", permission: permission.permission };
  return { ok: false, code: "EXCEPTION_FORBIDDEN" };
}

export function corporateLinkReviewCapability(actor: CorporateLinkReviewActor): {
  canReview: boolean;
  permission: string | null;
  reason: string | null;
} {
  const authorization = resolveCorporateLinkReviewAuthorization(actor);
  if (authorization.ok) return { canReview: true, permission: authorization.permission, reason: null };
  return { canReview: false, permission: null, reason: CORPORATE_LINK_REVIEW_FORBIDDEN_MESSAGE };
}

export function corporateLinkActionStatus(action: CorporateLinkAction): "CONFIRMED" | "REJECTED" | "CLOSED" {
  if (action === "confirm") return "CONFIRMED";
  if (action === "reject") return "REJECTED";
  return "CLOSED";
}

export function assessCorporateLinkReview(input: {
  actor: CorporateLinkReviewActor;
  subjectCustomerId: string;
  relatedCustomerId: string;
  action: string;
  justification: string;
}):
  | {
      ok: true;
      action: CorporateLinkAction;
      authorizationBasis: "ROLE_SUPER_ADMIN" | "ASSIGNED_PERMISSION";
      permission: string | null;
      justification: string;
    }
  | { ok: false; code: string; message: string } {
  const authorization = resolveCorporateLinkReviewAuthorization(input.actor);
  if (authorization.ok === false) {
    return {
      ok: false,
      code: authorization.code,
      message: CORPORATE_LINK_REVIEW_FORBIDDEN_MESSAGE,
    };
  }
  if (!UUID.test(input.subjectCustomerId) || !UUID.test(input.relatedCustomerId)) {
    return { ok: false, code: "CORPORATE_LINK_CUSTOMER", message: "Cliente do vínculo é inválido." };
  }
  if (input.subjectCustomerId === input.relatedCustomerId) {
    return { ok: false, code: "CORPORATE_LINK_SELF", message: "Uma empresa não se vincula a ela mesma." };
  }
  if (!CORPORATE_LINK_ACTIONS.includes(input.action as CorporateLinkAction)) {
    return { ok: false, code: "CORPORATE_LINK_ACTION", message: "Ação de vínculo inválida." };
  }
  const justification = input.justification.trim();
  if (justification.length < COMMERCIAL_CREDIT_EXCEPTION_MIN_JUSTIFICATION || justification.length > 2000) {
    return { ok: false, code: "CORPORATE_LINK_JUSTIFICATION", message: "O vínculo exige justificativa objetiva." };
  }
  return {
    ok: true,
    action: input.action as CorporateLinkAction,
    authorizationBasis: authorization.basis,
    permission: authorization.permission,
    justification,
  };
}
