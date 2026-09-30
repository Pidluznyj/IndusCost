/**
 * Mapper defensivo. Campos de parte/polo não são assumidos:
 * a descoberta por CNPJ espera o probe real.
 *
 * Datas compactas DataJud (AAAAMMDDHHMMSS) não carregam offset.
 * Os componentes civis são serializados de forma determinística como UTC
 * (`YYYY-MM-DDTHH:mm:ss.000Z`). Isso não afirma o fuso do tribunal.
 */

import type {
  LegalCasePole,
  NormalizedCaseObservation,
  NormalizedMovement,
  NormalizedParty,
  NormalizedSourceBatch,
  NormalizedSubject,
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

function subjectsFrom(source: Record<string, unknown>): NormalizedSubject[] {
  const raw = source.assuntos;
  if (!Array.isArray(raw)) return [];
  const out: NormalizedSubject[] = [];
  for (const [index, item] of raw.entries()) {
    const row = asRecord(item);
    const name = row ? text(row.nome) ?? text(row.descricao) : text(item);
    if (!name) continue;
    out.push({
      code: row ? text(row.codigo) : null,
      name,
      fullPath: row ? text(row.hierarquia) ?? text(row.caminhoCompleto) : null,
      isMain: Boolean(row?.principal) || index === 0,
    });
  }
  return out;
}

function poleFrom(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (folded.includes("ATIVO") || folded === "AT" || folded.includes("AUTHOR") || folded.includes("POLO ATIVO")) {
    return "ACTIVE";
  }
  if (folded.includes("PASSIVO") || folded === "PA" || folded.includes("REU") || folded.includes("POLO PASSIVO")) {
    return "PASSIVE";
  }
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}

function partiesFrom(source: Record<string, unknown>): NormalizedParty[] {
  const buckets = [source.polos, source.partes, source.pessoas];
  const out: NormalizedParty[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      const row = asRecord(item);
      if (!row) continue;
      const name = text(row.nome) ?? text(row.nomePessoa) ?? text(row.razaoSocial);
      if (!name) continue;
      const document = text(row.numeroDocumentoPrincipal) ?? text(row.documento) ?? text(row.cnpj) ?? text(row.cpf);
      out.push({
        name,
        document,
        partyType: text(row.tipo) ?? text(row.tipoParte) ?? text(row.papel),
        personType: document && document.replace(/\D/g, "").length === 14 ? "COMPANY" : document && document.replace(/\D/g, "").length === 11 ? "PERSON" : "UNKNOWN",
        pole: poleFrom(row.polo ?? row.poloProcessual ?? row.tipoPolo),
      });
    }
  }
  return out;
}

function systemNameFrom(source: Record<string, unknown>): string | null {
  const sistema = asRecord(source.sistema);
  return text(sistema?.nome) ?? text(source.sistema) ?? text(source.nomeSistema);
}

function currentStatusFrom(source: Record<string, unknown>): string | null {
  const situacao = asRecord(source.situacao);
  return (
    text(situacao?.nome) ??
    text(source.situacao) ??
    text(source.descricaoSituacao) ??
    text(asRecord(source.movimentoAtual)?.nome)
  );
}

function secrecyFrom(source: Record<string, unknown>): boolean | null {
  const nivel = asRecord(source.nivelSigilo) ?? asRecord(source.sigilo);
  if (typeof source.nivelSigilo === "number") return source.nivelSigilo > 0;
  if (typeof source.sigilo === "boolean") return source.sigilo;
  const nome = text(nivel?.nome) ?? text(source.nivelSigilo);
  if (!nome) return null;
  const folded = nome.toUpperCase();
  if (folded.includes("PUBLIC")) return false;
  if (folded.includes("SIGIL") || folded.includes("SEGREDO")) return true;
  return null;
}

function archivedAtFrom(source: Record<string, unknown>, movements: NormalizedMovement[]): string | null {
  const direct =
    normalizeDatajudDateTime(source.dataBaixa) ??
    normalizeDatajudDateTime(source.dataArquivamento) ??
    normalizeDatajudDateTime(asRecord(source.baixa)?.data);
  if (direct) return direct;
  const archival = movements.find((row) => /arquiv|baixa|extint/i.test(row.name));
  return archival?.occurredAt ?? null;
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
    const movements = movementsFrom(source);
    const parties = partiesFrom(source);
    cases.push({
      processNumber,
      tribunal,
      jurisdiction: text(source.grau),
      degree: text(source.grau),
      courtUnit: courtUnitFrom(source.orgaoJulgador),
      classCode: text(asRecord(source.classe)?.codigo),
      className: text(asRecord(source.classe)?.nome),
      filedAt: normalizeDatajudDateTime(source.dataAjuizamento),
      currentStatus: currentStatusFrom(source),
      entityPole: "UNKNOWN",
      sourceIdentifier: datajudId,
      sourceUpdatedAt: normalizeDatajudDateTime(source.dataHoraUltimaAtualizacao),
      explicitCnpj: null,
      candidateName: null,
      officialIdentifier: datajudId,
      parties,
      movements,
      subjects: subjectsFrom(source),
      systemName: systemNameFrom(source),
      area: text(source.formato) ?? text(asRecord(source.formato)?.nome),
      archivedAt: archivedAtFrom(source, movements),
      secrecy: secrecyFrom(source),
      priority: text(asRecord(source.prioridade)?.nome) ?? text(source.prioridade),
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
