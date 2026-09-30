/**
 * Leituras agregadas. Grids não incluem rawMetadata.
 */

import { formatCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  clampPage,
  isHealthyStatus,
  MULTIPLE_GROUP_NOTE,
  NO_CASES_IDENTIFIED_COPY,
  slicePage,
  SOURCE_LABELS,
  SOURCE_STATUS_LABELS,
  type ExposureCaseListItem,
  type LegalExposureSource,
  type Page,
  type SourcePublicStatus,
} from "./legalExposureContracts.js";
import {
  entityUniqueProcessCount,
  listCanonicalCases,
  uniqueProcessCount,
} from "./legalExposureExecutive.js";
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import { isCriticalMonitoringSource, resolveSourceHealth } from "./legalExposureHealth.js";
import { formatProcessNumber } from "./legalExposureNormalization.js";
import { eventDetail, eventTypeLabel, movementComplementsText, TIMELINE_DUPLICATE_EVENT_TYPES } from "./legalExposureFeedUi.js";
import type { LegalExposureMemory } from "./legalExposureStore.js";

export {
  displayProcessClass,
  enrichmentStatusOf,
  evidenceSourcesOf,
  latestMovementOf,
  latestPublicationOf,
  verificationStatusOf,
} from "./legalExposureCaseFacts.js";

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
  return (["DOMICILIO", "DATAJUD", "DJEN", "ESCAVADOR", "TRT_CERTIFICATE", "CNDT"] as LegalExposureSource[]).map(
    (source) => {
      const rows = memory.connections.filter((row) => row.source === source);
      const configured =
        config.get(source as "DOMICILIO" | "DATAJUD" | "DJEN" | "ESCAVADOR")?.configured ?? rows.length > 0;
      const enabled =
        rows.some((row) => row.enabled) ||
        Boolean(config.get(source as "DOMICILIO" | "DATAJUD" | "DJEN" | "ESCAVADOR")?.enabled);
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
  const monitoredCases = uniqueProcessCount(memory);
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
    monitoredCases: entityUniqueProcessCount(memory, entity.id),
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
    multipleGroupNote: MULTIPLE_GROUP_NOTE,
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

export function listCases(memory: LegalExposureMemory, query: ExposureListQuery): Page<ExposureCaseListItem> {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const rows = listCanonicalCases(memory, query);
  return slicePage(rows, page, pageSize);
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
  const caseIds = new Set(
    legalCase
      ? memory.cases
          .filter((row) => row.processNumberNormalized === legalCase.processNumberNormalized)
          .map((row) => row.id)
      : [caseId]
  );
  const movements: ExposureTimelineItem[] = memory.movements
    .filter((row) => caseIds.has(row.caseId))
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
    .filter((row) => row.caseId != null && caseIds.has(row.caseId))
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
    .filter((row) => row.caseId != null && caseIds.has(row.caseId))
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
