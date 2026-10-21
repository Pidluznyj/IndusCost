/**
 * Pessoas 360° — cadastro mestre de identidade. Regras PURAS (sem banco):
 * validação dos dados canônicos e decisão de mudança de situação.
 *
 * Propriedade de campo: Person é dona de nome, nome social, CPF, e-mails e telefone.
 * Employee/AppUser/FleetDriver/CommissionPerson guardam cópias para seus fins e NÃO são
 * reescritos quando a Pessoa muda (sincronização só pelos fluxos próprios de cada módulo).
 */
import { CanonicalPersonError, normalizeCpfLoose, normalizeEmailLoose, normalizePhone } from "@/src/lib/canonicalPerson.js";
import { isValidCpf } from "@/src/lib/fleetCpfUtils.js";

export type PersonIdentityPatch = {
  displayName?: string;
  socialName?: string | null;
  corporateEmail?: string | null;
  personalEmail?: string | null;
  cpf?: string | null;
  phone?: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function optionalText(value: unknown, field: string, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new CanonicalPersonError("INVALID_FIELD", `${field} inválido.`, 400);
  const t = value.trim();
  if (t.length > max) throw new CanonicalPersonError("INVALID_FIELD", `${field}: máximo de ${max} caracteres.`, 400);
  return t || null;
}

function optionalEmail(value: unknown, field: string): string | null | undefined {
  const t = optionalText(value, field, 254);
  if (t === undefined || t === null) return t;
  const norm = normalizeEmailLoose(t);
  if (!norm || !EMAIL_RE.test(norm)) throw new CanonicalPersonError("INVALID_EMAIL", `${field}: e-mail inválido.`, 400);
  return norm;
}

/**
 * Normaliza e valida os campos canônicos. `partial=false` exige nome; CPF, quando informado,
 * precisa ter 11 dígitos com dígitos verificadores válidos (nunca é zerado em silêncio).
 */
export function validatePersonIdentityInput(raw: unknown, options: { partial: boolean }): PersonIdentityPatch {
  if (!raw || typeof raw !== "object") throw new CanonicalPersonError("INVALID_BODY", "Corpo inválido.", 400);
  const body = raw as Record<string, unknown>;
  const out: PersonIdentityPatch = {};

  if (body.displayName !== undefined || !options.partial) {
    const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!name) throw new CanonicalPersonError("NAME_REQUIRED", "Informe o nome da pessoa.", 400);
    if (name.length > 200) throw new CanonicalPersonError("INVALID_FIELD", "Nome: máximo de 200 caracteres.", 400);
    out.displayName = name;
  }
  const social = optionalText(body.socialName, "Nome social");
  if (social !== undefined) out.socialName = social;
  const corp = optionalEmail(body.corporateEmail, "E-mail principal");
  if (corp !== undefined) out.corporateEmail = corp;
  const personal = optionalEmail(body.personalEmail, "E-mail pessoal");
  if (personal !== undefined) out.personalEmail = personal;

  if (body.cpf !== undefined) {
    if (body.cpf === null || (typeof body.cpf === "string" && body.cpf.trim() === "")) {
      out.cpf = null;
    } else {
      if (typeof body.cpf !== "string") throw new CanonicalPersonError("INVALID_CPF", "CPF inválido.", 400);
      const digits = body.cpf.replace(/\D/g, "");
      if (digits.length !== 11) throw new CanonicalPersonError("INVALID_CPF", "CPF deve ter 11 dígitos.", 400);
      if (!isValidCpf(digits)) throw new CanonicalPersonError("INVALID_CPF", "CPF inválido: dígitos verificadores não conferem.", 400);
      out.cpf = normalizeCpfLoose(digits);
    }
  }
  if (body.phone !== undefined) {
    if (body.phone === null || (typeof body.phone === "string" && body.phone.trim() === "")) out.phone = null;
    else if (typeof body.phone !== "string") throw new CanonicalPersonError("INVALID_FIELD", "Telefone inválido.", 400);
    else {
      const norm = normalizePhone(body.phone);
      if (!norm || norm.length < 8) throw new CanonicalPersonError("INVALID_FIELD", "Telefone inválido.", 400);
      out.phone = norm;
    }
  }
  return out;
}

export type PersonStatusTarget = "ACTIVE" | "INACTIVE";

