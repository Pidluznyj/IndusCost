/**
 * Satisfação de Clientes — contratos, limites e validadores PUROS.
 *
 * Nada aqui toca Prisma, rede ou `process.env`: é a camada que os testes usam
 * para provar as regras sem banco. Serviços `.server.ts` importam daqui.
 */

// ─── Questionário histórico V1 ──────────────────────────────────────────────

export const SATISFACTION_TEMPLATE_V1_CODE = "CUSTOMER_SATISFACTION_V1" as const;

/** Escala histórica — congelada. Alterar aqui quebra a comparabilidade da série. */
export const SATISFACTION_RATING_MIN = 1 as const;
export const SATISFACTION_RATING_MAX = 5 as const;

export const SATISFACTION_RATING_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: "Ruim",
  2: "Regular",
  3: "Bom",
  4: "Ótimo",
  5: "Excelente",
});

/**
 * Os seis critérios avaliativos do V1, na ordem histórica. São `code` estáveis:
 * comparação entre campanhas usa o code, NUNCA o texto nem a posição.
 */
export const SATISFACTION_V1_RATING_CODES = [
  "COMMERCIAL_SERVICE",
  "QUOTE_ORDER_RESPONSE_TIME",
  "DELIVERY_DEADLINE",
  "ORDER_CONFORMITY",
  "PRODUCT_QUALITY",
  "TECHNICAL_SUPPORT",
] as const;

export type SatisfactionRatingCode = (typeof SATISFACTION_V1_RATING_CODES)[number];

export const SATISFACTION_V1_IDENTIFICATION_CODES = [
  "CUSTOMER_NAME",
  "TAX_ID",
  "CONTACT_PHONE",
  "SURVEY_DATE",
  "RESPONDENT_NAME",
] as const;

export const SATISFACTION_V1_OPEN_FEEDBACK_CODE = "OPEN_FEEDBACK" as const;

/** Rótulos curtos para dashboard/critérios (o label completo vive no snapshot). */
export const SATISFACTION_RATING_CODE_SHORT_LABELS: Readonly<
  Record<SatisfactionRatingCode, string>
> = Object.freeze({
  COMMERCIAL_SERVICE: "Atendimento comercial",
  QUOTE_ORDER_RESPONSE_TIME: "Tempo de resposta",
  DELIVERY_DEADLINE: "Prazo de entrega",
  ORDER_CONFORMITY: "Conformidade do pedido",
  PRODUCT_QUALITY: "Qualidade do produto",
  TECHNICAL_SUPPORT: "Suporte técnico",
});

export const SATISFACTION_QUESTION_TYPES = [
  "RATING",
  "TEXT",
  "SHORT_TEXT",
  "PHONE",
  "DATE",
  "TAX_ID",
] as const;
export type SatisfactionQuestionTypeValue = (typeof SATISFACTION_QUESTION_TYPES)[number];

export const SATISFACTION_CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "OPEN",
  "CLOSED",
  "ARCHIVED",
] as const;
export type SatisfactionCampaignStatusValue = (typeof SATISFACTION_CAMPAIGN_STATUSES)[number];

export const SATISFACTION_RESPONSE_STATUSES = ["DRAFT", "SUBMITTED"] as const;
export type SatisfactionResponseStatusValue = (typeof SATISFACTION_RESPONSE_STATUSES)[number];

export const SATISFACTION_RESPONSE_SOURCES = [
  "INDIVIDUAL_LINK",
  "GENERAL_LINK",
  "GOOGLE_FORMS_IMPORT",
] as const;
export type SatisfactionResponseSourceValue = (typeof SATISFACTION_RESPONSE_SOURCES)[number];

/** Estado derivado do convite — calculado SÓ aqui; backend e UI leem o mesmo. */
export const SATISFACTION_INVITATION_STATUSES = [
  "NOT_OPENED",
  "OPENED",
  "STARTED",
  "COMPLETED",
  "REVOKED",
] as const;
export type SatisfactionInvitationStatusValue =
  (typeof SATISFACTION_INVITATION_STATUSES)[number];

// ─── Limites de input (server-side; React não é controle de segurança) ──────

