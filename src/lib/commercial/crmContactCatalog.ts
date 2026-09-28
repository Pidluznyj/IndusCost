/**
 * Catálogo canônico do registro de contato do CRM Comercial.
 *
 * Fonte única dos códigos persistidos em `CommercialActivity` (em inglês) e dos
 * rótulos pt-BR mostrados na interface. O backend valida com
 * `validateCrmContactInput` (crmContactRegistration.server.ts) e a tela usa as
 * mesmas listas — modal, timeline, cockpit, Gestão Geral e Cliente 360. Nenhum
 * componente deve repetir estas listas nem traduzir códigos por conta própria.
 *
 * Resultado e próxima ação são códigos validados pela aplicação, sem enum
 * Prisma: `outcome` guarda o código do resultado (contatos antigos têm texto
 * livre, exibido como está) e `nextActionType` o código da próxima ação.
 */

type CrmOption<C extends string> = { readonly code: C; readonly label: string };

export const CRM_CONTACT_CHANNEL_OPTIONS = [
  { code: "WHATSAPP", label: "WhatsApp" },
  { code: "PHONE", label: "Telefone" },
  { code: "EMAIL", label: "E-mail" },
  { code: "MEETING", label: "Reunião" },
  { code: "VISIT", label: "Visita" },
  { code: "VIDEO_CALL", label: "Videochamada" },
  { code: "OTHER", label: "Outro" },
] as const;

export type CrmContactChannelCode = (typeof CRM_CONTACT_CHANNEL_OPTIONS)[number]["code"];

export const CRM_CONTACT_REASON_OPTIONS = [
  { code: "PROSPECTION", label: "Prospecção" },
  { code: "FOLLOW_UP", label: "Acompanhamento" },
  { code: "PROPOSAL", label: "Proposta" },
  { code: "NEGOTIATION", label: "Negociação" },
  { code: "POST_SALE", label: "Pós-venda" },
  { code: "REACTIVATION", label: "Reativação" },
  { code: "COMPLAINT", label: "Reclamação" },
  { code: "RELATIONSHIP", label: "Relacionamento" },
  { code: "OTHER", label: "Outros" },
] as const;

export type CrmContactReasonCode = (typeof CRM_CONTACT_REASON_OPTIONS)[number]["code"];

/**
 * Rótulo padrão de cada resultado. O mesmo código pode aparecer em mais de um
 * motivo (ex.: "Não foi possível contato") para os relatórios agregarem.
 */
