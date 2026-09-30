/**
 * Leituras agregadas. Grids não incluem rawMetadata.
 */

import { formatCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  LEGAL_EXPOSURE_SOURCES,
  clampPage,
  isHealthyStatus,
  NO_CASES_IDENTIFIED_COPY,
  slicePage,
  SOURCE_LABELS,
  SOURCE_STATUS_LABELS,
  type CaseEnrichmentStatus,
  type CaseVerificationStatus,
  type ExposureCaseListItem,
  type ExposureCaseLatestMovement,
  type ExposureCaseLatestPublication,
  type LegalExposureSource,
  type Page,
  type SourcePublicStatus,
} from "./legalExposureContracts.js";
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import { isCriticalMonitoringSource, resolveSourceHealth } from "./legalExposureHealth.js";
import { formatProcessNumber } from "./legalExposureNormalization.js";
import { eventDetail, eventTypeLabel, movementComplementsText, TIMELINE_DUPLICATE_EVENT_TYPES } from "./legalExposureFeedUi.js";
import type {
  ExposureCaseRecord,
  ExposureEvidenceRecord,
  ExposureMovementRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

const STATUS_RANK: Record<string, number> = {
  NOT_CONFIGURED: 0,
  DISABLED: 1,
  HEALTHY: 2,
  DEGRADED: 3,
  STALE: 4,
  DISCONNECTED: 5,
  RATE_LIMITED: 6,
  SOURCE_ERROR: 7,
  AUTH_ERROR: 8,
  CONFIGURATION_ERROR: 9,
};

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
  page?: unknown;
  pageSize?: unknown;
};

function inRange(value: string | null, from?: string | null, to?: string | null): boolean {
  if (!value) return !from && !to;
  const time = Date.parse(value);
  if (Number.isNaN(time)) return false;
  if (from && time < Date.parse(from)) return false;
  if (to && time > Date.parse(to)) return false;
  return true;
}

export function sourceStatuses(memory: LegalExposureMemory, now: Date): SourcePublicStatus[] {
  const config = new Map(publicSourceConfiguration().map((row) => [row.source, row]));
  return (["DOMICILIO", "DATAJUD", "DJEN", "TRT_CERTIFICATE", "CNDT"] as LegalExposureSource[]).map(
    (source) => {
      const rows = memory.connections.filter((row) => row.source === source);
      const configured = config.get(source as "DOMICILIO" | "DATAJUD" | "DJEN")?.configured ?? rows.length > 0;
      const enabled = rows.some((row) => row.enabled) || Boolean(config.get(source as "DOMICILIO" | "DATAJUD" | "DJEN")?.enabled);
      if (rows.length === 0) {
        const status = configured ? (enabled ? "NOT_CONFIGURED" : "DISABLED") : "NOT_CONFIGURED";
        return {
          source,
          label: SOURCE_LABELS[source],
          status,
          statusLabel: SOURCE_STATUS_LABELS[status],
          configured,
          enabled,
          lastSuccessfulAt: null,
          lastAttemptAt: null,
          healthy: false,
        };
      }
      const evaluated = rows.map((row) =>
        resolveSourceHealth({
          source,
          configured,
          enabled: row.enabled,
          now,
          lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt) : null,
          lastSuccessfulAt: row.lastSuccessfulAt ? new Date(row.lastSuccessfulAt) : null,
          lastErrorAt: row.lastErrorAt ? new Date(row.lastErrorAt) : null,
          lastErrorCode: row.lastErrorCode,
        })
      );
      const status = evaluated.sort((a, b) => (STATUS_RANK[b] ?? 0) - (STATUS_RANK[a] ?? 0))[0] ?? "NOT_CONFIGURED";
      const lastSuccessfulAt = rows
        .map((row) => row.lastSuccessfulAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
      const lastAttemptAt = rows
        .map((row) => row.lastAttemptAt)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null;
      return {
        source,
        label: SOURCE_LABELS[source],
        status,
        statusLabel: SOURCE_STATUS_LABELS[status],
        configured,
        enabled,
        lastSuccessfulAt,
        lastAttemptAt,
        healthy: isHealthyStatus(status),
      };
    }
  );
}

