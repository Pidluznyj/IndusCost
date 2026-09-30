/**
 * Fatos processuais derivados de evidências. Sem rawMetadata no DTO.
 */

import {
  LEGAL_EXPOSURE_SOURCES,
  type CaseEnrichmentStatus,
  type CaseVerificationStatus,
  type ExposureCaseLatestMovement,
  type ExposureCaseLatestPublication,
  type LegalExposureSource,
} from "./legalExposureContracts.js";
import type { ExposureCaseRecord, ExposureEvidenceRecord, ExposureMovementRecord } from "./legalExposureStore.js";

const OFFICIAL_CONFIRMATION_SOURCES = new Set<LegalExposureSource>(["DJEN", "DATAJUD"]);
const PROCESSUAL_CLASS_SOURCES = new Set<LegalExposureSource>(["DATAJUD"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueSources(sources: LegalExposureSource[]): LegalExposureSource[] {
  const present = new Set(sources);
  return LEGAL_EXPOSURE_SOURCES.filter((source) => present.has(source));
}

function evidenceTime(row: ExposureEvidenceRecord): number {
  return Date.parse(row.lastSeenAt || row.sourceUpdatedAt || row.firstSeenAt) || 0;
}

function movementTime(row: ExposureMovementRecord): number {
  const occurred = row.occurredAt ? Date.parse(row.occurredAt) : Number.NaN;
  if (Number.isFinite(occurred)) return occurred;
  return Date.parse(row.firstSeenAt) || 0;
}

export function evidenceSourcesOf(evidences: ExposureEvidenceRecord[]): LegalExposureSource[] {
  return uniqueSources(evidences.map((row) => row.source));
}

export function verificationStatusOf(evidences: ExposureEvidenceRecord[]): CaseVerificationStatus {
  const confirmedOfficial = evidences.some(
    (row) => row.confidence === "CONFIRMED" && OFFICIAL_CONFIRMATION_SOURCES.has(row.source)
  );
  return confirmedOfficial ? "CONFIRMED_OFFICIAL" : "REVIEW_REQUIRED";
}

export function enrichmentStatusOf(evidences: ExposureEvidenceRecord[]): CaseEnrichmentStatus {
  const hasDatajud = evidences.some((row) => row.source === "DATAJUD" && row.confidence === "CONFIRMED");
  if (hasDatajud) return "DATAJUD_ENRICHED";
  const hasDjen = evidences.some((row) => row.source === "DJEN" && row.confidence === "CONFIRMED");
  if (hasDjen) return "DJEN_ONLY";
  return "PARTIAL";
}

export function displayProcessClass(
  legalCase: Pick<ExposureCaseRecord, "classCode" | "className">,
  evidences: ExposureEvidenceRecord[]
): { classCode: string | null; className: string | null } {
  const processual = evidences.some(
    (row) => row.confidence === "CONFIRMED" && PROCESSUAL_CLASS_SOURCES.has(row.source)
  );
  if (!processual) return { classCode: null, className: null };
  return { classCode: legalCase.classCode, className: legalCase.className };
}

export function latestMovementOf(movements: ExposureMovementRecord[]): ExposureCaseLatestMovement | null {
  const dated = movements.filter((row) => row.occurredAt && Number.isFinite(Date.parse(row.occurredAt)));
  const pool = dated.length > 0 ? dated : movements;
  let best: ExposureMovementRecord | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const row of pool) {
    const time = movementTime(row);
    if (!best || time > bestTime) {
      best = row;
      bestTime = time;
    }
  }
  if (!best) return null;
  return {
    name: best.name,
    occurredAt: best.occurredAt,
    source: best.source,
    courtUnit: best.courtUnit,
  };
}

export function latestPublicationOf(evidences: ExposureEvidenceRecord[]): ExposureCaseLatestPublication | null {
  const djen = evidences.filter((row) => row.source === "DJEN");
  let best: ExposureEvidenceRecord | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;
  for (const row of djen) {
    const time = evidenceTime(row);
    if (!best || time > bestTime) {
      best = row;
      bestTime = time;
    }
  }
  if (!best) return null;
  const raw = asRecord(best.rawMetadata);
  return {
    type: textField(raw?.tipoComunicacao),
    availableAt: textField(raw?.dataDisponibilizacao),
    courtUnit: textField(raw?.nomeOrgao),
  };
}
