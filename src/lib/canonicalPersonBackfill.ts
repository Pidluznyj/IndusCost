/**
 * Classificação de backfill Person (puro, sem Prisma).
 * Nome/telefone isolados nunca são auto-link. Apply só `unequivocal`.
 */

import { isValidCpf } from "@/src/lib/fleetCpfUtils.js";
import {
  foldAscii,
  maskCpf,
  maskEmail,
  maskPhone,
  normalizeCpfLoose,
  normalizeEmailLoose,
  normalizePhone,
} from "@/src/lib/canonicalPerson.js";

export type BackfillEntityKind =
  | "employee"
  | "app_user"
  | "commission_person"
  | "fleet_driver"
  | "customer_identity"
  | "customer_contact";

export type MatchCategory =
  | "unequivocal"
  | "probable"
  | "ambiguous"
  | "no_match"
  | "conflict";

export type MatchEvidence = "cpf" | "email" | "official_id" | "phone" | "name";

export type PersonIndexRow = {
  id: string;
  displayName: string;
  corporateEmail: string | null;
  personalEmail: string | null;
  cpfNormalized: string | null;
  phoneNormalized: string | null;
  /** Papéis já vinculados (para unique Employee/AppUser). */
  linkedEmployeeIds: string[];
  linkedAppUserIds: string[];
};

export type OrphanEntityRow = {
  kind: BackfillEntityKind;
  id: string;
  label: string;
  emails: Array<string | null | undefined>;
  cpf: string | null | undefined;
  phone: string | null | undefined;
  officialId: string | null | undefined;
  name: string | null | undefined;
};

export type BackfillCandidate = {
  entityKind: BackfillEntityKind;
  entityId: string;
  entityLabel: string;
  category: MatchCategory;
  evidence: MatchEvidence[];
  targetPersonId: string | null;
  targetPersonLabel: string | null;
  reason: string;
  autoLinkSafe: boolean;
  emailMasked: string | null;
  cpfMasked: string | null;
  phoneMasked: string | null;
  candidatePersonIds: string[];
};

export type BackfillSummary = {
  scannedByKind: Record<string, number>;
  byCategory: Record<MatchCategory, number>;
  autoLinkSafeCount: number;
};

/** Unique 1:1 — Person não pode ganhar segundo Employee/AppUser. */
export function wouldViolateUniquePersonLink(
  kind: BackfillEntityKind,
  person: PersonIndexRow,
  entityId: string
): boolean {
  if (kind === "employee") {
    return person.linkedEmployeeIds.some((id) => id !== entityId);
  }
  if (kind === "app_user") {
    return person.linkedAppUserIds.some((id) => id !== entityId);
  }
  return false;
}

export function collectOrphanEmails(orphan: OrphanEntityRow): string[] {
  const out = new Set<string>();
  for (const raw of orphan.emails) {
    const e = normalizeEmailLoose(raw);
    if (e) out.add(e);
  }
  return [...out];
}

export function orphanValidCpf(orphan: OrphanEntityRow): string | null {
  const digits = normalizeCpfLoose(orphan.cpf);
  if (!digits) return null;
  return isValidCpf(digits) ? digits : null;
}

export function orphanOfficialId(orphan: OrphanEntityRow): string | null {
  const raw = orphan.officialId;
  if (raw == null) return null;
  const s = String(raw).trim();
  return s.length > 0 ? s : null;
}

