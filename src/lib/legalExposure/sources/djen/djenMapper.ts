/**
 * Mapper DJEN defensivo.
 * tipoComunicacao é publicação, nunca classe processual.
 * Teor oficial vai para officialText sanitizado — não para rawMetadata.
 */

import type {
  NormalizedAttorney,
  NormalizedCandidateObservation,
  NormalizedCaseObservation,
  NormalizedCommunicationObservation,
  NormalizedHearing,
  NormalizedParty,
  NormalizedSourceBatch,
} from "../../legalExposureContracts.js";
import { canonicalProcessKey, sanitizePayload } from "../../legalExposureNormalization.js";
import {
  parseDjenPublicationText,
  poleFromDjenLabel,
  sanitizeOfficialPublicationText,
} from "../../parseDjenPublicationText.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function personTypeFrom(document: string | null): NormalizedParty["personType"] {
  const digits = document?.replace(/\D/g, "") ?? "";
  if (digits.length === 14) return "COMPANY";
  if (digits.length === 11) return "PERSON";
  return "UNKNOWN";
}

function mergeParties(structured: NormalizedParty[], parsed: NormalizedParty[]): NormalizedParty[] {
  const byKey = new Map<string, NormalizedParty>();
  function keyOf(party: NormalizedParty): string {
    const document = (party.document ?? "").replace(/\D/g, "");
    if (document) return `doc:${document}`;
    const folded = party.name.trim().toUpperCase();
    for (const [key, existing] of byKey) {
      if (existing.name.trim().toUpperCase() === folded) return key;
    }
    return `name:${folded}`;
  }
  for (const party of [...structured, ...parsed]) {
    const key = keyOf(party);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...party });
      continue;
    }
    if (existing.pole !== "UNKNOWN" && party.pole !== "UNKNOWN" && existing.pole !== party.pole) {
      byKey.set(key, { ...existing, pole: "UNKNOWN", partyType: "POLO_DIVERGENTE" });
      continue;
    }
    if (existing.pole === "UNKNOWN" && party.pole !== "UNKNOWN") {
      byKey.set(key, { ...existing, pole: party.pole, partyType: existing.partyType ?? party.partyType });
    }
    if (!existing.document && party.document) existing.document = party.document;
  }
  return [...byKey.values()];
}

function partiesFrom(row: Record<string, unknown>): NormalizedParty[] {
  const bucket = row.destinatarios ?? row.destinatario ?? row.partes;
  const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
  const out: NormalizedParty[] = [];
  for (const item of list) {
    const party = asRecord(item);
    if (!party) continue;
    const name = text(party.nome) ?? text(party.nomeParte) ?? text(party.nomePessoa);
    if (!name) continue;
    const document = text(party.cnpj) ?? text(party.cpf) ?? text(party.documento) ?? text(party.numeroDocumento);
    out.push({
      name,
      document,
      partyType: text(party.tipo) ?? text(party.polo) ?? text(party.tipoPolo),
      personType: personTypeFrom(document),
      pole: poleFromDjenLabel(party.polo ?? party.tipoPolo ?? party.tipo),
    });
  }
  return out;
}

function attorneysFrom(row: Record<string, unknown>): NormalizedAttorney[] {
  const bucket = row.destinatarioadvogados ?? row.destinatarioAdvogados ?? row.advogados;
  const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
  const out: NormalizedAttorney[] = [];
  for (const item of list) {
    const attorney = asRecord(item);
    if (!attorney) continue;
    const nested = asRecord(attorney.advogado) ?? attorney;
    const name = text(nested.nome) ?? text(nested.nomeAdvogado);
    if (!name) continue;
    const oabNumber = text(nested.numeroOAB) ?? text(nested.numero_oab) ?? text(nested.oab);
    const oabState = text(nested.ufOAB) ?? text(nested.uf_oab) ?? text(nested.uf);
    const represented = asRecord(attorney.destinatario) ?? asRecord(attorney.parte);
    out.push({
      name,
      document: text(nested.cpf) ?? text(nested.documento),
      oabNumber,
      oabState: oabState ? oabState.toUpperCase() : null,
      representedPartyName: text(represented?.nome) ?? text(attorney.nomeParte),
      representedPartyDocument: text(represented?.cnpj) ?? text(represented?.cpf),
    });
  }
  return out;
}

