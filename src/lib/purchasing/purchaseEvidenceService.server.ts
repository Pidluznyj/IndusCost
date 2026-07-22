/**
 * Serviço de evidências de Compras SC (OP-17).
 * Reutiliza appLocalFileStorage — sem segundo sistema de arquivos.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  fingerprintAppLocalFile,
  readAppLocalFile,
  saveAppLocalFile,
} from "@/src/lib/appLocalFileStorage.js";
import {
  assertEvidenceCanBeMutated,
  assertNegotiationConclusionRequirements,
  detectPurchaseEvidenceType,
  isPurchaseEvidenceEntityType,
  namespaceForEvidenceEntity,
  PurchaseEvidenceError,
  type PurchaseEvidenceEntityTypeName,
  validatePurchaseEvidenceUploadFile,
} from "./purchaseEvidenceRules.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type EvidenceActor = {
  userId: string;
  userName?: string | null;
};

async function writeHistory(
  db: Db,
  input: {
    evidenceId: string;
    action: "UPLOADED" | "REPLACED" | "SOFT_DELETED" | "LOCKED" | "UNLOCKED" | "DOWNLOAD";
    reason?: string | null;
    actor?: EvidenceActor | null;
    metaJson?: Prisma.InputJsonValue;
  }
) {
  await db.purchaseEvidenceHistoryEvent.create({
    data: {
      evidenceId: input.evidenceId,
      action: input.action,
      reason: input.reason ?? null,
      userId: input.actor?.userId ?? null,
      userName: input.actor?.userName ?? null,
      metaJson: input.metaJson,
    },
  });
}

async function resolveProtectionFlags(prisma: PrismaClient, entityType: string, entityId: string) {
  let quotationId: string | null = null;
  let offerId: string | null = null;

  if (entityType === "QUOTATION") quotationId = entityId;
  if (entityType === "NEGOTIATION_ROUND") {
    const round = await prisma.purchaseNegotiationRound.findUnique({
      where: { id: entityId },
      select: { quotationId: true },
    });
    quotationId = round?.quotationId ?? null;
  }
  if (entityType === "OFFER" || entityType === "CONFIRMATION") {
    if (entityType === "OFFER") {
      offerId = entityId;
      const offer = await prisma.purchaseQuotationOffer.findUnique({
        where: { id: entityId },
        select: { quotationId: true, status: true },
      });
      quotationId = offer?.quotationId ?? null;
    } else {
      // CONFIRMATION entityId pode ser quotationId ou offerId — tenta ambos
      const asOffer = await prisma.purchaseQuotationOffer.findUnique({
        where: { id: entityId },
        select: { id: true, quotationId: true, status: true },
      });
      if (asOffer) {
        offerId = asOffer.id;
        quotationId = asOffer.quotationId;
      } else {
        quotationId = entityId;
      }
    }
  }
  if (entityType === "QUOTATION_SUPPLIER") {
    const qs = await prisma.purchaseQuotationSupplier.findUnique({
      where: { id: entityId },
      select: { quotationId: true, status: true },
    });
    quotationId = qs?.quotationId ?? null;
  }
  if (entityType === "APPROVAL") {
    const ap = await prisma.purchaseApproval.findUnique({
      where: { id: entityId },
      select: { quotationId: true, purchaseOrderId: true },
    });
    quotationId = ap?.quotationId ?? null;
    if (ap?.purchaseOrderId) {
      return {
        hasPurchaseOrder: true,
        quotationAwarded: false,
        offerIsWinner: false,
      };
    }
  }
  if (entityType === "PURCHASE_ORDER") {
    return { hasPurchaseOrder: true, quotationAwarded: false, offerIsWinner: false };
  }

  let quotationAwarded = false;
  let hasPurchaseOrder = false;
  let offerIsWinner = false;

  if (quotationId) {
    const q = await prisma.purchaseQuotation.findUnique({
      where: { id: quotationId },
      select: {
        status: true,
        _count: { select: { purchaseOrders: true } },
      },
    });
    quotationAwarded = q?.status === "ADJUDICADA";
    hasPurchaseOrder = (q?._count.purchaseOrders ?? 0) > 0;
  }
  if (offerId) {
    const offer = await prisma.purchaseQuotationOffer.findUnique({
      where: { id: offerId },
      select: { status: true },
    });
    offerIsWinner = offer?.status === "VENCEDORA";
  } else if (quotationId) {
    const winner = await prisma.purchaseQuotationOffer.findFirst({
      where: { quotationId, status: "VENCEDORA" },
      select: { id: true },
    });
    offerIsWinner = Boolean(winner);
  }

  return { hasPurchaseOrder, quotationAwarded, offerIsWinner };
}

async function assertEntityExists(prisma: PrismaClient, entityType: string, entityId: string) {
  switch (entityType) {
    case "REQUEST":
      if (!(await prisma.purchaseRequest.findUnique({ where: { id: entityId }, select: { id: true } }))) {
        throw new PurchaseEvidenceError("Solicitação não encontrada.", "ENTITY_NOT_FOUND");
      }
      break;
    case "QUOTATION":
    case "CONFIRMATION":
      if (
        !(await prisma.purchaseQuotation.findUnique({ where: { id: entityId }, select: { id: true } })) &&
        !(await prisma.purchaseQuotationOffer.findUnique({ where: { id: entityId }, select: { id: true } }))
      ) {
        throw new PurchaseEvidenceError("Cotação/confirmação não encontrada.", "ENTITY_NOT_FOUND");
      }
      break;
    case "QUOTATION_SUPPLIER":
      if (
        !(await prisma.purchaseQuotationSupplier.findUnique({
          where: { id: entityId },
          select: { id: true },
        }))
      ) {
        throw new PurchaseEvidenceError("Fornecedor da cotação não encontrado.", "ENTITY_NOT_FOUND");
      }
      break;
    case "OFFER":
      if (
        !(await prisma.purchaseQuotationOffer.findUnique({ where: { id: entityId }, select: { id: true } }))
      ) {
        throw new PurchaseEvidenceError("Oferta não encontrada.", "ENTITY_NOT_FOUND");
      }
      break;
    case "NEGOTIATION_ROUND":
      if (
        !(await prisma.purchaseNegotiationRound.findUnique({
          where: { id: entityId },
          select: { id: true },
        }))
      ) {
        throw new PurchaseEvidenceError("Rodada não encontrada.", "ENTITY_NOT_FOUND");
      }
      break;
    case "APPROVAL":
      if (!(await prisma.purchaseApproval.findUnique({ where: { id: entityId }, select: { id: true } }))) {
        throw new PurchaseEvidenceError("Aprovação não encontrada.", "ENTITY_NOT_FOUND");
      }
      break;
    case "PURCHASE_ORDER":
      if (!(await prisma.purchaseOrder.findUnique({ where: { id: entityId }, select: { id: true } }))) {
        throw new PurchaseEvidenceError("Pedido de compra não encontrado.", "ENTITY_NOT_FOUND");
      }
      break;
    case "RECEIPT":
      if (!(await prisma.purchaseReceipt.findUnique({ where: { id: entityId }, select: { id: true } }))) {
        throw new PurchaseEvidenceError("Recebimento não encontrado.", "ENTITY_NOT_FOUND");
      }
      break;
    default:
      throw new PurchaseEvidenceError("Tipo de vínculo inválido.", "ENTITY_TYPE_INVALID");
  }
}

export async function listPurchaseEvidences(
  prisma: PrismaClient,
  entityType: PurchaseEvidenceEntityTypeName,
  entityId: string,
  opts?: { includeDeleted?: boolean }
) {
  return prisma.purchaseEvidence.findMany({
    where: {
      entityType,
      entityId,
      ...(opts?.includeDeleted ? {} : { deletedAt: null }),
    },
    include: {
      historyEvents: { orderBy: { createdAt: "desc" }, take: 20 },
    },
    orderBy: { uploadedAt: "desc" },
  });
}

export async function uploadPurchaseEvidence(
  prisma: PrismaClient,
  input: {
    entityType: string;
    entityId: string;
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    description?: string | null;
    notes?: string | null;
    evidenceType?: string | null;
    replacesId?: string | null;
    actor?: EvidenceActor | null;
  }
) {
  if (!isPurchaseEvidenceEntityType(input.entityType)) {
    throw new PurchaseEvidenceError("Tipo de vínculo inválido.", "ENTITY_TYPE_INVALID");
  }
  const entityType = input.entityType;
  await assertEntityExists(prisma, entityType, input.entityId);
  validatePurchaseEvidenceUploadFile({
    originalName: input.originalName,
    mimeType: input.mimeType,
    size: input.buffer.byteLength,
  });

  const protection = await resolveProtectionFlags(prisma, entityType, input.entityId);
  let replacesId: string | null = input.replacesId ?? null;
  if (replacesId) {
    const old = await prisma.purchaseEvidence.findFirst({
      where: { id: replacesId, entityType, entityId: input.entityId },
    });
    if (!old || old.deletedAt) {
      throw new PurchaseEvidenceError("Evidência a substituir não encontrada.", "REPLACE_TARGET_MISSING");
    }
    assertEvidenceCanBeMutated({
      lockedAt: old.lockedAt,
      hasPurchaseOrder: protection.hasPurchaseOrder,
      quotationAwarded: protection.quotationAwarded,
      offerIsWinner: protection.offerIsWinner,
      softDeleteReason: "substituição com histórico",
      isSoftDelete: true,
    });
  } else if (protection.hasPurchaseOrder || protection.quotationAwarded || protection.offerIsWinner) {
    // Upload novo ainda permitido (trilha), but deletes need reason
  }

  const contentHash = fingerprintAppLocalFile(input.buffer);
  const saved = await saveAppLocalFile({
    namespace: namespaceForEvidenceEntity(entityType),
    entityId: input.entityId,
    originalFileName: input.originalName,
    buffer: input.buffer,
  });

  const evidenceType = detectPurchaseEvidenceType({
    mimeType: input.mimeType,
    fileName: input.originalName,
    explicitType: input.evidenceType,
  });

  return prisma.$transaction(async (tx) => {
    const evidence = await tx.purchaseEvidence.create({
      data: {
        entityType,
        entityId: input.entityId,
        fileName: saved.fileName,
        originalFileName: input.originalName || saved.fileName,
        mimeType: input.mimeType || "application/octet-stream",
        fileSize: saved.fileSize,
        storageKey: saved.storageKey,
        contentHash,
        evidenceType,
        description: input.description?.trim() || null,
        notes: input.notes?.trim() || null,
        uploadedBy: input.actor?.userId ?? null,
        uploadedByName: input.actor?.userName ?? null,
        replacesId,
        lockedAt:
          protection.hasPurchaseOrder || protection.quotationAwarded || protection.offerIsWinner
            ? new Date()
            : null,
        lockedReason:
          protection.hasPurchaseOrder || protection.quotationAwarded || protection.offerIsWinner
            ? "Vínculo com adjudicação/pedido — trilha protegida"
            : null,
      },
    });

    await writeHistory(tx, {
      evidenceId: evidence.id,
      action: replacesId ? "REPLACED" : "UPLOADED",
      reason: replacesId ? "Substituição com histórico" : null,
      actor: input.actor,
      metaJson: {
        contentHash,
        storageKey: saved.storageKey,
        replacesId,
      },
    });

    if (replacesId) {
      await tx.purchaseEvidence.update({
        where: { id: replacesId },
        data: {
          deletedAt: new Date(),
          deletedBy: input.actor?.userId ?? null,
          deleteReason: "Substituída por nova evidência (histórico preservado)",
        },
      });
      await writeHistory(tx, {
        evidenceId: replacesId,
        action: "SOFT_DELETED",
        reason: "Substituída",
        actor: input.actor,
        metaJson: { replacedById: evidence.id },
      });
    }

    return evidence;
  });
}

export async function softDeletePurchaseEvidence(
  prisma: PrismaClient,
  evidenceId: string,
  actor: EvidenceActor,
  reason: string
) {
  const evidence = await prisma.purchaseEvidence.findUnique({ where: { id: evidenceId } });
  if (!evidence || evidence.deletedAt) {
    throw new PurchaseEvidenceError("Evidência não encontrada.", "NOT_FOUND");
  }
  const protection = await resolveProtectionFlags(
    prisma,
    evidence.entityType,
    evidence.entityId
  );
  assertEvidenceCanBeMutated({
    lockedAt: evidence.lockedAt,
    hasPurchaseOrder: protection.hasPurchaseOrder,
    quotationAwarded: protection.quotationAwarded,
    offerIsWinner: protection.offerIsWinner,
    softDeleteReason: reason,
    isSoftDelete: true,
  });

  const updated = await prisma.purchaseEvidence.update({
    where: { id: evidenceId },
    data: {
      deletedAt: new Date(),
      deletedBy: actor.userId,
      deleteReason: reason.trim(),
    },
  });
  await writeHistory(prisma, {
    evidenceId,
    action: "SOFT_DELETED",
    reason: reason.trim(),
    actor,
  });
  return updated;
}

export async function downloadPurchaseEvidence(prisma: PrismaClient, evidenceId: string, actor?: EvidenceActor | null) {
  const evidence = await prisma.purchaseEvidence.findUnique({ where: { id: evidenceId } });
  if (!evidence || evidence.deletedAt) {
    throw new PurchaseEvidenceError("Evidência não encontrada.", "NOT_FOUND");
  }
  const buf = await readAppLocalFile(evidence.storageKey);
  if (actor) {
    await writeHistory(prisma, {
      evidenceId,
      action: "DOWNLOAD",
      actor,
    });
  }
  return { evidence, buffer: buf };
}

export async function countActiveEvidences(
  prisma: PrismaClient,
  entityType: PurchaseEvidenceEntityTypeName,
  entityId: string
) {
  return prisma.purchaseEvidence.count({
    where: { entityType, entityId, deletedAt: null },
  });
}

export async function lockEvidencesForEntity(
  prisma: PrismaClient,
  entityType: PurchaseEvidenceEntityTypeName,
  entityId: string,
  reason: string,
  actor?: EvidenceActor | null
) {
  const rows = await prisma.purchaseEvidence.findMany({
    where: { entityType, entityId, deletedAt: null, lockedAt: null },
    select: { id: true },
  });
  if (rows.length === 0) return 0;
  await prisma.purchaseEvidence.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { lockedAt: new Date(), lockedReason: reason },
  });
  for (const row of rows) {
    await writeHistory(prisma, {
      evidenceId: row.id,
      action: "LOCKED",
      reason,
      actor,
    });
  }
  return rows.length;
}

/**
 * Gate de conclusão: relato + evidência (rodada e/ou cotação), ou exceção justificada.
 */
export async function assertCanConcludeNegotiation(
  prisma: PrismaClient,
  input: {
    quotationId: string;
    roundId?: string | null;
    buyerReport?: string | null;
    exceptionJustification?: string | null;
    hasExceptionPermission: boolean;
  }
) {
  let evidenceCount = await countActiveEvidences(prisma, "QUOTATION", input.quotationId);
  if (input.roundId) {
    evidenceCount += await countActiveEvidences(prisma, "NEGOTIATION_ROUND", input.roundId);
  }
  evidenceCount += await countActiveEvidences(prisma, "CONFIRMATION", input.quotationId);

  return assertNegotiationConclusionRequirements({
    buyerReport: input.buyerReport,
    activeEvidenceCount: evidenceCount,
    exceptionJustification: input.exceptionJustification,
    hasExceptionPermission: input.hasExceptionPermission,
  });
}

export function mapEvidenceError(e: unknown): { status: number; body: { error: string; code?: string } } {
  if (e instanceof PurchaseEvidenceError) {
    const status = e.code === "NOT_FOUND" || e.code === "ENTITY_NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("purchase evidence error:", e);
  return { status: 500, body: { error: "Erro nas evidências de compra." } };
}
