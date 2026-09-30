/**
 * Mapper complementar Jusbrasil/Digesto. Não inventa campo ausente.
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
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

function partiesFrom(root: Record<string, unknown>): NormalizedParty[] {
  const list = Array.isArray(root.partes) ? root.partes : Array.isArray(root.pessoas) ? root.pessoas : [];
  const out: NormalizedParty[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.nome) ?? text(row.name);
    if (!name) continue;
    const document = text(row.documento) ?? text(row.cpf) ?? text(row.cnpj);
    out.push({
      name,
      document,
      partyType: text(row.tipo) ?? text(row.polo) ?? text(row.relacao),
      personType: document && document.replace(/\D/g, "").length === 14 ? "COMPANY" : document && document.replace(/\D/g, "").length === 11 ? "PERSON" : "UNKNOWN",
      pole: poleFrom(row.polo ?? row.tipo ?? row.relacao),
    });
  }
  return out;
}

function movementsFrom(root: Record<string, unknown>): NormalizedMovement[] {
  const list = Array.isArray(root.movs) ? root.movs : Array.isArray(root.movimentacoes) ? root.movimentacoes : [];
  const out: NormalizedMovement[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const name = text(row.texto) ?? text(row.conteudo) ?? text(row.nome);
    if (!name) continue;
    out.push({
      sourceCode: text(row.codigo) ?? text(row.id),
      name,
      occurredAt: text(row.data) ?? text(row.dt),
      courtUnit: text(row.orgao),
      complements: sanitizePayload(row),
    });
  }
  return out;
}

function subjectsFrom(root: Record<string, unknown>): NormalizedSubject[] {
  const name = text(root.assunto) ?? text(asRecord(root.assunto)?.nome);
  if (!name) return [];
  return [{ code: null, name, fullPath: null, isMain: true }];
}

export function mapJusbrasilProcess(body: unknown): NormalizedSourceBatch {
  const root = asRecord(body);
  const processNumber = text(root?.numero) ?? text(root?.cnj) ?? text(root?.npu);
  if (!root || !processNumber) {
    return {
      source: "JUSBRASIL",
      outcome: "INVALID_RESPONSE",
      errorCode: "INVALID_RESPONSE",
      errorMessageSanitized: "Resposta Jusbrasil sem número CNJ.",
      retryAfterSeconds: null,
      externalCall: true,
      cases: [],
      communications: [],
      candidates: [],
    };
  }
  const observation: NormalizedCaseObservation = {
    processNumber,
    tribunal: text(root.tribunal) ?? text(root.sigla_tribunal),
    jurisdiction: text(root.instancia),
    degree: text(root.instancia),
    courtUnit: text(root.foro) ?? text(root.orgao),
    classCode: null,
    className: text(root.classe),
    filedAt: text(root.distribuicao) ?? text(root.data_distribuicao),
    currentStatus: text(root.situacao) ?? text(root.status),
    entityPole: "UNKNOWN",
    sourceIdentifier: processNumber,
    sourceUpdatedAt: text(root.atualizado_em) ?? text(root.last_update),
    explicitCnpj: null,
    candidateName: null,
    officialIdentifier: processNumber,
    parties: partiesFrom(root),
    movements: movementsFrom(root),
    subjects: subjectsFrom(root),
    attorneys: [],
    hearings: [],
    systemName: text(root.sistema),
    area: text(root.area),
    claimValue: text(root.valor) ?? text(asRecord(root.valor_causa)?.valor),
    claimCurrency: "BRL",
    archivedAt: null,
    secrecy: null,
    priority: null,
    rawMetadata: sanitizePayload({ complementary: true, process: root }),
  };
  return {
    source: "JUSBRASIL",
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

export function notConfiguredJusbrasilBatch(): NormalizedSourceBatch {
  return {
    source: "JUSBRASIL",
    outcome: "CONFIGURATION_ERROR",
    errorCode: "NOT_CONFIGURED",
    errorMessageSanitized: "Jusbrasil desligado ou sem credencial.",
    retryAfterSeconds: null,
    externalCall: false,
    cases: [],
    communications: [],
    candidates: [],
  };
}