export function buildExposureDashboard(memory: LegalExposureMemory, now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const monitoredCases = memory.cases.length;
  const pendingCommunications = memory.communications.filter((row) => row.normalizedStatus === "PENDING").length;
  const actionRequired = memory.alerts.filter((row) => row.status === "OPEN" && row.requiresAction).length;
  const newsToday = memory.events.filter((row) => Date.parse(row.detectedAt) >= start.getTime()).length;
  const sources = sourceStatuses(memory, now);
  const entities = memory.entities.filter((row) => row.active).map((entity) => ({
    id: entity.id,
    legalName: entity.legalName,
    cnpj: formatCnpj(entity.cnpj),
    monitoring: {
      domicilio: entity.monitorDomicilio,
      datajud: entity.monitorDatajud,
      djen: entity.monitorDjen,
      certificates: entity.monitorCertificates,
    },
    monitoredCases: memory.cases.filter((row) => row.entityId === entity.id).length,
    pendingCommunications: memory.communications.filter(
      (row) => row.entityId === entity.id && row.normalizedStatus === "PENDING"
    ).length,
    actionRequired: memory.alerts.filter(
      (row) => row.entityId === entity.id && row.status === "OPEN" && row.requiresAction
    ).length,
    freshness: sources
      .filter((source) => isCriticalMonitoringSource(source.source))
      .map((source) => ({ source: source.source, status: source.status, healthy: source.healthy })),
  }));
  const certificates = {
    trt: latestCertificate(memory, "TRT_LABOR_CASES"),
    cndt: latestCertificate(memory, "CNDT"),
    cndtNote: CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  };
  return {
    cards: {
      actionRequired,
      monitoredCases,
      pendingCommunications,
      newsToday,
    },
    monitoredCasesLabel: "Processos monitorados",
    emptyState: monitoredCases === 0 ? NO_CASES_IDENTIFIED_COPY : null,
    absenceIsNotClearance: ABSENCE_IS_NOT_CLEARANCE_COPY,
    sources,
    entities,
    certificates,
    configuration: publicSourceConfiguration().map((row) => ({
      source: row.source,
      configured: row.configured,
      enabled: row.enabled,
    })),
  };
}

function latestCertificate(memory: LegalExposureMemory, type: "TRT_LABOR_CASES" | "CNDT") {
  const rows = memory.certificates
    .filter((row) => row.type === type)
    .sort((a, b) => Date.parse(b.issuedAt ?? b.createdAt) - Date.parse(a.issuedAt ?? a.createdAt));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    result: row.result,
    issuedAt: row.issuedAt,
    validUntil: row.validUntil,
    tribunal: row.tribunal,
  };
}

