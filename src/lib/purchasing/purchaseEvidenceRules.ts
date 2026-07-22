/**
 * Regras puras de evidências de Compras SC (OP-17).
 * Reutiliza o padrão de tipos/MIME de anexos comerciais do IndusCost.
 */

export const PURCHASE_EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;

export const PURCHASE_EVIDENCE_ENTITY_TYPES = [
  "REQUEST",
  "QUOTATION",
  "QUOTATION_SUPPLIER",
  "OFFER",
  "NEGOTIATION_ROUND",
  "CONFIRMATION",
  "APPROVAL",
  "PURCHASE_ORDER",
  "RECEIPT",
] as const;

export type PurchaseEvidenceEntityTypeName = (typeof PURCHASE_EVIDENCE_ENTITY_TYPES)[number];

export const PURCHASE_EVIDENCE_TYPES = [
  "PDF",
  "IMAGE",
  "SPREADSHEET",
  "EMAIL",
  "PROPOSAL",
  "OTHER",
] as const;

export type PurchaseEvidenceTypeName = (typeof PURCHASE_EVIDENCE_TYPES)[number];

const SPREADSHEET_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
]);

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);

const EMAIL_MIMES = new Set(["message/rfc822", "application/vnd.ms-outlook"]);

const PDF_MIMES = new Set(["application/pdf"]);

const EXT_MAP: Record<string, PurchaseEvidenceTypeName> = {
  ".pdf": "PDF",
  ".png": "IMAGE",
  ".jpg": "IMAGE",
  ".jpeg": "IMAGE",
  ".webp": "IMAGE",
  ".gif": "IMAGE",
  ".xls": "SPREADSHEET",
  ".xlsx": "SPREADSHEET",
  ".csv": "SPREADSHEET",
  ".eml": "EMAIL",
  ".msg": "EMAIL",
};

export class PurchaseEvidenceError extends Error {
  constructor(
    message: string,
    readonly code: string
  ) {
    super(message);
    this.name = "PurchaseEvidenceError";
  }
}

function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  if (i < 0) return "";
  return fileName.slice(i).toLowerCase();
}

export function isPurchaseEvidenceEntityType(value: unknown): value is PurchaseEvidenceEntityTypeName {
  return (
    typeof value === "string" &&
    (PURCHASE_EVIDENCE_ENTITY_TYPES as readonly string[]).includes(value)
  );
}

export function detectPurchaseEvidenceType(input: {
  mimeType: string;
  fileName: string;
  explicitType?: string | null;
}): PurchaseEvidenceTypeName {
  if (
    input.explicitType &&
    (PURCHASE_EVIDENCE_TYPES as readonly string[]).includes(input.explicitType)
  ) {
    return input.explicitType as PurchaseEvidenceTypeName;
  }
  const mime = input.mimeType.trim().toLowerCase();
  const ext = extensionOf(input.fileName);
  if (PDF_MIMES.has(mime) || ext === ".pdf") return "PDF";
  if (IMAGE_MIMES.has(mime) || EXT_MAP[ext] === "IMAGE") return "IMAGE";
  if (SPREADSHEET_MIMES.has(mime) || EXT_MAP[ext] === "SPREADSHEET") return "SPREADSHEET";
  if (EMAIL_MIMES.has(mime) || EXT_MAP[ext] === "EMAIL") return "EMAIL";
  if (ext === ".doc" || ext === ".docx") return "PROPOSAL";
  return "OTHER";
}

