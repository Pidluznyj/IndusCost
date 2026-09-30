/**
 * Mapper DJEN defensivo.
 * tipoComunicacao é publicação, não classe processual.
 * texto integral não é persistido.
 */

import type {
  LegalCasePole,
  NormalizedCandidateObservation,
  NormalizedCaseObservation,
  NormalizedCommunicationObservation,
  NormalizedParty,
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

function poleFrom(value: unknown): LegalCasePole {
  const folded = String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  if (folded.includes("ATIVO") || folded === "AT" || folded === "A") return "ACTIVE";
  if (folded.includes("PASSIVO") || folded === "PA" || folded === "P") return "PASSIVE";
  if (folded.includes("TERCEIR")) return "THIRD_PARTY";
  return "UNKNOWN";
}

function personTypeFrom(document: string | null): NormalizedParty["personType"] {
  const digits = document?.replace(/\D/g, "") ?? "";
  if (digits.length === 14) return "COMPANY";
  if (digits.length === 11) return "PERSON";
  return "UNKNOWN";
}

function partiesFrom(row: Record<string, unknown>): NormalizedParty[] {
  const bucket = row.destinatarios ?? row.destinatario;
  const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
  const out: NormalizedParty[] = [];
  for (const item of list) {
    const party = asRecord(item);
    if (!party) continue;
    const name = text(party.nome) ?? text(party.nomeParte);
    if (!name) continue;
    const document = text(party.cnpj) ?? text(party.cpf) ?? text(party.documento) ?? text(party.numeroDocumento);
    out.push({
      name,
      document,
      partyType: text(party.tipo) ?? text(party.polo),
      personType: personTypeFrom(document),
      pole: poleFrom(party.polo),
    });
  }
  return out;
}

function publicationIdentity(row: Record<string, unknown>, processNumber: string | null): string {
  return (
    text(row.id) ??
    [processNumber, text(row.dataDisponibilizacao) ?? text(row.data_disponibilizacao), text(row.tipoComunicacao)]
      .filter(Boolean)
      .join(":")
  );
}

function safeMetadata(row: Record<string, unknown>): unknown {
  const copy = { ...row };
  delete copy.texto;
  delete copy.textoComunicacao;
  delete copy.inteiroTeor;
  return sanitizePayload(copy);
}

export type DjenMappedPage = {
  batch: NormalizedSourceBatch;
  itemCount: number;
  totalCount: number | null;
};

function readTotalCount(root: Record<string, unknown> | null): number | null {
  const count = root?.count;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
}

export function mapDjenPublicationPage(body: unknown): DjenMappedPage {
  const root = asRecord(body);
  const list = Array.isArray(body) ? body : Array.isArray(root?.items) ? root.items : null;
  if (!list) {
    return {
      batch: {
        source: "DJEN",
        outcome: "INVALID_RESPONSE",
        errorCode: "INVALID_RESPONSE",
        errorMessageSanitized: "Resposta DJEN sem lista.",
        retryAfterSeconds: null,
        externalCall: true,
        cases: [],
        communications: [],
        candidates: [],
      },
      itemCount: 0,
      totalCount: readTotalCount(root),
    };
  }
  const cases: NormalizedCaseObservation[] = [];
  const communications: NormalizedCommunicationObservation[] = [];
  const candidates: NormalizedCandidateObservation[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const processNumber =
      text(row.numeroProcesso) ?? text(row.numeroprocessocommascara) ?? text(row.numero_processo);
    const name = text(row.nomeParte) ?? text(row.destinatario);
    const tribunal = text(row.siglaTribunal) ?? text(row.tribunal);
    const availableAt = text(row.dataDisponibilizacao) ?? text(row.data_disponibilizacao);
    const communicationType = text(row.tipoComunicacao) ?? "OUTRA";
    const identity = publicationIdentity(row, processNumber);
    if (processNumber) {
      cases.push({
        processNumber,
        tribunal,
        jurisdiction: null,
        degree: null,
        courtUnit: text(row.nomeOrgao),
        classCode: null,
        className: null,
        filedAt: null,
        currentStatus: null,
        entityPole: "UNKNOWN",
        sourceIdentifier: identity,
        sourceUpdatedAt: availableAt,
        explicitCnpj: text(row.cnpj),
        candidateName: name,
        officialIdentifier: processNumber,
        parties: partiesFrom(row),
        movements: [],
        rawMetadata: safeMetadata(row),
      });
      communications.push({
        sourceCommunicationId: identity,
        tenantId: null,
        processNumber,
        communicationType,
        subject: text(row.assunto) ?? name,
        sourceStatus: text(row.situacao) ?? "PUBLICADA",
        availableAt,
        scienceDeadlineAt: null,
        sourceScienceAt: null,
        tribunal,
        courtUnit: text(row.nomeOrgao),
        rawMetadata: safeMetadata(row),
      });
      continue;
    }
    if (name) {
      candidates.push({
        candidateName: name,
        processNumber: null,
        explicitCnpj: text(row.cnpj),
        officialIdentifier: text(row.id),
        tribunal,
        rawMetadata: safeMetadata(row),
      });
    }
  }
  return {
    batch: {
      source: "DJEN",
      outcome: cases.length + candidates.length + communications.length === 0 ? "NO_RESULTS" : "SUCCESS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: true,
      cases,
      communications,
      candidates,
    },
    itemCount: list.length,
    totalCount: readTotalCount(root),
  };
}

export function mapDjenPublications(body: unknown): NormalizedSourceBatch {
  return mapDjenPublicationPage(body).batch;
}