const OFFICIAL_CONFIRMATION_SOURCES = new Set<LegalExposureSource>(["DJEN", "DATAJUD"]);
const PROCESSUAL_CLASS_SOURCES = new Set<LegalExposureSource>(["DATAJUD"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueSources(sources: LegalExposureSource[]): LegalExposureSource[] {
  const present = new Set(sources);
  return LEGAL_EXPOSURE_SOURCES.filter((source) => present.has(source));
}

function evidenceTime(row: ExposureEvidenceRecord): number {
  return Date.parse(row.lastSeenAt || row.sourceUpdatedAt || row.firstSeenAt) || 0;
}

function movementTime(row: ExposureMovementRecord): number {
  const occurred = row.occurredAt ? Date.parse(row.occurredAt) : Number.NaN;
  if (Number.isFinite(occurred)) return occurred;
  return Date.parse(row.firstSeenAt) || 0;
}

export function evidenceSourcesOf(evidences: ExposureEvidenceRecord[]): LegalExposureSource[] {
  return uniqueSources(evidences.map((row) => row.source));
}

export function verificationStatusOf(evidences: ExposureEvidenceRecord[]): CaseVerificationStatus {
  const confirmedOfficial = evidences.some(
    (row) => row.confidence === "CONFIRMED" && OFFICIAL_CONFIRMATION_SOURCES.has(row.source)
  );
  return confirmedOfficial ? "CONFIRMED_OFFICIAL" : "REVIEW_REQUIRED";
}

export function enrichmentStatusOf(evidences: ExposureEvidenceRecord[]): CaseEnrichmentStatus {
  const hasDatajud = evidences.some((row) => row.source === "DATAJUD" && row.confidence === "CONFIRMED");
  if (hasDatajud) return "DATAJUD_ENRICHED";
  const hasDjen = evidences.some((row) => row.source === "DJEN" && row.confidence === "CONFIRMED");
  if (hasDjen) return "DJEN_ONLY";
  return "PARTIAL";
}

export function displayProcessClass(
  legalCase: Pick<ExposureCaseRecord, "classCode" | "className">,
  evidences: ExposureEvidenceRecord[]
): { classCode: string | null; className: string | null } {
  const processual = evidences.some(
    (row) => row.confidence === "CONFIRMED" && PROCESSUAL_CLASS_SOURCES.has(row.source)
  );
  if (!processual) return { classCode: null, className: null };
  return { classCode: legalCase.classCode, className: legalCase.className };
}

export function latestMovementOf(
  movements: ExposureMovementRecord[]
): ExposureCaseLatestMovement | null {
  const dated = movements.filter((row) => row.occurredAt && Number.isFinite(Date.parse(row.occurredAt)));
  const pool = dated.length > 0 ? dated : movements;
  let best: ExposureMovementRecord | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const row of pool) {
    const time = movementTime(row);
    if (!best || time > bestTime) {
      best = row;
      bestTime = time;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    occurredAt: best.occurredAt,
    source: best.source,
    courtUnit: best.courtUnit,
  };
}

export function latestPublicationOf(
  evidences: ExposureEvidenceRecord[]
): ExposureCaseLatestPublication | null {
  const djen = evidences.filter((row) => row.source === "DJEN");
  let best: ExposureEvidenceRecord | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const row of djen) {
    const time = evidenceTime(row);
    if (!best || time > bestTime) {
      best = row;
      bestTime = time;
    }
  }
  if (!best) return null;
  const raw = asRecord(best.rawMetadata);
  return {
    type: textField(raw?.tipoComunicacao),
    availableAt: textField(raw?.dataDisponibilizacao),
    courtUnit: textField(raw?.nomeOrgao),
  };
}

function toListItem(
  row: ExposureCaseRecord,
  memory: {
    entityById: Map<string, LegalExposureMemory["entities"][number]>;
    evidencesByCaseId: Map<string, ExposureEvidenceRecord[]>;
    movementsByCaseId: Map<string, ExposureMovementRecord[]>;
  }
): ExposureCaseListItem {
  const entity = memory.entityById.get(row.entityId);
  const evidences = memory.evidencesByCaseId.get(row.id) ?? [];
  const movements = memory.movementsByCaseId.get(row.id) ?? [];
  const processClass = displayProcessClass(row, evidences);
  const cnpj = entity?.cnpj ?? "";
  return {
    id: row.id,
    entityId: row.entityId,
    processNumber: formatProcessNumber(row.processNumberNormalized),
    entity: {
      id: entity?.id ?? row.entityId,
      legalName: entity?.legalName ?? "",
      tradeName: entity?.tradeName ?? null,
      cnpj,
      displayCnpj: formatCnpj(cnpj),
    },
    tribunal: row.tribunal,
    jurisdiction: row.jurisdiction,
    degree: row.degree,
    courtUnit: row.courtUnit,
    classCode: processClass.classCode,
    className: processClass.className,
    filedAt: row.filedAt,
    entityPole: row.entityPole,
    currentStatus: row.currentStatus,
    primarySource: row.primarySource,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    evidenceSources: evidenceSourcesOf(evidences),
    verificationStatus: verificationStatusOf(evidences),
    enrichmentStatus: enrichmentStatusOf(evidences),
    latestMovement: latestMovementOf(movements),
    latestPublication: latestPublicationOf(evidences),
    involvedEntities: [],
  };
}

const ENRICHMENT_RANK: Record<CaseEnrichmentStatus, number> = { PARTIAL: 0, DJEN_ONLY: 1, DATAJUD_ENRICHED: 2 };

function movementRank(movement: ExposureCaseLatestMovement | null): number {
  if (!movement) return Number.NEGATIVE_INFINITY;
  return movement.occurredAt ? Date.parse(movement.occurredAt) || 0 : 0;
}

/**
 * O mesmo número de processo pode existir uma vez por empresa monitorada
 * (cada empresa tem o seu registro). Para a lista, vira UM item: o registro
 * mais recente é a base, os dados vazios são completados pelos demais e
 * todas as empresas envolvidas ficam listadas.
 */
function groupCasesByProcess(items: ExposureCaseListItem[], allByProcess: Map<string, ExposureCaseListItem[]>): ExposureCaseListItem[] {
  const groups = new Map<string, ExposureCaseListItem[]>();
  for (const item of items) {
    const key = item.processNumber;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.values()].map((members) => {
    const sorted = [...members].sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
    const primary = sorted[0]!;
    const everyone = allByProcess.get(primary.processNumber) ?? sorted;
    const firstText = (pick: (row: ExposureCaseListItem) => string | null) => sorted.map(pick).find((value) => value != null) ?? null;
    return {
      ...primary,
      courtUnit: firstText((row) => row.courtUnit),
      classCode: firstText((row) => row.classCode),
      className: firstText((row) => row.className),
      filedAt: firstText((row) => row.filedAt),
      currentStatus: firstText((row) => row.currentStatus),
      sourceUpdatedAt: sorted.map((row) => row.sourceUpdatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      firstSeenAt: sorted.map((row) => row.firstSeenAt).sort()[0] ?? primary.firstSeenAt,
      evidenceSources: uniqueSources(sorted.flatMap((row) => row.evidenceSources)),
      verificationStatus: sorted.some((row) => row.verificationStatus === "CONFIRMED_OFFICIAL") ? "CONFIRMED_OFFICIAL" : "REVIEW_REQUIRED",
      enrichmentStatus: sorted.reduce<CaseEnrichmentStatus>(
        (best, row) => (ENRICHMENT_RANK[row.enrichmentStatus] > ENRICHMENT_RANK[best] ? row.enrichmentStatus : best),
        primary.enrichmentStatus
      ),
      latestMovement: sorted.reduce<ExposureCaseLatestMovement | null>(
        (best, row) => (movementRank(row.latestMovement) > movementRank(best) ? row.latestMovement : best),
        null
      ),
      latestPublication: firstText((row) => row.latestPublication?.type ?? null) ? sorted.find((row) => row.latestPublication?.type)?.latestPublication ?? primary.latestPublication : primary.latestPublication,
      involvedEntities: [...everyone]
        .sort((a, b) => a.entity.legalName.localeCompare(b.entity.legalName, "pt-BR"))
        .map((row) => ({ caseId: row.id, entity: row.entity, entityPole: row.entityPole, verificationStatus: row.verificationStatus })),
    };
  });
}

function indexCases(memory: LegalExposureMemory) {
  const entityById = new Map(memory.entities.map((entity) => [entity.id, entity]));
  const evidencesByCaseId = new Map<string, ExposureEvidenceRecord[]>();
  for (const row of memory.evidences) {
    const list = evidencesByCaseId.get(row.caseId);
    if (list) list.push(row);
    else evidencesByCaseId.set(row.caseId, [row]);
  }
  const movementsByCaseId = new Map<string, ExposureMovementRecord[]>();
  for (const row of memory.movements) {
    const list = movementsByCaseId.get(row.caseId);
    if (list) list.push(row);
    else movementsByCaseId.set(row.caseId, [row]);
  }
  return { entityById, evidencesByCaseId, movementsByCaseId };
}

export function listCases(memory: LegalExposureMemory, query: ExposureListQuery): Page<ExposureCaseListItem> {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const q = query.q?.replace(/\D/g, "") ?? "";
  const indexes = indexCases(memory);
  // Todas as empresas de cada processo, sem filtro: o cartão lista os envolvidos mesmo filtrando por uma empresa.
  const allByProcess = new Map<string, ExposureCaseListItem[]>();
  for (const row of memory.cases) {
    const item = toListItem(row, indexes);
    const list = allByProcess.get(item.processNumber);
    if (list) list.push(item);
    else allByProcess.set(item.processNumber, [item]);
  }
  const rows = memory.cases
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.tribunal || row.tribunal === query.tribunal)
    .filter((row) => !query.pole || row.entityPole === query.pole)
    .filter((row) => !query.status || row.currentStatus === query.status)
    .filter((row) => !q || row.processNumberNormalized.includes(q))
    .filter((row) => inRange(row.lastSeenAt, query.from, query.to))
    .filter((row) => {
      if (!query.source) return true;
      const evidences = indexes.evidencesByCaseId.get(row.id) ?? [];
      const sources = evidenceSourcesOf(evidences);
      return sources.includes(query.source as LegalExposureSource) || row.primarySource === query.source;
    })
    .map((row) => toListItem(row, indexes))
    .filter((row) => !query.verification || row.verificationStatus === query.verification)
    .filter((row) => !query.enrichment || row.enrichmentStatus === query.enrichment);
  const grouped = groupCasesByProcess(rows, allByProcess).sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return slicePage(grouped, page, pageSize);
}

/** Referência curta do processo e da empresa, para qualquer linha do feed dizer do que se trata. */
export type ExposureFeedReference = {
  caseId: string | null;
  processNumber: string | null;
  tribunal: string | null;
  courtUnit: string | null;
  entity: { id: string; legalName: string; displayCnpj: string } | null;
};

function feedReference(
  memory: LegalExposureMemory,
  input: { entityId: string | null; caseId: string | null; processNumber?: string | null; tribunal?: string | null; courtUnit?: string | null }
): ExposureFeedReference {
  const legalCase = input.caseId ? memory.cases.find((row) => row.id === input.caseId) ?? null : null;
  const entityId = input.entityId ?? legalCase?.entityId ?? null;
  const entity = entityId ? memory.entities.find((row) => row.id === entityId) ?? null : null;
  const processNumber = legalCase ? formatProcessNumber(legalCase.processNumberNormalized) : input.processNumber ? formatProcessNumber(input.processNumber) : null;
  return {
    caseId: legalCase?.id ?? null,
    processNumber,
    tribunal: input.tribunal ?? legalCase?.tribunal ?? null,
    courtUnit: input.courtUnit ?? legalCase?.courtUnit ?? null,
    entity: entity ? { id: entity.id, legalName: entity.legalName, displayCnpj: formatCnpj(entity.cnpj) } : null,
  };
}

export function listCommunications(memory: LegalExposureMemory, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const rows = memory.communications
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.status || row.normalizedStatus === query.status)
    .filter((row) => !query.source || row.source === query.source)
    .filter((row) => !query.tribunal || row.tribunal === query.tribunal)
    .filter((row) => inRange(row.detectedAt, query.from, query.to))
    .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
    .map((row) => ({
      id: row.id,
      entityId: row.entityId,
      caseId: row.caseId,
      source: row.source,
      processNumber: row.processNumber ? formatProcessNumber(row.processNumber) : null,
      communicationType: row.communicationType,
      subject: row.subject,
      sourceStatus: row.sourceStatus,
      normalizedStatus: row.normalizedStatus,
      availableAt: row.availableAt,
      detectedAt: row.detectedAt,
      tribunal: row.tribunal,
      courtUnit: row.courtUnit,
      scienceDeadlineAt: row.scienceDeadlineAt,
      sourceScienceAt: row.sourceScienceAt,
      reference: feedReference(memory, { entityId: row.entityId, caseId: row.caseId, processNumber: row.processNumber, tribunal: row.tribunal, courtUnit: row.courtUnit }),
    }));
  return slicePage(rows, page, pageSize);
}