function publicationIdentity(row: Record<string, unknown>, processNumber: string | null): string {
  return (
    text(row.id) ??
    text(row.hash) ??
    [processNumber, text(row.dataDisponibilizacao) ?? text(row.data_disponibilizacao), text(row.tipoComunicacao)]
      .filter(Boolean)
      .join(":")
  );
}

function officialBody(row: Record<string, unknown>): string | null {
  return sanitizeOfficialPublicationText(
    text(row.texto) ?? text(row.textoComunicacao) ?? text(row.inteiroTeor) ?? text(row.conteudo)
  );
}

function safeMetadata(row: Record<string, unknown>): unknown {
  const copy = { ...row };
  delete copy.texto;
  delete copy.textoComunicacao;
  delete copy.inteiroTeor;
  delete copy.conteudo;
  return sanitizePayload(copy);
}

function mergeAttorneys(left: NormalizedAttorney[], right: NormalizedAttorney[]): NormalizedAttorney[] {
  const byKey = new Map<string, NormalizedAttorney>();
  for (const row of [...left, ...right]) {
    const oab = `${row.oabNumber ?? ""}:${row.oabState ?? ""}`.trim();
    const key = oab !== ":" ? `oab:${oab.toUpperCase()}` : `name:${row.name.trim().toUpperCase()}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function mergeHearings(left: NormalizedHearing[], right: NormalizedHearing[]): NormalizedHearing[] {
  const byKey = new Map<string, NormalizedHearing>();
  for (const row of [...left, ...right]) {
    const key = `${row.type ?? ""}:${row.scheduledAt ?? ""}:${row.courtUnit ?? ""}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
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
    const rawProcess =
      text(row.numeroProcesso) ?? text(row.numeroprocessocommascara) ?? text(row.numero_processo);
    const processKey = canonicalProcessKey(rawProcess);
    const processNumber = processKey.ok ? processKey.key : rawProcess;
    const name = text(row.nomeParte) ?? (typeof row.destinatario === "string" ? text(row.destinatario) : null);
    const tribunal = text(row.siglaTribunal) ?? text(row.tribunal);
    const availableAt = text(row.dataDisponibilizacao) ?? text(row.data_disponibilizacao);
    const communicationType = text(row.tipoComunicacao) ?? text(row.tipoDocumento) ?? "OUTRA";
    const identity = publicationIdentity(row, processNumber);
    const officialText = officialBody(row);
    const parsed = parseDjenPublicationText(officialText);
    const className = text(row.nomeClasse) ?? text(row.classeNome);
    const classCode = text(row.codigoClasse) ?? text(row.classeCodigo);
    if (processNumber) {
      const structuredParties = partiesFrom(row);
      const parties = mergeParties(structuredParties, parsed.parties);
      const attorneys = mergeAttorneys(attorneysFrom(row), parsed.attorneys);
      const hearings = mergeHearings([], parsed.hearings).map((hearing) => ({
        ...hearing,
        courtUnit: hearing.courtUnit ?? text(row.nomeOrgao),
      }));
      cases.push({
        processNumber,
        tribunal,
        jurisdiction: null,
        degree: null,
        courtUnit: text(row.nomeOrgao),
        classCode,
        className,
        filedAt: parsed.filedAt,
        currentStatus: null,
        entityPole: "UNKNOWN",
        sourceIdentifier: identity,
        sourceUpdatedAt: availableAt,
        explicitCnpj: text(row.cnpj),
        candidateName: name,
        officialIdentifier: processNumber,
        parties,
        movements: [],
        attorneys,
        hearings,
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
        officialText,
        officialHash: text(row.hash),
        officialLink: text(row.link) ?? parsed.officialLinks[0] ?? null,
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
