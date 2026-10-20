/**
 * Vínculos societários a partir do QSA já consultado.
 * CNPJ completo liga empresas. Nome parecido, CPF e documento mascarado não ligam.
 * Não transfere dívida e não gera bloqueio crítico.
 */

import { createHash } from "node:crypto";
import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";

export const CORPORATE_MEMBERSHIP_MAX_AGE_DAYS = 90;

export const CORPORATE_MEMBER_KINDS = ["PARTNER", "ADMINISTRATOR", "REPRESENTATIVE", "UNKNOWN"] as const;
export type CorporateMemberKind = (typeof CORPORATE_MEMBER_KINDS)[number];

export const CORPORATE_MEMBER_KIND_LABEL: Record<CorporateMemberKind, string> = {
  PARTNER: "Sócio",
  ADMINISTRATOR: "Administrador",
  REPRESENTATIVE: "Representante",
  UNKNOWN: "Qualificação não identificada",
};

export type CorporateDocumentKind = "CNPJ" | "MASKED" | "ABSENT" | "CPF_WITHHELD";
export type CorporateReliability = "HIGH" | "INSUFFICIENT";
export type CorporateRelationBasis = "DIRECT_CNPJ" | "SHARED_CNPJ";

export type CorporateMembershipDraft = {
  subjectCnpj: string;
  source: string;
  consultedAt: Date;
  memberKind: CorporateMemberKind;
  roleText: string | null;
  personKind: "PJ" | "PF" | "FOREIGN" | "UNKNOWN";
  documentKind: CorporateDocumentKind;
  memberCnpj: string | null;
  reliability: CorporateReliability;
  evidenceRef: string;
  /** Só para detectar homônimo. Não é gravado nem exibido. */
  nameKey: string | null;
};

export type RegisteredCorporateParty = {
  customerId: string;
  cnpj: string;
  companyName: string;
  registryKind: "CUSTOMER" | "LEAD";
};

export type CorporateRelation = {
  subjectCustomerId: string;
  relatedCustomerId: string;
  relatedCompanyName: string;
  relatedCnpj: string;
  registryKind: "CUSTOMER" | "LEAD";
  memberKind: CorporateMemberKind;
  basis: CorporateRelationBasis;
  source: string;
  consultedAt: string;
  evidenceRef: string;
  partnerCnpj: string;
};

export type CorporateRelationReport = {
  relations: CorporateRelation[];
  insufficient: number;
  stale: number;
  homonymIgnored: number;
  withoutQsa: number;
  writes: "NONE";
};

const DAY_MS = 24 * 60 * 60 * 1000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

export function corporateNameKey(name: string | null): string | null {
  if (!name) return null;
  const key = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (key.length < 5) return null;
  return key;
}

export function classifyCorporateRole(role: string | null): CorporateMemberKind {
  if (!role) return "UNKNOWN";
  const text = corporateNameKey(role) ?? "";
  if (text.includes("REPRESENTANTE")) return "REPRESENTATIVE";
  if (text.includes("SOCIO") || text.includes("ACIONISTA") || text.includes("TITULAR")) return "PARTNER";
  if (text.includes("ADMINISTRADOR") || text.includes("DIRETOR") || text.includes("PRESIDENTE")) return "ADMINISTRATOR";
  return "UNKNOWN";
}

export function classifyCorporateDocument(raw: string | null): {
  documentKind: CorporateDocumentKind;
  memberCnpj: string | null;
} {
  if (!raw?.trim()) return { documentKind: "ABSENT", memberCnpj: null };
  if (raw.includes("*")) return { documentKind: "MASKED", memberCnpj: null };
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11) return { documentKind: "CPF_WITHHELD", memberCnpj: null };
  if (digits.length === 14 && isValidCnpj(digits)) return { documentKind: "CNPJ", memberCnpj: digits };
  return { documentKind: "MASKED", memberCnpj: null };
}

function personKindFromBrasil(value: unknown): CorporateMembershipDraft["personKind"] {
  const code = readString(value);
  if (code === "1") return "PJ";
  if (code === "2") return "PF";
  if (code === "3") return "FOREIGN";
  return "UNKNOWN";
}

function personKindFromPublica(value: string | null): CorporateMembershipDraft["personKind"] {
  const text = corporateNameKey(value) ?? "";
  if (text.includes("JURIDICA")) return "PJ";
  if (text.includes("FISICA")) return "PF";
  if (text.includes("ESTRANGEIR")) return "FOREIGN";
  return "UNKNOWN";
}

