/**
 * Read model canônico: um CNJ = um processo executivo.
 * Agrupa duplicatas físicas históricas sem apagá-las.
 */

import { formatCnpj, formatCurrencyBrl } from "@/src/lib/companyCnpjFormat.js";
import { attentionLabel, collectAttentionFlags } from "./legalExposureAttention.js";
import { derivedEntityLinks, pickCanonicalCase } from "./legalExposureCanonical.js";
import { CASE_STAGE_LABELS, classifyCaseStage } from "./legalExposureCaseStage.js";
import {
  LEGAL_EXPOSURE_SOURCES,
  MULTIPLE_GROUP_NOTE,
  type ExposureCaseListItem,
  type ExposureExecutiveAttorney,
  type ExposureExecutiveHearing,
  type ExposureExecutiveParty,
  type ExposureExecutiveSubject,
  type ExposureGroupEntity,
  type ExposureTimelineItem,
  type LegalExposureSource,
  type Page,
} from "./legalExposureContracts.js";
import { formatProcessNumber, normalizeLegalName } from "./legalExposureNormalization.js";
import { maskPartyDocument } from "./legalExposurePrivacy.js";
import { eventDetail, eventTypeLabel, movementComplementsText } from "./legalExposureFeedUi.js";
import {
  displayProcessClass,
  enrichmentStatusOf,
  evidenceSourcesOf,
  latestMovementOf,
  latestPublicationOf,
  verificationStatusOf,
} from "./legalExposureCaseFacts.js";
import type {
  ExposureAttorneyRecord,
  ExposureCaseRecord,
  ExposureHearingRecord,
  ExposurePartyRecord,
  ExposureSubjectRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

export type ExposureListQuery = {
  entityId?: string | null;
  status?: string | null;
  tribunal?: string | null;
  source?: string | null;
  severity?: string | null;
  pole?: string | null;
  q?: string | null;
  from?: string | null;
  to?: string | null;
  verification?: string | null;
  enrichment?: string | null;
  stage?: string | null;
  className?: string | null;
  multipleGroup?: boolean | string | null;
  hasHearing?: boolean | string | null;
  hasRequiredAction?: boolean | string | null;
  filedFrom?: string | null;
  filedTo?: string | null;
  claimMin?: string | number | null;
  claimMax?: string | number | null;
  timelineKind?: string | null;
  communicationType?: string | null;
  page?: unknown;
  pageSize?: unknown;
};

export type MemoryIndexes = {
  entityById: Map<string, LegalExposureMemory["entities"][number]>;
  casesByProcess: Map<string, ExposureCaseRecord[]>;
  caseById: Map<string, ExposureCaseRecord>;
  linksByCase: Map<string, ReturnType<typeof derivedEntityLinks>>;
  linksByEntity: Map<string, ReturnType<typeof derivedEntityLinks>>;
  evidencesByCase: Map<string, LegalExposureMemory["evidences"]>;
  partiesByCase: Map<string, ExposurePartyRecord[]>;
  movementsByCase: Map<string, LegalExposureMemory["movements"]>;
  communicationsByCase: Map<string, LegalExposureMemory["communications"]>;
  eventsByCase: Map<string, LegalExposureMemory["events"]>;
  subjectsByCase: Map<string, ExposureSubjectRecord[]>;
  hearingsByCase: Map<string, ExposureHearingRecord[]>;
  attorneysByCase: Map<string, ExposureAttorneyRecord[]>;
};

function pushIndex<T>(map: Map<string, T[]>, key: string, row: T) {
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

export function indexExposureMemory(memory: LegalExposureMemory): MemoryIndexes {
  const entityById = new Map(memory.entities.map((row) => [row.id, row]));
  const casesByProcess = new Map<string, ExposureCaseRecord[]>();
  const caseById = new Map(memory.cases.map((row) => [row.id, row]));
  for (const row of memory.cases) pushIndex(casesByProcess, row.processNumberNormalized, row);
  const links = derivedEntityLinks(memory);
  const linksByCase = new Map<string, typeof links>();
  const linksByEntity = new Map<string, typeof links>();
  for (const row of links) {
    pushIndex(linksByCase, row.caseId, row);
    pushIndex(linksByEntity, row.entityId, row);
  }
  const evidencesByCase = new Map<string, LegalExposureMemory["evidences"]>();
  for (const row of memory.evidences) pushIndex(evidencesByCase, row.caseId, row);
  const partiesByCase = new Map<string, ExposurePartyRecord[]>();
  for (const row of memory.parties) pushIndex(partiesByCase, row.caseId, row);
  const movementsByCase = new Map<string, LegalExposureMemory["movements"]>();
  for (const row of memory.movements) pushIndex(movementsByCase, row.caseId, row);
  const communicationsByCase = new Map<string, LegalExposureMemory["communications"]>();
  for (const row of memory.communications) {
    if (row.caseId) pushIndex(communicationsByCase, row.caseId, row);
  }
  const eventsByCase = new Map<string, LegalExposureMemory["events"]>();
  for (const row of memory.events) {
    if (row.caseId) pushIndex(eventsByCase, row.caseId, row);
  }
  const subjectsByCase = new Map<string, ExposureSubjectRecord[]>();
  for (const row of memory.subjects) pushIndex(subjectsByCase, row.caseId, row);
  const hearingsByCase = new Map<string, ExposureHearingRecord[]>();
  for (const row of memory.hearings) pushIndex(hearingsByCase, row.caseId, row);
  const attorneysByCase = new Map<string, ExposureAttorneyRecord[]>();
  for (const row of memory.attorneys) pushIndex(attorneysByCase, row.caseId, row);
  return {
    entityById,
    casesByProcess,
    caseById,
    linksByCase,
    linksByEntity,
    evidencesByCase,
    partiesByCase,
    movementsByCase,
    communicationsByCase,
    eventsByCase,
    subjectsByCase,
    hearingsByCase,
    attorneysByCase,
  };
}

function collectForCases<T>(map: Map<string, T[]>, caseIds: string[]): T[] {
  const out: T[] = [];
  for (const id of caseIds) {
    const rows = map.get(id);
    if (rows) out.push(...rows);
  }
  return out;
}

function uniqueSources(sources: LegalExposureSource[]): LegalExposureSource[] {
  const present = new Set(sources);
  return LEGAL_EXPOSURE_SOURCES.filter((source) => present.has(source));
}

function partyKey(row: ExposurePartyRecord): string {
  if (row.documentNormalized) return `doc:${row.documentNormalized}`;
  return `name:${row.normalizedName}:${row.pole}:${row.partyType ?? ""}`;
}

function mergeParties(rows: ExposurePartyRecord[], entityByCnpj: Map<string, string>): ExposureExecutiveParty[] {
  const byKey = new Map<string, ExposurePartyRecord[]>();
  for (const row of rows) pushIndex(byKey, partyKey(row), row);
  return [...byKey.values()].map((group) => {
    const primary = group.find((row) => row.pole !== "UNKNOWN") ?? group[0]!;
    const document = group.find((row) => row.documentNormalized)?.documentNormalized ?? primary.documentNormalized;
    const entityId = document ? entityByCnpj.get(document) ?? null : null;
    return {
      name: primary.name,
      partyType: primary.partyType,
      pole: primary.pole,
      personType: primary.personType,
      documentMasked: maskPartyDocument({ document, personType: primary.personType }),
      isGroupEntity: Boolean(entityId),
      entityId,
      sources: uniqueSources(group.map((row) => row.source)),
    };
  });
}

function mergeAttorneys(rows: ExposureAttorneyRecord[]): ExposureExecutiveAttorney[] {
  const byKey = new Map<string, ExposureAttorneyRecord[]>();
  for (const row of rows) {
    const key = row.oabNumber
      ? `oab:${row.oabNumber}:${row.oabState ?? ""}`
      : `name:${normalizeLegalName(row.name)}`;
    pushIndex(byKey, key, row);
  }
  return [...byKey.values()].map((group) => {
    const primary = group[0]!;
    return {
      name: primary.name,
      oabNumber: primary.oabNumber,
      oabState: primary.oabState,
      representedPartyName: primary.representedPartyName,
      documentMasked: maskPartyDocument({ document: primary.document, personType: "PERSON" }),
      sources: uniqueSources(group.map((row) => row.source)),
    };
  });
}

function mergeSubjects(rows: ExposureSubjectRecord[]): ExposureExecutiveSubject[] {
  const byName = new Map<string, ExposureSubjectRecord>();
  for (const row of rows) {
    const current = byName.get(row.name);
    if (!current || (row.isMain && !current.isMain) || (row.source === "DATAJUD" && current.source !== "DATAJUD")) {
      byName.set(row.name, row);
    }
  }
  return [...byName.values()].map((row) => ({
    code: row.code,
    name: row.name,
    fullPath: row.fullPath,
    isMain: row.isMain,
    source: row.source,
  }));
}

function mergeHearings(rows: ExposureHearingRecord[]): ExposureExecutiveHearing[] {
  const byFp = new Map<string, ExposureHearingRecord>();
  for (const row of rows) {
    if (!byFp.has(row.fingerprint) || row.source === "DATAJUD") byFp.set(row.fingerprint, row);
  }
  return [...byFp.values()]
    .map((row) => ({
      type: row.type,
      scheduledAt: row.scheduledAt,
      status: row.status,
      courtUnit: row.courtUnit,
      source: row.source,
    }))
    .sort((a, b) => Date.parse(a.scheduledAt ?? "") - Date.parse(b.scheduledAt ?? ""));
}

function formatClaim(value: string | null, currency: string | null): string | null {
  if (!value) return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!currency || currency === "BRL") return formatCurrencyBrl(amount);
  return `${currency} ${amount.toLocaleString("pt-BR")}`;
}

function daysAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.floor((now.getTime() - time) / (24 * 60 * 60 * 1000));
}