export const SATISFACTION_INPUT_LIMITS = Object.freeze({
  respondentName: 160,
  companyName: 200,
  taxId: 18,
  phone: 32,
  openFeedback: 4000,
  campaignName: 160,
  campaignCode: 60,
  campaignDescription: 1000,
  idempotencyKey: 120,
  /** Corpo aceito nas rotas públicas (bytes). */
  publicBodyBytes: 64 * 1024,
});

// ─── Erro de contrato ───────────────────────────────────────────────────────

export class SatisfactionContractError extends Error {
  readonly field?: string;
  readonly code: string;

  constructor(message: string, options?: { field?: string; code?: string }) {
    super(message);
    this.name = "SatisfactionContractError";
    this.field = options?.field;
    this.code = options?.code ?? "INVALID_INPUT";
  }
}

// ─── Normalizadores ─────────────────────────────────────────────────────────

const DIACRITICS = /[\u0300-\u036F]/g;

export function normalizeText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

/** Mantém só dígitos — casa CNPJ/CPF sem depender de máscara. */
export function normalizeTaxIdDigits(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D+/g, "");
  return digits.length > 0 ? digits : null;
}

/**
 * Chave de comparação de razão social: sem acento, sem pontuação, sem caixa e
 * sem sufixos societários — "Indústria Açúcar LTDA" e "industria acucar" casam.
 */
export function normalizeCompanyNameKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const key = raw
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(
      /\b(ltda|me|epp|eireli|s\/a|sa|cia|comercio|comercial|industria|industrial)\b/g,
      " "
    )
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return key || null;
}

// ─── Rating ─────────────────────────────────────────────────────────────────

/**
 * Rating válido = inteiro dentro da escala. Qualquer outra coisa (0, "", null,
 * 4.5, "5") é rejeitada — nunca convertida silenciosamente.
 */
export function isValidRating(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SATISFACTION_RATING_MIN &&
    value <= SATISFACTION_RATING_MAX
  );
}

export function parseRating(value: unknown, field: string): number {
  if (!isValidRating(value)) {
    throw new SatisfactionContractError(
      `Nota inválida em "${field}": use um inteiro de ${SATISFACTION_RATING_MIN} a ${SATISFACTION_RATING_MAX}.`,
      { field, code: "INVALID_RATING" }
    );
  }
  return value;
}

export function getRatingLabel(value: number): string {
  return SATISFACTION_RATING_LABELS[value] ?? String(value);
}

// ─── Máquina de estados da campanha ─────────────────────────────────────────

const CAMPAIGN_TRANSITIONS: Readonly<
  Record<SatisfactionCampaignStatusValue, readonly SatisfactionCampaignStatusValue[]>
> = Object.freeze({
  DRAFT: ["SCHEDULED", "OPEN"],
  SCHEDULED: ["OPEN", "CLOSED"],
  OPEN: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
  ARCHIVED: [],
});

export function canTransitionCampaign(
  from: SatisfactionCampaignStatusValue,
  to: SatisfactionCampaignStatusValue
): boolean {
  return (CAMPAIGN_TRANSITIONS[from] ?? []).includes(to);
}

export function assertCampaignTransition(
  from: SatisfactionCampaignStatusValue,
  to: SatisfactionCampaignStatusValue
): void {
  if (!canTransitionCampaign(from, to)) {
    throw new SatisfactionContractError(`Transição de campanha inválida: ${from} → ${to}.`, {
      code: "INVALID_TRANSITION",
    });
  }
}

/** Depois de publicada, o questionário e o período avaliado ficam congelados. */
export function isCampaignSemanticallyLocked(
  status: SatisfactionCampaignStatusValue,
  publishedAt: Date | null | undefined
): boolean {
  return publishedAt != null || status !== "DRAFT";
}

/** Só um DRAFT nunca publicado e sem dependências pode ser excluído. */
export function canDeleteCampaign(input: {
  status: SatisfactionCampaignStatusValue;
  publishedAt: Date | null;
  invitationCount: number;
  responseCount: number;
}): boolean {
  return (
    input.status === "DRAFT" &&
    input.publishedAt == null &&
    input.invitationCount === 0 &&
    input.responseCount === 0
  );
}

/**
 * A campanha aceita resposta AGORA? Status manda; a janela opensAt/closesAt
 * refina. Sem janela = sem restrição temporal.
 */