export function isAllowedPurchaseEvidenceUpload(mimeType: string, fileName: string): boolean {
  const mime = mimeType.trim().toLowerCase();
  const ext = extensionOf(fileName);
  if (!ext) return false;

  // MIME ∩ extensão obrigatórios (sem bypass só por extensão — OP-27).
  if (PDF_MIMES.has(mime) && ext === ".pdf") return true;
  if (IMAGE_MIMES.has(mime) && EXT_MAP[ext] === "IMAGE") return true;
  if (SPREADSHEET_MIMES.has(mime) && (EXT_MAP[ext] === "SPREADSHEET" || ext === ".csv")) {
    return true;
  }
  if (EMAIL_MIMES.has(mime) && EXT_MAP[ext] === "EMAIL") return true;
  if (
    (mime === "application/msword" ||
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") &&
    (ext === ".doc" || ext === ".docx")
  ) {
    return true;
  }
  return false;
}

export function validatePurchaseEvidenceUploadFile(input: {
  originalName: string;
  mimeType: string;
  size: number;
}): void {
  if (!input.originalName?.trim()) {
    throw new PurchaseEvidenceError("Nome do arquivo obrigatório.", "FILE_NAME_REQUIRED");
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    throw new PurchaseEvidenceError("Arquivo vazio não permitido.", "FILE_EMPTY");
  }
  if (input.size > PURCHASE_EVIDENCE_MAX_BYTES) {
    throw new PurchaseEvidenceError(
      `Arquivo muito grande. Limite: ${Math.round(PURCHASE_EVIDENCE_MAX_BYTES / (1024 * 1024))} MB.`,
      "FILE_TOO_LARGE"
    );
  }
  if (!isAllowedPurchaseEvidenceUpload(input.mimeType, input.originalName)) {
    throw new PurchaseEvidenceError(
      "Tipo de arquivo não permitido. Envie PDF, imagem, planilha, e-mail ou proposta comercial.",
      "INVALID_TYPE"
    );
  }
}

/** Soft-delete silencioso proibido quando locked ou vínculo adjudicado/PO. */
export function assertEvidenceCanBeMutated(input: {
  lockedAt: Date | string | null;
  hasPurchaseOrder: boolean;
  quotationAwarded: boolean;
  offerIsWinner: boolean;
  softDeleteReason?: string | null;
  isSoftDelete: boolean;
}): void {
  const locked =
    Boolean(input.lockedAt) ||
    input.hasPurchaseOrder ||
    input.quotationAwarded ||
    input.offerIsWinner;
  if (!locked) return;
  if (input.isSoftDelete) {
    const reason = String(input.softDeleteReason ?? "").trim();
    if (!reason) {
      throw new PurchaseEvidenceError(
        "Evidência protegida: informe justificativa para exclusão/substituição com auditoria.",
        "DELETE_REASON_REQUIRED"
      );
    }
    return;
  }
  throw new PurchaseEvidenceError(
    "Evidência protegida após escolha de vencedor ou pedido — use substituição com histórico.",
    "EVIDENCE_LOCKED"
  );
}

/**
 * Antes de concluir negociação / marcar vencedor: relato + ≥1 evidência ativa,
 * salvo permissão excepcional com justificativa.
 */
export function assertNegotiationConclusionRequirements(input: {
  buyerReport: string | null | undefined;
  activeEvidenceCount: number;
  exceptionJustification?: string | null;
  hasExceptionPermission: boolean;
}): { usedException: boolean } {
  const report = String(input.buyerReport ?? "").trim();
  const hasEvidence = input.activeEvidenceCount > 0;
  if (report && hasEvidence) return { usedException: false };

  const justification = String(input.exceptionJustification ?? "").trim();
  if (input.hasExceptionPermission && justification.length >= 10) {
    return { usedException: true };
  }

  if (!report) {
    throw new PurchaseEvidenceError(
      "Relato do comprador é obrigatório para concluir a negociação.",
      "BUYER_REPORT_REQUIRED"
    );
  }
  if (!hasEvidence) {
    throw new PurchaseEvidenceError(
      "É necessário ao menos uma evidência ativa, ou justificativa excepcional autorizada.",
      "EVIDENCE_REQUIRED"
    );
  }
  return { usedException: false };
}

export function namespaceForEvidenceEntity(entityType: PurchaseEvidenceEntityTypeName): string {
  switch (entityType) {
    case "REQUEST":
      return "purchase-requests";
    case "QUOTATION":
    case "QUOTATION_SUPPLIER":
    case "OFFER":
    case "NEGOTIATION_ROUND":
    case "CONFIRMATION":
    case "APPROVAL":
      return "purchase-quotations";
    case "PURCHASE_ORDER":
      return "purchase-orders";
    case "RECEIPT":
      return "purchase-receipts";
    default:
      return "purchase-evidences";
  }
}
