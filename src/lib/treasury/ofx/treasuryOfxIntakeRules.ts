/**
 * Regras puras de intake OFX — MIME, tamanho, peek de formato, hash.
 * Sem fs / sem Prisma.
 */

import { createHash } from "node:crypto";
import { extname } from "node:path";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import {
  TREASURY_OFX_ALLOWED_EXTENSIONS,
  TREASURY_OFX_ALLOWED_MIME_TYPES,
  TREASURY_OFX_MAX_FILE_BYTES,
  type TreasuryOfxFormat,
} from "./treasuryOfxConstants.js";

export type TreasuryOfxIntakeMeta = {
  originalName: string;
  mimeType: string;
  byteLength: number;
};

export function treasuryOfxExtension(fileName: string): string {
  return extname(fileName.trim()).toLowerCase();
}

export function isAllowedTreasuryOfxExtension(fileName: string): boolean {
  return (TREASURY_OFX_ALLOWED_EXTENSIONS as readonly string[]).includes(
    treasuryOfxExtension(fileName)
  );
}

export function isAllowedTreasuryOfxMimeType(
  mimeType: string,
  fileName: string
): boolean {
  const mime = mimeType.trim().toLowerCase();
  if (
    !(TREASURY_OFX_ALLOWED_MIME_TYPES as readonly string[]).includes(mime)
  ) {
    return false;
  }
  if (mime === "application/octet-stream" || mime === "text/plain") {
    return isAllowedTreasuryOfxExtension(fileName);
  }
  return true;
}

export function hashTreasuryOfxBuffer(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** Detecta OFX 1 (SGML) vs OFX 2 (XML) pelo cabeçalho. */
export function detectTreasuryOfxFormat(text: string): TreasuryOfxFormat {
  const head = text.slice(0, 4096);
  if (/<\?OFX\b/i.test(head) || /OFXHEADER\s*:\s*200\b/i.test(head)) {
    return "OFX2";
  }
  if (/OFXHEADER\s*:\s*100\b/i.test(head) || /\bDATA\s*:\s*OFXSGML\b/i.test(head)) {
    return "OFX1";
  }
  if (/<OFX[\s>]/i.test(head)) {
    // XML sem PI explícito — tratar como OFX2 estruturalmente.
    return /<\?xml\b/i.test(head) ? "OFX2" : "UNKNOWN";
  }
  return "UNKNOWN";
}

export function assertTreasuryOfxLooksSafe(buffer: Buffer): void {
  if (buffer.byteLength === 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Arquivo OFX vazio.",
      "file"
    );
  }
  if (buffer.byteLength > TREASURY_OFX_MAX_FILE_BYTES) {
    throw new TreasuryDomainError(
      "PAYLOAD_TOO_LARGE",
      `Arquivo OFX excede o limite de ${TREASURY_OFX_MAX_FILE_BYTES} bytes.`,
      "file"
    );
  }
  // Proteção contra binário / NUL (arquivo malformado ou não-texto).
  if (buffer.includes(0)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Arquivo OFX contém bytes nulos — conteúdo rejeitado.",
      "file"
    );
  }
}

export function assertTreasuryOfxIntakeMeta(meta: TreasuryOfxIntakeMeta): void {
  if (!meta.originalName?.trim()) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Nome do arquivo OFX é obrigatório.",
      "originalName"
    );
  }
  if (!isAllowedTreasuryOfxExtension(meta.originalName)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Extensão de arquivo não permitida. Use .ofx ou .qfx.",
      "originalName"
    );
  }
  if (!isAllowedTreasuryOfxMimeType(meta.mimeType, meta.originalName)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `MIME não permitido para OFX: ${meta.mimeType || "(vazio)"}.`,
      "mimeType"
    );
  }
  if (meta.byteLength > TREASURY_OFX_MAX_FILE_BYTES) {
    throw new TreasuryDomainError(
      "PAYLOAD_TOO_LARGE",
      `Arquivo OFX excede o limite de ${TREASURY_OFX_MAX_FILE_BYTES} bytes.`,
      "file"
    );
  }
  if (meta.byteLength <= 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Arquivo OFX vazio.",
      "file"
    );
  }
}

/**
 * Valida buffer + metadados e exige marcador OFX no início.
 * Não faz parse completo.
 */
export function assertTreasuryOfxIntake(
  buffer: Buffer,
  meta: Omit<TreasuryOfxIntakeMeta, "byteLength"> & { byteLength?: number }
): { sha256: string; formatHint: TreasuryOfxFormat; textPreview: string } {
  const byteLength = meta.byteLength ?? buffer.byteLength;
  assertTreasuryOfxIntakeMeta({
    originalName: meta.originalName,
    mimeType: meta.mimeType,
    byteLength,
  });
  assertTreasuryOfxLooksSafe(buffer);

  const textPreview = buffer.subarray(0, Math.min(buffer.byteLength, 8192)).toString("utf8");
  if (!/OFXHEADER\s*:/i.test(textPreview) && !/<OFX[\s>]/i.test(textPreview) && !/<\?OFX\b/i.test(textPreview)) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Conteúdo não parece um arquivo OFX válido (cabeçalho ausente).",
      "file"
    );
  }

  return {
    sha256: hashTreasuryOfxBuffer(buffer),
    formatHint: detectTreasuryOfxFormat(textPreview),
    textPreview,
  };
}