export function isCampaignAcceptingResponses(
  campaign: {
    status: SatisfactionCampaignStatusValue;
    opensAt: Date | null;
    closesAt: Date | null;
  },
  now: Date
): boolean {
  if (campaign.status !== "OPEN") return false;
  if (campaign.opensAt && now < campaign.opensAt) return false;
  if (campaign.closesAt && now > campaign.closesAt) return false;
  return true;
}

/** Motivo de indisponibilidade — vira mensagem amigável no formulário público. */
export type SatisfactionUnavailableReason =
  | "NOT_OPEN"
  | "NOT_STARTED"
  | "CLOSED"
  | "ALREADY_ANSWERED"
  | "REVOKED"
  | "EXPIRED"
  | "INVALID";

export function resolveCampaignUnavailableReason(
  campaign: {
    status: SatisfactionCampaignStatusValue;
    opensAt: Date | null;
    closesAt: Date | null;
  },
  now: Date
): SatisfactionUnavailableReason | null {
  if (campaign.status === "SCHEDULED") return "NOT_STARTED";
  if (campaign.status === "CLOSED" || campaign.status === "ARCHIVED") return "CLOSED";
  if (campaign.status !== "OPEN") return "NOT_OPEN";
  if (campaign.opensAt && now < campaign.opensAt) return "NOT_STARTED";
  if (campaign.closesAt && now > campaign.closesAt) return "CLOSED";
  return null;
}

// ─── Estado derivado do convite ─────────────────────────────────────────────

/**
 * Fonte ÚNICA do status do convite. O frontend não recalcula — consome este
 * valor via DTO, para não existirem duas verdades.
 */
export function resolveInvitationStatus(invitation: {
  revokedAt: Date | null;
  completedAt: Date | null;
  startedAt: Date | null;
  firstOpenedAt: Date | null;
}): SatisfactionInvitationStatusValue {
  if (invitation.revokedAt) return "REVOKED";
  if (invitation.completedAt) return "COMPLETED";
  if (invitation.startedAt) return "STARTED";
  if (invitation.firstOpenedAt) return "OPENED";
  return "NOT_OPENED";
}

export const SATISFACTION_INVITATION_STATUS_LABELS: Readonly<
  Record<SatisfactionInvitationStatusValue, string>
> = Object.freeze({
  NOT_OPENED: "Não abriu",
  OPENED: "Abriu",
  STARTED: "Começou",
  COMPLETED: "Respondeu",
  REVOKED: "Revogado",
});

// ─── Validação de respostas ─────────────────────────────────────────────────

export type SatisfactionQuestionSpec = {
  id: string;
  code: string;
  label: string;
  type: SatisfactionQuestionTypeValue;
  sortOrder: number;
  required: boolean;
  scaleMin: number | null;
  scaleMax: number | null;
};

export type SatisfactionAnswerInput = {
  questionCode: string;
  ratingValue?: number | null;
  textValue?: string | null;
  dateValue?: string | null;
};

export type SatisfactionValidatedAnswer = {
  questionId: string;
  questionCode: string;
  ratingValue: number | null;
  textValue: string | null;
  dateValue: Date | null;
};

export type SatisfactionValidationIssue = {
  questionCode: string;
  code: "REQUIRED_MISSING" | "INVALID_RATING" | "INVALID_DATE" | "UNKNOWN_QUESTION";
  message: string;
};

export type SatisfactionValidationResult =
  | { ok: true; answers: SatisfactionValidatedAnswer[] }
  | { ok: false; issues: SatisfactionValidationIssue[] };

export function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Valida respostas contra o snapshot de perguntas da campanha.
 *
 * `enforceRequired` é false no autosave (rascunho pode estar incompleto) e true
 * no submit. Pergunta sem valor NÃO vira linha — a ausência é a representação
 * oficial de "não respondido".
 */
