/**
 * E-mail corporativo do colaborador — funções puras (sem Prisma).
 * Fonte de verdade do vínculo profissional: Employee.corporateEmail.
 * Login permanece em AppUser.email (sem alteração automática).
 */

export class CorporateEmailError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "CorporateEmailError";
    this.code = code;
    this.status = status;
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim + lowercase; vazio → null. */
export function normalizeCorporateEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function assertCorporateEmailFormat(email: string | null): void {
  if (email == null) return;
  if (!EMAIL_RE.test(email)) {
    throw new CorporateEmailError(
      "INVALID_CORPORATE_EMAIL",
      "Informe um e-mail corporativo válido."
    );
  }
}

export function isValidCorporateEmailInput(raw: unknown): boolean {
  const email = normalizeCorporateEmail(raw);
  if (email == null) return true;
  try {
    assertCorporateEmailFormat(email);
    return true;
  } catch {
    return false;
  }
}
