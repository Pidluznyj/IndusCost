/**
 * Rótulos e formatação da lista de processos. Sem rawMetadata e sem ISO bruto na UI.
 */

import {
  CASE_AWAITING_DATAJUD_COPY,
  CASE_DATAJUD_AVAILABLE_COPY,
  CASE_FILED_AT_UNKNOWN_COPY,
  CASE_MOVEMENT_UNKNOWN_COPY,
  CASE_POLE_ACTIVE_COPY,
  CASE_POLE_OTHER_COPY,
  CASE_POLE_PASSIVE_COPY,
  CASE_POLE_THIRD_PARTY_COPY,
  CASE_POLE_UNKNOWN_COPY,
  CASE_REVIEW_REQUIRED_COPY,
  CASE_STATUS_UNKNOWN_COPY,
  CASE_VERIFIED_OFFICIAL_COPY,
  type CaseEnrichmentStatus,
  type CaseVerificationStatus,
} from "./legalExposureContracts.js";

export function formatExposureDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatExposureDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function casePoleLabel(pole: string | null | undefined): string {
  if (pole === "PASSIVE") return CASE_POLE_PASSIVE_COPY;
  if (pole === "ACTIVE") return CASE_POLE_ACTIVE_COPY;
  if (pole === "THIRD_PARTY") return CASE_POLE_THIRD_PARTY_COPY;
  if (pole === "OTHER") return CASE_POLE_OTHER_COPY;
  return CASE_POLE_UNKNOWN_COPY;
}

export function caseStatusLabel(status: string | null | undefined): string {
  const value = status?.trim();
  return value || CASE_STATUS_UNKNOWN_COPY;
}

export function caseFiledAtLabel(filedAt: string | null | undefined): string {
  return formatExposureDate(filedAt) ?? CASE_FILED_AT_UNKNOWN_COPY;
}

export function caseMovementLabel(input: {
  name: string;
  occurredAt: string | null;
} | null): string {
  if (!input) return CASE_MOVEMENT_UNKNOWN_COPY;
  const when = formatExposureDate(input.occurredAt);
  return when ? `${when} · ${input.name}` : input.name;
}

export function caseVerificationLabel(status: CaseVerificationStatus): string {
  return status === "CONFIRMED_OFFICIAL" ? CASE_VERIFIED_OFFICIAL_COPY : CASE_REVIEW_REQUIRED_COPY;
}

export function caseEnrichmentLabel(status: CaseEnrichmentStatus): string {
  return status === "DATAJUD_ENRICHED" ? CASE_DATAJUD_AVAILABLE_COPY : CASE_AWAITING_DATAJUD_COPY;
}
