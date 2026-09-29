/**
 * Mapper defensivo. Campos de parte/polo não são assumidos:
 * a descoberta por CNPJ espera o probe real.
 */

import type {
  NormalizedCaseObservation,
  NormalizedMovement,
  NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { sanitizePayload } from "../../legalExposureNormalization.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function movementsFrom(source: Record<string, unknown>): NormalizedMovement[] {
  const raw = source.movimentos;
  if (!Array.isArray(raw)) return [];
  const out: NormalizedMovement[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome) ?? text(row.descricao);
    if (!name) continue;
    out.push({
      sourceCode: text(row.codigo),
      name,
      occurredAt: text(row.dataHora) ?? text(row.data),
      courtUnit: text(row.orgaoJulgador),
      complements: sanitizePayload(row.complementos ?? null),
    });
  }
  return out;
}

export function mapDatajudSearch(body: unknown): NormalizedSourceBatch {
  const root = asRecord(body);
  const hitsWrap = asRecord(root?.hits);
  const hits = hitsWrap?.hits;
  if (!Array.isArray(hits)) {
    return {
      source: "DATAJUD",
      outcome: "INVALID_RESPONSE",
      errorCode: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta DataJud sem hits.",
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  if (hits.length === 0) {
    return {
      source: "DATAJUD",
      outcome: "NO_RESULTS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const cases: NormalizedCaseObservation[] = [];
  for (const hit of hits) {
    const row = asRecord(hit);
    const source = asRecord(row?._source);
    if (!source) continue;
    const processNumber = text(source.numeroProcesso);
    if (!processNumber) continue;
    const tribunal = text(source.tribunal) ?? text(source.siglaTribunal);
    cases.push({
      processNumber,
      tribunal,
      jurisdiction: text(source.grau),
      degree: text(source.grau),
      courtUnit: text(asRecord(source.orgaoJulgador)?.nome),
      classCode: text(asRecord(source.classe)?.codigo),
      className: text(asRecord(source.classe)?.nome),
      filedAt: text(source.dataAjuizamento),
      currentStatus: null,
      entityPole: "UNKNOWN",
      sourceIdentifier: processNumber,
      sourceUpdatedAt: text(source.dataHoraUltimaAtualizacao),
      explicitCnpj: null,
      candidateName: null,
      officialIdentifier: processNumber,
      parties: [],
      movements: movementsFrom(source),
      rawMetadata: sanitizePayload(source),
    });
  }
  return {
    source: "DATAJUD",
    outcome: cases.length === 0 ? "INVALID_RESPONSE" : "SUCCESS",
    errorCode: cases.length === 0 ? "INVALID_RESPONSE" : null,
    errorMessageSanitized: cases.length === 0 ? "Hits sem número de processo." : null,
    retryAfterSeconds: null,
    externalCall: true,
    cases,
    communications: [],
    candidates: [],
  };
}
