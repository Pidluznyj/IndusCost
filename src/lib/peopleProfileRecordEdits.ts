/**
 * Correção de registros da ficha funcional — parsing/validação dos corpos PATCH.
 * Browser-safe — sem Prisma/fs.
 * PATCH é parcial: só as chaves presentes entram no patch; `null` (ou "") limpa coluna anulável.
 * Mensagens nunca ecoam o valor recebido (valores monetários / PII).
 */

import { PeopleProfileAccessError } from "./peopleProfileErrors.js";
import {
  HR_ABSENCE_STATUSES,
  HR_ABSENCE_TYPES,
  HR_COMPENSATION_ADJUSTMENT_TYPES,
  HR_EMPLOYEE_BENEFIT_STATUSES,
  HR_NOTE_CATEGORIES,
  PEOPLE_CAREER_EDITABLE_EVENT_TYPES,
  PEOPLE_CAREER_RECLASSIFIABLE_EVENT_TYPES,
  type HrAbsenceStatus,
  type HrAbsenceType,
  type HrCompensationAdjustmentType,
  type HrEmployeeBenefitStatus,
  type HrNoteCategory,
} from "./peopleProfileTypes.js";

export const PEOPLE_RECORD_TEXT_LIMITS = {
  reason: 500,
  notes: 2000,
  planName: 160,
  contactName: 160,
  phone: 40,
  relationship: 80,
  epiItem: 200,
  epiSize: 40,
  responsibleName: 160,
  documentType: 80,
  documentDisplayName: 200,
  noteBody: 8000,
  careerLabel: 200,
} as const;

export const PEOPLE_PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;

export type PeopleProfilePhotoContentType = "image/jpeg" | "image/png" | "image/webp";

export const PEOPLE_PROFILE_PHOTO_EXTENSIONS: Record<PeopleProfilePhotoContentType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function fail(code: string, message: string): never {
  throw new PeopleProfileAccessError(code, message, 400);
}

/** Tipo real da imagem pelos magic bytes — o mimetype declarado pelo cliente não é confiável. */
export function sniffImageContentType(bytes: Uint8Array): PeopleProfilePhotoContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((b, i) => bytes[i] === b)) return "image/png";
  const ascii = (start: number, text: string) =>
    bytes.length >= start + text.length &&
    [...text].every((ch, i) => bytes[start + i] === ch.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "image/webp";
  return null;
}

/**
 * URL da foto com versão derivada da chave de armazenamento (prefixo aleatório do arquivo):
 * trocar a foto troca a URL e o <img> não reaproveita a imagem antiga.
 */
export function buildEmployeePhotoUrl(employeeId: string, storageKey: string): string {
  const fileName = storageKey.replace(/\\/g, "/").split("/").pop() ?? "";
  const version = /^([0-9a-f]{8})-/i.exec(fileName)?.[1] ?? null;
  const base = `/api/employees/${employeeId}/photo`;
  return version ? `${base}?v=${version.toLowerCase()}` : base;
}

// ---------------------------------------------------------------------------
// Normalizadores de valor (também usados pelos POST).
// ---------------------------------------------------------------------------