export const CRM_CONTACT_RESULT_LABELS = {
  INTERESTED: "Cliente demonstrou interesse",
  NOT_INTERESTED_NOW: "Sem interesse no momento",
  REQUESTS_LATER_CONTACT: "Solicita contato posterior",
  REQUESTS_PRESENTATION: "Solicita apresentação ou catálogo",
  REQUESTS_QUOTE: "Solicita orçamento",
  UNREACHABLE: "Não foi possível contato",
  INVALID_CONTACT: "Contato inválido",
  CUSTOMER_RESPONDED: "Cliente respondeu",
  AWAITING_DECISION: "Aguardando decisão",
  REQUESTS_NEW_CONTACT: "Solicita novo contato",
  REQUESTS_PROPOSAL_REVISION: "Solicita revisão de proposta",
  NEGOTIATION_ADVANCED: "Negociação avançou",
  NEGOTIATION_ENDED: "Negociação encerrada",
  PROPOSAL_PRESENTED: "Proposta apresentada",
  PROPOSAL_ACCEPTED: "Proposta aceita",
  PROPOSAL_REJECTED: "Proposta recusada",
  REQUESTS_PRICE_REVISION: "Solicita revisão de preço",
  REQUESTS_TERM_REVISION: "Solicita revisão de prazo",
  REQUESTS_QUANTITY_CHANGE: "Solicita alteração de quantidade",
  AWAITING_CUSTOMER_APPROVAL: "Aguardando aprovação interna do cliente",
  AWAITING_REPLY: "Aguardando retorno",
  NEGOTIATION_WON: "Negociação fechada",
  NEGOTIATION_LOST: "Negociação perdida",
  REQUESTS_DISCOUNT: "Cliente solicitou desconto",
  REQUESTS_PAYMENT_CONDITION: "Cliente solicitou condição de pagamento",
  REQUESTS_DELIVERY_TERM: "Cliente solicitou prazo de entrega",
  RESUME_LATER: "Retomar posteriormente",
  CUSTOMER_SATISFIED: "Cliente satisfeito",
  CUSTOMER_HAS_QUESTION: "Cliente com dúvida",
  CUSTOMER_REPORTED_PROBLEM: "Cliente relatou problema",
  NEEDS_SUPPORT: "Necessita suporte",
  NEW_OPPORTUNITY: "Nova oportunidade identificada",
  REQUESTS_NEW_ORDER: "Solicita novo pedido",
  NO_ACTION_NEEDED: "Sem ação necessária",
  REACTIVATED: "Cliente reativado / interessado",
  NO_DEMAND_NOW: "Sem demanda no momento",
  DOES_NOT_WANT_TO_RESUME: "Não deseja retomar",
  COMPLAINT_RESOLVED: "Reclamação resolvida",
  UNDER_ANALYSIS: "Em análise",
  ROUTED_TO_QUALITY: "Encaminhada para qualidade",
  ROUTED_TO_LOGISTICS: "Encaminhada para logística",
  ROUTED_TO_FINANCE: "Encaminhada para financeiro",
  NEEDS_CUSTOMER_REPLY: "Necessita retorno ao cliente",
  RELATIONSHIP_MAINTAINED: "Relacionamento mantido",
  NEEDS_FOLLOW_UP: "Necessita acompanhamento",
  MATTER_RESOLVED: "Assunto resolvido",
  NEEDS_INTERNAL_ROUTING: "Necessita encaminhamento interno",
  OTHER_RESULT: "Outro resultado",
} as const;

export type CrmContactResultCode = keyof typeof CRM_CONTACT_RESULT_LABELS;

function result(code: CrmContactResultCode, label?: string): CrmOption<CrmContactResultCode> {
  return { code, label: label ?? CRM_CONTACT_RESULT_LABELS[code] };
}

/**
 * Resultados oferecidos por motivo, na ordem da tela. Quando o motivo usa outra
 * redação para o mesmo código, o rótulo vem daqui (ex.: Prospecção mostra
 * "Solicitar retorno posterior" para REQUESTS_LATER_CONTACT).
 */
export const CRM_CONTACT_RESULT_OPTIONS_BY_REASON: Readonly<
  Record<CrmContactReasonCode, readonly CrmOption<CrmContactResultCode>[]>
