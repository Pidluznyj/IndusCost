/**
 * Hierarquia de autoridade das fontes do Exposure.
 * Oficial não é sobrescrito por complementar. Localizador nunca confirma polo.
 */

import type { LegalCasePole, LegalExposureSource } from "./legalExposureContracts.js";

export const OFFICIAL_PROCESS_SOURCES = new Set<LegalExposureSource>(["DATAJUD", "TRIBUNAL_PUBLIC"]);
export const OFFICIAL_PUBLICATION_SOURCES = new Set<LegalExposureSource>(["DJEN"]);
export const COMPLEMENTARY_SOURCES = new Set<LegalExposureSource>(["ESCAVADOR", "JUSBRASIL"]);
export const LOCATOR_SOURCES = new Set<LegalExposureSource>(["WEB_DISCOVERY"]);

export function isOfficialProcessSource(source: LegalExposureSource): boolean {
  return OFFICIAL_PROCESS_SOURCES.has(source);
}

export function isComplementarySource(source: LegalExposureSource): boolean {
  return COMPLEMENTARY_SOURCES.has(source);
}

export function isLocatorSource(source: LegalExposureSource): boolean {
  return LOCATOR_SOURCES.has(source);
}

export function sourceKindOf(
  source: LegalExposureSource
): "OFFICIAL_PROCESS" | "OFFICIAL_PUBLICATION" | "COMPLEMENTARY" | "LOCATOR" | "OTHER" {
  if (OFFICIAL_PROCESS_SOURCES.has(source)) return "OFFICIAL_PROCESS";
  if (OFFICIAL_PUBLICATION_SOURCES.has(source)) return "OFFICIAL_PUBLICATION";
  if (COMPLEMENTARY_SOURCES.has(source)) return "COMPLEMENTARY";
  if (LOCATOR_SOURCES.has(source)) return "LOCATOR";
  return "OTHER";
}

/** Polo ACTIVE de publicação DJEN no destinatário do grupo não confirma reclamante. */
export function djenGroupRecipientPole(pole: string): LegalCasePole {
  if (pole === "PASSIVE") return "PASSIVE";
  if (pole === "THIRD_PARTY") return "THIRD_PARTY";
  if (pole === "OTHER") return "OTHER";
  return "UNKNOWN";
}
