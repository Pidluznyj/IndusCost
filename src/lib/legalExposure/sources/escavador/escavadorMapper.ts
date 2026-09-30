/**
 * Mapper complementar Escavador. Não inventa campo ausente.
 */

import type {
  LegalCasePole,
  NormalizedAttorney,
  NormalizedCaseObservation,
  NormalizedHearing,
  NormalizedMovement,
  NormalizedParty,
  NormalizedSourceBatch,
  NormalizedSubject,
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

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return null;
  return new Date(parsed).toISOString();
}

function poleFrom(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (folded.includes("ATIVO") || folded.includes("AUTOR") || folded.includes("RECLAMANTE")) return "ACTIVE";
  if (folded.includes("PASSIVO") || folded.includes("REU") || folded.includes("RECLAMAD")) return "PASSIVE";
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}

function money(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return value.toFixed(2);
  const raw = text(value);
  if (!raw) return null;
  if (raw.includes(",")) {
    const amount = Number(raw.replace(/\./g, "").replace(",", "."));
    return Number.isFinite(amount) ? amount.toFixed(2) : null;
  }
  const amount = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? amount.toFixed(2) : null;
}

function partiesFrom(root: Record<string, unknown>): NormalizedParty[] {
  const out: NormalizedParty[] = [];
  const envolvidos = root.envolvidos ?? root.partes ?? asRecord(root.fontes)?.envolvidos;
  const list = Array.isArray(envolvidos) ? envolvidos : [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome) ?? text(row.nome_normalizado);
    if (!name) continue;
    const document = text(row.cpf) ?? text(row.cnpj) ?? text(row.documento);
    out.push({
      name,
      document,
      partyType: text(row.tipo) ?? text(row.polo) ?? text(row.titulo),
      personType: document && document.replace(/\D/g, "").length === 14 ? "COMPANY" : document && document.replace(/\D/g, "").length === 11 ? "PERSON" : "UNKNOWN",
      pole: poleFrom(row.polo ?? row.tipo_polo ?? row.tipo),
    });
  }
  return out;
}

function attorneysFrom(root: Record<string, unknown>): NormalizedAttorney[] {
  const list = Array.isArray(root.advogados) ? root.advogados : [];
  const out: NormalizedAttorney[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome);
    if (!name) continue;
    const oab = asRecord(row.oab) ?? row;
    out.push({
      name,
      document: text(row.cpf) ?? text(row.documento),
      oabNumber: text(oab.numero) ?? text(row.oab_numero) ?? text(row.oab),
      oabState: text(oab.uf) ?? text(row.oab_uf) ?? text(row.uf),
      representedPartyName: text(row.parte) ?? text(row.representado),
      representedPartyDocument: text(row.documento_parte),
    });
  }
  return out;
}

function hearingsFrom(root: Record<string, unknown>): NormalizedHearing[] {
  const list = Array.isArray(root.audiencias) ? root.audiencias : [];
  const out: NormalizedHearing[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    out.push({
      type: text(row.tipo) ?? text(row.titulo),
      scheduledAt: isoDate(row.data) ?? isoDate(row.data_hora),
      status: text(row.situacao) ?? text(row.status),
      courtUnit: text(row.orgao) ?? text(row.unidade),
    });
  }
  return out;
}

function subjectsFrom(root: Record<string, unknown>): NormalizedSubject[] {
  const out: NormalizedSubject[] = [];
  const main = text(root.assunto) ?? text(asRecord(root.assunto)?.nome);
  if (main) out.push({ code: null, name: main, fullPath: null, isMain: true });
  const extras = root.assuntos_normalizados ?? root.assuntos;
  if (Array.isArray(extras)) {
    for (const item of extras) {
      const row = asRecord(item);
      const name = row ? text(row.nome) ?? text(row.titulo) : text(item);
      if (!name || out.some((subject) => subject.name === name)) continue;
      out.push({
        code: row ? text(row.codigo) : null,
        name,
        fullPath: row ? text(row.caminho) : null,
        isMain: false,
      });
    }
  }
  return out;
}

function movementsFrom(body: unknown): NormalizedMovement[] {
  const root = asRecord(body);
  const items = root?.items ?? root?.movimentacoes ?? (Array.isArray(body) ? body : []);
  if (!Array.isArray(items)) return [];
  const out: NormalizedMovement[] = [];
  for (const item of items) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.conteudo) ?? text(row.texto) ?? text(row.descricao) ?? text(row.tipo);
    if (!name) continue;
    out.push({
      sourceCode: text(row.id) ?? text(row.codigo),
      name,
      occurredAt: isoDate(row.data) ?? isoDate(row.datahora),
      courtUnit: text(row.orgao) ?? text(row.unidade_origem),
      complements: sanitizePayload(row.complemento ?? null),
    });
  }
  return out;
}

export function mapEscavadorProcess(capa: unknown, movementsBody: unknown): NormalizedSourceBatch {
  const root = asRecord(capa);
  const processNumber =
    text(root?.numero_cnj) ?? text(root?.numero) ?? text(asRecord(root?.processo)?.numero_cnj);
  if (!root || !processNumber) {
    return {
      source: "ESCAVADOR",
      outcome: "INVALID_RESPONSE",
      errorCode: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta Escavador sem número CNJ.",
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const fonte = asRecord(Array.isArray(root.fontes) ? root.fontes[0] : root.fonte);
  const observation: NormalizedCaseObservation = {
    processNumber,
    tribunal: text(root.uf) ?? text(fonte?.tribunal) ?? text(root.tribunal),
    jurisdiction: text(root.grau) ?? text(fonte?.grau),
    degree: text(root.grau) ?? text(fonte?.grau),
    courtUnit: text(root.unidade_origem) ?? text(fonte?.orgao) ?? text(root.orgao_julgador),
    classCode: null,
    className: text(root.classe) ?? text(fonte?.classe),
    filedAt: isoDate(root.data_inicio) ?? isoDate(root.data_distribuicao),
    currentStatus: text(root.situacao) ?? text(fonte?.situacao),
    entityPole: "UNKNOWN",
    sourceIdentifier: processNumber,
    sourceUpdatedAt: isoDate(root.data_ultima_movimentacao) ?? isoDate(root.atualizado_em),
    explicitCnpj: null,
    candidateName: null,
    officialIdentifier: processNumber,
    parties: partiesFrom(root),
    movements: movementsFrom(movementsBody),
    subjects: subjectsFrom(root),
    attorneys: attorneysFrom(root),
    hearings: hearingsFrom(root),
    systemName: text(root.sistema) ?? text(fonte?.sistema),
    area: text(root.area),
    claimValue: money(root.valor_causa ?? fonte?.valor_causa),
    claimCurrency: "BRL",
    archivedAt: isoDate(root.data_arquivamento) ?? isoDate(fonte?.data_arquivamento),
    secrecy: typeof root.segredo_justica === "boolean" ? root.segredo_justica : null,
    priority: text(root.prioridade),
    rawMetadata: sanitizePayload({ capa: root, complementary: true }),
  };
  return {
    source: "ESCAVADOR",
    outcome: "SUCCESS",
    errorCode: null,
    errorMessageSanitized: null,
    retryAfterSeconds: null,
    externalCall: true,
    cases: [observation],
    communications: [],
    candidates: [],
  };
}

export function notConfiguredEscavadorBatch(): NormalizedSourceBatch {
  return {
    source: "ESCAVADOR",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "NOT_CONFIGURED",
    errorMessageSanitized: "Escavador desligado ou sem credencial.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}