> = {
  PROSPECTION: [
    result("INTERESTED"),
    result("NOT_INTERESTED_NOW"),
    result("REQUESTS_LATER_CONTACT", "Solicitar retorno posterior"),
    result("REQUESTS_PRESENTATION"),
    result("REQUESTS_QUOTE"),
    result("UNREACHABLE"),
    result("INVALID_CONTACT"),
  ],
  FOLLOW_UP: [
    result("CUSTOMER_RESPONDED"),
    result("AWAITING_DECISION", "Aguardando decisão do cliente"),
    result("REQUESTS_NEW_CONTACT"),
    result("REQUESTS_PROPOSAL_REVISION"),
    result("NEGOTIATION_ADVANCED"),
    result("NEGOTIATION_ENDED"),
    result("UNREACHABLE"),
  ],
  PROPOSAL: [
    result("PROPOSAL_PRESENTED"),
    result("PROPOSAL_ACCEPTED"),
    result("PROPOSAL_REJECTED"),
    result("REQUESTS_PRICE_REVISION"),
    result("REQUESTS_TERM_REVISION"),
    result("REQUESTS_QUANTITY_CHANGE"),
    result("AWAITING_CUSTOMER_APPROVAL"),
    result("AWAITING_REPLY"),
  ],
  NEGOTIATION: [
    result("NEGOTIATION_ADVANCED"),
    result("NEGOTIATION_WON"),
    result("NEGOTIATION_LOST"),
    result("REQUESTS_DISCOUNT"),
    result("REQUESTS_PAYMENT_CONDITION"),
    result("REQUESTS_DELIVERY_TERM"),
    result("AWAITING_DECISION"),
    result("RESUME_LATER"),
  ],
  POST_SALE: [
    result("CUSTOMER_SATISFIED"),
    result("CUSTOMER_HAS_QUESTION"),
    result("CUSTOMER_REPORTED_PROBLEM"),
    result("NEEDS_SUPPORT"),
    result("NEW_OPPORTUNITY"),
    result("REQUESTS_NEW_ORDER"),
    result("NO_ACTION_NEEDED"),
  ],
  REACTIVATION: [
    result("REACTIVATED"),
    result("REQUESTS_QUOTE"),
    result("REQUESTS_LATER_CONTACT"),
    result("NO_DEMAND_NOW"),
    result("DOES_NOT_WANT_TO_RESUME"),
    result("UNREACHABLE"),
  ],
  COMPLAINT: [
    result("COMPLAINT_RESOLVED"),
    result("UNDER_ANALYSIS"),
    result("ROUTED_TO_QUALITY"),
    result("ROUTED_TO_LOGISTICS"),
    result("ROUTED_TO_FINANCE"),
    result("NEEDS_CUSTOMER_REPLY"),
  ],
  RELATIONSHIP: [
    result("RELATIONSHIP_MAINTAINED"),
    result("NEW_OPPORTUNITY"),
    result("REQUESTS_LATER_CONTACT", "Cliente solicita contato posterior"),
    result("NO_DEMAND_NOW", "Cliente sem demanda no momento"),
    result("NEEDS_FOLLOW_UP"),
  ],
  OTHER: [
    result("MATTER_RESOLVED"),
    result("NEEDS_FOLLOW_UP"),
    result("NEEDS_INTERNAL_ROUTING"),
    result("AWAITING_REPLY", "Aguardando cliente"),
    result("OTHER_RESULT"),
  ],
};

/** Opção terminal: todo contato classifica a próxima ação, mesmo sem nenhuma. */
export const CRM_NEXT_ACTION_NONE = "NONE";

export const CRM_NEXT_ACTION_OPTIONS = [
  { code: "CALL_AGAIN", label: "Telefonar novamente" },
  { code: "SEND_WHATSAPP", label: "Enviar WhatsApp" },
  { code: "SEND_EMAIL", label: "Enviar e-mail" },
  { code: "SEND_CATALOG", label: "Enviar catálogo" },
  { code: "SEND_PRESENTATION", label: "Enviar apresentação" },
  { code: "PREPARE_QUOTE", label: "Preparar orçamento" },
  { code: "SEND_PROPOSAL", label: "Enviar proposta" },
  { code: "REVISE_PROPOSAL", label: "Revisar proposta" },
  { code: "NEGOTIATE_PRICE", label: "Negociar preço" },
  { code: "NEGOTIATE_PAYMENT_TERMS", label: "Negociar prazo de pagamento" },
  { code: "CONFIRM_ORDER", label: "Confirmar pedido" },
  { code: "TRACK_ORDER", label: "Acompanhar pedido" },
  { code: "CHECK_DELIVERY", label: "Verificar entrega" },
  { code: "POST_SALE_CHECK", label: "Realizar pós-venda" },
  { code: "ROUTE_TO_SUPPORT", label: "Encaminhar para suporte" },
  { code: "ROUTE_TO_QUALITY", label: "Encaminhar para qualidade" },
  { code: "ROUTE_TO_LOGISTICS", label: "Encaminhar para logística" },
  { code: "ROUTE_TO_FINANCE", label: "Encaminhar para financeiro" },
  { code: "ROUTE_TO_ENGINEERING", label: "Encaminhar para engenharia" },
  { code: "REACTIVATE_CUSTOMER", label: "Reativar cliente" },
  { code: "VISIT_CUSTOMER", label: "Visitar cliente" },
  { code: "WAIT_CUSTOMER_REPLY", label: "Aguardar retorno do cliente" },
  { code: CRM_NEXT_ACTION_NONE, label: "Nenhuma ação necessária" },
] as const;

