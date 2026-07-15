/**
 * Abas Pessoal e Emergência do cadastro de colaborador.
 * Normalização, validação, máscaras e redação de API (sem CEP externo).
 */

import { isValidCpf, normalizeCpfDigits, formatCpfMask } from "@/src/lib/fleetCpfUtils.js";
import {
  digitsOnly,
  maskCpf,
  maskEmail,
  maskPhone,
  normalizeEmailLoose,
} from "@/src/lib/canonicalPerson.js";
import { EmployeeRegistrationError } from "@/src/lib/employeeRegistration.js";

export {
  formatCpfMask,
  normalizeCpfDigits,
  isValidCpf,
  maskCpf,
  maskEmail,
  maskPhone,
};

const PERSONAL_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ADDRESS_LEN = 500;
const MAX_RG_LEN = 32;
const MAX_NAME_LEN = 120;
const MAX_RELATIONSHIP_LEN = 80;

export type EmployeePersonalHrFields = {
  cpf: string | null;
  rg: string | null;
  birthDate: Date | null;
  phone: string | null;
  personalEmail: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelationship: string | null;
};

export type EmployeePersonalHrPrevious = {
  cpf?: string | null;
  phone?: string | null;
  emergencyContactPhone?: string | null;
  personalEmail?: string | null;
};

function trimOrNull(value: unknown, maxLen?: number): string | null {
  if (typeof value !== "string") return null;
  let t = value.trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  if (!t) return null;
  if (maxLen && t.length > maxLen) t = t.slice(0, maxLen);
  return t;
}

export function formatPhoneBrMask(value: string): string {
  const d = digitsOnly(value).slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  }
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function formatCpfForDisplay(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = normalizeCpfDigits(value);
  if (digits.length === 11) return formatCpfMask(digits);
  return value.trim() || "—";
}

export function formatPhoneForDisplay(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = digitsOnly(value);
  if (digits.length >= 10) return formatPhoneBrMask(digits);
  return value.trim() || "—";
}

