/**
 * Leitura e inclusão histórica de QSA.
 * Não apaga consulta anterior e não varre a base para gravar em massa.
 */

import { formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  CORPORATE_MEMBER_KIND_LABEL,
  CORPORATE_RELATION_COMPONENT_LIMIT,
  analyzeCorporateRelations,
  extractMembershipsFromLookup,
  registryKindOf,
  type CorporateCandidate,
  type CorporateMembershipDraft,
  type CorporateRelation,
  type RegisteredCorporateParty,
} from "./corporateRelation.js";

export type CorporateRelationView = {
  kindLabel: string;
  relatedCompany: string;
  creditStatusLabel: string;
  evidence: string;
};

type MembershipRow = {
  subjectCnpj: string;
  source: string;
  consultedAt: Date;
  memberKind: string;
  roleText: string | null;
  personKind: string;
  documentKind: string;
  memberCnpj: string | null;
  reliability: string;
  evidenceRef: string;
  memberIdentityKey?: string | null;
};

type PartyRow = {
  id: string;
  taxId: string | null;
  companyName: string;
  status?: string | null;
  relationshipStatus?: string | null;
};

export type CorporateRelationStore = {
  commercialCorporateMembership: {
    findMany(args: { where: Record<string, unknown> }): Promise<MembershipRow[]>;
    findFirst(args: { where: { evidenceRef: string } }): Promise<{ id: string } | null>;
    create(args: { data: MembershipRow & { subjectCustomerId: string | null } }): Promise<MembershipRow>;
  };
  customerCnpjLookup: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: { fetchedAt: "desc" };
    }): Promise<{ rawJson: unknown; fetchedAt: Date } | null>;
  };
  customer: {
    findMany(args: { where: { taxId: { in: string[] } } }): Promise<PartyRow[]>;
  };
};

function toDraft(row: MembershipRow): CorporateMembershipDraft {
  return {
    subjectCnpj: normalizeCnpj(row.subjectCnpj),
    source: row.source,
    consultedAt: row.consultedAt,
    memberKind: row.memberKind as CorporateMembershipDraft["memberKind"],
    roleText: row.roleText,
    personKind: row.personKind as CorporateMembershipDraft["personKind"],
    documentKind: row.documentKind as CorporateMembershipDraft["documentKind"],
    memberCnpj: row.memberCnpj ? normalizeCnpj(row.memberCnpj) : null,
    reliability: row.reliability === "HIGH" ? "HIGH" : "INSUFFICIENT",
    evidenceRef: row.evidenceRef,
    identityKey: row.memberIdentityKey ?? null,
    nameKey: null,
  };
}

function sourceLabel(source: string): string {
  if (source === "brasilapi") return "BrasilAPI";
  if (source === "publica.cnpj.ws") return "publica.cnpj.ws";
  if (source === "cadastro") return "Cadastro";
  return source;
}

export function presentCorporateRelation(
  relation: Pick<
    CorporateRelation,
    "memberKind" | "registryKind" | "relatedCompanyName" | "relatedCnpj" | "source" | "consultedAt" | "basis"
  >,
  creditStatusLabel: string
): CorporateRelationView {
  const consulted = new Date(relation.consultedAt);
  const when = Number.isNaN(consulted.getTime()) ? "data indisponível" : consulted.toLocaleDateString("pt-BR");
  const basis =
    relation.basis === "SHARED_CNPJ"
      ? "CNPJ societário em comum"
      : relation.basis === "SHARED_CPF"
        ? "CPF de sócio ou administrador conferido"
        : relation.basis === "TRANSITIVE"
          ? "Cadeia de vínculos confirmados"
          : "CNPJ do quadro societário";
  const registry = relation.registryKind === "LEAD" ? "Lead" : "Cliente";
  return {
    kindLabel: CORPORATE_MEMBER_KIND_LABEL[relation.memberKind],
    relatedCompany: `${registry} · ${relation.relatedCompanyName} · ${formatCnpj(relation.relatedCnpj)}`,
    creditStatusLabel,
    evidence: `${sourceLabel(relation.source)} · ${when} · ${basis}. Não transfere dívida.`,
  };
}