export type CrmNextActionCode = (typeof CRM_NEXT_ACTION_OPTIONS)[number]["code"];

/**
 * Próximas ações sugeridas por motivo, na ordem da tela. Relacionamento e
 * Outros não constavam da matriz comercial: Relacionamento usa as ações de
 * contato/visita e Outros oferece o catálogo inteiro.
 */
export const CRM_NEXT_ACTION_OPTIONS_BY_REASON: Readonly<
  Record<CrmContactReasonCode, readonly CrmNextActionCode[]>
> = {
  PROSPECTION: [
    "CALL_AGAIN",
    "SEND_WHATSAPP",
    "SEND_EMAIL",
    "SEND_CATALOG",
    "SEND_PRESENTATION",
    "PREPARE_QUOTE",
    "VISIT_CUSTOMER",
    "WAIT_CUSTOMER_REPLY",
    CRM_NEXT_ACTION_NONE,
  ],
  FOLLOW_UP: [
    "CALL_AGAIN",
    "SEND_WHATSAPP",
    "SEND_EMAIL",
    "REVISE_PROPOSAL",
    "WAIT_CUSTOMER_REPLY",
    "VISIT_CUSTOMER",
    CRM_NEXT_ACTION_NONE,
  ],
  PROPOSAL: [
    "SEND_PROPOSAL",
    "REVISE_PROPOSAL",
    "NEGOTIATE_PRICE",
    "NEGOTIATE_PAYMENT_TERMS",
    "CALL_AGAIN",
    "WAIT_CUSTOMER_REPLY",
    "CONFIRM_ORDER",
    CRM_NEXT_ACTION_NONE,
  ],
  NEGOTIATION: [
    "NEGOTIATE_PRICE",
    "NEGOTIATE_PAYMENT_TERMS",
    "REVISE_PROPOSAL",
    "CALL_AGAIN",
    "CONFIRM_ORDER",
    "WAIT_CUSTOMER_REPLY",
    CRM_NEXT_ACTION_NONE,
  ],
  POST_SALE: [
    "POST_SALE_CHECK",
    "TRACK_ORDER",
    "CHECK_DELIVERY",
    "ROUTE_TO_SUPPORT",
    "CALL_AGAIN",
    CRM_NEXT_ACTION_NONE,
  ],
  REACTIVATION: [
    "CALL_AGAIN",
    "SEND_WHATSAPP",
    "SEND_CATALOG",
    "PREPARE_QUOTE",
    "REACTIVATE_CUSTOMER",
    "VISIT_CUSTOMER",
    "WAIT_CUSTOMER_REPLY",
    CRM_NEXT_ACTION_NONE,
  ],
  COMPLAINT: [
    "ROUTE_TO_SUPPORT",
    "ROUTE_TO_QUALITY",
    "ROUTE_TO_LOGISTICS",
    "ROUTE_TO_FINANCE",
    "CALL_AGAIN",
    "WAIT_CUSTOMER_REPLY",
    CRM_NEXT_ACTION_NONE,
  ],
  RELATIONSHIP: [
    "CALL_AGAIN",
    "SEND_WHATSAPP",
    "SEND_EMAIL",
    "SEND_CATALOG",
    "VISIT_CUSTOMER",
    "WAIT_CUSTOMER_REPLY",
    CRM_NEXT_ACTION_NONE,
  ],
  OTHER: CRM_NEXT_ACTION_OPTIONS.map((option) => option.code),
};

