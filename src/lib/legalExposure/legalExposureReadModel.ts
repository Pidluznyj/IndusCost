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
  };
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
    .filter((row) => !query.enrichment || row.enrichmentStatus === query.enrichment)
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  return slicePage(rows, page, pageSize);
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
    }));
  return slicePage(rows, page, pageSize);
}

export function listAlerts(memory: LegalExposureMemory, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const rows = memory.alerts
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.status || row.status === query.status)
    .filter((row) => !query.severity || row.severity === query.severity)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return slicePage(rows, page, pageSize);
}

export function caseTimeline(memory: LegalExposureMemory, caseId: string, query: ExposureListQuery) {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const movements = memory.movements
    .filter((row) => row.caseId === caseId)
    .map((row) => ({
      kind: "movement" as const,
      at: row.occurredAt ?? row.firstSeenAt,
      title: row.name,
      source: row.source,
    }));
  const communications = memory.communications
    .filter((row) => row.caseId === caseId)
    .map((row) => ({
      kind: "communication" as const,
      at: row.detectedAt,
      title: row.subject || row.communicationType,
      source: row.source,
    }));
  const events = memory.events
    .filter((row) => row.caseId === caseId)
    .map((row) => ({
      kind: "event" as const,
      at: row.detectedAt,
      title: row.eventType,
      source: row.source,
    }));
  const merged = [...movements, ...communications, ...events].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at)
  );
  return slicePage(merged, page, pageSize);
}
