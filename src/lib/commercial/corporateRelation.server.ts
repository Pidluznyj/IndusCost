/**
 * Leitura e inclusão histórica de QSA.
 * Não apaga consulta anterior e não varre a base para gravar em massa.
 */

import { createHash } from "node:crypto";
import { formatCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  CORPORATE_MEMBER_KIND_LABEL,
  CORPORATE_RELATION_COMPONENT_LIMIT,
  analyzeCorporateRelations,
  corporateAddressKey,
  expandConfirmedCustomerIds,
  extractMembershipsFromLookup,
  registryKindOf,
  visibleCorporateCandidates,
  type CorporateCandidate,
  type CorporateMembershipDraft,
  type CorporateRelation,
  type RegisteredCorporateParty,
} from "./corporateRelation.js";
import {
  classifyCorporateEmail,
  scanCorporateRadar,
  type RadarCorrelation,
  type RadarParty,
  type RadarScanResult,
} from "./corporateRadar.js";
import { loadRadarCatalog, type RadarCatalog } from "./corporateRadarCatalog.server.js";

export type CorporateRelationView = {
  kindLabel: string;
  relatedCompany: string;
  relatedCustomerId: string | null;
  creditStatusLabel: string;
  evidence: string;
  /** FORMAL = QSA ou mesma raiz (não se encerra aqui); MANUAL = confirmado por pessoa autorizada; PENDING = indício. */
  origin?: "FORMAL" | "MANUAL" | "PENDING";
  /** Só o vínculo manual confirmado pode ser encerrado. */
  closable?: boolean;
  companyName?: string;
  cnpjLabel?: string;
  evidenceTypeLabel?: string;
  sourceLabel?: string;
  reliabilityLabel?: string;
  dateLabel?: string;
  /** Quem decidiu, quando e por quê (vínculo manual ou histórico). */
  reviewNote?: string | null;
};

export type CorporateLinkHistoryView = {
  relatedCustomerId: string;
  companyName: string;
  cnpjLabel: string;
  statusLabel: "Rejeitado" | "Encerrado";
  reviewNote: string;
};

function formatReviewDate(value: string | null): string {
  if (!value) return "data indisponível";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "data indisponível" : date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function reviewNote(row: { actorName: string | null; reviewedAt: string | null; justification: string | null }, verb: string): string {
  const who = row.actorName ?? "usuário não identificado";
  const why = row.justification?.trim() ? ` Justificativa: ${row.justification.trim()}` : "";
  return `${verb} por ${who} em ${formatReviewDate(row.reviewedAt)}.${why}`;
}

/** Vínculo confirmado manualmente: entra no grupo de risco e pode ser encerrado por pessoa autorizada. */
export function presentManualCorporateLink(
  row: {
    relatedCustomerId: string;
    relatedCompanyName: string;
    relatedCnpj: string | null;
    actorName: string | null;
    reviewedAt: string | null;
    justification: string | null;
  },
  creditStatusLabel: string
): CorporateRelationView {
  const cnpjLabel = row.relatedCnpj ? formatCnpj(row.relatedCnpj) : "—";
  return {
    kindLabel: "Confirmado manualmente",
    relatedCompany: `Cliente · ${row.relatedCompanyName} · ${cnpjLabel}`,
    relatedCustomerId: row.relatedCustomerId,
    creditStatusLabel,
    evidence: "Vínculo confirmado por pessoa autorizada. Entra no grupo de risco; não transfere dívida.",
    origin: "MANUAL",
    closable: true,
    companyName: row.relatedCompanyName,
    cnpjLabel,
    evidenceTypeLabel: "Confirmação manual",
    sourceLabel: "Revisão de Financeiro ou Diretoria",
    reliabilityLabel: "Decisão humana registrada",
    dateLabel: formatReviewDate(row.reviewedAt),
    reviewNote: reviewNote(row, "Confirmado"),
  };
}

export function presentCorporateLinkHistory(row: {
  relatedCustomerId: string;
  relatedCompanyName: string;
  relatedCnpj: string | null;
  status: "REJECTED" | "CLOSED";
  actorName: string | null;
  reviewedAt: string | null;
  justification: string | null;
}): CorporateLinkHistoryView {
  return {
    relatedCustomerId: row.relatedCustomerId,
    companyName: row.relatedCompanyName,
    cnpjLabel: row.relatedCnpj ? formatCnpj(row.relatedCnpj) : "—",
    statusLabel: row.status === "REJECTED" ? "Rejeitado" : "Encerrado",
    reviewNote: reviewNote(row, row.status === "REJECTED" ? "Rejeitado" : "Encerrado"),
  };
}

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
    origin: "FORMAL",
    closable: false,
    companyName: relation.relatedCompanyName,
    cnpjLabel: formatCnpj(relation.relatedCnpj),
    evidenceTypeLabel: basis.split(".")[0],
    sourceLabel: sourceLabel(relation.source),
    reliabilityLabel: "Comprovado por documento",
    dateLabel: when,
    reviewNote: null,
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
    // Uma evidência por padrão: telefone novo num par com endereço já rejeitado é evidência nova e reabre a revisão.
    const patterns = item.patterns.filter((row) => row.code === "REL-05" || row.code === "REL-06" || row.code === "REL-07");
    if (!relatedId || patterns.length === 0) continue;
    const peer = named.get(relatedId);
    if (!peer) continue;
    for (const pattern of patterns) {
      candidates.push({
        subjectCustomerId: customerId,
        relatedCustomerId: relatedId,
        relatedCompanyName: peer.companyName,
        relatedCnpj: peer.cnpj,
        registryKind: "CUSTOMER",
        basis: pattern.code === "REL-06" ? "SHARED_PHONE" : pattern.code === "REL-07" ? "SHARED_EMAIL" : "SHARED_ADDRESS",
        status: "PENDING_REVIEW",
        consultedAt,
        evidenceLabel: radarEvidenceLabel(pattern.code, pattern.evidence, named.get(customerId)),
      });
    }
  }
  return { relations, candidates };
}

