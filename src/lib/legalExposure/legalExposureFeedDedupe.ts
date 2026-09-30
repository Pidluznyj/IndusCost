/**
 * Deduplicação semântica no read model. Não apaga histórico físico.
 * Mesmo CNJ + mesma identidade de evento/publicação = uma linha executiva.
 */

import { canonicalProcessKey } from "./legalExposureNormalization.js";
import type { LegalExposureMemory } from "./legalExposureStore.js";

export function processKeyForCaseId(memory: LegalExposureMemory, caseId: string | null | undefined): string {
  if (!caseId) return "none";
  const legalCase = memory.cases.find((row) => row.id === caseId);
  if (!legalCase) return `case:${caseId}`;
  return canonicalProcessKey(legalCase.processNumberNormalized || legalCase.processNumber, legalCase.id).key;
}

export function semanticEventKey(
  memory: LegalExposureMemory,
  event: {
    eventKey: string;
    eventType: string;
    caseId: string | null;
    communicationId: string | null;
    payload: unknown;
  }
): string {
  const cnj = processKeyForCaseId(memory, event.caseId);
  const communication = event.communicationId
    ? memory.communications.find((row) => row.id === event.communicationId)
    : null;
  if (communication) {
    return `${event.eventType}:${cnj}:${communication.idempotencyKey || communication.sourceCommunicationId}`;
  }
  const stripped = event.eventKey.replace(/:[0-9a-f-]{8,}:/i, ":");
  const payload = event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
  const payloadHint = String(payload.processNumberNormalized ?? payload.processNumber ?? payload.name ?? "");
  return `${event.eventType}:${cnj}:${stripped}:${payloadHint}`;
}

export function semanticAlertKey(
  memory: LegalExposureMemory,
  alert: { eventId: string; title: string; entityId: string }
): string {
  const event = memory.events.find((row) => row.id === alert.eventId);
  if (!event) return `alert:${alert.title}:${alert.entityId}`;
  return semanticEventKey(memory, event);
}

export function semanticCommunicationKey(row: {
  idempotencyKey?: string | null;
  sourceCommunicationId?: string | null;
  processNumber?: string | null;
  communicationType?: string;
  availableAt?: string | null;
  entityId?: string;
}): string {
  if (row.idempotencyKey) return row.idempotencyKey;
  if (row.sourceCommunicationId) return row.sourceCommunicationId;
  const cnj = canonicalProcessKey(row.processNumber).key;
  return `${cnj}:${row.communicationType ?? ""}:${row.availableAt ?? ""}`;
}

export function uniqueByKey<T>(rows: T[], keyOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function siblingAlertIds(memory: LegalExposureMemory, alertId: string): string[] {
  const seed = memory.alerts.find((row) => row.id === alertId);
  if (!seed) return [];
  const key = semanticAlertKey(memory, seed);
  return memory.alerts.filter((row) => semanticAlertKey(memory, row) === key).map((row) => row.id);
}