export function buildPersonIndexes(people: PersonIndexRow[]): {
  byCpf: Map<string, PersonIndexRow[]>;
  byEmail: Map<string, PersonIndexRow[]>;
  byPhone: Map<string, PersonIndexRow[]>;
  byNameFold: Map<string, PersonIndexRow[]>;
  byOfficialHint: Map<string, PersonIndexRow[]>;
} {
  const byCpf = new Map<string, PersonIndexRow[]>();
  const byEmail = new Map<string, PersonIndexRow[]>();
  const byPhone = new Map<string, PersonIndexRow[]>();
  const byNameFold = new Map<string, PersonIndexRow[]>();
  const byOfficialHint = new Map<string, PersonIndexRow[]>();

  const push = <T>(map: Map<string, T[]>, key: string | null | undefined, row: T) => {
    if (!key) return;
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  };

  for (const p of people) {
    push(byCpf, p.cpfNormalized, p);
    push(byEmail, normalizeEmailLoose(p.corporateEmail), p);
    push(byEmail, normalizeEmailLoose(p.personalEmail), p);
    push(byPhone, normalizePhone(p.phoneNormalized), p);
    push(byNameFold, foldAscii(p.displayName || ""), p);
  }

  return { byCpf, byEmail, byPhone, byNameFold, byOfficialHint };
}

function uniquePersons(rows: PersonIndexRow[]): PersonIndexRow[] {
  const map = new Map<string, PersonIndexRow>();
  for (const r of rows) map.set(r.id, r);
  return [...map.values()];
}

/**
 * Classifica um órfão contra o índice de Persons existentes.
 */
