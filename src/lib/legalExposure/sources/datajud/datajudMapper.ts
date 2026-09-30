/**
 * Mapper defensivo do DataJud público.
 * Campos ausentes no payload real permanecem null / [].
 * Datas compactas (AAAAMMDDHHMMSS) são serializadas como UTC determinístico.
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
  if (rec) return text(rec.nome) ?? text(rec.nomeOrgao);
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

function subjectIsMain(row: Record<string, unknown>): boolean {
  return row.principal === true || row.principal === "S" || row.principal === "s";
}

function subjectsFrom(source: Record<string, unknown>): NormalizedSubject[] {
  const raw = source.assuntos;
  if (!Array.isArray(raw)) return [];
  const out: NormalizedSubject[] = [];
  for (const item of raw) {
    const row = asRecord(item);
    const name = row ? text(row.nome) ?? text(row.descricao) : text(item);
    if (!name) continue;
    const parent = row ? asRecord(row.assuntoPai) ?? asRecord(row.pai) : null;
    const parentName = parent ? text(parent.nome) : null;
    out.push({
      code: row ? text(row.codigo) : null,
      name,
      fullPath:
        (row ? text(row.hierarquia) ?? text(row.caminhoCompleto) : null) ??
        (parentName ? `${parentName} > ${name}` : null),
      isMain: row ? subjectIsMain(row) : false,
    });
  }
  return out;
}

function poleFrom(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (folded.includes("ATIVO") || folded === "AT" || folded === "A" || folded.includes("AUTHOR") || folded.includes("POLO ATIVO")) {
    return "ACTIVE";
  }
  if (folded.includes("PASSIVO") || folded === "PA" || folded === "P" || folded.includes("REU") || folded.includes("POLO PASSIVO")) {
    return "PASSIVE";
  }
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}

function personTypeFrom(document: string | null, hinted: string | null): NormalizedParty["personType"] {
  const digits = document?.replace(/\D/g, "") ?? "";
  if (digits.length === 14) return "COMPANY";
  if (digits.length === 11) return "PERSON";
  const folded = String(hinted ?? "").toUpperCase();
  if (folded.includes("JURIDIC") || folded === "PJ") return "COMPANY";
  if (folded.includes("FISIC") || folded === "PF") return "PERSON";
  return "UNKNOWN";
}

function pushParty(out: NormalizedParty[], row: Record<string, unknown>, inheritedPole: unknown): void {
  const name = text(row.nome) ?? text(row.nomePessoa) ?? text(row.razaoSocial);
  if (!name) return;
  const document =
    text(row.numeroDocumentoPrincipal) ?? text(row.documento) ?? text(row.cnpj) ?? text(row.cpf);
  const hintedType = text(row.tipoPessoa) ?? text(row.natureza);
  out.push({
    name,
    document,
    partyType: text(row.tipo) ?? text(row.tipoParte) ?? text(row.papel),
    personType: personTypeFrom(document, hintedType),
    pole: poleFrom(row.polo ?? row.poloProcessual ?? row.tipoPolo ?? inheritedPole),
  });
}

function partiesFrom(source: Record<string, unknown>): NormalizedParty[] {
  const buckets = [source.polos, source.partes, source.pessoas];
  const out: NormalizedParty[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      const row = asRecord(item);
      if (!row) continue;
      const nested = row.partes;
      if (Array.isArray(nested)) {
        for (const party of nested) {
          const nestedRow = asRecord(party);
          if (nestedRow) pushParty(out, nestedRow, row.polo ?? row.tipoPolo);
        }
        continue;
      }
      pushParty(out, row, null);
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
  return text(situacao?.nome) ?? text(source.situacao) ?? text(source.descricaoSituacao);
}

function secrecyFrom(source: Record<string, unknown>): boolean | null {
  if (typeof source.nivelSigilo === "number" && Number.isFinite(source.nivelSigilo)) {
    return source.nivelSigilo > 0;
  }
  if (typeof source.sigilo === "boolean") return source.sigilo;
  const nivel = asRecord(source.nivelSigilo) ?? asRecord(source.sigilo);
  const nome = text(nivel?.nome) ?? text(source.nivelSigilo);
  if (!nome) return null;
  const folded = nome.toUpperCase();
  if (folded.includes("PUBLIC")) return false;
  if (folded.includes("SIGIL") || folded.includes("SEGREDO")) return true;
  const asNumber = Number(nome);
  if (Number.isFinite(asNumber)) return asNumber > 0;
  return null;
}

function archivedAtFrom(source: Record<string, unknown>): string | null {
  return (
    normalizeDatajudDateTime(source.dataBaixa) ??
    normalizeDatajudDateTime(source.dataArquivamento) ??
    normalizeDatajudDateTime(asRecord(source.baixa)?.data) ??
    normalizeDatajudDateTime(asRecord(source.arquivamento)?.data)
  );
}

function claimValueFrom(source: Record<string, unknown>): { value: string; currency: string } | null {
  const dados = asRecord(source.dadosBasicos);
  const raw = source.valorCausa ?? source.valorCausaProcesso ?? dados?.valorCausa;
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw.toFixed(2), currency: "BRL" };
  if (typeof raw === "string" && raw.trim()) {
    const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
    if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) return null;
    return { value: amount.toFixed(2), currency: "BRL" };
  }
  return null;
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
    const claim = claimValueFrom(source);
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
      area: null,
      claimValue: claim?.value ?? null,
      claimCurrency: claim?.currency ?? null,
      archivedAt: archivedAtFrom(source),
      secrecy: secrecyFrom(source),
      priority: text(asRecord(source.prioridade)?.nome) ?? (typeof source.prioridade === "string" ? text(source.prioridade) : null),
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
