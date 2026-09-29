/**
 * Leituras agregadas. Grids não incluem rawMetadata.
 */

import { formatCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  ABSENCE_IS_NOT_CLEARANCE_COPY,
  CNDT_DOES_NOT_MEAN_NO_CASES_COPY,
  clampPage,
  isHealthyStatus,
  NO_CASES_IDENTIFIED_COPY,
  slicePage,
  SOURCE_LABELS,
  SOURCE_STATUS_LABELS,
  type LegalExposureSource,
  type Page,
  type SourcePublicStatus,
} from "./legalExposureContracts.js";
import { publicSourceConfiguration } from "./legalExposureFeatureFlags.js";
import { isCriticalMonitoringSource, resolveSourceHealth } from "./legalExposureHealth.js";
import { formatProcessNumber } from "./legalExposureNormalization.js";
import type { LegalExposureMemory } from "./legalExposureStore.js";

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

export function listCases(memory: LegalExposureMemory, query: ExposureListQuery): Page<{
  id: string;
  entityId: string;
  processNumber: string;
  tribunal: string | null;
  entityPole: string;
  currentStatus: string | null;
  primarySource: string;
  firstSeenAt: string;
  lastSeenAt: string;
}> {
  const { page, pageSize } = clampPage(query.page, query.pageSize);
  const q = query.q?.replace(/\D/g, "") ?? "";
  const rows = memory.cases
    .filter((row) => !query.entityId || row.entityId === query.entityId)
    .filter((row) => !query.tribunal || row.tribunal === query.tribunal)
    .filter((row) => !query.pole || row.entityPole === query.pole)
    .filter((row) => !query.source || row.primarySource === query.source)
    .filter((row) => !query.status || row.currentStatus === query.status)
    .filter((row) => !q || row.processNumberNormalized.includes(q))
    .filter((row) => inRange(row.lastSeenAt, query.from, query.to))
    .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
    .map((row) => ({
      id: row.id,
      entityId: row.entityId,
      processNumber: formatProcessNumber(row.processNumberNormalized),
      tribunal: row.tribunal,
      entityPole: row.entityPole,
      currentStatus: row.currentStatus,
      primarySource: row.primarySource,
      firstSeenAt: row.firstSeenAt,
      lastSeenAt: row.lastSeenAt,
    }));
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