export function classifyOrphanAgainstPersons(
  orphan: OrphanEntityRow,
  indexes: ReturnType<typeof buildPersonIndexes>
): BackfillCandidate {
  const emails = collectOrphanEmails(orphan);
  const cpf = orphanValidCpf(orphan);
  const phone = normalizePhone(orphan.phone);
  const nameFold = orphan.name ? foldAscii(orphan.name) : "";
  const officialId = orphanOfficialId(orphan);

  const emailMasked = emails[0] ? maskEmail(emails[0]) : null;
  const cpfMasked = cpf ? maskCpf(cpf) : null;
  const phoneMasked = phone ? maskPhone(phone) : null;

  const base = {
    entityKind: orphan.kind,
    entityId: orphan.id,
    entityLabel: orphan.label,
    emailMasked,
    cpfMasked,
    phoneMasked,
  };

  // Contatos de cliente: nunca auto-link no apply
  const contactBlocked = orphan.kind === "customer_contact";

  const cpfHits = cpf ? uniquePersons(indexes.byCpf.get(cpf) ?? []) : [];
  const emailHitLists = emails.flatMap((e) => indexes.byEmail.get(e) ?? []);
  const emailHits = uniquePersons(emailHitLists);
  const phoneHits =
    phone && phone.length >= 10
      ? uniquePersons(indexes.byPhone.get(phone) ?? [])
      : [];
  const nameHits =
    nameFold.length >= 3
      ? uniquePersons(indexes.byNameFold.get(nameFold) ?? [])
      : [];

  // Conflito: CPF inválido quando informado com 11 dígitos sem checksum
  const cpfDigitsLoose = normalizeCpfLoose(orphan.cpf);
  if (cpfDigitsLoose && !cpf) {
    return {
      ...base,
      category: "conflict",
      evidence: ["cpf"],
      targetPersonId: null,
      targetPersonLabel: null,
      reason: "CPF com 11 dígitos mas checksum inválido — não vincular.",
      autoLinkSafe: false,
      candidatePersonIds: [],
    };
  }

  // Ambíguo: múltiplas Persons no mesmo CPF ou e-mail
  if (cpfHits.length > 1) {
    return {
      ...base,
      category: "ambiguous",
      evidence: ["cpf"],
      targetPersonId: null,
      targetPersonLabel: null,
      reason: "CPF corresponde a mais de uma Person.",
      autoLinkSafe: false,
      candidatePersonIds: cpfHits.map((p) => p.id),
    };
  }
  if (emailHits.length > 1) {
    return {
      ...base,
      category: "ambiguous",
      evidence: ["email"],
      targetPersonId: null,
      targetPersonLabel: null,
      reason: "E-mail correspondente a mais de uma Person.",
      autoLinkSafe: false,
      candidatePersonIds: emailHits.map((p) => p.id),
    };
  }

  // Conflito CPF×e-mail apontam Persons diferentes
  if (cpfHits.length === 1 && emailHits.length === 1 && cpfHits[0].id !== emailHits[0].id) {
    return {
      ...base,
      category: "conflict",
      evidence: ["cpf", "email"],
      targetPersonId: null,
      targetPersonLabel: null,
      reason: "CPF e e-mail apontam para Persons diferentes.",
      autoLinkSafe: false,
      candidatePersonIds: [cpfHits[0].id, emailHits[0].id],
    };
  }

  if (cpfHits.length === 1) {
    const person = cpfHits[0];
    if (wouldViolateUniquePersonLink(orphan.kind, person, orphan.id)) {
      return {
        ...base,
        category: "conflict",
        evidence: ["cpf"],
        targetPersonId: person.id,
        targetPersonLabel: person.displayName,
        reason: "Person já possui outro vínculo único do mesmo tipo (Employee/AppUser).",
        autoLinkSafe: false,
        candidatePersonIds: [person.id],
      };
    }
    return {
      ...base,
      category: contactBlocked ? "probable" : "unequivocal",
      evidence: ["cpf"],
      targetPersonId: person.id,
      targetPersonLabel: person.displayName,
      reason: contactBlocked
        ? "Contato de cliente — CPF casa com Person; só relatório (sem apply)."
        : "CPF válido e único → Person.",
      autoLinkSafe: !contactBlocked,
      candidatePersonIds: [person.id],
    };
  }

  if (emailHits.length === 1) {
    const person = emailHits[0];
    if (wouldViolateUniquePersonLink(orphan.kind, person, orphan.id)) {
      return {
        ...base,
        category: "conflict",
        evidence: ["email"],
        targetPersonId: person.id,
        targetPersonLabel: person.displayName,
        reason: "E-mail casa Person que já tem outro Employee/AppUser.",
        autoLinkSafe: false,
        candidatePersonIds: [person.id],
      };
    }
    // Se órfão tem CPF válido diferente do da Person → conflito
    if (cpf && person.cpfNormalized && person.cpfNormalized !== cpf) {
      return {
        ...base,
        category: "conflict",
        evidence: ["email", "cpf"],
        targetPersonId: person.id,
        targetPersonLabel: person.displayName,
        reason: "E-mail casa Person, mas CPF do órfão diverge.",
        autoLinkSafe: false,
        candidatePersonIds: [person.id],
      };
    }
    return {
      ...base,
      category: contactBlocked ? "probable" : "unequivocal",
      evidence: ["email"],
      targetPersonId: person.id,
      targetPersonLabel: person.displayName,
      reason: contactBlocked
        ? "Contato de cliente — e-mail casa Person; só relatório."
        : "E-mail exato único → Person (sem conflito de CPF).",
      autoLinkSafe: !contactBlocked,
      candidatePersonIds: [person.id],
    };
  }

  // official id (ex.: nomusPersonId) — forte só se 1 Person encontrada via hint externo
  // (índice byOfficialHint preenchido pelo scanner quando aplicável)
  if (officialId && indexes.byOfficialHint.has(officialId)) {
    const hits = uniquePersons(indexes.byOfficialHint.get(officialId) ?? []);
    if (hits.length === 1) {
      const person = hits[0];
      if (wouldViolateUniquePersonLink(orphan.kind, person, orphan.id)) {
        return {
          ...base,
          category: "conflict",
          evidence: ["official_id"],
          targetPersonId: person.id,
          targetPersonLabel: person.displayName,
          reason: "Identificador oficial casa Person com vínculo único conflitante.",
          autoLinkSafe: false,
          candidatePersonIds: [person.id],
        };
      }
      return {
        ...base,
        category: contactBlocked ? "probable" : "unequivocal",
        evidence: ["official_id"],
        targetPersonId: person.id,
        targetPersonLabel: person.displayName,
        reason: "Identificador oficial único → Person.",
        autoLinkSafe: !contactBlocked,
        candidatePersonIds: [person.id],
      };
    }
    if (hits.length > 1) {
      return {
        ...base,
        category: "ambiguous",
        evidence: ["official_id"],
        targetPersonId: null,
        targetPersonLabel: null,
        reason: "Identificador oficial ambíguo.",
        autoLinkSafe: false,
        candidatePersonIds: hits.map((p) => p.id),
      };
    }
  }

  // Telefone isolado → provável, nunca apply
  if (phoneHits.length === 1 && cpfHits.length === 0 && emailHits.length === 0) {
    return {
      ...base,
      category: "probable",
      evidence: ["phone"],
      targetPersonId: phoneHits[0].id,
      targetPersonLabel: phoneHits[0].displayName,
      reason: "Somente telefone — nunca auto-vínculo.",
      autoLinkSafe: false,
      candidatePersonIds: [phoneHits[0].id],
    };
  }
  if (phoneHits.length > 1) {
    return {
      ...base,
      category: "ambiguous",
      evidence: ["phone"],
      targetPersonId: null,
      targetPersonLabel: null,
      reason: "Telefone corresponde a várias Persons.",
      autoLinkSafe: false,
      candidatePersonIds: phoneHits.map((p) => p.id),
    };
  }

  // Nome isolado → relatório, nunca apply
  if (nameHits.length >= 1 && cpfHits.length === 0 && emailHits.length === 0) {
    return {
      ...base,
      category: nameHits.length === 1 ? "probable" : "ambiguous",
      evidence: ["name"],
      targetPersonId: nameHits.length === 1 ? nameHits[0].id : null,
      targetPersonLabel: nameHits.length === 1 ? nameHits[0].displayName : null,
      reason: "Somente nome — nunca merge/vínculo automático.",
      autoLinkSafe: false,
      candidatePersonIds: nameHits.map((p) => p.id),
    };
  }

  return {
    ...base,
    category: "no_match",
    evidence: [],
    targetPersonId: null,
    targetPersonLabel: null,
    reason: "Sem correspondência por CPF/e-mail/identificador oficial.",
    autoLinkSafe: false,
    candidatePersonIds: [],
  };
}