/**
 * Status gravado no contato (coluna `status`). Aberto = próxima ação pendente:
 * é o que carteira, cockpit, Gestão Geral e Cliente 360 contam como follow-up.
 */
const CRM_CONTACT_STATUS_LABELS: Readonly<Record<string, string>> = {
  OPEN: "Aberto",
  DONE: "Concluído",
  WAITING: "Aguardando",
  PENDING: "Pendente",
  SCHEDULED: "Agendado",
  CANCELLED: "Cancelado",
  CANCELED: "Cancelado",
  CLOSED: "Encerrado",
};

/** Status derivado da próxima ação (mesma regra padrão da API antes do modal estruturado). */
export function deriveCrmContactStatus(nextActionType: string): "OPEN" | "DONE" {
  return nextActionType === CRM_NEXT_ACTION_NONE ? "DONE" : "OPEN";
}

// ---------------------------------------------------------------------------
// Rótulos. Código desconhecido (dado antigo em texto livre) aparece como está;
// vazio devolve null para a tela decidir o traço.
// ---------------------------------------------------------------------------

function normalizeCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase();
}

function labelFrom(
  options: readonly CrmOption<string>[],
  value: string | null | undefined
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const code = normalizeCode(raw);
  return options.find((option) => option.code === code)?.label ?? raw;
}

export function crmContactChannelLabel(value: string | null | undefined): string | null {
  return labelFrom(CRM_CONTACT_CHANNEL_OPTIONS, value);
}

export function crmContactReasonLabel(value: string | null | undefined): string | null {
  return labelFrom(CRM_CONTACT_REASON_OPTIONS, value);
}

/**
 * `activityType` do contato = motivo (a API grava o motivo, ou "CONTACT" quando
 * não havia motivo nos registros antigos).
 */
export function crmActivityTypeLabel(value: string | null | undefined): string {
  const code = normalizeCode(value);
  if (!code || code === "CONTACT") return "Contato";
  return crmContactReasonLabel(code) ?? "Contato";
}

export function crmNextActionLabel(value: string | null | undefined): string | null {
  return labelFrom(CRM_NEXT_ACTION_OPTIONS, value);
}

/**
 * Linha da próxima ação: "Enviar proposta — detalhe", só o rótulo ou só o
 * detalhamento (contatos antigos não têm ação estruturada).
 */
export function crmNextActionSummary(
  type: string | null | undefined,
  description: string | null | undefined
): string | null {
  const label = crmNextActionLabel(type);
  const detail = String(description ?? "").trim();
  if (label && detail) return `${label} — ${detail}`;
  return label || detail || null;
}

export function crmContactStatusLabel(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return CRM_CONTACT_STATUS_LABELS[normalizeCode(raw)] ?? raw;
}

/** Rótulo do resultado; com o motivo, usa a redação daquele motivo. */
export function crmContactResultLabel(
  value: string | null | undefined,
  reason?: string | null
): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const code = normalizeCode(raw);
  const reasonCode = normalizeCode(reason);
  const byReason = isCrmContactReasonCode(reasonCode)
    ? CRM_CONTACT_RESULT_OPTIONS_BY_REASON[reasonCode].find((option) => option.code === code)
    : undefined;
  if (byReason) return byReason.label;
  return code in CRM_CONTACT_RESULT_LABELS
    ? CRM_CONTACT_RESULT_LABELS[code as CrmContactResultCode]
    : raw;
}

export function isCrmContactReasonCode(value: string): value is CrmContactReasonCode {
  return CRM_CONTACT_REASON_OPTIONS.some((option) => option.code === value);
}

export function isCrmContactChannelCode(value: string): value is CrmContactChannelCode {
  return CRM_CONTACT_CHANNEL_OPTIONS.some((option) => option.code === value);
}