export function creditStatusLabel(status: string | null): string {
  if (status === "REGULAR") return "Regular";
  if (status === "OVERDUE") return "Inadimplente";
  if (status === "PROTESTED") return "Protestada";
  if (status === "UNKNOWN") return "Não verificado";
  return "Não consultado";
}

function mergeDrafts(target: CorporateMembershipDraft[], rows: readonly CorporateMembershipDraft[]) {
  const seen = new Set(target.map((row) => row.evidenceRef));
  for (const row of rows) {
    if (seen.has(row.evidenceRef)) continue;
    seen.add(row.evidenceRef);
    target.push(row);
  }
}

async function findByIdentityKey(db: CorporateRelationStore, keys: readonly string[]): Promise<MembershipRow[]> {
  if (keys.length === 0) return [];
  try {
    return await db.commercialCorporateMembership.findMany({
      where: { memberIdentityKey: { in: [...keys] } },
    });
  } catch (error) {
    console.error("corporate-identity-read", error instanceof Error ? error.name : "error");
    return [];
  }
}

function preferDirectRelations(relations: readonly CorporateRelation[]): CorporateRelation[] {
  const byRelated = new Map<string, CorporateRelation>();
  for (const relation of relations) {
    const current = byRelated.get(relation.relatedCustomerId);
    if (!current || (current.basis === "TRANSITIVE" && relation.basis !== "TRANSITIVE")) {
      byRelated.set(relation.relatedCustomerId, relation);
    }
  }
  return [...byRelated.values()];
}

export async function loadCorporateRelationAssessment(
  db: CorporateRelationStore,
  input: { customerId: string; cnpj: string | null; now: Date }
): Promise<{ relations: CorporateRelation[]; candidates: CorporateCandidate[] }> {
  const cnpj = normalizeCnpj(input.cnpj);
  const stored = cnpj
    ? await db.commercialCorporateMembership.findMany({
        where: { OR: [{ subjectCnpj: cnpj }, { subjectCustomerId: input.customerId }] },
      })
    : [];
  const drafts = stored.map(toDraft);
  if (cnpj) {
    const lookup = await db.customerCnpjLookup.findFirst({
      where: { OR: [{ customerId: input.customerId }, { cnpj }] },
      orderBy: { fetchedAt: "desc" },
    });
    if (lookup) mergeDrafts(drafts, extractMembershipsFromLookup(lookup.rawJson, lookup.fetchedAt));
  }
  const queriedCnpj = new Set<string>();
  const queriedKey = new Set<string>();
  const queriedSubject = new Set<string>(cnpj ? [cnpj] : []);
  for (let hop = 0; hop < 3; hop += 1) {
    const partnerCnpjs = [
      ...new Set(drafts.flatMap((row) => (row.memberCnpj ? [row.memberCnpj] : []))),
    ]
      .filter((value) => !queriedCnpj.has(value))
      .slice(0, CORPORATE_RELATION_COMPONENT_LIMIT);
    const identityKeys = [...new Set(drafts.flatMap((row) => (row.identityKey ? [row.identityKey] : [])))]
      .filter((value) => !queriedKey.has(value))
      .slice(0, CORPORATE_RELATION_COMPONENT_LIMIT);
    for (const value of partnerCnpjs) queriedCnpj.add(value);
    for (const value of identityKeys) queriedKey.add(value);
    if (partnerCnpjs.length > 0) {
      const shared = await db.commercialCorporateMembership.findMany({
        where: { memberCnpj: { in: partnerCnpjs } },
      });
      mergeDrafts(drafts, shared.map(toDraft));
    }
    if (identityKeys.length > 0) {
      mergeDrafts(drafts, (await findByIdentityKey(db, identityKeys)).map(toDraft));
    }
    const subjects = [...new Set(drafts.map((row) => row.subjectCnpj))]
      .filter((value) => value && !queriedSubject.has(value))
      .slice(0, CORPORATE_RELATION_COMPONENT_LIMIT);
    for (const value of subjects) queriedSubject.add(value);
    if (partnerCnpjs.length === 0 && identityKeys.length === 0 && subjects.length === 0) break;
    if (subjects.length > 0) {
      const expanded = await db.commercialCorporateMembership.findMany({
        where: { subjectCnpj: { in: subjects } },
      });
      mergeDrafts(drafts, expanded.map(toDraft));
    }
  }
  const wanted = [
    ...new Set(drafts.flatMap((row) => [row.subjectCnpj, row.memberCnpj].filter((value): value is string => Boolean(value)))),
  ];
  const taxIdKeys = [
    ...new Set(wanted.flatMap((cnpj) => [cnpj, formatCnpj(cnpj)]).filter((value) => value && value !== "—")),
  ];
  const parties = taxIdKeys.length ? await db.customer.findMany({ where: { taxId: { in: taxIdKeys } } }) : [];
  const registered: RegisteredCorporateParty[] = parties.map((party) => ({
    customerId: party.id,
    cnpj: normalizeCnpj(party.taxId),
    companyName: party.companyName,
    registryKind: registryKindOf(party),
  }));
  const report = analyzeCorporateRelations({
    memberships: drafts,
    parties: registered,
    now: input.now,
    subjectCnpjs: cnpj ? [cnpj] : [],
  });
  const relations = preferDirectRelations(
    report.relations.filter((relation) => relation.subjectCustomerId === input.customerId)
  );
  const confirmed = new Set(relations.map((relation) => relation.relatedCustomerId));
  return {
    relations,
    candidates: report.candidates.filter(
      (candidate) => candidate.subjectCustomerId === input.customerId && !confirmed.has(candidate.relatedCustomerId)
    ),
  };
}

