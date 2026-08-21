/**
 * Contrato do fluxo autónomo por setor do Stock Collector.
 *
 * Deep-link de setor (ex.: /collector/sector/raw-material) é o QR operacional
 * da fase autônoma. O QR de item × almoxarifado × endereço permanece legado
 * em collectorQrContract.ts.
 */
import { InventoryValidationError } from "./../inventoryTypes.js";

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
export const COLLECTOR_PUBLIC_BASE_URL_ENV = "INVENTORY_COLLECTOR_PUBLIC_BASE_URL";

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
 * Base pública HTTPS do Collector (QR / deep-link).
 * Preferência: INVENTORY_COLLECTOR_PUBLIC_BASE_URL → APP_URL.
 * Sem fallback local inventado: se nenhum estiver setado, retorna null.
 */
export function getCollectorPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const primary = String(env[COLLECTOR_PUBLIC_BASE_URL_ENV] ?? "").trim();
  const fallback = String(env.APP_URL ?? "").trim();
  const raw = primary || fallback;
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export function buildSectorCollectorAbsoluteUrl(
  sector: CollectorSectorCode,
  env: NodeJS.ProcessEnv = process.env
): string {
  const base = getCollectorPublicBaseUrl(env);
  const path = buildSectorCollectorPath(sector);
  if (!base) return path;
  try {
    return new URL(path, `${base}/`).toString();
  } catch {
    return `${base}${path}`;
  }
}