/** Resultados do motivo (vazio para motivo desconhecido). */
export function crmContactResultOptions(
  reason: string | null | undefined
): readonly CrmOption<CrmContactResultCode>[] {
  const code = normalizeCode(reason);
  return isCrmContactReasonCode(code) ? CRM_CONTACT_RESULT_OPTIONS_BY_REASON[code] : [];
}

/** Próximas ações do motivo, na ordem de relevância do motivo (vazio para motivo desconhecido). */
export function crmNextActionOptions(
  reason: string | null | undefined
): readonly CrmOption<CrmNextActionCode>[] {
  const code = normalizeCode(reason);
  if (!isCrmContactReasonCode(code)) return [];
  return CRM_NEXT_ACTION_OPTIONS_BY_REASON[code].flatMap((actionCode) =>
    CRM_NEXT_ACTION_OPTIONS.filter((option) => option.code === actionCode)
  );
}

/**
 * Ao trocar o motivo, resultado e próxima ação que não valem mais são limpos
 * (o usuário precisa escolher de novo). "Nenhuma ação necessária" vale em todo
 * motivo, então nunca é limpa.
 */
export function reconcileCrmContactReasonChange(input: {
  reason: string;
  result: string;
  nextActionType: string;
}): { result: string; nextActionType: string } {
  const results = crmContactResultOptions(input.reason);
  const actions = crmNextActionOptions(input.reason);
  return {
    result: results.some((option) => option.code === input.result) ? input.result : "",
    nextActionType: actions.some((option) => option.code === input.nextActionType)
      ? input.nextActionType
      : "",
  };
}

// ---------------------------------------------------------------------------
// Validação canônica (servidor e tela usam a mesma regra).
// ---------------------------------------------------------------------------

export const CRM_CONTACT_SUMMARY_MAX = 8000;
export const CRM_CONTACT_NEXT_ACTION_DESCRIPTION_MAX = 8000;
export const CRM_CONTACT_PHONE_MAX = 128;
export const CRM_CONTACT_EMAIL_MAX = 254;

/** Ordem dos campos na tela — a primeira mensagem de erro segue esta ordem. */
export const CRM_CONTACT_FIELDS = [
  "contactDate",
  "channel",
  "reason",
  "phoneUsed",
  "emailUsed",
  "result",
  "summary",
  "nextActionType",
  "nextActionAt",
  "nextActionDescription",
] as const;

export type CrmContactField = (typeof CRM_CONTACT_FIELDS)[number];

export type CrmContactFieldErrors = Partial<Record<CrmContactField, string>>;

export type CrmContactInput = Partial<Record<CrmContactField, unknown>>;

export type CrmContactValidated = {
  contactDate: Date;
  channel: CrmContactChannelCode;
  reason: CrmContactReasonCode;
  result: CrmContactResultCode;
  summary: string;
  nextActionType: CrmNextActionCode;
  /** Sempre null quando a próxima ação é "Nenhuma ação necessária". */
  nextActionAt: Date | null;
  nextActionDescription: string | null;
  phoneUsed: string | null;
  emailUsed: string | null;
};

export type CrmContactValidation =
  | { ok: true; value: CrmContactValidated }
  | { ok: false; errors: CrmContactFieldErrors };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDate(value: unknown): Date | null | "INVALID" {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "INVALID" : value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "INVALID" : parsed;
}

export function firstCrmContactError(errors: CrmContactFieldErrors): string | null {
  for (const field of CRM_CONTACT_FIELDS) {
    if (errors[field]) return errors[field] ?? null;
  }
  return null;
}

/**
 * Regras do registro de contato:
 * - data, canal, motivo, resultado, resumo e próxima ação obrigatórios;
 * - resultado e próxima ação precisam pertencer ao motivo;
 * - próxima ação real exige data/hora (não anterior ao contato) e detalhamento;
 * - "Nenhuma ação necessária" não aceita data (nunca grava data fictícia);
 * - telefone/e-mail usados são opcionais.
 */