export function validateAnswers(
  questions: readonly SatisfactionQuestionSpec[],
  answers: readonly SatisfactionAnswerInput[],
  options: { enforceRequired: boolean }
): SatisfactionValidationResult {
  const byCode = new Map(questions.map((q) => [q.code, q]));
  const issues: SatisfactionValidationIssue[] = [];
  const validatedByCode = new Map<string, SatisfactionValidatedAnswer>();

  for (const answer of answers) {
    const question = byCode.get(answer.questionCode);
    if (!question) {
      issues.push({
        questionCode: answer.questionCode,
        code: "UNKNOWN_QUESTION",
        message: `Pergunta desconhecida nesta campanha: ${answer.questionCode}.`,
      });
      continue;
    }

    let ratingValue: number | null = null;
    let textValue: string | null = null;
    let dateValue: Date | null = null;

    if (question.type === "RATING") {
      const raw = answer.ratingValue;
      if (raw != null) {
        if (!isValidRating(raw)) {
          issues.push({
            questionCode: question.code,
            code: "INVALID_RATING",
            message: `"${question.label}": use um inteiro de ${SATISFACTION_RATING_MIN} a ${SATISFACTION_RATING_MAX}.`,
          });
          continue;
        }
        ratingValue = raw;
      }
    } else if (question.type === "DATE") {
      if (answer.dateValue != null && String(answer.dateValue).trim() !== "") {
        const parsed = parseIsoDate(answer.dateValue);
        if (!parsed) {
          issues.push({
            questionCode: question.code,
            code: "INVALID_DATE",
            message: `"${question.label}": data inválida.`,
          });
          continue;
        }
        dateValue = parsed;
      }
    } else {
      const maxLength =
        question.type === "TEXT"
          ? SATISFACTION_INPUT_LIMITS.openFeedback
          : question.type === "PHONE"
            ? SATISFACTION_INPUT_LIMITS.phone
            : question.type === "TAX_ID"
              ? SATISFACTION_INPUT_LIMITS.taxId
              : SATISFACTION_INPUT_LIMITS.companyName;
      textValue = normalizeText(answer.textValue, maxLength);
    }

    if (ratingValue == null && textValue == null && dateValue == null) {
      // Valor vazio: remove qualquer resposta anterior do mesmo código no payload.
      validatedByCode.delete(question.code);
      continue;
    }

    // Última ocorrência vence — payload duplicado não gera duas linhas.
    validatedByCode.set(question.code, {
      questionId: question.id,
      questionCode: question.code,
      ratingValue,
      textValue,
      dateValue,
    });
  }

  if (options.enforceRequired) {
    for (const question of questions) {
      if (!question.required) continue;
      if (validatedByCode.has(question.code)) continue;
      issues.push({
        questionCode: question.code,
        code: "REQUIRED_MISSING",
        message: `"${question.label}" é obrigatório.`,
      });
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  const ordered = [...validatedByCode.values()].sort((a, b) => {
    const oa = byCode.get(a.questionCode)?.sortOrder ?? 0;
    const ob = byCode.get(b.questionCode)?.sortOrder ?? 0;
    return oa - ob;
  });
  return { ok: true, answers: ordered };
}

// ─── Parsers de entrada administrativa ──────────────────────────────────────

export type SatisfactionCampaignCreateInput = {
  name: string;
  code: string;
  description: string | null;
  referenceStart: Date;
  referenceEnd: Date;
  opensAt: Date | null;
  closesAt: Date | null;
  allowGeneralLink: boolean;
};

function requiredDate(raw: unknown, field: string): Date {
  const parsed = parseIsoDate(raw);
  if (!parsed) {
    throw new SatisfactionContractError(`Informe uma data válida em "${field}".`, {
      field,
      code: "INVALID_DATE",
    });
  }
  return parsed;
}

/** Código estável a partir do nome — usado quando o usuário não informa um. */
export function slugifyCampaignCode(name: string, referenceStart: Date): string {
  const base = name
    .normalize("NFD")
    .replace(DIACRITICS, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  const year = String(referenceStart.getUTCFullYear());
  const prefix = base || "PESQUISA";
  // Nome que ja cita o ano ("Satisfacao 2026") nao repete o sufixo.
  return prefix.includes(year) ? prefix : `${prefix}_${year}`;
}

export function parseCampaignCreateInput(body: unknown): SatisfactionCampaignCreateInput {
  const raw = (body ?? {}) as Record<string, unknown>;

  const name = normalizeText(raw.name, SATISFACTION_INPUT_LIMITS.campaignName);
  if (!name) {
    throw new SatisfactionContractError("Informe o nome da pesquisa.", { field: "name" });
  }

  const referenceStart = requiredDate(raw.referenceStart, "referenceStart");
  const referenceEnd = requiredDate(raw.referenceEnd, "referenceEnd");
  if (referenceEnd < referenceStart) {
    throw new SatisfactionContractError(
      "O fim do período de referência não pode ser anterior ao início.",
      { field: "referenceEnd", code: "INVALID_RANGE" }
    );
  }

  const opensAt = parseIsoDate(raw.opensAt);
  const closesAt = parseIsoDate(raw.closesAt);
  if (opensAt && closesAt && closesAt < opensAt) {
    throw new SatisfactionContractError("O encerramento não pode ser anterior à abertura.", {
      field: "closesAt",
      code: "INVALID_RANGE",
    });
  }

  const explicitCode = normalizeText(raw.code, SATISFACTION_INPUT_LIMITS.campaignCode)
    ?.toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_");

  return {
    name,
    code: explicitCode || slugifyCampaignCode(name, referenceStart),
    description: normalizeText(raw.description, SATISFACTION_INPUT_LIMITS.campaignDescription),
    referenceStart,
    referenceEnd,
    opensAt,
    closesAt,
    allowGeneralLink: raw.allowGeneralLink === true,
  };
}

export type SatisfactionCampaignUpdateInput = Partial<
  Omit<SatisfactionCampaignCreateInput, "code">
>;

export function parseCampaignUpdateInput(body: unknown): SatisfactionCampaignUpdateInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  const out: SatisfactionCampaignUpdateInput = {};

  if (raw.name !== undefined) {
    const name = normalizeText(raw.name, SATISFACTION_INPUT_LIMITS.campaignName);
    if (!name) {
      throw new SatisfactionContractError("Informe o nome da pesquisa.", { field: "name" });
    }
    out.name = name;
  }
  if (raw.description !== undefined) {
    out.description = normalizeText(
      raw.description,
      SATISFACTION_INPUT_LIMITS.campaignDescription
    );
  }
  if (raw.referenceStart !== undefined) {
    out.referenceStart = requiredDate(raw.referenceStart, "referenceStart");
  }
  if (raw.referenceEnd !== undefined) {
    out.referenceEnd = requiredDate(raw.referenceEnd, "referenceEnd");
  }
  if (raw.opensAt !== undefined) out.opensAt = parseIsoDate(raw.opensAt);
  if (raw.closesAt !== undefined) out.closesAt = parseIsoDate(raw.closesAt);
  if (raw.allowGeneralLink !== undefined) out.allowGeneralLink = raw.allowGeneralLink === true;

  if (out.referenceStart && out.referenceEnd && out.referenceEnd < out.referenceStart) {
    throw new SatisfactionContractError(
      "O fim do período de referência não pode ser anterior ao início.",
      { field: "referenceEnd", code: "INVALID_RANGE" }
    );
  }

  return out;
}

// ─── Parsers da superfície pública ──────────────────────────────────────────

export type SatisfactionSubmitInput = {
  answers: SatisfactionAnswerInput[];
  respondentName: string | null;
  respondentPhone: string | null;
  declaredCompanyName: string | null;
  declaredTaxId: string | null;
  idempotencyKey: string | null;
  turnstileToken: string | null;
};

export function parseAnswersPayload(raw: unknown): SatisfactionAnswerInput[] {
  if (!Array.isArray(raw)) return [];
  const out: SatisfactionAnswerInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const questionCode = normalizeText(item.questionCode, 80);
    if (!questionCode) continue;
    out.push({
      questionCode,
      ratingValue: typeof item.ratingValue === "number" ? item.ratingValue : null,
      textValue: typeof item.textValue === "string" ? item.textValue : null,
      dateValue: typeof item.dateValue === "string" ? item.dateValue : null,
    });
  }
  return out;
}

export function parseSubmitInput(body: unknown): SatisfactionSubmitInput {
  const raw = (body ?? {}) as Record<string, unknown>;
  return {
    answers: parseAnswersPayload(raw.answers),
    respondentName: normalizeText(raw.respondentName, SATISFACTION_INPUT_LIMITS.respondentName),
    respondentPhone: normalizeText(raw.respondentPhone, SATISFACTION_INPUT_LIMITS.phone),
    declaredCompanyName: normalizeText(
      raw.declaredCompanyName,
      SATISFACTION_INPUT_LIMITS.companyName
    ),
    declaredTaxId: normalizeText(raw.declaredTaxId, SATISFACTION_INPUT_LIMITS.taxId),
    idempotencyKey: normalizeText(raw.idempotencyKey, SATISFACTION_INPUT_LIMITS.idempotencyKey),
    turnstileToken: normalizeText(raw.turnstileToken, 4096),
  };
}