export function uniqueProcessCount(memory: LegalExposureMemory): number {
  return new Set(memory.cases.map((row) => row.processNumberNormalized)).size;
}

export function entityUniqueProcessCount(memory: LegalExposureMemory, entityId: string): number {
  const indexes = indexExposureMemory(memory);
  const linkedCaseIds = new Set((indexes.linksByEntity.get(entityId) ?? []).map((row) => row.caseId));
  const processes = new Set<string>();
  for (const row of memory.cases) {
    if (row.entityId === entityId || linkedCaseIds.has(row.id)) processes.add(row.processNumberNormalized);
  }
  return processes.size;
}

export function buildExposureProcessSummary(
  memory: LegalExposureMemory,
  processNumberNormalized: string,
  now = new Date(),
  indexes = indexExposureMemory(memory)
): ExposureCaseListItem | null {
  const siblings = indexes.casesByProcess.get(processNumberNormalized) ?? [];
  const canonical = pickCanonicalCase(siblings);
  if (!canonical) return null;
  const caseIds = siblings.map((row) => row.id);
  const caseIdSet = new Set(caseIds);
  const evidences = collectForCases(indexes.evidencesByCase, caseIds);
  const movements = collectForCases(indexes.movementsByCase, caseIds);
  const communications = collectForCases(indexes.communicationsByCase, caseIds);
  const hearings = collectForCases(indexes.hearingsByCase, caseIds);
  const parties = collectForCases(indexes.partiesByCase, caseIds);
  const subjects = collectForCases(indexes.subjectsByCase, caseIds);
  const attorneys = collectForCases(indexes.attorneysByCase, caseIds);
  const entityByCnpj = new Map(memory.entities.map((entity) => [entity.cnpj.replace(/\D/g, ""), entity.id]));
  const linkRows = derivedEntityLinks(memory).filter((row) => caseIdSet.has(row.caseId));
  const linksByEntity = new Map<string, typeof linkRows>();
  for (const link of linkRows) {
    const list = linksByEntity.get(link.entityId) ?? [];
    list.push(link);
    linksByEntity.set(link.entityId, list);
  }
  const poleRank: Record<string, number> = { PASSIVE: 0, ACTIVE: 1, THIRD_PARTY: 2, OTHER: 3, UNKNOWN: 4 };
  const groupEntities: ExposureGroupEntity[] = [...linksByEntity.entries()]
    .map(([entityId, group]) => {
      const entity = indexes.entityById.get(entityId);
      const pole = group.find((row) => row.pole !== "UNKNOWN")?.pole ?? group[0]!.pole;
      const cnpj = entity?.cnpj ?? "";
      return {
        id: entityId,
        legalName: entity?.legalName ?? "",
        tradeName: entity?.tradeName ?? null,
        cnpj,
        displayCnpj: formatCnpj(cnpj),
        pole,
        confidence: group[0]!.confidence,
        firstSeenAt: group.map((row) => row.firstSeenAt).sort()[0] ?? canonical.firstSeenAt,
        sources: uniqueSources(group.map((row) => row.lastSource)),
      };
    })
    .sort((a, b) => (poleRank[a.pole] ?? 9) - (poleRank[b.pole] ?? 9) || a.legalName.localeCompare(b.legalName));
  const mergedParties = mergeParties(parties, entityByCnpj);
  const claimants = mergedParties.filter((row) => row.pole === "ACTIVE");
  const groupIds = new Set(groupEntities.map((row) => row.id));
  const otherDefendants = mergedParties.filter(
    (row) => row.pole === "PASSIVE" && (!row.entityId || !groupIds.has(row.entityId))
  );
  const processClass = displayProcessClass(canonical, evidences);
  const mergedHearings = mergeHearings(hearings);
  const nextHearing =
    mergedHearings.find((row) => row.scheduledAt && Date.parse(row.scheduledAt) > now.getTime()) ?? null;
  const latestMovement = latestMovementOf(movements);
  const latestPublication = latestPublicationOf(evidences, communications);
  const stage = classifyCaseStage({
    currentStatus: canonical.currentStatus,
    className: processClass.className ?? canonical.className,
    archivedAt: canonical.archivedAt,
    movements,
  });
  const openForProcess = memory.alerts.filter((row) => {
    const event = memory.events.find((item) => item.id === row.eventId);
    return row.status === "OPEN" && row.requiresAction && event?.caseId && caseIdSet.has(event.caseId);
  });
  const passiveGroupCount = groupEntities.filter((row) => row.pole === "PASSIVE").length;
  const flags = collectAttentionFlags({
    passiveGroupCount,
    publicationDaysAgo: daysAgo(latestPublication?.availableAt ?? null, now),
    openCriticalAlerts: openForProcess.length,
    nextHearingAt: nextHearing?.scheduledAt ?? null,
    latestMovementAt: latestMovement?.occurredAt ?? null,
    enrichmentIncomplete: !processClass.className || claimants.length === 0,
    sourceDegraded: false,
    archivedAt: canonical.archivedAt,
    now,
  });
  const entity = indexes.entityById.get(canonical.entityId);
  const cnpj = entity?.cnpj ?? "";
  const firstSeenAt = siblings.map((row) => row.firstSeenAt).sort()[0] ?? canonical.firstSeenAt;
  const lastSeenAt = siblings.map((row) => row.lastSeenAt).sort().at(-1) ?? canonical.lastSeenAt;
  return {
    id: canonical.id,
    entityId: canonical.entityId,
    canonicalCaseId: canonical.id,
    caseIds,
    processNumber: formatProcessNumber(canonical.processNumberNormalized),
    entity: {
      id: entity?.id ?? canonical.entityId,
      legalName: entity?.legalName ?? "",
      tradeName: entity?.tradeName ?? null,
      cnpj,
      displayCnpj: formatCnpj(cnpj),
    },
    groupEntities,
    involvedEntities: groupEntities.map((row) => ({
      caseId: siblings.find((item) => item.entityId === row.id)?.id ?? canonical.id,
      entity: {
        id: row.id,
        legalName: row.legalName,
        tradeName: row.tradeName,
        cnpj: row.cnpj,
        displayCnpj: row.displayCnpj,
      },
      entityPole: row.pole,
      verificationStatus: verificationStatusOf(evidences),
    })),
    tribunal: canonical.tribunal,
    jurisdiction: canonical.jurisdiction,
    degree: canonical.degree,
    courtUnit: canonical.courtUnit,
    classCode: processClass.classCode,
    className: processClass.className,
    filedAt: canonical.filedAt,
    entityPole: groupEntities.find((row) => row.id === canonical.entityId)?.pole ?? canonical.entityPole,
    currentStatus: canonical.currentStatus,
    primarySource: canonical.primarySource,
    firstSeenAt,
    lastSeenAt,
    sourceUpdatedAt: canonical.sourceUpdatedAt,
    evidenceSources: evidenceSourcesOf(evidences),
    verificationStatus: verificationStatusOf(evidences),
    enrichmentStatus: enrichmentStatusOf(evidences),
    latestMovement,
    latestPublication,
    claimants,
    otherDefendants,
    attorneys: mergeAttorneys(attorneys),
    subjects: mergeSubjects(subjects),
    stage: stage.stage,
    stageLabel: CASE_STAGE_LABELS[stage.stage],
    stageConfidence: stage.confidence,
    claimValue: canonical.claimValue,
    claimCurrency: canonical.claimCurrency,
    claimValueFormatted: formatClaim(canonical.claimValue, canonical.claimCurrency),
    systemName: canonical.systemName,
    area: canonical.area,
    nextHearing,
    movementCount: new Set(movements.map((row) => row.fingerprint)).size,
    publicationCount:
      communications.filter((row) => row.source === "DJEN").length ||
      evidences.filter((row) => row.source === "DJEN").length,
    communicationCount: communications.length,
    openAlertCount: openForProcess.length,
    attentionFlags: flags,
    attentionLabels: flags.map((flag) => attentionLabel(flag, { count: passiveGroupCount })),
    multipleGroupEntities: groupEntities.length > 1,
    secrecy: canonical.secrecy,
  };
}

