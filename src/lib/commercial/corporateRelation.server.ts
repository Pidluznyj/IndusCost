/**
 * Leitura e inclusão histórica de QSA.
 * Não apaga consulta anterior e não varre a base para gravar em massa.
 */

import { formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  CORPORATE_MEMBER_KIND_LABEL,
  analyzeCorporateRelations,
  extractMembershipsFromLookup,
  registryKindOf,
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
  const basis = relation.basis === "SHARED_CNPJ" ? "CNPJ societário em comum" : "CNPJ do quadro societário";
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

export async function loadCorporateRelations(
  db: CorporateRelationStore,
  input: { customerId: string; cnpj: string | null; now: Date }
): Promise<CorporateRelation[]> {
  const cnpj = normalizeCnpj(input.cnpj);
  const stored = cnpj
    ? await db.commercialCorporateMembership.findMany({
        where: { OR: [{ subjectCnpj: cnpj }, { subjectCustomerId: input.customerId }] },
      })
    : [];
  let drafts = stored.map(toDraft);
  if (drafts.length === 0 && cnpj) {
    const lookup = await db.customerCnpjLookup.findFirst({
      where: { OR: [{ customerId: input.customerId }, { cnpj }] },
      orderBy: { fetchedAt: "desc" },
    });
    if (lookup) drafts = extractMembershipsFromLookup(lookup.rawJson, lookup.fetchedAt);
  }
  const partnerCnpjs = [...new Set(drafts.flatMap((row) => (row.memberCnpj ? [row.memberCnpj] : [])))];
  if (partnerCnpjs.length > 0) {
    const shared = await db.commercialCorporateMembership.findMany({
      where: { memberCnpj: { in: partnerCnpjs } },
    });
    const seen = new Set(drafts.map((row) => row.evidenceRef));
    for (const row of shared.map(toDraft)) {
      if (!seen.has(row.evidenceRef)) drafts.push(row);
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
  return analyzeCorporateRelations({
    memberships: drafts,
    parties: registered,
    now: input.now,
    subjectCnpjs: cnpj ? [cnpj] : [],
  }).relations.filter((relation) => relation.subjectCustomerId === input.customerId);
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
    await db.commercialCorporateMembership.create({
      data: {
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
      },
    });
    inserted += 1;
  }
  return { inserted, skipped, deleted: 0 };
}