export async function loadCorporateRelations(
  db: CorporateRelationStore,
  input: { customerId: string; cnpj: string | null; now: Date }
): Promise<CorporateRelation[]> {
  return (await loadCorporateRelationAssessment(db, input)).relations;
}

export function presentCorporateCandidate(candidate: CorporateCandidate): CorporateRelationView {
  const consulted = new Date(candidate.consultedAt);
  const when = Number.isNaN(consulted.getTime()) ? "data indisponível" : consulted.toLocaleDateString("pt-BR");
  const registry = candidate.registryKind === "LEAD" ? "Lead" : "Cliente";
  return {
    kindLabel: "Pendente de validação",
    relatedCompany: `${registry} · ${candidate.relatedCompanyName} · ${formatCnpj(candidate.relatedCnpj)}`,
    creditStatusLabel: "Não comprovado",
    evidence: `${when} · Nome coincidente no quadro societário. Não comprova identidade e não transfere dívida.`,
  };
}

export async function recordCorporateMembershipsFromLookup(
  db: CorporateRelationStore,
  input: { customerId: string | null; rawJson: unknown; consultedAt: Date }
): Promise<{ inserted: number; skipped: number; deleted: 0 }> {
  const memberships = extractMembershipsFromLookup(input.rawJson, input.consultedAt);
  if (memberships.length === 0) return { inserted: 0, skipped: 0, deleted: 0 };
  return appendCorporateMemberships(db, { customerId: input.customerId, memberships });
}

/** Inclusão histórica. Repetir a mesma evidência não altera a consulta anterior. */
export async function appendCorporateMemberships(
  db: CorporateRelationStore,
  input: { customerId: string | null; memberships: readonly CorporateMembershipDraft[] }
): Promise<{ inserted: number; skipped: number; deleted: 0 }> {
  let inserted = 0;
  let skipped = 0;
  for (const row of input.memberships) {
    const existing = await db.commercialCorporateMembership.findFirst({ where: { evidenceRef: row.evidenceRef } });
    if (existing) {
      skipped += 1;
      continue;
    }
    const data = {
      subjectCnpj: row.subjectCnpj,
      subjectCustomerId: input.customerId,
      source: row.source,
      consultedAt: row.consultedAt,
      memberKind: row.memberKind,
      roleText: row.roleText,
      personKind: row.personKind,
      documentKind: row.documentKind,
      memberCnpj: row.memberCnpj,
      reliability: row.reliability,
      evidenceRef: row.evidenceRef,
      memberIdentityKey: row.identityKey,
    };
    try {
      await db.commercialCorporateMembership.create({ data });
    } catch (error) {
      if (data.memberIdentityKey == null) throw error;
      const { memberIdentityKey: _ignored, ...legacy } = data;
      await db.commercialCorporateMembership.create({ data: legacy });
    }
    inserted += 1;
  }
  return { inserted, skipped, deleted: 0 };
}