function flagOn(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}

function matchesSearch(item: ExposureCaseListItem, q: string): boolean {
  if (!q) return true;
  const digits = q.replace(/\D/g, "");
  const folded = q.toUpperCase();
  if (digits && item.processNumber.replace(/\D/g, "").includes(digits)) return true;
  if (item.entity.legalName.toUpperCase().includes(folded)) return true;
  if (item.groupEntities.some((row) => row.legalName.toUpperCase().includes(folded) || row.cnpj.includes(digits))) {
    return true;
  }
  if (item.claimants.some((row) => row.name.toUpperCase().includes(folded))) return true;
  if (item.otherDefendants.some((row) => row.name.toUpperCase().includes(folded))) return true;
  if ((item.className ?? "").toUpperCase().includes(folded)) return true;
  if (item.subjects.some((row) => row.name.toUpperCase().includes(folded))) return true;
  return false;
}

export function listCanonicalCases(
  memory: LegalExposureMemory,
  query: ExposureListQuery,
  now = new Date()
): ExposureCaseListItem[] {
  const indexes = indexExposureMemory(memory);
  const items: ExposureCaseListItem[] = [];
  for (const processNumberNormalized of indexes.casesByProcess.keys()) {
    const item = buildExposureProcessSummary(memory, processNumberNormalized, now, indexes);
    if (item) items.push(item);
  }
  return items
    .filter((row) => {
      if (!query.entityId) return true;
      return row.groupEntities.some((entity) => entity.id === query.entityId) || row.entityId === query.entityId;
    })
    .filter((row) => !query.tribunal || row.tribunal === query.tribunal)
    .filter((row) => {
      if (!query.pole) return true;
      return row.groupEntities.some((entity) => entity.pole === query.pole);
    })
    .filter((row) => !query.status || row.currentStatus === query.status)
    .filter((row) => !query.stage || row.stage === query.stage)
    .filter((row) => !query.className || row.className === query.className)
    .filter((row) => !query.multipleGroup || !flagOn(query.multipleGroup) || row.multipleGroupEntities)
    .filter((row) => !query.hasHearing || !flagOn(query.hasHearing) || Boolean(row.nextHearing))
    .filter((row) => !query.hasRequiredAction || !flagOn(query.hasRequiredAction) || row.openAlertCount > 0)
    .filter((row) => {
      if (!query.source) return true;
      return row.evidenceSources.includes(query.source as LegalExposureSource) || row.primarySource === query.source;
    })
    .filter((row) => !query.verification || row.verificationStatus === query.verification)
    .filter((row) => !query.enrichment || row.enrichmentStatus === query.enrichment)
    .filter((row) => matchesSearch(row, query.q ?? ""))
    .filter((row) => {
      if (query.filedFrom && (!row.filedAt || Date.parse(row.filedAt) < Date.parse(query.filedFrom))) return false;
      if (query.filedTo && (!row.filedAt || Date.parse(row.filedAt) > Date.parse(query.filedTo))) return false;
      return true;
    })
    .filter((row) => {
      const amount = row.claimValue ? Number(row.claimValue) : null;
      if (query.claimMin != null && query.claimMin !== "" && (amount == null || amount < Number(query.claimMin))) {
        return false;
      }
      if (query.claimMax != null && query.claimMax !== "" && (amount == null || amount > Number(query.claimMax))) {
        return false;
      }
      return true;
    })
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
}