function evidenceRef(parts: Record<string, string | null>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function membership(input: {
  subjectCnpj: string;
  source: string;
  consultedAt: Date;
  memberKind: CorporateMemberKind;
  roleText: string | null;
  personKind: CorporateMembershipDraft["personKind"];
  documentRaw: string | null;
  name: string | null;
}): CorporateMembershipDraft {
  const document = classifyCorporateDocument(input.documentRaw);
  return {
    subjectCnpj: input.subjectCnpj,
    source: input.source,
    consultedAt: input.consultedAt,
    memberKind: input.memberKind,
    roleText: input.roleText,
    personKind: input.personKind,
    documentKind: document.documentKind,
    memberCnpj: document.memberCnpj,
    reliability: document.documentKind === "CNPJ" ? "HIGH" : "INSUFFICIENT",
    nameKey: corporateNameKey(input.name),
    evidenceRef: evidenceRef({
      subjectCnpj: input.subjectCnpj,
      source: input.source,
      consultedAt: input.consultedAt.toISOString(),
      memberKind: input.memberKind,
      memberCnpj: document.memberCnpj,
      documentKind: document.documentKind,
      roleText: input.roleText,
    }),
  };
}

export function extractBrasilApiMemberships(
  raw: unknown,
  consultedAt: Date,
  subjectCnpj?: string | null
): CorporateMembershipDraft[] {
  const root = asRecord(raw) ?? {};
  const cnpj = normalizeCnpj(subjectCnpj ?? readString(root.cnpj));
  if (!isValidCnpj(cnpj)) return [];
  const rows: CorporateMembershipDraft[] = [];
  for (const item of asArray(root.qsa)) {
    const row = asRecord(item) ?? {};
    const role = readString(row.qualificacao_socio) ?? readString(row.qualificacao);
    rows.push(
      membership({
        subjectCnpj: cnpj,
        source: "brasilapi",
        consultedAt,
        memberKind: classifyCorporateRole(role),
        roleText: role,
        personKind: personKindFromBrasil(row.identificador_de_socio),
        documentRaw: readString(row.cnpj_cpf_do_socio),
        name: readString(row.nome_socio) ?? readString(row.nome),
      })
    );
    const representativeRole =
      readString(row.qualificacao_representante_legal) ??
      (readString(row.nome_representante_legal) ? "Representante legal" : null);
    if (representativeRole || readString(row.cpf_representante_legal)) {
      rows.push(
        membership({
          subjectCnpj: cnpj,
          source: "brasilapi",
          consultedAt,
          memberKind: "REPRESENTATIVE",
          roleText: representativeRole,
          personKind: "UNKNOWN",
          documentRaw: readString(row.cpf_representante_legal),
          name: readString(row.nome_representante_legal),
        })
      );
    }
  }
  return rows;
}

export function extractPublicaMemberships(
  raw: unknown,
  consultedAt: Date,
  subjectCnpj?: string | null
): CorporateMembershipDraft[] {
  const root = asRecord(raw) ?? {};
  const cnpj = normalizeCnpj(subjectCnpj ?? readString(root.cnpj) ?? readString(asRecord(root.estabelecimento)?.cnpj));
  if (!isValidCnpj(cnpj)) return [];
  return asArray(root.socios).map((item) => {
    const row = asRecord(item) ?? {};
    const qualification = asRecord(row.qualificacao_socio);
    const role = readString(qualification?.descricao) ?? readString(row.qualificacao_socio) ?? readString(row.tipo);
    return membership({
      subjectCnpj: cnpj,
      source: "publica.cnpj.ws",
      consultedAt,
      memberKind: classifyCorporateRole(role),
      roleText: role,
      personKind: personKindFromPublica(readString(row.tipo)),
      documentRaw: readString(row.cpf_cnpj_socio),
      name: readString(row.nome),
    });
  });
}

export function extractMembershipsFromLookup(rawJson: unknown, consultedAt: Date): CorporateMembershipDraft[] {
  const root = asRecord(rawJson) ?? {};
  const sources = asRecord(root.sources) ?? root;
  const brasil = sources.brasilapi ?? sources.BRASILAPI;
  const publica = sources["publica.cnpj.ws"] ?? sources.publica;
  return [
    ...(brasil ? extractBrasilApiMemberships(brasil, consultedAt) : []),
    ...(publica ? extractPublicaMemberships(publica, consultedAt) : []),
  ];
}

function isFresh(row: CorporateMembershipDraft, now: Date, maxAgeDays: number): boolean {
  return now.getTime() - row.consultedAt.getTime() <= maxAgeDays * DAY_MS;
}

export function analyzeCorporateRelations(input: {
  memberships: readonly CorporateMembershipDraft[];
  parties: readonly RegisteredCorporateParty[];
  now: Date;
  subjectCnpjs?: readonly string[];
  maxAgeDays?: number;
}): CorporateRelationReport {
  const maxAgeDays = input.maxAgeDays ?? CORPORATE_MEMBERSHIP_MAX_AGE_DAYS;
  const partiesByCnpj = new Map<string, RegisteredCorporateParty>();
  for (const party of input.parties) {
    const cnpj = normalizeCnpj(party.cnpj);
    if (isValidCnpj(cnpj)) partiesByCnpj.set(cnpj, { ...party, cnpj });
  }
  const freshHigh = input.memberships.filter(
    (row) => row.reliability === "HIGH" && row.memberCnpj && isFresh(row, input.now, maxAgeDays)
  );
  const stale = input.memberships.filter(
    (row) => row.reliability === "HIGH" && row.memberCnpj && !isFresh(row, input.now, maxAgeDays)
  ).length;
  const insufficient = input.memberships.filter((row) => row.reliability !== "HIGH").length;
  const subjects = new Set(
    (input.subjectCnpjs ?? input.memberships.map((row) => row.subjectCnpj)).map((cnpj) => normalizeCnpj(cnpj)).filter(Boolean)
  );
  const withQsa = new Set(input.memberships.map((row) => row.subjectCnpj));
  const withoutQsa = [...subjects].filter((cnpj) => !withQsa.has(cnpj)).length;

  const homonymGroups = new Map<string, Set<string>>();
  for (const row of input.memberships) {
    if (!row.nameKey || row.reliability === "HIGH") continue;
    const group = homonymGroups.get(row.nameKey) ?? new Set<string>();
    group.add(row.subjectCnpj);
    homonymGroups.set(row.nameKey, group);
  }
  const homonymIgnored = [...homonymGroups.values()].filter((group) => group.size >= 2).length;

  const relations = new Map<string, CorporateRelation>();
  const add = (relation: CorporateRelation) => {
    if (relation.subjectCustomerId === relation.relatedCustomerId) return;
    const key = `${relation.subjectCustomerId}:${relation.relatedCustomerId}:${relation.basis}:${relation.partnerCnpj}`;
    if (!relations.has(key)) relations.set(key, relation);
  };

  for (const row of freshHigh) {
    const subject = partiesByCnpj.get(row.subjectCnpj);
    const related = row.memberCnpj ? partiesByCnpj.get(row.memberCnpj) : undefined;
    if (!subject || !related || !row.memberCnpj) continue;
    add({
      subjectCustomerId: subject.customerId,
      relatedCustomerId: related.customerId,
      relatedCompanyName: related.companyName,
      relatedCnpj: related.cnpj,
      registryKind: related.registryKind,
      memberKind: row.memberKind,
      basis: "DIRECT_CNPJ",
      source: row.source,
      consultedAt: row.consultedAt.toISOString(),
      evidenceRef: row.evidenceRef,
      partnerCnpj: row.memberCnpj,
    });
  }

  const byPartner = new Map<string, CorporateMembershipDraft[]>();
  for (const row of freshHigh) {
    if (!row.memberCnpj) continue;
    const bucket = byPartner.get(row.memberCnpj) ?? [];
    bucket.push(row);
    byPartner.set(row.memberCnpj, bucket);
  }
  for (const [partnerCnpj, rows] of byPartner) {
    const subjectsInGroup = [...new Map(rows.map((row) => [row.subjectCnpj, row])).values()];
    for (const left of subjectsInGroup) {
      for (const right of subjectsInGroup) {
        if (left.subjectCnpj === right.subjectCnpj) continue;
        const subject = partiesByCnpj.get(left.subjectCnpj);
        const related = partiesByCnpj.get(right.subjectCnpj);
        if (!subject || !related) continue;
        add({
          subjectCustomerId: subject.customerId,
          relatedCustomerId: related.customerId,
          relatedCompanyName: related.companyName,
          relatedCnpj: related.cnpj,
          registryKind: related.registryKind,
          memberKind: left.memberKind,
          basis: "SHARED_CNPJ",
          source: left.source,
          consultedAt: left.consultedAt.toISOString(),
          evidenceRef: left.evidenceRef,
          partnerCnpj,
        });
      }
    }
  }

  return {
    relations: [...relations.values()],
    insufficient,
    stale,
    homonymIgnored,
    withoutQsa,
    writes: "NONE",
  };
}

export function registryKindOf(customer: { status?: string | null; relationshipStatus?: string | null }): "CUSTOMER" | "LEAD" {
  const status = (customer.status ?? "").toUpperCase();
  const relationship = (customer.relationshipStatus ?? "").toLowerCase();
  if (status === "LEAD" || status === "PROSPECT" || relationship.includes("lead") || relationship.includes("prospect")) {
    return "LEAD";
  }
  return "CUSTOMER";
}