export function normalizeOptionalText(value: unknown, label: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail("INVALID_FIELD", `${label}: valor inválido.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > max) fail("FIELD_TOO_LONG", `${label}: máximo de ${max} caracteres.`);
  return trimmed;
}

export function normalizeRequiredText(value: unknown, label: string, max: number): string {
  const text = normalizeOptionalText(value, label, max);
  if (!text) fail("REQUIRED_FIELD", `Campo obrigatório: ${label}.`);
  return text;
}

export function normalizeOptionalDate(value: unknown, label: string): Date | null {
  if (value == null || value === "") return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) fail("INVALID_DATE", `${label}: data inválida.`);
  return parsed;
}

export function normalizeRequiredDate(value: unknown, label: string): Date {
  const parsed = normalizeOptionalDate(value, label);
  if (!parsed) fail("INVALID_DATE", `${label}: data inválida.`);
  return parsed;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Teto de valor monetário aceito nos registros (as colunas são Decimal(20,6)). */
export const PEOPLE_RECORD_MAX_AMOUNT = 999_999_999.99;

/** `percentage` é Decimal(10,6): |valor| precisa ficar abaixo de 10000. */
export const PEOPLE_ADJUSTMENT_MAX_ABS_PERCENTAGE = 9_999.99;

/** Valor monetário: finito, >= 0 e dentro do teto. */
export function normalizeOptionalAmount(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const n = toFiniteNumber(value);
  if (n == null || n < 0) fail("INVALID_AMOUNT", `${label}: valor inválido.`);
  if (n > PEOPLE_RECORD_MAX_AMOUNT) fail("INVALID_AMOUNT", `${label}: valor acima do limite.`);
  return n;
}

/**
 * Percentual digitado pelo usuário fora da coluna (ex.: valor anterior 30 → novo 3300) vira 400
 * com dica, em vez de estourar no banco como 500.
 */
export function assertAdjustmentPercentageInRange(percentage: number | null): number | null {
  if (percentage != null && Math.abs(percentage) > PEOPLE_ADJUSTMENT_MAX_ABS_PERCENTAGE) {
    fail(
      "INVALID_AMOUNT",
      "Valor anterior e novo valor geram um percentual fora do limite. Confira os valores."
    );
  }
  return percentage;
}

export function normalizeRequiredAmount(value: unknown, label: string): number {
  const n = normalizeOptionalAmount(value, label);
  if (n == null) fail("INVALID_AMOUNT", `${label}: valor inválido.`);
  return n;
}

/** Quantidade de EPI: inteiro >= 1. */
export function normalizeQuantity(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n == null || !Number.isInteger(n) || n < 1) {
    fail("INVALID_QUANTITY", "Quantidade: informe um número inteiro maior ou igual a 1.");
  }
  return n;
}

/** Prioridade do contato de emergência: inteiro 1..9. */
export function normalizePriority(value: unknown): number {
  const n = toFiniteNumber(value);
  if (n == null || !Number.isInteger(n) || n < 1 || n > 9) {
    fail("INVALID_PRIORITY", "Prioridade: informe um número inteiro de 1 a 9.");
  }
  return n;
}

export function normalizeEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  code: string,
  label: string
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(code, `${label}: valor inválido.`);
  }
  return value as T;
}

/** Tipos aceitos em reajuste criado pelo usuário (MANUAL_EDIT é só do salvar genérico). */
export function normalizeUserCompensationType(value: unknown): HrCompensationAdjustmentType {
  const type = normalizeEnum(
    value ?? "OTHER",
    HR_COMPENSATION_ADJUSTMENT_TYPES,
    "INVALID_TYPE",
    "Tipo de reajuste"
  );
  if (type === "MANUAL_EDIT") fail("INVALID_TYPE", "Tipo de reajuste: valor inválido.");
  return type;
}

export function normalizeAbsenceType(value: unknown): HrAbsenceType {
  return normalizeEnum(value, HR_ABSENCE_TYPES, "INVALID_TYPE", "Tipo de afastamento");
}

export function normalizeAbsenceStatus(value: unknown): HrAbsenceStatus {
  return normalizeEnum(value, HR_ABSENCE_STATUSES, "INVALID_STATUS", "Situação do afastamento");
}

export function normalizeNoteCategory(value: unknown): HrNoteCategory {
  return normalizeEnum(value, HR_NOTE_CATEGORIES, "INVALID_CATEGORY", "Categoria");
}

/** Fim não pode anteceder o início (compara o par já mesclado com a linha atual). */
export function assertDateRange(
  start: Date | null | undefined,
  end: Date | null | undefined,
  label = "Data de término"
): void {
  if (start && end && end.getTime() < start.getTime()) {
    fail("INVALID_DATE_RANGE", `${label}: não pode ser anterior à data de início.`);
  }
}

// ---------------------------------------------------------------------------
// Carreira — trava de tipo e reclassificação.
// ---------------------------------------------------------------------------

export function isCareerEventEditable(eventType: string): boolean {
  return (PEOPLE_CAREER_EDITABLE_EVENT_TYPES as readonly string[]).includes(eventType);
}

/** 409 HISTORY_EVENT_LOCKED para eventos que não são corrigidos pela guia Carreira. */
export function assertCareerEventEditable(eventType: string): void {
  if (isCareerEventEditable(eventType)) return;
  if (eventType === "COMPENSATION_ADJUSTMENT") {
    throw new PeopleProfileAccessError(
      "HISTORY_EVENT_LOCKED",
      "Reajustes são corrigidos na guia Remuneração.",
      409
    );
  }
  if (eventType === "INITIAL_STATE") {
    throw new PeopleProfileAccessError(
      "HISTORY_EVENT_LOCKED",
      "O estado inicial conhecido é gerado pelo sistema e não pode ser alterado.",
      409
    );
  }
  throw new PeopleProfileAccessError(
    "HISTORY_EVENT_LOCKED",
    "Este evento é gerado por outro registro da ficha e deve ser corrigido na guia de origem.",
    409
  );
}

/** Reclassificação só entre PROMOTION e ROLE_CHANGE. Devolve o tipo final. */
export function resolveCareerEventTypeChange(currentType: string, requestedType: string): string {
  if (requestedType === currentType) return currentType;
  const swappable = PEOPLE_CAREER_RECLASSIFIABLE_EVENT_TYPES as readonly string[];
  if (!swappable.includes(currentType) || !swappable.includes(requestedType)) {
    fail(
      "INVALID_EVENT_TYPE",
      "O tipo do evento só pode ser alterado entre Promoção e Alteração de cargo."
    );
  }
  return requestedType;
}

// ---------------------------------------------------------------------------
// Patches tipados.
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>;

function asBody(body: unknown): Body {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    fail("INVALID_BODY", "Dados inválidos.");
  }
  return body as Body;
}

function has(body: Body, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
}

export type CompensationAdjustmentPatch = {
  type?: HrCompensationAdjustmentType;
  effectiveDate?: Date;
  previousAmount?: number | null;
  newAmount?: number;
  reason?: string | null;
  notes?: string | null;
};

export function parseCompensationAdjustmentPatch(input: unknown): CompensationAdjustmentPatch {
  const body = asBody(input);
  const patch: CompensationAdjustmentPatch = {};
  // MANUAL_EDIT é aceito aqui: a linha automática pode ser mantida ou reclassificada.
  if (has(body, "type")) {
    patch.type = normalizeEnum(
      body.type,
      HR_COMPENSATION_ADJUSTMENT_TYPES,
      "INVALID_TYPE",
      "Tipo de reajuste"
    );
  }
  if (has(body, "effectiveDate")) {
    patch.effectiveDate = normalizeRequiredDate(body.effectiveDate, "Data de vigência");
  }
  if (has(body, "previousAmount")) {
    patch.previousAmount = normalizeOptionalAmount(body.previousAmount, "Valor anterior");
  }
  if (has(body, "newAmount")) {
    patch.newAmount = normalizeRequiredAmount(body.newAmount, "Novo valor");
  }
  if (has(body, "reason")) {
    patch.reason = normalizeOptionalText(body.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
  }
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type CareerEventPatch = {
  effectiveDate?: Date;
  reason?: string | null;
  notes?: string | null;
  eventType?: string;
};

export function parseCareerEventPatch(input: unknown): CareerEventPatch {
  const body = asBody(input);
  const patch: CareerEventPatch = {};
  if (has(body, "effectiveDate")) {
    patch.effectiveDate = normalizeRequiredDate(body.effectiveDate, "Data de vigência");
  }
  if (has(body, "reason")) {
    patch.reason = normalizeOptionalText(body.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
  }
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  if (has(body, "eventType")) {
    if (typeof body.eventType !== "string" || !body.eventType.trim()) {
      fail("INVALID_EVENT_TYPE", "Tipo de evento inválido.");
    }
    patch.eventType = body.eventType.trim();
  }
  return patch;
}

export type EmployeeBenefitPatch = {
  startDate?: Date;
  endDate?: Date | null;
  planName?: string | null;
  amount?: number | null;
  status?: HrEmployeeBenefitStatus;
  notes?: string | null;
};

/** `allowAmount: false` ignora a chave `amount` (nunca zera o valor de quem não pode vê-lo). */
export function parseEmployeeBenefitPatch(
  input: unknown,
  opts: { allowAmount: boolean }
): EmployeeBenefitPatch {
  const body = asBody(input);
  const patch: EmployeeBenefitPatch = {};
  if (has(body, "startDate")) {
    patch.startDate = normalizeRequiredDate(body.startDate, "Data de início");
  }
  if (has(body, "endDate")) patch.endDate = normalizeOptionalDate(body.endDate, "Data de término");
  if (has(body, "planName")) {
    patch.planName = normalizeOptionalText(body.planName, "Plano", PEOPLE_RECORD_TEXT_LIMITS.planName);
  }
  if (opts.allowAmount && has(body, "amount")) {
    patch.amount = normalizeOptionalAmount(body.amount, "Valor");
  }
  if (has(body, "status")) {
    patch.status = normalizeEnum(
      body.status,
      HR_EMPLOYEE_BENEFIT_STATUSES,
      "INVALID_STATUS",
      "Situação do benefício"
    );
  }
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type EmployeeAbsencePatch = {
  type?: HrAbsenceType;
  startDate?: Date;
  endDate?: Date | null;
  expectedReturn?: Date | null;
  actualReturn?: Date | null;
  status?: HrAbsenceStatus;
  reason?: string | null;
  notes?: string | null;
};

export function parseEmployeeAbsencePatch(input: unknown): EmployeeAbsencePatch {
  const body = asBody(input);
  const patch: EmployeeAbsencePatch = {};
  if (has(body, "type")) patch.type = normalizeAbsenceType(body.type);
  if (has(body, "startDate")) {
    patch.startDate = normalizeRequiredDate(body.startDate, "Data de início");
  }
  if (has(body, "endDate")) patch.endDate = normalizeOptionalDate(body.endDate, "Data de término");
  if (has(body, "expectedReturn")) {
    patch.expectedReturn = normalizeOptionalDate(body.expectedReturn, "Retorno previsto");
  }
  if (has(body, "actualReturn")) {
    patch.actualReturn = normalizeOptionalDate(body.actualReturn, "Retorno efetivo");
  }
  if (has(body, "status")) patch.status = normalizeAbsenceStatus(body.status);
  if (has(body, "reason")) {
    patch.reason = normalizeOptionalText(body.reason, "Motivo", PEOPLE_RECORD_TEXT_LIMITS.reason);
  }
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type EmergencyContactPatch = {
  name?: string;
  phone?: string;
  relationship?: string | null;
  alternatePhone?: string | null;
  priority?: number;
  notes?: string | null;
};

export function parseEmergencyContactPatch(input: unknown): EmergencyContactPatch {
  const body = asBody(input);
  const patch: EmergencyContactPatch = {};
  if (has(body, "name")) {
    patch.name = normalizeRequiredText(body.name, "Nome", PEOPLE_RECORD_TEXT_LIMITS.contactName);
  }
  if (has(body, "phone")) {
    patch.phone = normalizeRequiredText(body.phone, "Telefone", PEOPLE_RECORD_TEXT_LIMITS.phone);
  }
  if (has(body, "relationship")) {
    patch.relationship = normalizeOptionalText(
      body.relationship,
      "Parentesco",
      PEOPLE_RECORD_TEXT_LIMITS.relationship
    );
  }
  if (has(body, "alternatePhone")) {
    patch.alternatePhone = normalizeOptionalText(
      body.alternatePhone,
      "Telefone alternativo",
      PEOPLE_RECORD_TEXT_LIMITS.phone
    );
  }
  if (has(body, "priority")) patch.priority = normalizePriority(body.priority);
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type EpiDeliveryPatch = {
  item?: string;
  deliveredAt?: Date;
  quantity?: number;
  size?: string | null;
  validUntil?: Date | null;
  returnedAt?: Date | null;
  responsibleName?: string | null;
  notes?: string | null;
};

export function parseEpiDeliveryPatch(input: unknown): EpiDeliveryPatch {
  const body = asBody(input);
  const patch: EpiDeliveryPatch = {};
  if (has(body, "item")) {
    patch.item = normalizeRequiredText(body.item, "Item", PEOPLE_RECORD_TEXT_LIMITS.epiItem);
  }
  if (has(body, "deliveredAt")) {
    patch.deliveredAt = normalizeRequiredDate(body.deliveredAt, "Data de entrega");
  }
  if (has(body, "quantity")) patch.quantity = normalizeQuantity(body.quantity);
  if (has(body, "size")) {
    patch.size = normalizeOptionalText(body.size, "Tamanho", PEOPLE_RECORD_TEXT_LIMITS.epiSize);
  }
  if (has(body, "validUntil")) patch.validUntil = normalizeOptionalDate(body.validUntil, "Validade");
  if (has(body, "returnedAt")) {
    patch.returnedAt = normalizeOptionalDate(body.returnedAt, "Data de devolução");
  }
  if (has(body, "responsibleName")) {
    patch.responsibleName = normalizeOptionalText(
      body.responsibleName,
      "Responsável",
      PEOPLE_RECORD_TEXT_LIMITS.responsibleName
    );
  }
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type EmployeeDocumentPatch = {
  documentType?: string;
  displayName?: string;
  issuedAt?: Date | null;
  expiresAt?: Date | null;
  notes?: string | null;
};

export function parseEmployeeDocumentPatch(input: unknown): EmployeeDocumentPatch {
  const body = asBody(input);
  const patch: EmployeeDocumentPatch = {};
  if (has(body, "documentType")) {
    patch.documentType = normalizeRequiredText(
      body.documentType,
      "Tipo do documento",
      PEOPLE_RECORD_TEXT_LIMITS.documentType
    );
  }
  if (has(body, "displayName")) {
    patch.displayName = normalizeRequiredText(
      body.displayName,
      "Nome de exibição",
      PEOPLE_RECORD_TEXT_LIMITS.documentDisplayName
    );
  }
  if (has(body, "issuedAt")) patch.issuedAt = normalizeOptionalDate(body.issuedAt, "Data de emissão");
  if (has(body, "expiresAt")) patch.expiresAt = normalizeOptionalDate(body.expiresAt, "Validade");
  if (has(body, "notes")) {
    patch.notes = normalizeOptionalText(body.notes, "Observações", PEOPLE_RECORD_TEXT_LIMITS.notes);
  }
  return patch;
}

export type EmployeeNotePatch = {
  category?: HrNoteCategory;
  body?: string;
};

export function parseEmployeeNotePatch(input: unknown): EmployeeNotePatch {
  const body = asBody(input);
  const patch: EmployeeNotePatch = {};
  if (has(body, "category")) patch.category = normalizeNoteCategory(body.category);
  if (has(body, "body")) {
    patch.body = normalizeRequiredText(
      body.body,
      "Texto da observação",
      PEOPLE_RECORD_TEXT_LIMITS.noteBody
    );
  }
  return patch;
}