export function buildGroupedCaseTimeline(
  memory: LegalExposureMemory,
  caseId: string,
  query: ExposureListQuery
): Page<ExposureTimelineItem> {
  const indexes = indexExposureMemory(memory);
  const seed = indexes.caseById.get(caseId);
  if (!seed) {
    return { items: [], total: 0, page: 1, pageSize: 20 };
  }
  const siblings = indexes.casesByProcess.get(seed.processNumberNormalized) ?? [seed];
  const caseIds = siblings.map((row) => row.id);
  const movements = collectForCases(indexes.movementsByCase, caseIds).map((row) => ({
    kind: "movement" as const,
    at: row.occurredAt ?? row.firstSeenAt,
    title: row.name,
    description: movementComplementsText(row.complements),
    source: row.source,
    sourceCode: row.sourceCode,
    courtUnit: row.courtUnit,
    complements: row.complements,
    communicationType: null,
    subject: null,
    status: null,
  }));
  const communications = collectForCases(indexes.communicationsByCase, caseIds);
  const djenCommunications = communications.filter((row) => row.source === "DJEN");
  const otherCommunications = communications
    .filter((row) => row.source !== "DJEN")
    .map((row) => ({
      kind: "communication" as const,
      at: row.availableAt ?? row.detectedAt,
      title: row.subject || row.communicationType,
      description: row.communicationType,
      source: row.source,
      sourceCode: null,
      courtUnit: row.courtUnit,
      complements: null,
      communicationType: row.communicationType,
      subject: row.subject,
      status: row.normalizedStatus,
    }));
  const events = collectForCases(indexes.eventsByCase, caseIds).map((row) => ({
    kind: "event" as const,
    at: row.detectedAt,
    title: eventTypeLabel(row.eventType),
    description: eventDetail(row.eventType, row.payload),
    source: row.source,
    sourceCode: null,
    courtUnit: null,
    complements: null,
    communicationType: null,
    subject: null,
    status: null,
  }));
  const hearings = collectForCases(indexes.hearingsByCase, caseIds).map((row) => ({
    kind: "hearing" as const,
    at: row.scheduledAt ?? row.firstSeenAt,
    title: row.type || "Audiência",
    description: row.status,
    source: row.source,
    sourceCode: null,
    courtUnit: row.courtUnit,
    complements: null,
    communicationType: null,
    subject: null,
    status: row.status,
  }));
  const publications = (
    djenCommunications.length > 0
      ? djenCommunications.map((row) => {
          const raw = row.rawMetadata && typeof row.rawMetadata === "object" ? (row.rawMetadata as Record<string, unknown>) : null;
          const tipo =
            row.communicationType ||
            (typeof raw?.tipoComunicacao === "string" ? raw.tipoComunicacao : null);
          return {
            kind: "publication" as const,
            at: row.availableAt ?? row.detectedAt,
            title: tipo || "Publicação DJEN",
            description: row.subject,
            source: row.source,
            sourceCode: null,
            courtUnit: row.courtUnit,
            complements: null,
            communicationType: row.communicationType,
            subject: row.subject,
            status: row.normalizedStatus,
          };
        })
      : collectForCases(indexes.evidencesByCase, caseIds)
          .filter((row) => row.source === "DJEN")
          .map((row) => {
            const raw = row.rawMetadata && typeof row.rawMetadata === "object" ? (row.rawMetadata as Record<string, unknown>) : null;
            const available =
              typeof raw?.dataDisponibilizacao === "string" ? raw.dataDisponibilizacao : row.lastSeenAt;
            const tipo = typeof raw?.tipoComunicacao === "string" ? raw.tipoComunicacao : "Publicação DJEN";
            const orgao = typeof raw?.nomeOrgao === "string" ? raw.nomeOrgao : null;
            return {
              kind: "publication" as const,
              at: available,
              title: tipo,
              description: null,
              source: row.source,
              sourceCode: null,
              courtUnit: orgao,
              complements: null,
              communicationType: tipo,
              subject: null,
              status: null,
            };
          })
  );
  const kind = query.timelineKind;
  let merged: ExposureTimelineItem[] = [...movements, ...otherCommunications, ...events, ...hearings, ...publications];
  if (kind && kind !== "all") merged = merged.filter((row) => row.kind === kind);
  merged.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const page = Number(query.page ?? 1) || 1;
  const pageSize = Number(query.pageSize ?? 20) || 20;
  const start = (page - 1) * pageSize;
  return { items: merged.slice(start, start + pageSize), total: merged.length, page, pageSize };
}