export function normalizeOptionalBirthDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00.000Z` : trimmed
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function assertBirthDateReasonable(date: Date | null): void {
  if (!date) return;
  const y = date.getUTCFullYear();
  if (y < 1900) {
    throw new EmployeeRegistrationError(
      "INVALID_BIRTH_DATE",
      "Data de nascimento inválida."
    );
  }
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const birthUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  if (birthUtc > todayUtc) {
    throw new EmployeeRegistrationError(
      "INVALID_BIRTH_DATE",
      "Data de nascimento não pode ser no futuro."
    );
  }
}

/** E-mail pessoal: lowercase; formato básico quando preenchido. */
export function normalizePersonalEmail(
  value: unknown,
  opts?: { previous?: string | null; allowLegacy?: boolean }
): string | null {
  const email = normalizeEmailLoose(value);
  if (!email) return null;
  if (PERSONAL_EMAIL_RE.test(email)) return email;
  const prev = normalizeEmailLoose(opts?.previous);
  if (opts?.allowLegacy && prev && email === prev) return email;
  throw new EmployeeRegistrationError(
    "INVALID_PERSONAL_EMAIL",
    "Informe um e-mail pessoal válido."
  );
}

/**
 * CPF: só dígitos; check digit obrigatório em valor novo/alterado.
 * Legado inválido pode permanecer se inalterado.
 */
export function normalizeEmployeeCpf(
  value: unknown,
  opts?: { previous?: string | null; allowLegacy?: boolean }
): string | null {
  const raw =
    typeof value === "string" || typeof value === "number" ? String(value) : "";
  const digits = normalizeCpfDigits(raw);
  if (!digits) return null;
  if (isValidCpf(digits)) return digits;
  const prev = normalizeCpfDigits(String(opts?.previous ?? ""));
  if (opts?.allowLegacy && prev && digits === prev) return digits;
  if (digits.length !== 11) {
    throw new EmployeeRegistrationError(
      "INVALID_CPF",
      "CPF deve ter 11 dígitos."
    );
  }
  throw new EmployeeRegistrationError("INVALID_CPF", "CPF inválido.");
}

export function normalizeEmployeePhone(
  value: unknown,
  opts?: { previous?: string | null; allowLegacy?: boolean; fieldLabel?: string }
): string | null {
  const label = opts?.fieldLabel ?? "Telefone";
  const digits = digitsOnly(value);
  if (!digits) return null;
  if (digits.length === 10 || digits.length === 11) return digits;
  const prev = digitsOnly(opts?.previous);
  if (opts?.allowLegacy && prev && digits === prev) return digits;
  throw new EmployeeRegistrationError(
    "INVALID_PHONE",
    `${label} deve ter DDD + número (10 ou 11 dígitos).`
  );
}

export function assertEmergencyContactConsistency(input: {
  name: string | null;
  phone: string | null;
  relationship: string | null;
}): void {
  const any =
    Boolean(input.name) || Boolean(input.phone) || Boolean(input.relationship);
  if (!any) return;
  if (!input.name) {
    throw new EmployeeRegistrationError(
      "EMERGENCY_NAME_REQUIRED",
      "Informe o nome do contato de emergência quando houver telefone ou relação."
    );
  }
  if (!input.phone) {
    throw new EmployeeRegistrationError(
      "EMERGENCY_PHONE_REQUIRED",
      "Informe o telefone do contato de emergência."
    );
  }
}

/**
 * Normaliza + valida abas Pessoal e Emergência para persistência.
 * Não altera payroll/EPI/profissional.
 */
export function prepareEmployeePersonalHrFields(
  body: Record<string, unknown>,
  opts?: {
    previous?: EmployeePersonalHrPrevious | null;
    allowLegacy?: boolean;
  }
): EmployeePersonalHrFields {
  const allowLegacy = opts?.allowLegacy === true;
  const prev = opts?.previous ?? null;

  const cpf = normalizeEmployeeCpf(body.cpf, {
    previous: prev?.cpf,
    allowLegacy,
  });
  const phone = normalizeEmployeePhone(body.phone, {
    previous: prev?.phone,
    allowLegacy,
    fieldLabel: "Telefone",
  });
  const personalEmail = normalizePersonalEmail(body.personalEmail, {
    previous: prev?.personalEmail,
    allowLegacy,
  });
  const rg = trimOrNull(body.rg, MAX_RG_LEN);
  const address = trimOrNull(body.address, MAX_ADDRESS_LEN);
  const birthDate = normalizeOptionalBirthDate(body.birthDate);
  assertBirthDateReasonable(birthDate);

  const emergencyContactName = trimOrNull(body.emergencyContactName, MAX_NAME_LEN);
  const emergencyContactPhone = normalizeEmployeePhone(body.emergencyContactPhone, {
    previous: prev?.emergencyContactPhone,
    allowLegacy,
    fieldLabel: "Telefone de emergência",
  });
  const emergencyContactRelationship = trimOrNull(
    body.emergencyContactRelationship,
    MAX_RELATIONSHIP_LEN
  );
  assertEmergencyContactConsistency({
    name: emergencyContactName,
    phone: emergencyContactPhone,
    relationship: emergencyContactRelationship,
  });

  return {
    cpf,
    rg,
    birthDate,
    phone,
    personalEmail,
    address,
    emergencyContactName,
    emergencyContactPhone,
    emergencyContactRelationship,
  };
}

/** Validação client-side espelhada (mensagens curtas). */
export function validateEmployeePersonalHrForm(
  input: {
    cpf?: string | null;
    phone?: string | null;
    personalEmail?: string | null;
    birthDate?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    emergencyContactRelationship?: string | null;
    rg?: string | null;
    address?: string | null;
  },
  opts?: {
    previous?: EmployeePersonalHrPrevious | null;
    allowLegacy?: boolean;
  }
): string | null {
  try {
    prepareEmployeePersonalHrFields(
      {
        cpf: input.cpf ?? "",
        phone: input.phone ?? "",
        personalEmail: input.personalEmail ?? "",
        birthDate: input.birthDate ?? "",
        rg: input.rg ?? "",
        address: input.address ?? "",
        emergencyContactName: input.emergencyContactName ?? "",
        emergencyContactPhone: input.emergencyContactPhone ?? "",
        emergencyContactRelationship: input.emergencyContactRelationship ?? "",
      },
      {
        allowLegacy: opts?.allowLegacy === true,
        previous: opts?.previous,
      }
    );
    return null;
  } catch (err) {
    if (err instanceof EmployeeRegistrationError) return err.message;
    return "Dados pessoais inválidos.";
  }
}

export const EMPLOYEE_PERSONAL_REDACT_KEYS = [
  "cpf",
  "rg",
  "birthDate",
  "phone",
  "personalEmail",
  "address",
  "emergencyContactName",
  "emergencyContactPhone",
  "emergencyContactRelationship",
] as const;

export type EmployeePersonalRedactKey = (typeof EMPLOYEE_PERSONAL_REDACT_KEYS)[number];

/**
 * Remove PII pessoal/emergência da resposta (listagem).
 * Quem tem employees.edit recebe campos completos (reveal=true).
 */
export function redactEmployeePersonalEmergencyForApi<T extends Record<string, unknown>>(
  employee: T,
  opts: { reveal: boolean }
): T & {
  personalPiiRedacted: boolean;
  emergencyContactRedacted: boolean;
  hasPersonalPii: boolean;
  hasEmergencyContact: boolean;
} {
  const hasPersonalPii = Boolean(
    employee.cpf ||
      employee.rg ||
      employee.birthDate ||
      employee.phone ||
      employee.personalEmail ||
      employee.address
  );
  const hasEmergencyContact = Boolean(
    employee.emergencyContactName ||
      employee.emergencyContactPhone ||
      employee.emergencyContactRelationship
  );

  if (opts.reveal) {
    return {
      ...employee,
      personalPiiRedacted: false,
      emergencyContactRedacted: false,
      hasPersonalPii,
      hasEmergencyContact,
    };
  }

  const next: Record<string, unknown> = { ...employee };
  for (const key of EMPLOYEE_PERSONAL_REDACT_KEYS) {
    next[key] = null;
  }
  return {
    ...(next as T),
    personalPiiRedacted: true,
    emergencyContactRedacted: true,
    hasPersonalPii,
    hasEmergencyContact,
  };
}

/** Auditoria: nunca logar CPF/telefone/endereço/emergência completos. */
export function auditPersonalHrSummary(fields: EmployeePersonalHrFields): {
  hasCpf: boolean;
  hasRg: boolean;
  hasBirthDate: boolean;
  hasPhone: boolean;
  hasPersonalEmail: boolean;
  hasAddress: boolean;
  hasEmergencyContact: boolean;
  cpfMasked: string | null;
  phoneMasked: string | null;
  personalEmailMasked: string | null;
} {
  return {
    hasCpf: Boolean(fields.cpf),
    hasRg: Boolean(fields.rg),
    hasBirthDate: Boolean(fields.birthDate),
    hasPhone: Boolean(fields.phone),
    hasPersonalEmail: Boolean(fields.personalEmail),
    hasAddress: Boolean(fields.address),
    hasEmergencyContact: Boolean(
      fields.emergencyContactName || fields.emergencyContactPhone
    ),
    cpfMasked: maskCpf(fields.cpf),
    phoneMasked: maskPhone(fields.phone),
    personalEmailMasked: maskEmail(fields.personalEmail),
  };
}
