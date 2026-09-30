/**
 * Classificação de inbox do Exposure. Sem score jurídico.
 */

import type { LegalExposureEventType, LegalExposureSeverity } from "./legalExposureContracts.js";

export const ALERT_CHANNELS = ["LEGAL", "TECHNICAL", "DATA"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

const TECHNICAL_EVENTS = new Set<string>(["SOURCE_FAILED", "SOURCE_STALE", "SOURCE_RECOVERED"]);
const DATA_EVENTS = new Set<string>(["CANDIDATE_REVIEW"]);

export function alertChannelOf(eventType: string | null | undefined): AlertChannel {
  const type = String(eventType ?? "");
  if (TECHNICAL_EVENTS.has(type)) return "TECHNICAL";
  if (DATA_EVENTS.has(type)) return "DATA";
  return "LEGAL";
}

export function alertActionLabel(input: {
  eventType: string | null;
  title: string;
}): string {
  const type = input.eventType as LegalExposureEventType | null;
  if (type === "NEW_CITATION") return "Revisar nova citação";
  if (type === "NEW_INTIMATION") return "Revisar nova intimação";
  if (type === "NEW_COMMUNICATION") return "Revisar nova comunicação";
  if (type === "SOURCE_FAILED") return "Verificar falha da fonte";
  if (type === "SOURCE_STALE") return "Verificar fonte desatualizada";
  if (type === "CANDIDATE_REVIEW") return "Revisar possível ocorrência";
  if (type === "NEW_CASE") return "Revisar processo identificado";
  return input.title.startsWith("Revisar") ? input.title : `Revisar: ${input.title}`;
}

export function isCriticalLegalAlert(input: {
  channel: AlertChannel;
  severity: LegalExposureSeverity;
}): boolean {
  return input.channel === "LEGAL" && (input.severity === "CRITICAL" || input.severity === "HIGH");
}

export function inboxMatchesFilter(
  filter: "all" | "critical" | "legal" | "data" | "technical" | "acknowledged",
  input: { channel: AlertChannel; severity: LegalExposureSeverity; status: string }
): boolean {
  if (filter === "acknowledged") return input.status === "ACKNOWLEDGED";
  if (input.status === "RESOLVED") return false;
  if (filter === "all") return input.status === "OPEN" || input.status === "ACKNOWLEDGED";
  if (input.status !== "OPEN") return false;
  if (filter === "critical") return isCriticalLegalAlert(input);
  if (filter === "legal") return input.channel === "LEGAL";
  if (filter === "data") return input.channel === "DATA";
  return input.channel === "TECHNICAL";
}