export function listEvents(memory: LegalExposureMemory, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const rows = memory.events
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.source || row.source === query.source)
    .filter((row) => !query.severity || row.severity === query.severity)
    .filter((row) => inRange(row.detectedAt, query.from, query.to))
    .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt))
    .map((row) => ({
      id: row.id,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.communicationId,
      source: row.source,
      eventType: row.eventType,
      severity: row.severity,
      detectedAt: row.detectedAt,
      // Texto de leitura: o que aconteceu e em qual processo — sem payload bruto.
      title: eventTypeLabel(row.eventType),
      detail: eventDetail(row.eventType, row.payload),
      reference: feedReference(memory, {
        entityId: row.entityId,
        caseId: row.caseId,
        processNumber: row.communicationId ? memory.communications.find((item) => item.id === row.communicationId)?.processNumber ?? null : null,
      }),
    }));
  return slicePage(rows, page, pageSize);
}

export function listAlerts(memory: LegalExposureMemory, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const rows = memory.alerts
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.status || row.status === query.status)
    .filter((row) => !query.severity || row.severity === query.severity)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map((row) => {
      // O alerta nasce de um evento: é dele que vêm o processo, a comunicação e o detalhe.
      const event = memory.events.find((item) => item.id === row.eventId) ?? null;
      const communication = event?.communicationId ? memory.communications.find((item) => item.id === event.communicationId) ?? null : null;
      return {
        ...row,
        eventType: event?.eventType ?? null,
        source: event?.source ?? null,
        detail: event ? eventDetail(event.eventType, event.payload) : null,
        reference: feedReference(memory, {
          entityId: row.entityId,
          caseId: event?.caseId ?? communication?.caseId ?? null,
          processNumber: communication?.processNumber ?? null,
          tribunal: communication?.tribunal ?? null,
          courtUnit: communication?.courtUnit ?? null,
        }),
      };
    });
  return slicePage(rows, page, pageSize);
}

