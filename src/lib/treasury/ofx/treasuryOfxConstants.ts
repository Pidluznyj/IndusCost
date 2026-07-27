/**
 * Constantes da base segura de importação OFX (Tesouraria).
 * Sem I/O — valores de política de intake.
 */

/** Limite duro de tamanho do arquivo OFX/QFX (5 MiB). */
export const TREASURY_OFX_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Proteção contra arquivos com explosão de lançamentos. */
export const TREASURY_OFX_MAX_TRANSACTIONS = 20_000;

/** Extensões aceitas (case-insensitive). */
export const TREASURY_OFX_ALLOWED_EXTENSIONS = [".ofx", ".qfx"] as const;

/**
 * MIME types permitidos. `application/octet-stream` só com extensão válida.
 * Bancos BR frequentemente enviam octet-stream / text/plain.
 */
export const TREASURY_OFX_ALLOWED_MIME_TYPES = [
  "application/x-ofx",
  "application/ofx",
  "application/vnd.intu.qfx",
  "text/ofx",
  "text/xml",
  "application/xml",
  "text/plain",
  "application/octet-stream",
] as const;

/** Prefixo do diretório temporário exclusivo da Tesouraria. */
export const TREASURY_OFX_TEMP_DIR_PREFIX = "induscost-treasury-ofx-" as const;

/** Biblioteca canônica de parsing (dependência npm). */
export const TREASURY_OFX_PARSER_LIBRARY = "ofx-data-extractor" as const;

export const TREASURY_OFX_FORMATS = ["OFX1", "OFX2", "UNKNOWN"] as const;
export type TreasuryOfxFormat = (typeof TREASURY_OFX_FORMATS)[number];
