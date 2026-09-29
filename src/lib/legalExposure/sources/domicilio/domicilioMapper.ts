/**
 * Mapper defensivo. Fixture local não é o contrato oficial do CNJ.
 */

import {
  type NormalizedCommunicationObservation,
  type NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { sanitizeErrorMessage, sanitizePayload } from "../../legalExposureNormalization.js";
import type { DomicilioInstitution } from "./domicilioContracts.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function firstText(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const found = text(record[key]);
    if (found) return found;
  }
  return null;
}

export function mapDomicilioInstitution(body: unknown): DomicilioInstitution | null {
  const record = asRecord(body);
  if (!record) return null;
  const tenantId = firstText(record, ["tenantId", "id", "identificador"]);
  const institution = firstText(record, ["institution", "nome", "razaoSocial", "nomeInstituicao"]);
  if (!tenantId || !institution) return null;
  return { tenantId, institution };
}

export function mapDomicilioCommunicationList(body: unknown): NormalizedSourceBatch {
  const record = asRecord(body);
  const list = Array.isArray(body)
    ? body
    : Array.isArray(record?.content)
      ? record.content
      : Array.isArray(record?.items)
        ? record.items
        : Array.isArray(record?.comunicacoes)
          ? record.comunicacoes
          : null;
  if (!list) {
    return {
      source: "DOMICILIO",
      outcome: "INVALID_RESPONSE",
      errorCode: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta do Domicílio sem lista reconhecível.",
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const communications: NormalizedCommunicationObservation[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const sourceCommunicationId = firstText(row, ["id", "comunicacaoId", "sourceCommunicationId"]);
    if (!sourceCommunicationId) continue;
    communications.push({
      sourceCommunicationId,
      tenantId: firstText(row, ["tenantId"]),
      processNumber: firstText(row, ["numeroProcesso", "processNumber"]),
      communicationType: firstText(row, ["tipoComunicacao", "communicationType"]) ?? "OUTRA",
      subject: firstText(row, ["assunto", "subject"]),
      sourceStatus: firstText(row, ["statusCiente", "status", "sourceStatus"]) ?? "",
      availableAt: firstText(row, ["dataDisponibilizacao", "availableAt"]),
      scienceDeadlineAt: firstText(row, ["prazoCiencia", "scienceDeadlineAt"]),
      sourceScienceAt: firstText(row, ["dataCiente", "sourceScienceAt"]),
      tribunal: firstText(row, ["tribunal"]),
      courtUnit: firstText(row, ["orgao", "courtUnit"]),
      rawMetadata: sanitizePayload(row),
    });
  }
  return {
    source: "DOMICILIO",
    outcome: communications.length === 0 ? "NO_RESULTS" : "SUCCESS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: true,
    cases: [],
    communications,
    candidates: [],
  };
}

export function mapDomicilioFailure(message: string): NormalizedSourceBatch {
  return {
    source: "DOMICILIO",
    outcome: "SOURCE_ERROR",
    errorCode: "SOURCE_ERROR",
    errorMessageSanitized: sanitizeErrorMessage(message),
    retryAfterSeconds: null,
    externalCall: true,
    cases: [],
    communications: [],
    candidates: [],
  };
}
