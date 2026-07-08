/**
 * Operações de anexos de cotação de mercado (servidor + Prisma).
 */

import type { PrismaClient } from "@prisma/client";
import {
  deleteAppLocalFile,
  readAppLocalFile,
  saveAppLocalFile,
} from "./appLocalFileStorage.js";
import {
  buildMaterialMarketQuoteAttachmentListResponse,
  detectMaterialMarketQuoteAttachmentType,
  MaterialMarketQuoteAttachmentError,
  serializeMaterialMarketQuoteAttachmentForApi,
  suggestReliabilityForAttachment,
  validateMaterialMarketQuoteUploadFile,
  type MaterialMarketQuoteAttachmentApiItem,
} from "./materialMarketQuoteAttachment.js";
import { toPrismaMaterialMarketQuoteReliabilityLevel } from "./materialMarketQuoteReliability.js";
import { refreshMaterialMarketQuoteReliabilitySuggestion } from "./materialMarketQuoteReliability.server.js";

const ATTACHMENT_NAMESPACE = "material-market-quotes";

type QuoteScope = {
  materialId: string;
  quoteId: string;
};

async function assertQuoteScope(
  prisma: PrismaClient,
  scope: QuoteScope
): Promise<{ id: string; materialId: string }> {
  const quote = await prisma.materialMarketQuote.findFirst({
    where: { id: scope.quoteId, materialId: scope.materialId },
    select: { id: true, materialId: true },
  });
  if (!quote) {
    throw new MaterialMarketQuoteAttachmentError(
      "QUOTE_NOT_FOUND",
      "Cotação não encontrada para esta matéria-prima.",
      404
    );
  }
  return quote;
}

async function writeQuoteAuditLog(
  prisma: PrismaClient,
  input: {
    quoteId: string;
    entityType: string;
    entityId?: string | null;
    action: string;
    details?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  await prisma.materialMarketQuoteAuditLog.create({
    data: {
      quoteId: input.quoteId,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      details: input.details ?? null,
      userId: input.userId ?? null,
    },
  });
}

async function refreshQuoteReliability(prisma: PrismaClient, quoteId: string): Promise<void> {
  await refreshMaterialMarketQuoteReliabilitySuggestion(prisma, quoteId);
}

export async function listMaterialMarketQuoteAttachments(
  prisma: PrismaClient,
  scope: QuoteScope
): Promise<{ items: MaterialMarketQuoteAttachmentApiItem[]; total: number }> {
  await assertQuoteScope(prisma, scope);
  const rows = await prisma.materialMarketQuoteAttachment.findMany({
    where: { quoteId: scope.quoteId },
    orderBy: { uploadedAt: "desc" },
  });
  return buildMaterialMarketQuoteAttachmentListResponse(rows, scope.materialId);
}

export async function uploadMaterialMarketQuoteAttachment(
  prisma: PrismaClient,
  scope: QuoteScope,
  input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    size: number;
    notes?: string | null;
    attachmentType?: unknown;
    userId?: string | null;
  }
): Promise<MaterialMarketQuoteAttachmentApiItem> {
  await assertQuoteScope(prisma, scope);
  validateMaterialMarketQuoteUploadFile({
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.size,
  });

  const attachmentType = detectMaterialMarketQuoteAttachmentType({
    mimeType: input.mimeType,
    fileName: input.originalName,
    explicitType: input.attachmentType,
  });
  const suggestedReliabilityLevel = suggestReliabilityForAttachment({
    attachmentType,
    mimeType: input.mimeType,
    fileName: input.originalName,
  });

  let saved;
  try {
    saved = await saveAppLocalFile({
      namespace: ATTACHMENT_NAMESPACE,
      entityId: scope.quoteId,
      originalFileName: input.originalName,
      buffer: input.buffer,
    });
  } catch {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_UPLOAD_FAILED",
      "Não foi possível salvar o arquivo. Tente novamente.",
      500
    );
  }

  const created = await prisma.materialMarketQuoteAttachment.create({
    data: {
      quoteId: scope.quoteId,
      fileName: saved.fileName,
      originalFileName: input.originalName.trim(),
      mimeType: input.mimeType.trim() || "application/octet-stream",
      fileSize: saved.fileSize,
      attachmentType,
      storageKey: saved.storageKey,
      suggestedReliabilityLevel:
        toPrismaMaterialMarketQuoteReliabilityLevel(suggestedReliabilityLevel),
      notes: input.notes?.trim() || null,
      uploadedBy: input.userId ?? null,
    },
  });

  await refreshQuoteReliability(prisma, scope.quoteId);
  await writeQuoteAuditLog(prisma, {
    quoteId: scope.quoteId,
    entityType: "MaterialMarketQuoteAttachment",
    entityId: created.id,
    action: "CREATE",
    details: created.originalFileName,
    userId: input.userId ?? null,
  });

  return serializeMaterialMarketQuoteAttachmentForApi(created, scope.materialId);
}

export async function readMaterialMarketQuoteAttachmentFile(
  prisma: PrismaClient,
  scope: QuoteScope & { attachmentId: string }
): Promise<{
  buffer: Buffer;
  mimeType: string;
  originalFileName: string;
}> {
  await assertQuoteScope(prisma, scope);
  const attachment = await prisma.materialMarketQuoteAttachment.findFirst({
    where: { id: scope.attachmentId, quoteId: scope.quoteId },
  });
  if (!attachment) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_NOT_FOUND",
      "Anexo não encontrado.",
      404
    );
  }

  try {
    const buffer = await readAppLocalFile(attachment.storageKey);
    return {
      buffer,
      mimeType: attachment.mimeType,
      originalFileName: attachment.originalFileName,
    };
  } catch {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_FILE_MISSING",
      "Arquivo do anexo não está disponível no servidor.",
      404
    );
  }
}

export async function deleteMaterialMarketQuoteAttachment(
  prisma: PrismaClient,
  scope: QuoteScope & { attachmentId: string },
  input: { userId?: string | null; canEdit: boolean }
): Promise<void> {
  await assertQuoteScope(prisma, scope);
  const attachment = await prisma.materialMarketQuoteAttachment.findFirst({
    where: { id: scope.attachmentId, quoteId: scope.quoteId },
  });
  if (!attachment) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_NOT_FOUND",
      "Anexo não encontrado.",
      404
    );
  }

  const isOwner =
    Boolean(input.userId) &&
    Boolean(attachment.uploadedBy) &&
    attachment.uploadedBy === input.userId;
  if (!input.canEdit && !isOwner) {
    throw new MaterialMarketQuoteAttachmentError(
      "ATTACHMENT_DELETE_FORBIDDEN",
      "Você não tem permissão para remover este anexo.",
      403
    );
  }

  await prisma.materialMarketQuoteAttachment.delete({ where: { id: attachment.id } });
  await deleteAppLocalFile(attachment.storageKey).catch(() => undefined);
  await refreshQuoteReliability(prisma, scope.quoteId);
  await writeQuoteAuditLog(prisma, {
    quoteId: scope.quoteId,
    entityType: "MaterialMarketQuoteAttachment",
    entityId: attachment.id,
    action: "DELETE",
    details: attachment.originalFileName,
    userId: input.userId ?? null,
  });
}
