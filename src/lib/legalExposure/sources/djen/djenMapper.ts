/**
 * Mapper DJEN defensivo sobre fixture sanitizada.
 * Nome sozinho vira candidato. Número CNJ vira observação de processo.
 */

import type {
  NormalizedCandidateObservation,
  NormalizedCaseObservation,
  NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { sanitizePayload } from "../../legalExposureNormalization.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
  const candidates: NormalizedCandidateObservation[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row) continue;
    const processNumber = text(row.numeroProcesso) ?? text(row.numeroprocessocommascara);
    const name = text(row.nomeParte) ?? text(row.destinatario) ?? text(row.texto);
    const tribunal = text(row.siglaTribunal) ?? text(row.tribunal);
    if (processNumber) {
      cases.push({
        processNumber,
        tribunal,
        jurisdiction: null,
        degree: null,
        courtUnit: text(row.nomeOrgao),
        classCode: null,
        // tipoComunicacao é publicação (Intimação/Citação), não classe processual.
        className: null,
        filedAt: null,
        currentStatus: null,
        entityPole: "UNKNOWN",
        sourceIdentifier: processNumber,
        sourceUpdatedAt: text(row.dataDisponibilizacao),
        explicitCnpj: text(row.cnpj),
        candidateName: name,
        officialIdentifier: processNumber,
        parties: [],
        movements: [],
        rawMetadata: sanitizePayload(row),
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
        rawMetadata: sanitizePayload(row),
      });
    }
  }
  return {
    batch: {
      source: "DJEN",
      outcome: cases.length + candidates.length === 0 ? "NO_RESULTS" : "SUCCESS",
      errorCode: null,
      errorMessageSanitized: null,
      retryAfterSeconds: null,
      externalCall: true,
      cases,
      communications: [],
      candidates,
    },
    itemCount: list.length,
    totalCount: readTotalCount(root),
  };
}

export function mapDjenPublications(body: unknown): NormalizedSourceBatch {
  return mapDjenPublicationPage(body).batch;
}
