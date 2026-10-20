/**
 * Resolução de identidade (Person) para cadastros operacionais — Frota e Comissões.
 *
 * Política (auditoria §11): CPF validado é evidência forte e pode vincular automaticamente
 * quando há exatamente uma Pessoa canônica não unificada com aquele CPF. E-mail é apenas
 * sugestão (nunca decide sozinho). Nome nunca é chave. Nada aqui cria Pessoa.
 */
import type { PrismaClient, Prisma } from "@prisma/client";
import { CanonicalPersonError, maskCpf, maskEmail, normalizeCpfLoose, normalizeEmailLoose } from "@/src/lib/canonicalPerson.js";
import { isValidCpf } from "@/src/lib/fleetCpfUtils.js";

type Db = Pick<PrismaClient, "person"> | Pick<Prisma.TransactionClient, "person">;

export type PersonCandidate = {
  id: string;
  displayName: string;
  status: string;
  cpfMasked: string | null;
  emailMasked: string | null;
  evidence: "CPF_EXACT" | "EMAIL_EXACT";
};

export type PersonCpfResolution = {
  /** Pessoa a vincular automaticamente (exatamente uma candidata por CPF), senão null. */
  personId: string | null;
  /** Mais de uma Pessoa não unificada com o mesmo CPF: nunca escolher sozinho. */
  ambiguous: boolean;
  candidates: PersonCandidate[];
};

const SELECT = { id: true, displayName: true, status: true, cpfNormalized: true, corporateEmail: true } as const;

function toCandidate(p: { id: string; displayName: string; status: string; cpfNormalized: string | null; corporateEmail: string | null }, evidence: PersonCandidate["evidence"]): PersonCandidate {
  return { id: p.id, displayName: p.displayName, status: p.status, cpfMasked: maskCpf(p.cpfNormalized), emailMasked: maskEmail(p.corporateEmail), evidence };
}

/** Resolve a Pessoa pelo CPF (com dígitos verificadores válidos). Pessoas MERGED nunca contam. */
export async function resolvePersonByCpf(db: Db, cpfRaw: unknown): Promise<PersonCpfResolution> {
  const cpf = normalizeCpfLoose(cpfRaw);
  if (!cpf || !isValidCpf(cpf)) return { personId: null, ambiguous: false, candidates: [] };
  const rows = await db.person.findMany({
    where: { cpfNormalized: cpf, status: { not: "MERGED" } },
    select: SELECT,
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    take: 10,
  });
  const candidates = rows.map((p) => toCandidate(p, "CPF_EXACT"));
  if (candidates.length === 1) return { personId: candidates[0]!.id, ambiguous: false, candidates };
  return { personId: null, ambiguous: candidates.length > 1, candidates };
}

/** Sugestões para o operador: por CPF (forte) e por e-mail (fraca, só sugestão). */
export async function suggestPersonsForIdentity(db: Db, input: { cpf?: unknown; email?: unknown }): Promise<{ byCpf: PersonCandidate[]; byEmail: PersonCandidate[]; cpfValid: boolean }> {
  const cpf = normalizeCpfLoose(input.cpf);
  const cpfValid = Boolean(cpf && isValidCpf(cpf));
  const byCpf = cpfValid ? (await resolvePersonByCpf(db, cpf)).candidates : [];
  const email = normalizeEmailLoose(input.email);
  let byEmail: PersonCandidate[] = [];
  if (email) {
    const rows = await db.person.findMany({
      where: { status: { not: "MERGED" }, OR: [{ corporateEmail: { equals: email, mode: "insensitive" } }, { personalEmail: { equals: email, mode: "insensitive" } }] },
      select: SELECT,
      take: 10,
    });
    const seen = new Set(byCpf.map((c) => c.id));
    byEmail = rows.filter((p) => !seen.has(p.id)).map((p) => toCandidate(p, "EMAIL_EXACT"));
  }
  return { byCpf, byEmail, cpfValid };
}

/** Garante que a Pessoa existe e não foi unificada em outra (vínculo novo em Pessoa MERGED é proibido). */
export async function assertPersonLinkable(db: Db, personId: string): Promise<{ id: string; displayName: string; cpfNormalized: string | null }> {
  const p = await db.person.findUnique({ where: { id: personId }, select: { id: true, displayName: true, status: true, cpfNormalized: true, mergedIntoPersonId: true } });
  if (!p) throw new CanonicalPersonError("PERSON_NOT_FOUND", "Pessoa não encontrada.", 404);
  if (p.status === "MERGED") {
    throw new CanonicalPersonError("PERSON_MERGED", "Esta Pessoa foi unificada em outra. Vincule à Pessoa que ficou.", 409);
  }
  return { id: p.id, displayName: p.displayName, cpfNormalized: p.cpfNormalized };
}

/**
 * Decide o `personId` de um cadastro operacional a partir do CPF, sem sobrescrever vínculo
 * existente. Se o cadastro já aponta para uma Pessoa cujo CPF difere do novo CPF, a operação
 * é recusada: a correção do vínculo é feita em Pessoas 360°, com prévia e auditoria.
 */
export async function planOperationalPersonLink(
  db: Db,
  input: { cpf: unknown; currentPersonId: string | null },
): Promise<{ personId: string | null; reason: "KEPT" | "RESOLVED_BY_CPF" | "NONE" | "AMBIGUOUS" }> {
  const cpf = normalizeCpfLoose(input.cpf);
  if (input.currentPersonId) {
    const current = await db.person.findUnique({ where: { id: input.currentPersonId }, select: { cpfNormalized: true, status: true } });
    if (current && current.cpfNormalized && cpf && current.cpfNormalized !== cpf) {
      throw new CanonicalPersonError(
        "PERSON_CPF_MISMATCH",
        "Este cadastro está vinculado a uma Pessoa com outro CPF. Corrija o vínculo em Pessoas 360° antes de alterar o CPF.",
        409,
      );
    }
    return { personId: input.currentPersonId, reason: "KEPT" };
  }
  const resolved = await resolvePersonByCpf(db, cpf);
  if (resolved.personId) return { personId: resolved.personId, reason: "RESOLVED_BY_CPF" };
  return { personId: null, reason: resolved.ambiguous ? "AMBIGUOUS" : "NONE" };
}