export function buildExecutiveNarrative(item: ExposureCaseListItem): string {
  const sentences: string[] = [];
  const companies = item.groupEntities.filter((row) => row.pole === "PASSIVE").map((row) => row.legalName);
  const filed = item.filedAt
    ? new Date(item.filedAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : null;
  if (filed) {
    sentences.push(`Processo ${item.className ? item.className.toLowerCase() : "judicial"} ajuizado em ${filed}.`);
  }
  if (companies.length > 0) {
    sentences.push(
      `Empresa${companies.length > 1 ? "s" : ""} do grupo no polo passivo: ${companies.join(" e ")}.`
    );
  }
  if (item.claimants.length > 0) {
    sentences.push(`Autor/reclamante: ${item.claimants.map((row) => row.name).join("; ")}.`);
  }
  if (item.claimValueFormatted) sentences.push(`Valor da causa: ${item.claimValueFormatted}.`);
  if (item.courtUnit || item.tribunal) {
    sentences.push(`Tramita em: ${[item.courtUnit, item.tribunal].filter(Boolean).join(" · ")}.`);
  }
  if (item.systemName) sentences.push(`Sistema: ${item.systemName}.`);
  if (item.movementCount > 0) sentences.push(`Foram identificadas ${item.movementCount} movimentações.`);
  if (item.latestMovement?.name) {
    const when = item.latestMovement.occurredAt
      ? new Date(item.latestMovement.occurredAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
      : null;
    sentences.push(`Última movimentação: ${item.latestMovement.name}${when ? ` em ${when}` : ""}.`);
  }
  if (item.nextHearing?.scheduledAt) {
    const when = new Date(item.nextHearing.scheduledAt).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    sentences.push(`Há audiência futura em ${when}.`);
  }
  return sentences.join(" ");
}

export function buildExposureProcessDossier(
  memory: LegalExposureMemory,
  caseId: string,
  now = new Date()
) {
  const indexes = indexExposureMemory(memory);
  const seed = indexes.caseById.get(caseId);
  if (!seed) return null;
  const item = buildExposureProcessSummary(memory, seed.processNumberNormalized, now, indexes);
  if (!item) return null;
  const timeline = buildGroupedCaseTimeline(memory, caseId, { page: 1, pageSize: 50 });
  const communications = memory.communications.filter((row) => item.caseIds.includes(row.caseId ?? ""));
  return {
    ...item,
    narrative: buildExecutiveNarrative(item),
    groupNote: item.multipleGroupEntities ? MULTIPLE_GROUP_NOTE : null,
    parties: {
      active: item.claimants,
      group: item.groupEntities,
      passiveGroup: item.groupEntities.filter((row) => row.pole === "PASSIVE"),
      passiveOthers: item.otherDefendants,
      thirdParties: collectForCases(indexes.partiesByCase, item.caseIds)
        .filter((row) => row.pole === "THIRD_PARTY")
        .map((row) => ({
          name: row.name,
          partyType: row.partyType,
          pole: row.pole,
          personType: row.personType,
          documentMasked: maskPartyDocument({ document: row.documentNormalized, personType: row.personType }),
          isGroupEntity: Boolean(row.documentNormalized && memory.entities.some((entity) => entity.cnpj.replace(/\D/g, "") === row.documentNormalized)),
          entityId: null,
          sources: [row.source],
        })),
      attorneys: item.attorneys,
    },
    timeline: timeline.items,
    communications: communications.map((row) => ({
      id: row.id,
      processNumber: row.processNumber,
      communicationType: row.communicationType,
      subject: row.subject,
      tribunal: row.tribunal,
      courtUnit: row.courtUnit,
      availableAt: row.availableAt,
      detectedAt: row.detectedAt,
      normalizedStatus: row.normalizedStatus,
      sourceStatus: row.sourceStatus,
      source: row.source,
      caseId: row.caseId,
    })),
    discovery: {
      firstSeenAt: item.firstSeenAt,
      primarySource: item.primarySource,
      evidenceSources: item.evidenceSources,
    },
    stageReason: classifyCaseStage({
      currentStatus: item.currentStatus,
      className: item.className,
      archivedAt: seed.archivedAt,
      movements: collectForCases(indexes.movementsByCase, item.caseIds),
    }).reason,
  };
}

export function buildExposureGroupReport(memory: LegalExposureMemory, entityId?: string | null, now = new Date()) {
  const items = listCanonicalCases(memory, { entityId: entityId ?? null }, now);
  const passive = items.filter((row) => row.groupEntities.some((entity) => entity.pole === "PASSIVE"));
  const active = items.filter((row) => row.groupEntities.some((entity) => entity.pole === "ACTIVE"));
  const multiple = items.filter((row) => row.multipleGroupEntities);
  const claimTotal = items.reduce((sum, row) => sum + (row.claimValue ? Number(row.claimValue) || 0 : 0), 0);
  const perEntity = memory.entities
    .filter((row) => row.active && (!entityId || row.id === entityId))
    .map((entity) => ({
      entityId: entity.id,
      legalName: entity.legalName,
      monitoredCases: entityUniqueProcessCount(memory, entity.id),
      processes: items.filter((item) => item.groupEntities.some((row) => row.id === entity.id)),
    }));
  return {
    generatedAt: now.toISOString(),
    groupNote: MULTIPLE_GROUP_NOTE,
    totals: {
      uniqueProcesses: uniqueProcessCount(memory),
      filteredProcesses: items.length,
      passive: passive.length,
      active: active.length,
      multipleGroup: multiple.length,
      claimTotal,
      claimTotalFormatted: formatClaim(String(claimTotal), "BRL"),
      requiredActions: items.reduce((sum, row) => sum + row.openAlertCount, 0),
      futureHearings: items.filter((row) => row.nextHearing).length,
    },
    entities: perEntity,
    processes: items,
  };
}
