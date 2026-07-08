/**
 * Anexos de evidência para cotações de mercado — validação, confiabilidade e serialização.
 */

import path from "node:path";
import {
  MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS,
  MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS,
  parseMaterialMarketQuoteReliabilityLevel,
  pickHigherReliabilityLevel,
  suggestMaterialMarketQuoteReliability,
  type MaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

export {
  MATERIAL_MARKET_QUOTE_RELIABILITY_BADGE_CLASSES,
  MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS,
  MATERIAL_MARKET_QUOTE_RELIABILITY_LEVELS,
  type MaterialMarketQuoteReliabilityLevel,
} from "./materialMarketQuoteReliability.js";

export const MATERIAL_MARKET_QUOTE_ATTACHMENT_TYPES = [
  "PDF",
  "IMAGE",
  "SPREADSHEET",
  "EMAIL",
  "PROPOSAL",
  "OTHER",
] as const;

export type MaterialMarketQuoteAttachmentType =
  (typeof MATERIAL_MARKET_QUOTE_ATTACHMENT_TYPES)[number];

export const MATERIAL_MARKET_QUOTE_ATTACHMENT_TYPE_LABELS: Record<
  MaterialMarketQuoteAttachmentType,
  string
> = {
  PDF: "PDF",
  IMAGE: "Imagem",
  SPREADSHEET: "Planilha",
  EMAIL: "E-mail",
  PROPOSAL: "Proposta comercial",
  OTHER: "Outro",
};

export const MATERIAL_MARKET_QUOTE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
]);

const EMAIL_MIMES = new Set([
  "message/rfc822",
  "application/vnd.ms-outlook",
]);

export type MaterialMarketQuoteAttachmentRow = {
  id: string;
  quoteId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: string;
  storageKey: string;
  suggestedReliabilityLevel?: string | null;
  notes?: string | null;
  uploadedBy?: string | null;
  uploadedAt: Date | string;
};

export type MaterialMarketQuoteAttachmentApiItem = {
  id: string;
  quoteId: string;
  fileName: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  attachmentType: MaterialMarketQuoteAttachmentType;
  attachmentTypeLabel: string;
  suggestedReliabilityLevel: MaterialMarketQuoteReliabilityLevel | null;
  suggestedReliabilityLabel: string | null;
  notes: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  downloadUrl: string;
};

export class MaterialMarketQuoteAttachmentError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function parseAttachmentType(value: unknown): MaterialMarketQuoteAttachmentType | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return (MATERIAL_MARKET_QUOTE_ATTACHMENT_TYPES as readonly string[]).includes(upper)
    ? (upper as MaterialMarketQuoteAttachmentType)
    : null;
}

function extensionOf(fileName: string): string {
  return path.extname(fileName).toLowerCase();
}

export function isAllowedMaterialMarketQuoteAttachmentMime(
  mimeType: string,
  fileName: string
): boolean {
  const mime = mimeType.trim().toLowerCase();
  const ext = extensionOf(fileName);

  if (mime === "application/pdf" || ext === ".pdf") return true;
  if (mime.startsWith("image/")) return true;
  if (SPREADSHEET_MIMES.has(mime) || [".xlsx", ".xls", ".csv"].includes(ext)) return true;
  if (EMAIL_MIMES.has(mime) || [".eml", ".msg"].includes(ext)) return true;
  if (mime === "application/octet-stream") {
    return [".pdf", ".xlsx", ".xls", ".csv", ".eml", ".msg", ".doc", ".docx"].includes(ext);
  }
  return false;
}

export function detectMaterialMarketQuoteAttachmentType(input: {
  mimeType: string;
  fileName: string;
  explicitType?: unknown;
}): MaterialMarketQuoteAttachmentType {
  const explicit = parseAttachmentType(input.explicitType);
  if (explicit) return explicit;

  const mime = input.mimeType.trim().toLowerCase();
  const ext = extensionOf(input.fileName);

  if (mime === "application/pdf" || ext === ".pdf") return "PDF";
  if (mime.startsWith("image/")) return "IMAGE";
  if (SPREADSHEET_MIMES.has(mime) || [".xlsx", ".xls", ".csv"].includes(ext)) {
    return "SPREADSHEET";
  }
  if (EMAIL_MIMES.has(mime) || [".eml", ".msg"].includes(ext)) return "EMAIL";
  if (ext === ".doc" || ext === ".docx") return "PROPOSAL";
  return "OTHER";
}

export function suggestReliabilityForAttachment(input: {
  attachmentType: MaterialMarketQuoteAttachmentType;
  mimeType: string;
  fileName: string;
}): MaterialMarketQuoteReliabilityLevel {
  if (input.attachmentType === "PDF" || input.attachmentType === "PROPOSAL") return "ALTA";
  if (input.attachmentType === "SPREADSHEET" || input.attachmentType === "EMAIL") return "MEDIA";
  if (input.attachmentType === "IMAGE") return "MEDIA";
  const ext = extensionOf(input.fileName);
  if (ext === ".pdf") return "ALTA";
  return "MANUAL";
}

