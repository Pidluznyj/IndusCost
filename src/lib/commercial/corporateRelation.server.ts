/**
 * Leitura e inclusão histórica de QSA.
 * Não apaga consulta anterior e não varre a base para gravar em massa.
 */

import { formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  CORPORATE_MEMBER_KIND_LABEL,
  CORPORATE_RELATION_COMPONENT_LIMIT,
  analyzeCorporateRelations,
  expandConfirmedCustomerIds,
  extractMembershipsFromLookup,
  registryKindOf,
  visibleCorporateCandidates,
  type CorporateCandidate,
  type CorporateMembershipDraft,
  type CorporateRelation,
  type RegisteredCorporateParty,
} from "./corporateRelation.js";
import { scanCorporateRadar, type RadarCorrelation, type RadarParty, type RadarScanResult } from "./corporateRadar.js";
import { loadRadarCatalog, type RadarCatalog } from "./corporateRadarCatalog.server.js";

export type CorporateRelationView = {
  kindLabel: string;
  relatedCompany: string;
  relatedCustomerId: string | null;
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
  memberName?: string | null;
  memberNameKey?: string | null;
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
    nameKey: row.memberNameKey ?? null,
    displayName: row.memberName ?? null,
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
    "memberKind" | "registryKind" | "relatedCompanyName" | "relatedCnpj" | "relatedCustomerId" | "source" | "consultedAt" | "basis"
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
          : relation.basis === "SAME_ROOT"
            ? "Mesma raiz de CNPJ. Estabelecimentos do mesmo CNPJ-base, não cadastro duplicado"
            : "CNPJ do quadro societário";
  const registry = relation.registryKind === "LEAD" ? "Lead" : "Cliente";
  return {
    kindLabel: CORPORATE_MEMBER_KIND_LABEL[relation.memberKind],
    relatedCompany: `${registry} · ${relation.relatedCompanyName} · ${formatCnpj(relation.relatedCnpj)}`,
    relatedCustomerId: relation.relatedCustomerId,
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

function otherPartyId(item: { customerId: string; relatedCustomerId: string }, customerId: string): string | null {
  if (item.customerId === customerId) return item.relatedCustomerId;
  if (item.relatedCustomerId === customerId) return item.customerId;
  return null;
}

/** Indício cadastral permanece pendente. Só a mesma raiz formal entra como relação. */
export function collectRadarCreditSignals(
  scan: RadarScanResult,
  customerId: string,
  named: ReadonlyMap<string, RadarParty>,
  confirmed: ReadonlySet<string>,
  now: Date
): { relations: CorporateRelation[]; candidates: CorporateCandidate[] } {
  const relations: CorporateRelation[] = [];
  const candidates: CorporateCandidate[] = [];
  const consultedAt = now.toISOString();
  const pushFormal = (item: RadarCorrelation) => {
    if (!item.patterns.some((pattern) => pattern.code === "REL-01")) return;
    const relatedId = otherPartyId(item, customerId);
    if (!relatedId || confirmed.has(relatedId)) return;
    const peer = named.get(relatedId);
    if (!peer) return;
    relations.push({
      subjectCustomerId: customerId,
      relatedCustomerId: relatedId,
      relatedCompanyName: peer.companyName,
      relatedCnpj: peer.cnpj,
      registryKind: "CUSTOMER",
      memberKind: "UNKNOWN",
      basis: "SAME_ROOT",
      source: "CADASTRO",
      consultedAt,
      evidenceRef: item.fingerprint,
      partnerCnpj: peer.cnpj.slice(0, 8),
    });
  };
  for (const formal of scan.formal) pushFormal(formal);
  for (const item of scan.reviewQueue) {
    const relatedId = otherPartyId(item, customerId);
    const pattern = item.patterns.find((row) => row.code === "REL-05" || row.code === "REL-06" || row.code === "REL-07");
    if (!relatedId || !pattern) continue;
    const peer = named.get(relatedId);
    if (!peer) continue;
    candidates.push({
      subjectCustomerId: customerId,
      relatedCustomerId: relatedId,
      relatedCompanyName: peer.companyName,
      relatedCnpj: peer.cnpj,
      registryKind: "CUSTOMER",
      basis: pattern.code === "REL-06" ? "SHARED_PHONE" : pattern.code === "REL-07" ? "SHARED_EMAIL" : "SHARED_ADDRESS",
      status: "PENDING_REVIEW",
      consultedAt,
      evidenceLabel: pattern.evidence,
    });
  }
  return { relations, candidates };
}

export async function loadCorporateRelationAssessment(
  db: CorporateRelationStore,
  input: {
    customerId: string;
    cnpj: string | null;
    now: Date;
    rejected?: readonly { relatedCustomerId: string; fingerprint: string | null }[];
  },
  options?: { includeRadar?: boolean; radarCatalog?: RadarCatalog }
): Promise<{ relations: CorporateRelation[]; candidates: CorporateCandidate[]; radarReadFailed: boolean }> {
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
  const nameKeys = [...new Set(drafts.flatMap((row) => (row.nameKey ? [row.nameKey] : [])))].slice(
    0,
    CORPORATE_RELATION_COMPONENT_LIMIT
  );
  if (nameKeys.length > 0) {
    try {
      const named = await db.commercialCorporateMembership.findMany({
        where: { memberNameKey: { in: nameKeys } },
      });
      mergeDrafts(drafts, named.map(toDraft));
    } catch (error) {
      console.error("corporate-name-read", error instanceof Error ? error.name : "error");
    }
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
  let radarCandidates: CorporateCandidate[] = [];
  let radarRelations: CorporateRelation[] = [];
  let radarReadFailed = false;
  if (options?.includeRadar !== false) {
    const catalog = options?.radarCatalog ?? (await loadRadarCatalog(db));
    if (catalog.readFailed || !catalog.complete) {
      radarReadFailed = true;
    } else {
      try {
        const scan = scanCorporateRadar({
          parties: catalog.parties,
          memberships: drafts.map((row) => ({
            subjectCustomerId: registered.find((party) => party.cnpj === row.subjectCnpj)?.customerId ?? "",
            nameKey: row.nameKey,
            displayName: row.displayName,
            identityKey: row.identityKey,
            memberCnpj: row.memberCnpj,
            source: row.source,
            consultedAt: row.consultedAt.toISOString(),
          })).filter((row) => row.subjectCustomerId),
          seeds: [input.customerId],
          now: input.now,
        });
        const named = new Map(catalog.parties.map((party) => [party.customerId, party]));
        const collected = collectRadarCreditSignals(scan, input.customerId, named, confirmed, input.now);
        radarRelations = collected.relations;
        radarCandidates = collected.candidates;
      } catch (error) {
        console.error("corporate-radar-read", error instanceof Error ? error.name : "error");
        radarReadFailed = true;
      }
    }
  }
  const candidates = visibleCorporateCandidates(
    [...report.candidates, ...radarCandidates].filter(
      (candidate) => candidate.subjectCustomerId === input.customerId && !confirmed.has(candidate.relatedCustomerId)
    ),
    input.rejected ?? []
  );
  return { relations: [...relations, ...radarRelations], candidates, radarReadFailed };
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
  const digits = candidate.evidenceLabel.replace(/\D/g, "");
  const evidence =
    candidate.basis === "SHARED_PHONE"
      ? `${when} · Telefone coincidente terminado em ${digits.slice(-4) || "—"}. Indício, não prova societária e não transfere dívida.`
      : candidate.basis === "SHARED_EMAIL"
        ? `${when} · E-mail coincidente. Indício, não prova societária e não transfere dívida.`
        : candidate.basis === "SHARED_ADDRESS"
          ? `${when} · Endereço fiscal coincidente. Indício, não prova societária e não transfere dívida.`
          : `${when} · Nome coincidente: ${candidate.evidenceLabel}. Não comprova identidade e não transfere dívida.`;
  return {
    kindLabel: "Pendente de validação",
    relatedCompany: `${registry} · ${candidate.relatedCompanyName} · ${formatCnpj(candidate.relatedCnpj)}`,
    relatedCustomerId: candidate.relatedCustomerId,
    creditStatusLabel: "Não comprovado",
    evidence,
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
      memberName: row.displayName ?? null,
      memberNameKey: row.nameKey,
    };
    try {
      await db.commercialCorporateMembership.create({ data });
    } catch (error) {
      const { memberName: _name, memberNameKey: _nameKey, memberIdentityKey, ...legacy } = data;
      try {
        await db.commercialCorporateMembership.create({
          data: memberIdentityKey ? { ...legacy, memberIdentityKey } : legacy,
        });
      } catch (second) {
        if (memberIdentityKey == null) throw second;
        await db.commercialCorporateMembership.create({ data: legacy });
      }
      void error;
    }
    inserted += 1;
  }
  return { inserted, skipped, deleted: 0 };
}

type CorporateLinkRow = {
  customerId?: string;
  relatedCustomerId?: string;
  status?: string | null;
  evidenceFingerprint?: string | null;
  closedAt?: Date | string | null;
};

export async function loadCorporateLinkGraph(
  db: { customerCorporateLink: { findMany(args: unknown): Promise<CorporateLinkRow[]> } },
  startId: string
): Promise<{
  confirmedIds: string[];
  overflow: boolean;
  rejected: Array<{ relatedCustomerId: string; fingerprint: string | null }>;
}> {
  const confirmedEdges: Array<{ leftId: string; rightId: string }> = [];
  const rejected: Array<{ relatedCustomerId: string; fingerprint: string | null }> = [];
  const visited = new Set<string>();
  let frontier = [startId];
  for (let hop = 0; hop < 4 && frontier.length > 0; hop += 1) {
    const batch = frontier.filter((id) => !visited.has(id));
    for (const id of batch) visited.add(id);
    if (batch.length === 0) break;
    let rows: CorporateLinkRow[] = [];
    try {
      rows = await db.customerCorporateLink.findMany({
        where: { OR: [{ customerId: { in: batch } }, { relatedCustomerId: { in: batch } }] },
      });
    } catch {
      if (hop > 0) break;
      try {
        rows = await db.customerCorporateLink.findMany({
          where: { customerId: startId },
          select: { relatedCustomerId: true },
        });
      } catch {
        rows = [];
      }
    }
    const next: string[] = [];
    for (const row of rows) {
      const left = row.customerId || startId;
      const right = row.relatedCustomerId || "";
      if (!right || left === right) continue;
      const status = row.status || "CONFIRMED";
      const fingerprint = row.evidenceFingerprint ?? null;
      if (status === "REJECTED") {
        if (left === startId) rejected.push({ relatedCustomerId: right, fingerprint });
        else if (right === startId) rejected.push({ relatedCustomerId: left, fingerprint });
        continue;
      }
      if (status === "CLOSED" || row.closedAt) continue;
      if (status !== "CONFIRMED") continue;
      confirmedEdges.push({ leftId: left, rightId: right });
      if (!visited.has(left)) next.push(left);
      if (!visited.has(right)) next.push(right);
    }
    frontier = [...new Set(next)];
  }
  const expanded = expandConfirmedCustomerIds(startId, confirmedEdges);
  return { confirmedIds: expanded.ids, overflow: expanded.overflow, rejected };
}

export async function loadCorporateLinkGraphs(
  db: { customerCorporateLink: { findMany(args: unknown): Promise<CorporateLinkRow[]> } },
  startIds: readonly string[]
): Promise<{
  graphs: Map<string, { confirmedIds: string[]; overflow: boolean; rejected: Array<{ relatedCustomerId: string; fingerprint: string | null }> }>;
  readFailed: boolean;
}> {
  const starts = [...new Set(startIds)];
  const graphs = new Map<string, { confirmedIds: string[]; overflow: boolean; rejected: Array<{ relatedCustomerId: string; fingerprint: string | null }> }>();
  if (starts.length === 0) return { graphs, readFailed: false };
  const confirmedEdges: Array<{ leftId: string; rightId: string }> = [];
  const rejectedByStart = new Map<string, Array<{ relatedCustomerId: string; fingerprint: string | null }>>();
  const startSet = new Set(starts);
  const visited = new Set<string>();
  let frontier = [...starts];
  for (let hop = 0; hop < 4 && frontier.length > 0; hop += 1) {
    const batch = frontier.filter((id) => !visited.has(id));
    for (const id of batch) visited.add(id);
    if (batch.length === 0) break;
    let rows: CorporateLinkRow[] = [];
    try {
      rows = await db.customerCorporateLink.findMany({
        where: { OR: [{ customerId: { in: batch } }, { relatedCustomerId: { in: batch } }] },
      });
    } catch {
      return { graphs, readFailed: true };
    }
    const next: string[] = [];
    for (const row of rows) {
      const left = row.customerId || "";
      const right = row.relatedCustomerId || "";
      if (!left || !right || left === right) continue;
      const status = row.status || "CONFIRMED";
      const fingerprint = row.evidenceFingerprint ?? null;
      if (status === "REJECTED") {
        if (startSet.has(left)) {
          const list = rejectedByStart.get(left) ?? [];
          list.push({ relatedCustomerId: right, fingerprint });
          rejectedByStart.set(left, list);
        }
        if (startSet.has(right)) {
          const list = rejectedByStart.get(right) ?? [];
          list.push({ relatedCustomerId: left, fingerprint });
          rejectedByStart.set(right, list);
        }
        continue;
      }
      if (status === "CLOSED" || row.closedAt) continue;
      if (status !== "CONFIRMED") continue;
      confirmedEdges.push({ leftId: left, rightId: right });
      if (!visited.has(left)) next.push(left);
      if (!visited.has(right)) next.push(right);
    }
    frontier = [...new Set(next)];
  }
  for (const startId of starts) {
    const expanded = expandConfirmedCustomerIds(startId, confirmedEdges);
    graphs.set(startId, {
      confirmedIds: expanded.ids,
      overflow: expanded.overflow,
      rejected: rejectedByStart.get(startId) ?? [],
    });
  }
  return { graphs, readFailed: false };
}