export function summarizeCandidates(candidates: BackfillCandidate[]): BackfillSummary {
  const byCategory: Record<MatchCategory, number> = {
    unequivocal: 0,
    probable: 0,
    ambiguous: 0,
    no_match: 0,
    conflict: 0,
  };
  const scannedByKind: Record<string, number> = {};
  let autoLinkSafeCount = 0;
  for (const c of candidates) {
    byCategory[c.category] += 1;
    scannedByKind[c.entityKind] = (scannedByKind[c.entityKind] ?? 0) + 1;
    if (c.autoLinkSafe) autoLinkSafeCount += 1;
  }
  return { scannedByKind, byCategory, autoLinkSafeCount };
}

/** Linha CSV segura (sem CPF/e-mail completos). */
export function candidateToSafeCsvRow(c: BackfillCandidate): string[] {
  return [
    c.entityKind,
    c.entityId,
    c.entityLabel.replace(/[",\n]/g, " "),
    c.category,
    c.evidence.join("|"),
    c.targetPersonId ?? "",
    (c.targetPersonLabel ?? "").replace(/[",\n]/g, " "),
    c.autoLinkSafe ? "yes" : "no",
    c.emailMasked ?? "",
    c.cpfMasked ?? "",
    c.reason.replace(/[",\n]/g, " "),
  ];
}

export const BACKFILL_CSV_HEADER = [
  "entityKind",
  "entityId",
  "entityLabel",
  "category",
  "evidence",
  "targetPersonId",
  "targetPersonLabel",
  "autoLinkSafe",
  "emailMasked",
  "cpfMasked",
  "reason",
] as const;

export function filterApplyCandidates(candidates: BackfillCandidate[]): BackfillCandidate[] {
  return candidates.filter(
    (c) =>
      c.category === "unequivocal" &&
      c.autoLinkSafe &&
      Boolean(c.targetPersonId) &&
      c.entityKind !== "customer_contact"
  );
}