/**
 * Texto do indício com uma referência do valor coincidente (hash curto, sem o dado).
 * Assim a impressão da rejeição muda quando o endereço ou o e-mail em comum mudam e a revisão reabre;
 * a mesma coincidência continua com a mesma impressão. O telefone já traz os 4 últimos dígitos no texto.
 */
function radarEvidenceLabel(code: string, evidence: string, subject: RadarParty | undefined): string {
  const shared =
    code === "REL-05" && subject
      ? corporateAddressKey(subject)
      : code === "REL-07" && subject
        ? classifyCorporateEmail(subject.email).email
        : null;
  if (!shared) return evidence;
  return `${evidence} ref ${createHash("sha256").update(shared).digest("hex").slice(0, 12)}`;
}

export async function loadCorporateRelationAssessment(
  db: CorporateRelationStore,
  input: {
    customerId: string;
    cnpj: string | null;
    now: Date;
    rejected?: readonly { relatedCustomerId: string; fingerprint: string | null }[];
    /** Empresas já confirmadas manualmente (grafo de CustomerCorporateLink): não ficam pendentes. */
    manualConfirmedIds?: readonly string[];
  },
  options?: { includeRadar?: boolean; radarCatalog?: RadarCatalog }
): Promise<{
  relations: CorporateRelation[];
  candidates: CorporateCandidate[];
  /** Todos os indícios atuais, antes das decisões humanas. Base das impressões ao rejeitar ou encerrar. */
  evidenceCandidates: CorporateCandidate[];
  radarReadFailed: boolean;
}> {
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
  const evidenceCandidates = [...report.candidates, ...radarCandidates].filter(
    (candidate) => candidate.subjectCustomerId === input.customerId && !confirmed.has(candidate.relatedCustomerId)
  );
  const candidates = visibleCorporateCandidates(evidenceCandidates, input.rejected ?? [], input.manualConfirmedIds ?? []);
  return { relations: [...relations, ...radarRelations], candidates, evidenceCandidates, radarReadFailed };
}

/**
 * Radar de um cliente (GET /api/customers/:id/corporate-radar). Só leitura.
 * Aplica as mesmas decisões humanas da ficha de crédito: rejeitado, encerrado ou confirmado não volta como pendente;
 * o confirmado manualmente aparece em "manual".
 */
export async function loadCustomerCorporateRadarView(
  db: CorporateRelationStore & { customerCorporateLink: { findMany(args: unknown): Promise<CorporateLinkRow[]> } },
  customer: { id: string; taxId: string | null },
  now: Date
): Promise<{
  writes: "NONE";
  formal: CorporateRelationView[];
  manual: string[];
  review: CorporateRelationView[];
  radarReadFailed: boolean;
}> {
  const graph = await loadCorporateLinkGraph(db, customer.id);
  const assessment = await loadCorporateRelationAssessment(db, {
    customerId: customer.id,
    cnpj: customer.taxId,
    now,
    rejected: graph.rejected,
    manualConfirmedIds: graph.confirmedIds,
  });
  return {
    writes: "NONE",
    formal: assessment.relations.map((relation) => presentCorporateRelation(relation, "Conferido pelo cadastro")),
    manual: graph.confirmedIds,
    review: presentCorporateCandidates(assessment.candidates),
    radarReadFailed: assessment.radarReadFailed,
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
    origin: "PENDING",
    closable: false,
    companyName: candidate.relatedCompanyName,
    cnpjLabel: formatCnpj(candidate.relatedCnpj),
    evidenceTypeLabel: CANDIDATE_BASIS_LABEL[candidate.basis],
    sourceLabel: candidate.basis === "SHARED_NAME" ? "Quadro societário consultado" : "Radar · cadastro dos clientes",
    reliabilityLabel: "Baixa · indício, não prova",
    dateLabel: when,
    reviewNote: null,
  };
}

const CANDIDATE_BASIS_LABEL: Record<CorporateCandidate["basis"], string> = {
  SHARED_NAME: "Nome de sócio coincidente",
  SHARED_ADDRESS: "Mesmo endereço fiscal",
  SHARED_PHONE: "Mesmo telefone",
  SHARED_EMAIL: "Mesmo e-mail",
};

/** Um item por empresa: a decisão vale para todas as evidências do par de uma vez. */
export function presentCorporateCandidates(candidates: readonly CorporateCandidate[]): CorporateRelationView[] {
  const byRelated = new Map<string, CorporateRelationView>();
  for (const candidate of candidates) {
    const view = presentCorporateCandidate(candidate);
    const current = byRelated.get(candidate.relatedCustomerId);
    if (!current) {
      byRelated.set(candidate.relatedCustomerId, view);
      continue;
    }
    if (!current.evidenceTypeLabel?.includes(view.evidenceTypeLabel ?? "")) {
      current.evidenceTypeLabel = `${current.evidenceTypeLabel} + ${view.evidenceTypeLabel}`;
    }
    if (!current.evidence.includes(view.evidence)) current.evidence = `${current.evidence} ${view.evidence}`;
  }
  return [...byRelated.values()];
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
      // Rejeitado ou encerrado: sai do grupo e a mesma evidência não volta a ficar pendente.
      if (status === "REJECTED" || status === "CLOSED" || row.closedAt) {
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
      // Rejeitado ou encerrado: sai do grupo e a mesma evidência não volta a ficar pendente.
      if (status === "REJECTED" || status === "CLOSED" || row.closedAt) {
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
