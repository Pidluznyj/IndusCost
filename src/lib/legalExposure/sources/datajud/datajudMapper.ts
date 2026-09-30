/**
 * Mapper defensivo. Campos de parte/polo não são assumidos:
 * a descoberta por CNPJ espera o probe real.
 *
 * Datas compactas DataJud (AAAAMMDDHHMMSS) não carregam offset.
 * Os componentes civis são serializados de forma determinística como UTC
 * (`YYYY-MM-DDTHH:mm:ss.000Z`). Isso não afirma o fuso do tribunal.
 */

import type {
  NormalizedCaseObservation,
  NormalizedMovement,
  NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { sanitizePayload } from "../../legalExposureNormalization.js";

const COMPACT_DATAJUD_DATETIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const ISO_DATAJUD_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

/**
 * Interpreta `dataAjuizamento` compacto (14 dígitos) e timestamps ISO da API.
 * Compacto inválido ou ISO inválido viram `null` — nunca `Invalid Date`.
 */
export function normalizeDatajudDateTime(value: unknown): string | null {
  if (value == null) return null;
  const raw =
    typeof value === "number" && Number.isFinite(value)
      ? String(Math.trunc(value))
      : typeof value === "string"
        ? value.trim()
        : null;
  if (!raw) return null;
  const compact = COMPACT_DATAJUD_DATETIME.exec(raw);
  if (compact) {
    const year = Number(compact[1]);
    const month = Number(compact[2]);
    const day = Number(compact[3]);
    const hour = Number(compact[4]);
    const minute = Number(compact[5]);
    const second = Number(compact[6]);
    if (month < 1 || month > 12) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (day < 1 || day > daysInMonth(year, month)) return null;
    return `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}.000Z`;
  }
  const parsed = Date.parse(raw);
  if (!ISO_DATAJUD_DATETIME.test(raw) || Number.isNaN(parsed)) return null;
  const date = new Date(parsed);
  if (Number.isNaN(date.getTime())) return null;
  return raw;
}

function courtUnitFrom(value: unknown): string | null {
  const rec = asRecord(value);
  if (rec) return text(rec.nome);
  return text(value);
}

function movementComplements(row: Record<string, unknown>): unknown {
  return sanitizePayload(row.complementosTabelados ?? row.complementos ?? null);
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
      occurredAt: normalizeDatajudDateTime(row.dataHora ?? row.data),
      courtUnit: courtUnitFrom(row.orgaoJulgador),
      complements: movementComplements(row),
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
    const datajudId = text(source.id) ?? processNumber;
    const tribunal = text(source.tribunal) ?? text(source.siglaTribunal);
    cases.push({
      processNumber,
      tribunal,
      jurisdiction: text(source.grau),
      degree: text(source.grau),
      courtUnit: courtUnitFrom(source.orgaoJulgador),
      classCode: text(asRecord(source.classe)?.codigo),
      className: text(asRecord(source.classe)?.nome),
      filedAt: normalizeDatajudDateTime(source.dataAjuizamento),
      currentStatus: null,
      entityPole: "UNKNOWN",
      sourceIdentifier: datajudId,
      sourceUpdatedAt: normalizeDatajudDateTime(source.dataHoraUltimaAtualizacao),
      explicitCnpj: null,
      candidateName: null,
      officialIdentifier: datajudId,
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