export function computeQuoteSuggestedReliabilityLevel(
  attachments: Array<{
    attachmentType: MaterialMarketQuoteAttachmentType | string;
    suggestedReliabilityLevel?: MaterialMarketQuoteReliabilityLevel | string | null;
  }>,
  options?: {
    exchangeOrigin?: string | null;
    informationSource?: string | null;
  }
): MaterialMarketQuoteReliabilityLevel {
  if (attachments.length === 0) {
    return suggestMaterialMarketQuoteReliability({
      attachments: [],
      exchangeOrigin: options?.exchangeOrigin,
      informationSource: options?.informationSource,
    });
  }

  let best: MaterialMarketQuoteReliabilityLevel = "MANUAL";

  for (const attachment of attachments) {
    const fromField = parseMaterialMarketQuoteReliabilityLevel(
      attachment.suggestedReliabilityLevel
    );
    const fromType = suggestReliabilityForAttachment({
      attachmentType: parseAttachmentType(attachment.attachmentType) ?? "OTHER",
      mimeType: "",
      fileName: "",
    });
    const candidate = fromField ?? fromType;
    best = pickHigherReliabilityLevel(best, candidate);
  }

  if (attachments.length >= 3 && RELIABILITY_RANK_FALLBACK(best) < 2) {
    best = "MEDIA";
  }

  const aggregate = suggestMaterialMarketQuoteReliability({
    attachments: attachments.map((attachment) => ({
      attachmentType: String(attachment.attachmentType),
    })),
    exchangeOrigin: options?.exchangeOrigin,
    informationSource: options?.informationSource,
  });

  return pickHigherReliabilityLevel(best, aggregate);
}

function RELIABILITY_RANK_FALLBACK(level: MaterialMarketQuoteReliabilityLevel): number {
  if (level === "ALTA") return 3;
  if (level === "MEDIA") return 2;
  if (level === "BAIXA") return 1;
  return 0;
}

export function validateMaterialMarketQuoteUploadFile(input: {
  originalName: string;
  mimeType: string;
  size: number;
}): void {
  if (!input.originalName?.trim()) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_FILE_REQUIRED",
      "Selecione um arquivo para enviar."
    );
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_FILE_EMPTY",
      "O arquivo enviado está vazio."
    );
  }
  if (input.size > MATERIAL_MARKET_QUOTE_ATTACHMENT_MAX_BYTES) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_FILE_TOO_LARGE",
      `Arquivo muito grande. O limite é ${Math.round(
        MATERIAL_MARKET_QUOTE_ATTACHMENT_MAX_BYTES / (1024 * 1024)
      )} MB.`
    );
  }
  if (!isAllowedMaterialMarketQuoteAttachmentMime(input.mimeType, input.originalName)) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_INVALID_TYPE",
      "Tipo de arquivo não permitido. Envie PDF, imagem, planilha, e-mail exportado ou proposta comercial."
    );
  }
}

export function buildMaterialMarketQuoteAttachmentDownloadPath(
  materialId: string,
  quoteId: string,
  attachmentId: string
): string {
  return `/api/materials/market-intelligence/${materialId}/quotes/${quoteId}/attachments/${attachmentId}/download`;
}

export function serializeMaterialMarketQuoteAttachmentForApi(
  row: MaterialMarketQuoteAttachmentRow,
  materialId: string
): MaterialMarketQuoteAttachmentApiItem {
  const attachmentType =
    parseAttachmentType(row.attachmentType) ?? ("OTHER" as MaterialMarketQuoteAttachmentType);
  const reliability = parseMaterialMarketQuoteReliabilityLevel(row.suggestedReliabilityLevel);
  return {
    id: row.id,
    quoteId: row.quoteId,
    fileName: row.fileName,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    attachmentType,
    attachmentTypeLabel: MATERIAL_MARKET_QUOTE_ATTACHMENT_TYPE_LABELS[attachmentType],
    suggestedReliabilityLevel: reliability,
    suggestedReliabilityLabel: reliability
      ? MATERIAL_MARKET_QUOTE_RELIABILITY_LABELS[reliability]
      : null,
    notes: row.notes?.trim() || null,
    uploadedBy: row.uploadedBy ?? null,
    uploadedAt: new Date(row.uploadedAt).toISOString(),
    downloadUrl: buildMaterialMarketQuoteAttachmentDownloadPath(
      materialId,
      row.quoteId,
      row.id
    ),
  };
}

export function buildMaterialMarketQuoteAttachmentListResponse(
  rows: MaterialMarketQuoteAttachmentRow[],
  materialId: string
): { items: MaterialMarketQuoteAttachmentApiItem[]; total: number } {
  const items = rows.map((row) => serializeMaterialMarketQuoteAttachmentForApi(row, materialId));
  return { items, total: items.length };
}
