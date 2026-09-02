/**
 * Contrato do fluxo autónomo por setor do Stock Collector.
 *
 * Deep-link de setor (ex.: /collector/sector/raw-material) é o QR operacional
 * da fase autônoma. O QR de item × almoxarifado × endereço permanece legado
 * em collectorQrContract.ts.
 */
import { InventoryValidationError } from "./../inventoryTypes.js";
import {
  isCollectorPublicBaseUrlFailure,
  joinCollectorPublicUrl,
  resolveCollectorPublicBaseUrl,
} from "./collectorPublicBaseUrl.js";

export const COLLECTOR_SECTORS = {
  RAW_MATERIAL: {
    code: "RAW_MATERIAL",
    slug: "raw-material",
    label: "Matéria-prima",
    sessionCodePrefix: "MP",
  },
} as const;

export type CollectorSectorCode = keyof typeof COLLECTOR_SECTORS;

export const COLLECTOR_SECTOR_CODES = Object.keys(COLLECTOR_SECTORS) as CollectorSectorCode[];

export const COLLECTOR_INVALID_SECTOR = "COLLECTOR_INVALID_SECTOR";

export {
  COLLECTOR_PUBLIC_BASE_URL_ENV,
  COLLECTOR_PUBLIC_BASE_URL_INVALID,
  COLLECTOR_PUBLIC_BASE_URL_REQUIRED,
} from "./collectorPublicBaseUrl.js";

const SLUG_TO_SECTOR = new Map<string, CollectorSectorCode>(
  COLLECTOR_SECTOR_CODES.map((code) => [COLLECTOR_SECTORS[code].slug, code])
);

export function normalizeCollectorSectorInput(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

/** Aceita code (RAW_MATERIAL), slug (raw-material) ou label aproximado. */
export function parseCollectorSector(raw: unknown): CollectorSectorCode {
  const text = String(raw ?? "").trim();
  if (!text) {
    throw new InventoryValidationError("Setor obrigatório.", COLLECTOR_INVALID_SECTOR);
  }
  const upper = text.toUpperCase().replace(/-/g, "_");
  if (upper in COLLECTOR_SECTORS) {
    return upper as CollectorSectorCode;
  }
  const slug = normalizeCollectorSectorInput(text);
  const fromSlug = SLUG_TO_SECTOR.get(slug);
  if (fromSlug) return fromSlug;
  throw new InventoryValidationError(
    "Setor de contagem não suportado.",
    COLLECTOR_INVALID_SECTOR
  );
}

export function collectorSectorSlug(sector: CollectorSectorCode): string {
  return COLLECTOR_SECTORS[sector].slug;
}

export function collectorSectorLabel(sector: CollectorSectorCode): string {
  return COLLECTOR_SECTORS[sector].label;
}

export function buildSectorCollectorPath(sector: CollectorSectorCode): string {
  return `/collector/sector/${collectorSectorSlug(sector)}`;
}

/**
 * Base pública HTTPS do Collector (QR / deep-link), já validada.
 * Sem fallback local inventado: se nada válido estiver setado, retorna null.
 */
export function getCollectorPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const resolution = resolveCollectorPublicBaseUrl(env);
  return resolution.ok ? resolution.baseUrl : null;
}

/**
 * URL ABSOLUTA do deep-link de setor — o conteúdo do QR físico.
 *
 * Fail-closed: sem base pública válida lança InventoryValidationError com
 * COLLECTOR_PUBLIC_BASE_URL_REQUIRED / _INVALID. Nunca degrada para path
 * relativo, que a câmera nativa do iPad não conseguiria abrir.
 */
export function buildSectorCollectorAbsoluteUrl(
  sector: CollectorSectorCode,
  env: NodeJS.ProcessEnv = process.env
): string {
  const resolution = resolveCollectorPublicBaseUrl(env);
  if (isCollectorPublicBaseUrlFailure(resolution)) {
    throw new InventoryValidationError(resolution.message, resolution.code);
  }
  return joinCollectorPublicUrl(resolution.baseUrl, buildSectorCollectorPath(sector));
}