export function validateCrmContactInput(input: CrmContactInput): CrmContactValidation {
  const errors: CrmContactFieldErrors = {};

  const contactDate = parseDate(input.contactDate);
  if (contactDate === null) errors.contactDate = "Informe a data do contato.";
  else if (contactDate === "INVALID") errors.contactDate = "Data do contato inválida.";

  const channel = normalizeCode(text(input.channel));
  if (!channel) errors.channel = "Selecione o canal.";
  else if (!isCrmContactChannelCode(channel)) errors.channel = "Canal inválido.";

  const reason = normalizeCode(text(input.reason));
  if (!reason) errors.reason = "Selecione o motivo.";
  else if (!isCrmContactReasonCode(reason)) errors.reason = "Motivo inválido.";
  const knownReason = isCrmContactReasonCode(reason);

  const resultCode = normalizeCode(text(input.result));
  if (!resultCode) {
    errors.result = "Selecione o resultado do contato.";
  } else if (knownReason && !crmContactResultOptions(reason).some((o) => o.code === resultCode)) {
    errors.result = "Resultado não se aplica ao motivo escolhido.";
  } else if (!(resultCode in CRM_CONTACT_RESULT_LABELS)) {
    errors.result = "Resultado inválido.";
  }

  const summary = text(input.summary);
  if (!summary) errors.summary = "Descreva o que foi conversado.";
  else if (summary.length > CRM_CONTACT_SUMMARY_MAX) {
    errors.summary = "Resumo muito longo (máximo de 8.000 caracteres).";
  }

  const nextActionType = normalizeCode(text(input.nextActionType));
  if (!nextActionType) {
    errors.nextActionType = "Selecione a próxima ação.";
  } else if (knownReason && !crmNextActionOptions(reason).some((o) => o.code === nextActionType)) {
    errors.nextActionType = "Próxima ação não se aplica ao motivo escolhido.";
  } else if (!CRM_NEXT_ACTION_OPTIONS.some((o) => o.code === nextActionType)) {
    errors.nextActionType = "Próxima ação inválida.";
  }

  const isNone = nextActionType === CRM_NEXT_ACTION_NONE;
  const nextActionAt = parseDate(input.nextActionAt);
  const nextActionDescription = text(input.nextActionDescription);
  if (isNone) {
    if (nextActionAt !== null) errors.nextActionAt = "Sem próxima ação, não informe data.";
  } else if (nextActionType) {
    if (nextActionAt === null) errors.nextActionAt = "Informe a data e hora da próxima ação.";
    else if (nextActionAt === "INVALID") errors.nextActionAt = "Data da próxima ação inválida.";
    else if (contactDate instanceof Date && nextActionAt.getTime() < contactDate.getTime()) {
      errors.nextActionAt = "A próxima ação não pode ser anterior ao contato.";
    }
    if (!nextActionDescription) errors.nextActionDescription = "Detalhe a próxima ação.";
  }
  if (nextActionDescription.length > CRM_CONTACT_NEXT_ACTION_DESCRIPTION_MAX) {
    errors.nextActionDescription = "Detalhamento muito longo (máximo de 8.000 caracteres).";
  }

  const phoneUsed = text(input.phoneUsed);
  if (phoneUsed.length > CRM_CONTACT_PHONE_MAX) errors.phoneUsed = "Telefone muito longo.";
  const emailUsed = text(input.emailUsed);
  if (emailUsed.length > CRM_CONTACT_EMAIL_MAX) errors.emailUsed = "E-mail muito longo.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      contactDate: contactDate as Date,
      channel: channel as CrmContactChannelCode,
      reason: reason as CrmContactReasonCode,
      result: resultCode as CrmContactResultCode,
      summary,
      nextActionType: nextActionType as CrmNextActionCode,
      nextActionAt: isNone ? null : (nextActionAt as Date),
      nextActionDescription: nextActionDescription || null,
      phoneUsed: phoneUsed || null,
      emailUsed: emailUsed || null,
    },
  };
}
