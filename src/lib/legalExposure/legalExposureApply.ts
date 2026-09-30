/**
 * Aplicação idempotente de um lote normalizado.
 * Não apaga processo, comunicação, movimento, evento, certidão nem auditoria
 * quando a fonte deixa de devolver o registro.
 */

import { buildAlertDraft, type AlertKind } from "./legalExposureAlerts.js";
import {
  classifyCommunicationKind,
  communicationIdempotencyKey,
  normalizeCommunicationStatus,
  type LegalExposureSource,
  type NormalizedCandidateObservation,
  type NormalizedCaseObservation,
  type NormalizedCommunicationObservation,
  type NormalizedSourceBatch,
} from "./legalExposureContracts.js";
import { correlateObservation } from "./legalExposureCorrelation.js";
import { genericDiscoveryHasAdditionalEvidence, isTrustedDiscoveryAliasType } from "./legalExposureDiscovery.js";
import { isCriticalMonitoringSource, statusFromQueryOutcome } from "./legalExposureHealth.js";
import {
  movementFingerprint,
  normalizeLegalName,
  normalizeProcessNumber,
  sanitizePayload,
  stableHash,
} from "./legalExposureNormalization.js";
import type {
  ExposureAlertRecord,
  ExposureCaseRecord,
  ExposureCommunicationRecord,
  ExposureConnectionRecord,
  ExposureEventRecord,
  LegalExposureMemory,
} from "./legalExposureStore.js";

export type ApplyBatchInput = {
  entityId: string;
  batch: NormalizedSourceBatch;
  now: string;
  createId: () => string;
};

const SUCCESSFUL_OUTCOMES = new Set(["SUCCESS", "PARTIAL", "NO_RESULTS"]);

const DJEN_PUBLICATION_FIELDS = new Set(["classCode", "className", "filedAt", "jurisdiction", "degree"]);