export type PersonStatusDecision =
  | { ok: true; from: string; to: PersonStatusTarget }
  | { ok: false; code: "INVALID_STATUS" | "PERSON_MERGED" | "SAME_STATUS" | "PERSON_HAS_ACTIVE_LINKS"; status: 400 | 409; message: string; details?: string[] };

/**
 * Inativar uma Pessoa nunca desliga colaborador nem revoga conta (regras separadas e explícitas):
 * por isso só é permitido quando não há vínculos ativos. Reativar é sempre explícito e auditado.
 */
export function decidePersonStatusChange(args: {
  currentStatus: string;
  nextStatus: unknown;
  activeLinks: { activeUsers: number; activeEmployees: number; activeDrivers: number };
}): PersonStatusDecision {
  const next = typeof args.nextStatus === "string" ? args.nextStatus.trim().toUpperCase() : "";
  if (next !== "ACTIVE" && next !== "INACTIVE") {
    return { ok: false, code: "INVALID_STATUS", status: 400, message: "Situação inválida: use ACTIVE ou INACTIVE." };
  }
  if (args.currentStatus === "MERGED") {
    return { ok: false, code: "PERSON_MERGED", status: 409, message: "Esta pessoa foi unificada em outra. Reverta a unificação antes de alterar a situação." };
  }
  if (args.currentStatus === next) {
    return { ok: false, code: "SAME_STATUS", status: 409, message: `A pessoa já está ${next === "ACTIVE" ? "ativa" : "inativa"}.` };
  }
  if (next === "INACTIVE") {
    const details: string[] = [];
    if (args.activeLinks.activeUsers > 0) details.push(`${args.activeLinks.activeUsers} conta(s) de acesso ativa(s)`);
    if (args.activeLinks.activeEmployees > 0) details.push(`${args.activeLinks.activeEmployees} colaborador(es) ativo(s)`);
    if (args.activeLinks.activeDrivers > 0) details.push(`${args.activeLinks.activeDrivers} motorista(s) não inativo(s)`);
    if (details.length > 0) {
      return {
        ok: false,
        code: "PERSON_HAS_ACTIVE_LINKS",
        status: 409,
        message: "Não é possível inativar a identidade enquanto há vínculos ativos. Inative a conta, desligue o colaborador ou inative o motorista pelo módulo de origem antes.",
        details,
      };
    }
  }
  return { ok: true, from: args.currentStatus, to: next };
}

/** Campos mascarados para o snapshot do evento (nunca CPF/e-mail em claro). */
export function maskedIdentityDiff(
  before: { displayName: string; socialName: string | null; corporateEmail: string | null; personalEmail: string | null; cpfNormalized: string | null; phoneNormalized: string | null },
  after: { displayName: string; socialName: string | null; corporateEmail: string | null; personalEmail: string | null; cpfNormalized: string | null; phoneNormalized: string | null }
): { changed: string[]; before: Record<string, string | null>; after: Record<string, string | null> } {
  const mask = (v: string | null, kind: "name" | "email" | "cpf" | "phone"): string | null => {
    if (v == null) return null;
    if (kind === "name") return v;
    if (kind === "cpf") return v.length === 11 ? `***.***.${v.slice(6, 9)}-${v.slice(9)}` : "***";
    if (kind === "phone") return `${"*".repeat(Math.max(0, v.length - 4))}${v.slice(-4)}`;
    const [local, domain] = v.split("@");
    return `${(local ?? "").slice(0, 1)}***@${domain ?? ""}`;
  };
  const fields: Array<[keyof typeof before, "name" | "email" | "cpf" | "phone"]> = [
    ["displayName", "name"],
    ["socialName", "name"],
    ["corporateEmail", "email"],
    ["personalEmail", "email"],
    ["cpfNormalized", "cpf"],
    ["phoneNormalized", "phone"],
  ];
  const changed: string[] = [];
  const b: Record<string, string | null> = {};
  const a: Record<string, string | null> = {};
  for (const [field, kind] of fields) {
    if ((before[field] ?? null) !== (after[field] ?? null)) {
      changed.push(field);
      b[field] = mask(before[field] ?? null, kind);
      a[field] = mask(after[field] ?? null, kind);
    }
  }
  return { changed, before: b, after: a };
}