export type ExposureTimelineItem = {
  kind: "movement" | "communication" | "event";
  at: string;
  /** A data é a da ocorrência (movimentação/disponibilização) ou só a da detecção pelo IndusCost. */
  atKind: "OCCURRED" | "AVAILABLE" | "DETECTED";
  title: string;
  detail: string | null;
  source: string | null;
  status: string | null;
};

export function caseTimeline(memory: LegalExposureMemory, caseId: string, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const legalCase = memory.cases.find((row) => row.id === caseId) ?? null;
  const movements: ExposureTimelineItem[] = memory.movements
    .filter((row) => row.caseId === caseId)
    .map((row) => ({
      kind: "movement",
      at: row.occurredAt ?? row.firstSeenAt,
      atKind: row.occurredAt ? "OCCURRED" : "DETECTED",
      title: row.name,
      detail: [row.courtUnit, movementComplementsText(row.complements)].filter(Boolean).join(" · ") || null,
      source: row.source,
      status: null,
    }));
  const communications: ExposureTimelineItem[] = memory.communications
    .filter((row) => row.caseId === caseId)
    .map((row) => ({
      kind: "communication",
      at: row.availableAt ?? row.detectedAt,
      atKind: row.availableAt ? "AVAILABLE" : "DETECTED",
      title: row.subject || row.communicationType,
      detail: [row.courtUnit, row.subject ? row.communicationType : null].filter(Boolean).join(" · ") || null,
      source: row.source,
      status: row.normalizedStatus,
    }));
  const events: ExposureTimelineItem[] = memory.events
    .filter((row) => row.caseId === caseId)
    // "Nova movimentação"/"Nova comunicação" na hora da sincronização só repetiriam as linhas acima.
    .filter((row) => !TIMELINE_DUPLICATE_EVENT_TYPES.has(row.eventType))
    .map((row) => ({
      kind: "event",
      at: row.detectedAt,
      atKind: "DETECTED",
      title: eventTypeLabel(row.eventType),
      detail: eventDetail(row.eventType, row.payload),
      source: row.source,
      status: null,
    }));
  const merged = [...movements, ...communications, ...events].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at)
  );
  return {
    ...slicePage(merged, page, pageSize),
    case: legalCase
      ? {
          id: legalCase.id,
          processNumber: formatProcessNumber(legalCase.processNumberNormalized),
          tribunal: legalCase.tribunal,
          courtUnit: legalCase.courtUnit,
          className: legalCase.className,
          currentStatus: legalCase.currentStatus,
          entityPole: legalCase.entityPole,
          entity: feedReference(memory, { entityId: legalCase.entityId, caseId: legalCase.id }).entity,
        }
      : null,
  };
}
