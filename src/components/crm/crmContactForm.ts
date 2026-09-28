/**
 * Estado e regras do formulário "Registrar contato" (sem React, testável).
 *
 * A validação é a canônica do catálogo — a mesma que o servidor aplica. O
 * payload montado aqui NUNCA leva responsável, usuário ou status: o servidor
 * calcula os três (crmContactRegistration.server.ts).
 */
import {
  CRM_NEXT_ACTION_NONE,
  crmContactStatusLabel,
  deriveCrmContactStatus,
  reconcileCrmContactReasonChange,
  validateCrmContactInput,
  type CrmContactFieldErrors,
} from "@/src/lib/commercial/crmContactCatalog";

/** Resposta de GET /api/customers/:id/commercial-activities/context. */
export type CrmContactModalContext = {
  customer: {
    id: string;
    displayName: string;
    taxId: string;
    phone: string | null;
    email: string | null;
  };
  commercialOwner: {
    name: string;
    identityKey: string | null;
    externalSellerId: number | null;
  } | null;
  registeredBy: { id: string; name: string };
};

export type CrmContactFormState = {
  contactDate: string;
  channel: string;
  reason: string;
  result: string;
  summary: string;
  nextActionType: string;
  nextActionAt: string;
  nextActionDescription: string;
  phoneUsed: string;
  emailUsed: string;
};

export type CrmContactFormField = keyof CrmContactFormState;

export const CRM_CONTACT_NO_OWNER_LABEL = "Cliente sem responsável comercial";

/** Valor de `<input type="datetime-local">` no fuso do navegador. */
export function toDatetimeLocalValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** datetime-local (fuso do navegador) → ISO UTC; texto inválido segue cru para a validação acusar. */
function datetimeLocalToIso(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

/** Telefone e e-mail vêm do cadastro do cliente; resultado e próxima ação começam vazios. */
export function initialCrmContactForm(
  context: CrmContactModalContext,
  now: Date = new Date()
): CrmContactFormState {
  return {
    contactDate: toDatetimeLocalValue(now),
    channel: "WHATSAPP",
    reason: "FOLLOW_UP",
    result: "",
    summary: "",
    nextActionType: "",
    nextActionAt: "",
    nextActionDescription: "",
    phoneUsed: context.customer.phone ?? "",
    emailUsed: context.customer.email ?? "",
  };
}

/**
 * Aplica a mudança de um campo com as regras dinâmicas: trocar o motivo limpa
 * resultado/próxima ação que deixaram de valer; "Nenhuma ação necessária" limpa
 * a data (campo desabilitado, nunca data fictícia).
 */
export function applyCrmContactFieldChange(
  state: CrmContactFormState,
  field: CrmContactFormField,
  value: string
): CrmContactFormState {
  const next: CrmContactFormState = { ...state, [field]: value };
  if (field === "reason") {
    Object.assign(
      next,
      reconcileCrmContactReasonChange({
        reason: value,
        result: state.result,
        nextActionType: state.nextActionType,
      })
    );
  }
  if (field === "nextActionType" && value === CRM_NEXT_ACTION_NONE) {
    next.nextActionAt = "";
  }
  return next;
}

export function buildCrmContactPayload(state: CrmContactFormState): Record<string, string | null> {
  const isNone = state.nextActionType === CRM_NEXT_ACTION_NONE;
  return {
    contactDate: datetimeLocalToIso(state.contactDate),
    channel: state.channel,
    reason: state.reason,
    result: state.result,
    summary: state.summary,
    nextActionType: state.nextActionType,
    nextActionAt: isNone ? null : datetimeLocalToIso(state.nextActionAt),
    nextActionDescription: state.nextActionDescription,
    phoneUsed: state.phoneUsed,
    emailUsed: state.emailUsed,
  };
}

export function validateCrmContactForm(state: CrmContactFormState): CrmContactFieldErrors {
  const result = validateCrmContactInput(buildCrmContactPayload(state));
  return result.ok === false ? result.errors : {};
}

/** Status que o servidor vai gravar, para mostrar bloqueado no modal. */
export function crmContactDerivedStatusText(nextActionType: string): string | null {
  if (!nextActionType) return null;
  const label = crmContactStatusLabel(deriveCrmContactStatus(nextActionType));
  return nextActionType === CRM_NEXT_ACTION_NONE
    ? `${label} — sem próxima ação`
    : `${label} — próxima ação pendente`;
}
