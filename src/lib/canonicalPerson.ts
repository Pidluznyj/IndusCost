/**
 * Pessoa canônica — funções puras (normalização, máscaras, conflitos, PF/PJ).
 * Sem Prisma. Sem motor paralelo de comissões/clientes.
 */

export type PersonLinkSourceKind =
  | "person"
  | "employee"
  | "app_user"
  | "commission_person"
  | "fleet_driver"
  | "customer_pf";

export type PersonFieldKey =
  | "displayName"
  | "socialName"
  | "corporateEmail"
  | "personalEmail"
  | "cpfNormalized"
  | "phoneNormalized";

export type FieldResolutionChoice = "form" | "person";

export type FieldConflict = {
  field: PersonFieldKey;
  formValue: string | null;
  personValue: string | null;
};

export class CanonicalPersonError extends Error {
  readonly code: string;
  readonly status: number;
  readonly conflicts?: FieldConflict[];

  constructor(
    code: string,
    message: string,
    status = 400,
    conflicts?: FieldConflict[]
  ) {
    super(message);
    this.name = "CanonicalPersonError";
    this.code = code;
    this.status = status;
    this.conflicts = conflicts;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPersonUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

export function digitsOnly(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\D/g, "");
}

export function normalizeCpf(value: unknown): string | null {
  const d = digitsOnly(value);
  if (!d) return null;
  if (d.length !== 11) {
    throw new CanonicalPersonError("INVALID_CPF", "CPF deve ter 11 dígitos.");
  }
  return d;
}

export function normalizeCpfLoose(value: unknown): string | null {
  const d = digitsOnly(value);
  return d.length === 11 ? d : null;
}

export function normalizePhone(value: unknown): string | null {
  const d = digitsOnly(value);
  if (!d) return null;
  if (d.length < 10) return d;
  return d;
}

export function normalizeEmailLoose(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim().toLowerCase();
  return t.length > 0 ? t : null;
}

/** Remove acentos para busca/comparação (não altera persistência). */
export function foldAscii(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) return "***";
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***@${domain}`;
}

export function maskCpf(cpf: string | null | undefined): string | null {
  if (!cpf) return null;
  const d = digitsOnly(cpf);
  if (d.length < 5) return "***";
  return `***.***.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = digitsOnly(phone);
  if (d.length < 4) return "***";
  return `${"*".repeat(Math.max(0, d.length - 4))}${d.slice(-4)}`;
}

export function classifyCustomerDocument(
  taxId: string | null | undefined
): "PF" | "PJ" | "UNKNOWN" {
  const d = digitsOnly(taxId);
  if (d.length === 11) return "PF";
  if (d.length === 14) return "PJ";
  return "UNKNOWN";
}

export type PersonIdentitySnapshot = {
  displayName?: string | null;
  socialName?: string | null;
  corporateEmail?: string | null;
  personalEmail?: string | null;
  cpfNormalized?: string | null;
  phoneNormalized?: string | null;
};

/** Conflitos quando valores diferem e ambos estão preenchidos. */
export function detectPersonFieldConflicts(
  form: PersonIdentitySnapshot,
  person: PersonIdentitySnapshot
): FieldConflict[] {
  const fields: PersonFieldKey[] = [
    "displayName",
    "socialName",
    "corporateEmail",
    "personalEmail",
    "cpfNormalized",
    "phoneNormalized",
  ];
  const conflicts: FieldConflict[] = [];
  for (const field of fields) {
    const formRaw = form[field] ?? null;
    const personRaw = person[field] ?? null;
    const formNorm =
      field === "cpfNormalized" || field === "phoneNormalized"
        ? digitsOnly(formRaw || "") || null
        : field.includes("Email")
          ? normalizeEmailLoose(formRaw)
          : (typeof formRaw === "string" ? formRaw.trim() : null) || null;
    const personNorm =
      field === "cpfNormalized" || field === "phoneNormalized"
        ? digitsOnly(personRaw || "") || null
        : field.includes("Email")
          ? normalizeEmailLoose(personRaw)
          : (typeof personRaw === "string" ? personRaw.trim() : null) || null;
    if (formNorm && personNorm && formNorm !== personNorm) {
      conflicts.push({ field, formValue: formNorm, personValue: personNorm });
    }
  }
  return conflicts;
}

export function applyFieldResolutions(
  form: PersonIdentitySnapshot,
  person: PersonIdentitySnapshot,
  resolutions: Partial<Record<PersonFieldKey, FieldResolutionChoice>>
): PersonIdentitySnapshot {
  const out: PersonIdentitySnapshot = { ...form };
  for (const field of Object.keys(resolutions) as PersonFieldKey[]) {
    const choice = resolutions[field];
    if (choice === "person") {
      out[field] = person[field] ?? null;
    } else if (choice === "form") {
      out[field] = form[field] ?? null;
    }
  }
  // Campos sem conflito: preencher vazios do form com person
  for (const field of [
    "displayName",
    "socialName",
    "corporateEmail",
    "personalEmail",
    "cpfNormalized",
    "phoneNormalized",
  ] as PersonFieldKey[]) {
    const formVal = out[field];
    const empty =
      formVal == null ||
      (typeof formVal === "string" && formVal.trim() === "");
    if (empty && person[field]) {
      out[field] = person[field];
    }
  }
  return out;
}

/** Merge por nome semelhante é proibido — só evidências inequívocas. */
export function isUnequivocalMatchEvidence(input: {
  emailExact?: boolean;
  cpfExact?: boolean;
  nameOnly?: boolean;
}): boolean {
  if (input.nameOnly && !input.emailExact && !input.cpfExact) return false;
  return Boolean(input.emailExact || input.cpfExact);
}

export function sourceKindLabel(kind: PersonLinkSourceKind): string {
  switch (kind) {
    case "person":
      return "Pessoa canônica";
    case "employee":
      return "Colaborador";
    case "app_user":
      return "Usuário";
    case "commission_person":
      return "Pessoa comissionada";
    case "fleet_driver":
      return "Motorista";
    case "customer_pf":
      return "Cliente (pessoa física)";
    default:
      return kind;
  }
}