function nonemptyText(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

/** DataJud enriquece metadados processuais; DJEN posterior não apaga nem degrada. Null nunca limpa. */
export function mergeExistingCaseMetadata(
  legalCase: ExposureCaseRecord,
  observation: NormalizedCaseObservation,
  source: LegalExposureSource
): void {
  const fields = [
    "tribunal",
    "jurisdiction",
    "degree",
    "courtUnit",
    "classCode",
    "className",
    "filedAt",
  ] as const;
  for (const field of fields) {
    const incoming = nonemptyText(observation[field]);
    if (!incoming) continue;
    if (source === "DJEN" && DJEN_PUBLICATION_FIELDS.has(field)) continue;
    if (source === "DATAJUD" || !legalCase[field]) {
      legalCase[field] = incoming;
    }
  }
}

function monitoringEnabled(memory: LegalExposureMemory, entityId: string, source: LegalExposureSource): boolean {
  const entity = memory.entities.find((row) => row.id === entityId);
  if (!entity || !entity.active) return false;
  if (source === "DOMICILIO") return entity.monitorDomicilio;
  if (source === "DATAJUD") return entity.monitorDatajud;
  if (source === "DJEN") return entity.monitorDjen;
  return entity.monitorCertificates;
}

function upsertConnection(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  status: ExposureConnectionRecord["status"]
): void {
  const now = input.now;
  const existing = memory.connections.find(
    (row) => row.entityId === input.entityId && row.source === input.batch.source
  );
  const successful = SUCCESSFUL_OUTCOMES.has(input.batch.outcome);
  const base = existing ?? {
    id: input.createId(),
    entityId: input.entityId,
    source: input.batch.source,
    environment: "production",
    enabled: monitoringEnabled(memory, input.entityId, input.batch.source),
    status,
    lastAttemptAt: null,
    lastSuccessfulAt: null,
    lastFullSyncAt: null,
    lastErrorAt: null,
    lastErrorCode: null,
    lastErrorMessageSanitized: null,
    sourceUpdatedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  base.lastAttemptAt = now;
  base.updatedAt = now;
  base.status = status;
  base.enabled = monitoringEnabled(memory, input.entityId, input.batch.source);
  if (successful) {
    base.lastSuccessfulAt = now;
    if (input.batch.outcome !== "PARTIAL") {
      base.lastErrorAt = null;
      base.lastErrorCode = null;
      base.lastErrorMessageSanitized = null;
    } else {
      base.lastErrorAt = now;
      base.lastErrorCode = "PARTIAL";
      base.lastErrorMessageSanitized = input.batch.errorMessageSanitized;
    }
  } else {
    base.lastErrorAt = now;
    base.lastErrorCode = input.batch.errorCode ?? input.batch.outcome;
    base.lastErrorMessageSanitized = input.batch.errorMessageSanitized;
  }
  if (!existing) memory.connections.push(base);
}

function pushEvent(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  draft: Omit<ExposureEventRecord, "id" | "createdAt" | "detectedAt" | "payloadHash"> & {
    payload: unknown;
  }
): ExposureEventRecord | null {
  if (memory.events.some((row) => row.eventKey === draft.eventKey)) return null;
  const payload = sanitizePayload(draft.payload);
  const event: ExposureEventRecord = {
    ...draft,
    id: input.createId(),
    detectedAt: input.now,
    payload,
    payloadHash: stableHash(payload),
    createdAt: input.now,
  };
  memory.events.push(event);
  return event;
}

function pushAlert(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  event: ExposureEventRecord | null,
  kind: AlertKind
): void {
  if (!event) return;
  if (kind === "SOURCE_CONFIRMATION") return;
  if (memory.alerts.some((row) => row.eventId === event.id)) return;
  const draft = buildAlertDraft(kind);
  const alert: ExposureAlertRecord = {
    id: input.createId(),
    entityId: event.entityId,
    eventId: event.id,
    severity: draft.severity,
    status: "OPEN",
    requiresAction: draft.requiresAction,
    title: draft.title,
    summary: draft.summary,
    createdAt: input.now,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    resolvedAt: null,
    resolvedByUserId: null,
  };
  memory.alerts.push(alert);
}

function entityContext(memory: LegalExposureMemory, entityId: string) {
  const entity = memory.entities.find((row) => row.id === entityId);
  if (!entity) return null;
  const cases = memory.cases.filter((row) => row.entityId === entityId);
  const caseIds = new Set(cases.map((row) => row.id));
  return {
    entity,
    cases,
    aliases: memory.aliases.filter((row) => row.entityId === entityId && row.active).map((row) => row.normalizedValue),
    trustedAliasValues: memory.aliases
      .filter((row) => row.entityId === entityId && row.active && isTrustedDiscoveryAliasType(row.type))
      .map((row) => row.value),
    officialIds: memory.evidences
      .filter((row) => caseIds.has(row.caseId))
      .map((row) => ({ officialIdentifier: row.sourceIdentifier, caseId: row.caseId })),
  };
}

function ensureCase(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  observation: NormalizedCaseObservation
): ExposureCaseRecord | null {
  const ctx = entityContext(memory, input.entityId);
  if (!ctx) return null;
  if (
    observation.discoveryConfirmation === "GENERIC" &&
    !genericDiscoveryHasAdditionalEvidence({
      explicitCnpj: observation.explicitCnpj,
      candidateName: observation.candidateName,
      entityCnpj: ctx.entity.cnpj,
      entityLegalName: ctx.entity.legalName,
      trustedAliasValues: ctx.trustedAliasValues,
    })
  ) {
    const event = pushEvent(memory, input, {
      eventKey: `CANDIDATE_REVIEW:${input.entityId}:${input.batch.source}:GENERIC:${normalizeProcessNumber(observation.processNumber) || normalizeLegalName(observation.candidateName) || "sem-chave"}`,
      entityId: input.entityId,
      caseId: null,
      communicationId: null,
      source: input.batch.source,
      eventType: "CANDIDATE_REVIEW",
      severity: "MEDIUM",
      payload: { method: "GENERIC_ALIAS", name: observation.candidateName, processNumber: observation.processNumber },
    });
    pushAlert(memory, input, event, "LIKELY_REVIEW");
    return null;
  }
  const processNumberNormalized = normalizeProcessNumber(observation.processNumber);
  const decision = correlateObservation({
    processNumberNormalized,
    explicitCnpj: observation.explicitCnpj,
    entityCnpj: ctx.entity.cnpj,
    officialIdentifier: observation.officialIdentifier,
    candidateName: observation.candidateName,
    entityLegalName: ctx.entity.legalName,
    aliases: ctx.aliases,
    existingCases: ctx.cases,
    knownOfficialIds: ctx.officialIds,
  });

  if (decision.confidence !== "CONFIRMED" || !processNumberNormalized) {
    if (decision.confidence === "LIKELY") {
      const event = pushEvent(memory, input, {
        eventKey: `CANDIDATE_REVIEW:${input.entityId}:${input.batch.source}:${normalizeLegalName(observation.candidateName) || processNumberNormalized || "sem-chave"}`,
        entityId: input.entityId,
        caseId: null,
        communicationId: null,
        source: input.batch.source,
        eventType: "CANDIDATE_REVIEW",
        severity: "MEDIUM",
        payload: { method: decision.method, name: observation.candidateName },
      });
      pushAlert(memory, input, event, "LIKELY_REVIEW");
    }
    return null;
  }

  let legalCase = memory.cases.find(
    (row) =>
      row.entityId === input.entityId && row.processNumberNormalized === processNumberNormalized
  );
  const created = !legalCase;
  if (!legalCase) {
    legalCase = {
      id: input.createId(),
      entityId: input.entityId,
      processNumber: observation.processNumber,
      processNumberNormalized,
      tribunal: observation.tribunal,
      jurisdiction: observation.jurisdiction,
      degree: observation.degree,
      courtUnit: observation.courtUnit,
      classCode: observation.classCode,
      className: observation.className,
      filedAt: observation.filedAt,
      currentStatus: observation.currentStatus,
      entityPole: observation.entityPole,
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      primarySource: input.batch.source,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      createdAt: input.now,
      updatedAt: input.now,
    };
    if (input.batch.source === "DJEN") {
      legalCase.jurisdiction = null;
      legalCase.degree = null;
      legalCase.classCode = null;
      legalCase.className = null;
      legalCase.filedAt = null;
    }
    memory.cases.push(legalCase);
    const event = pushEvent(memory, input, {
      eventKey: `NEW_CASE:${input.entityId}:${processNumberNormalized}`,
      entityId: input.entityId,
      caseId: legalCase.id,
      communicationId: null,
      source: input.batch.source,
      eventType: "NEW_CASE",
      severity: observation.entityPole === "PASSIVE" ? "HIGH" : "MEDIUM",
      payload: { processNumberNormalized, source: input.batch.source },
    });
    if (observation.entityPole === "PASSIVE") pushAlert(memory, input, event, "PASSIVE_CASE");
  } else {
    const previousStatus = legalCase.currentStatus;
    const previousPole = legalCase.entityPole;
    legalCase.lastSeenAt = input.now;
    legalCase.updatedAt = input.now;
    legalCase.sourceUpdatedAt = observation.sourceUpdatedAt ?? legalCase.sourceUpdatedAt;
    mergeExistingCaseMetadata(legalCase, observation, input.batch.source);
    if (observation.currentStatus && observation.currentStatus !== previousStatus) {
      legalCase.currentStatus = observation.currentStatus;
      pushEvent(memory, input, {
        eventKey: `CASE_STATUS_CHANGED:${legalCase.id}:${previousStatus ?? "-"}:${observation.currentStatus}`,
        entityId: input.entityId,
        caseId: legalCase.id,
        communicationId: null,
        source: input.batch.source,
        eventType: "CASE_STATUS_CHANGED",
        severity: "MEDIUM",
        payload: { from: previousStatus, to: observation.currentStatus },
      });
    }
    if (
      observation.entityPole !== "UNKNOWN" &&
      observation.entityPole !== previousPole &&
      previousPole === "UNKNOWN"
    ) {
      legalCase.entityPole = observation.entityPole;
      const event = pushEvent(memory, input, {
        eventKey: `CASE_POLE_CONFIRMED:${legalCase.id}:${observation.entityPole}`,
        entityId: input.entityId,
        caseId: legalCase.id,
        communicationId: null,
        source: input.batch.source,
        eventType: "CASE_POLE_CONFIRMED",
        severity: "HIGH",
        payload: { pole: observation.entityPole },
      });
      if (observation.entityPole === "PASSIVE") pushAlert(memory, input, event, "PASSIVE_CASE");
    }
    if (!created) {
      const evidenceExists = memory.evidences.some(
        (row) =>
          row.caseId === legalCase!.id &&
          row.source === input.batch.source &&
          row.sourceIdentifier === observation.sourceIdentifier
      );
      if (!evidenceExists) {
        pushEvent(memory, input, {
          eventKey: `SOURCE_CONFIRMATION:${input.entityId}:${processNumberNormalized}:${input.batch.source}`,
          entityId: input.entityId,
          caseId: legalCase.id,
          communicationId: null,
          source: input.batch.source,
          eventType: "SOURCE_CONFIRMATION",
          severity: "LOW",
          payload: { source: input.batch.source },
        });
      }
    }
  }

  const evidence = memory.evidences.find(
    (row) =>
      row.caseId === legalCase!.id &&
      row.source === input.batch.source &&
      row.sourceIdentifier === observation.sourceIdentifier
  );
  const rawMetadata = sanitizePayload(observation.rawMetadata);
  if (!evidence) {
    memory.evidences.push({
      id: input.createId(),
      caseId: legalCase.id,
      source: input.batch.source,
      sourceIdentifier: observation.sourceIdentifier,
      confidence: "CONFIRMED",
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      sourceUpdatedAt: observation.sourceUpdatedAt,
      rawMetadata,
      rawHash: stableHash(rawMetadata),
      createdAt: input.now,
      updatedAt: input.now,
    });
  } else {
    evidence.lastSeenAt = input.now;
    evidence.updatedAt = input.now;
    evidence.rawMetadata = rawMetadata;
    evidence.rawHash = stableHash(rawMetadata);
  }

  for (const party of observation.parties) {
    const normalizedName = normalizeLegalName(party.name);
    const documentNormalized = party.document?.replace(/\D/g, "") || "";
    const found = memory.parties.find(
      (row) =>
        row.caseId === legalCase!.id &&
        row.source === input.batch.source &&
        row.normalizedName === normalizedName &&
        (row.documentNormalized ?? "") === (documentNormalized ?? "")
    );
    if (!found) {
      memory.parties.push({
        id: input.createId(),
        caseId: legalCase.id,
        name: party.name,
        normalizedName,
        document: party.document,
        documentNormalized,
        partyType: party.partyType,
        pole: party.pole,
        source: input.batch.source,
        firstSeenAt: input.now,
        lastSeenAt: input.now,
      });
    } else {
      found.lastSeenAt = input.now;
    }
  }

  for (const movement of observation.movements) {
    const fingerprint = movementFingerprint({
      processNumberNormalized,
      sourceCode: movement.sourceCode,
      name: movement.name,
      occurredAt: movement.occurredAt,
      courtUnit: movement.courtUnit,
      complements: movement.complements,
    });
    if (memory.movements.some((row) => row.fingerprint === fingerprint)) continue;
    memory.movements.push({
      id: input.createId(),
      caseId: legalCase.id,
      source: input.batch.source,
      sourceCode: movement.sourceCode,
      name: movement.name,
      occurredAt: movement.occurredAt,
      courtUnit: movement.courtUnit,
      complements: sanitizePayload(movement.complements),
      fingerprint,
      firstSeenAt: input.now,
      rawMetadata: null,
      createdAt: input.now,
    });
    pushEvent(memory, input, {
      eventKey: `NEW_MOVEMENT:${fingerprint}`,
      entityId: input.entityId,
      caseId: legalCase.id,
      communicationId: null,
      source: input.batch.source,
      eventType: "NEW_MOVEMENT",
      severity: "LOW",
      payload: { name: movement.name, sourceCode: movement.sourceCode },
    });
    const kind = classifyCommunicationKind(movement.name);
    if (decision.confidence === "CONFIRMED" && kind === "HEARING") {
      const event = pushEvent(memory, input, {
        eventKey: `HEARING:${fingerprint}`,
        entityId: input.entityId,
        caseId: legalCase.id,
        communicationId: null,
        source: input.batch.source,
        eventType: "NEW_MOVEMENT",
        severity: "HIGH",
        payload: { name: movement.name },
      });
      pushAlert(memory, input, event, "HEARING");
    }
    if (decision.confidence === "CONFIRMED" && kind === "DECISION") {
      const event = pushEvent(memory, input, {
        eventKey: `DECISION:${fingerprint}`,
        entityId: input.entityId,
        caseId: legalCase.id,
        communicationId: null,
        source: input.batch.source,
        eventType: "NEW_MOVEMENT",
        severity: "HIGH",
        payload: { name: movement.name },
      });
      pushAlert(memory, input, event, "DECISION");
    }
  }

  return legalCase;
}

function applyCommunication(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  observation: NormalizedCommunicationObservation
): void {
  const key = communicationIdempotencyKey(
    input.batch.source,
    observation.tenantId,
    observation.sourceCommunicationId
  );
  const normalizedStatus = normalizeCommunicationStatus(observation.sourceStatus);
  const processNumberNormalized = normalizeProcessNumber(observation.processNumber);
  const linked = processNumberNormalized
    ? memory.cases.find(
        (row) =>
          row.entityId === input.entityId && row.processNumberNormalized === processNumberNormalized
      )
    : undefined;
  const existing = memory.communications.find((row) => row.idempotencyKey === key);
  const rawMetadata = sanitizePayload(observation.rawMetadata);
  if (!existing) {
    const row: ExposureCommunicationRecord = {
      id: input.createId(),
      entityId: input.entityId,
      caseId: linked?.id ?? null,
      source: input.batch.source,
      sourceCommunicationId: observation.sourceCommunicationId,
      idempotencyKey: key,
      processNumber: observation.processNumber,
      communicationType: observation.communicationType,
      subject: observation.subject,
      sourceStatus: observation.sourceStatus,
      normalizedStatus,
      availableAt: observation.availableAt,
      detectedAt: input.now,
      scienceDeadlineAt: observation.scienceDeadlineAt,
      sourceScienceAt: observation.sourceScienceAt,
      officialContentOpenedAt: null,
      officialContentOpenedByUserId: null,
      tribunal: observation.tribunal,
      courtUnit: observation.courtUnit,
      rawMetadata,
      rawHash: stableHash(rawMetadata),
      firstSeenAt: input.now,
      lastSeenAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    };
    memory.communications.push(row);
    pushEvent(memory, input, {
      eventKey: `NEW_COMMUNICATION:${key}`,
      entityId: input.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: input.batch.source,
      eventType: "NEW_COMMUNICATION",
      severity: "MEDIUM",
      payload: { communicationType: observation.communicationType },
    });
    emitCommunicationAlerts(memory, input, row, null);
    return;
  }

  const previous = existing.normalizedStatus;
  existing.lastSeenAt = input.now;
  existing.updatedAt = input.now;
  existing.sourceStatus = observation.sourceStatus;
  existing.normalizedStatus = normalizedStatus;
  existing.caseId = existing.caseId ?? linked?.id ?? null;
  existing.rawMetadata = rawMetadata;
  existing.rawHash = stableHash(rawMetadata);
  if (observation.sourceScienceAt) existing.sourceScienceAt = observation.sourceScienceAt;
  if (previous !== normalizedStatus) emitCommunicationAlerts(memory, input, existing, previous);
}

function emitCommunicationAlerts(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  row: ExposureCommunicationRecord,
  previous: ExposureCommunicationRecord["normalizedStatus"] | null
): void {
  const kind = classifyCommunicationKind(row.communicationType);
  const key = row.idempotencyKey;
  if (row.normalizedStatus === "ACKNOWLEDGED" && previous && previous !== "ACKNOWLEDGED") {
    pushEvent(memory, input, {
      eventKey: `COMMUNICATION_ACKNOWLEDGED:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "COMMUNICATION_ACKNOWLEDGED",
      severity: "INFO",
      payload: { sourceStatus: row.sourceStatus },
    });
  }
  if (row.normalizedStatus === "EXPIRED") {
    const event = pushEvent(memory, input, {
      eventKey: `COMMUNICATION_EXPIRED:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "COMMUNICATION_EXPIRED",
      severity: kind === "CITATION" ? "CRITICAL" : "HIGH",
      payload: { sourceStatus: row.sourceStatus },
    });
    if (kind === "CITATION") pushAlert(memory, input, event, "CITATION_EXPIRED");
  }
  if (row.normalizedStatus === "CANCELED") {
    const event = pushEvent(memory, input, {
      eventKey: `COMMUNICATION_CANCELED:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "COMMUNICATION_CANCELED",
      severity: "INFO",
      payload: { sourceStatus: row.sourceStatus },
    });
    pushAlert(memory, input, event, "CANCELLATION");
  }
  if (previous == null && row.normalizedStatus === "PENDING" && kind === "CITATION") {
    const event = pushEvent(memory, input, {
      eventKey: `NEW_CITATION:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "NEW_CITATION",
      severity: "CRITICAL",
      payload: { sourceStatus: row.sourceStatus },
    });
    pushAlert(memory, input, event, "CITATION_PENDING");
  }
  if (previous == null && row.normalizedStatus === "PENDING" && kind === "INTIMATION") {
    const event = pushEvent(memory, input, {
      eventKey: `NEW_INTIMATION:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "NEW_INTIMATION",
      severity: "HIGH",
      payload: { sourceStatus: row.sourceStatus },
    });
    pushAlert(memory, input, event, "INTIMATION_PENDING");
  }
  if (previous == null && kind === "ARCHIVAL") {
    const event = pushEvent(memory, input, {
      eventKey: `ARCHIVAL:${key}`,
      entityId: row.entityId,
      caseId: row.caseId,
      communicationId: row.id,
      source: row.source,
      eventType: "NEW_COMMUNICATION",
      severity: "INFO",
      payload: { communicationType: row.communicationType },
    });
    pushAlert(memory, input, event, "ARCHIVAL");
  }
}

function applyCandidate(
  memory: LegalExposureMemory,
  input: ApplyBatchInput,
  candidate: NormalizedCandidateObservation
): void {
  if (candidate.processNumber && normalizeProcessNumber(candidate.processNumber)) {
    ensureCase(memory, input, {
      processNumber: candidate.processNumber,
      tribunal: candidate.tribunal,
      jurisdiction: null,
      degree: null,
      courtUnit: null,
      classCode: null,
      className: null,
      filedAt: null,
      currentStatus: null,
      entityPole: "UNKNOWN",
      sourceIdentifier: candidate.officialIdentifier || candidate.processNumber,
      sourceUpdatedAt: null,
      explicitCnpj: candidate.explicitCnpj,
      candidateName: candidate.candidateName,
      officialIdentifier: candidate.officialIdentifier,
      parties: [],
      movements: [],
      rawMetadata: candidate.rawMetadata,
    });
    return;
  }
  const ctx = entityContext(memory, input.entityId);
  if (!ctx) return;
  const decision = correlateObservation({
    processNumberNormalized: null,
    explicitCnpj: candidate.explicitCnpj,
    entityCnpj: ctx.entity.cnpj,
    officialIdentifier: candidate.officialIdentifier,
    candidateName: candidate.candidateName,
    entityLegalName: ctx.entity.legalName,
    aliases: ctx.aliases,
    existingCases: ctx.cases,
    knownOfficialIds: ctx.officialIds,
  });
  if (decision.confidence !== "LIKELY") return;
  const event = pushEvent(memory, input, {
    eventKey: `CANDIDATE_REVIEW:${input.entityId}:${input.batch.source}:${normalizeLegalName(candidate.candidateName)}`,
    entityId: input.entityId,
    caseId: null,
    communicationId: null,
    source: input.batch.source,
    eventType: "CANDIDATE_REVIEW",
    severity: "MEDIUM",
    payload: { method: decision.method, name: candidate.candidateName },
  });
  pushAlert(memory, input, event, "LIKELY_REVIEW");
}

export function applyBatchToMemory(
  memory: LegalExposureMemory,
  input: ApplyBatchInput
): LegalExposureMemory {
  const entity = memory.entities.find((row) => row.id === input.entityId);
  if (!entity) return memory;

  if (!monitoringEnabled(memory, input.entityId, input.batch.source)) {
    upsertConnection(memory, input, "DISABLED");
    return memory;
  }

  if (!SUCCESSFUL_OUTCOMES.has(input.batch.outcome)) {
    upsertConnection(memory, input, statusFromQueryOutcome(input.batch.outcome));
    if (isCriticalMonitoringSource(input.batch.source)) {
      const event = pushEvent(memory, input, {
        eventKey: `SOURCE_FAILED:${input.entityId}:${input.batch.source}:${input.batch.errorCode ?? input.batch.outcome}:${entity.lastSuccessfulSyncAt ?? "never"}`,
        entityId: input.entityId,
        caseId: null,
        communicationId: null,
        source: input.batch.source,
        eventType: "SOURCE_FAILED",
        severity: "HIGH",
        payload: {
          outcome: input.batch.outcome,
          message: input.batch.errorMessageSanitized,
        },
      });
      pushAlert(memory, input, event, "SOURCE_FAILED");
    }
    return memory;
  }

  upsertConnection(
    memory,
    input,
    input.batch.outcome === "PARTIAL" ? "DEGRADED" : "HEALTHY"
  );
  entity.lastSuccessfulSyncAt = input.now;
  entity.updatedAt = input.now;

  if (input.batch.outcome === "NO_RESULTS") return memory;

  for (const observation of input.batch.cases) ensureCase(memory, input, observation);
  for (const observation of input.batch.communications) applyCommunication(memory, input, observation);
  for (const candidate of input.batch.candidates) applyCandidate(memory, input, candidate);
  return memory;
}
