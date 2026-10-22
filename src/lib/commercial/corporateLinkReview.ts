/**
 * Confirmação administrativa de vínculo entre clientes.
 * Não confirma pelo nome. SUPER_ADMIN sem a permissão explícita não confirma.
 * A exceção de um CNPJ não é este módulo: cada cliente continua com a sua.
 */

import {
  COMMERCIAL_CREDIT_EXCEPTION_MIN_JUSTIFICATION,
  resolveCommercialCreditExceptionPermission,
} from "./commercialCreditDecision.js";

export const CORPORATE_LINK_ACTIONS = ["confirm", "reject", "close"] as const;
export type CorporateLinkAction = (typeof CORPORATE_LINK_ACTIONS)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assessCorporateLinkReview(input: {
  actor: { role: string; assignedPermissions: readonly string[] };
  subjectCustomerId: string;
  relatedCustomerId: string;
  action: string;
  justification: string;
}):
  | { ok: true; action: CorporateLinkAction; permission: string; justification: string }
  | { ok: false; code: string; message: string } {
  const permission = resolveCommercialCreditExceptionPermission(input.actor);
  if (!permission.ok) {
    return {
      ok: false,
      code: permission.code,
      message: "Confirmar ou rejeitar vínculo exige permissão explícita de Financeiro ou Diretoria.",
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
    permission: permission.permission,
    justification,
  };
}
