/**
 * Adjudicação formal + aprovação da cotação (OP-19).
 * Sem criar PO, recebimento ou Contas a Pagar.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  assertAwardDoesNotOverwriteInitial,
} from "./purchasingPriceInvariants.js";
import { computeOfferRoundSavings } from "./negotiationRoundService.server.js";
import { countActiveEvidences, lockEvidencesForEntity } from "./purchaseEvidenceService.server.js";
import { PurchaseQuotationWorkflowError } from "./purchaseQuotationWorkflow.js";
import {
  computeAwardGainSnapshot,
  QuotationAwardError,
  validateAwardPackage,
  type AwardAllocationInput,
  type AwardMode,
  type AwardRejectionInput,
} from "./quotationAwardEngine.js";

export type AwardActor = {
  userId: string;
  userName?: string | null;
};

const AWARD_INCLUDE = {
  allocations: { orderBy: { createdAt: "asc" as const } },
  rejections: { orderBy: { createdAt: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
  finalRound: true,
  approval: true,
} as const;

function toDec(v: number | null | undefined): Prisma.Decimal | null {
  if (v == null || !Number.isFinite(v)) return null;
  return new Prisma.Decimal(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function writeAwardHistory(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    awardId: string;
    action: "SUBMITTED" | "APPROVED" | "REJECTED" | "CANCELLED";
    reason?: string | null;
    userId?: string | null;
    userName?: string | null;
    metaJson?: Prisma.InputJsonValue;
  }
) {
  await db.purchaseQuotationAwardHistoryEvent.create({
    data: {
      awardId: input.awardId,
      action: input.action,
      reason: input.reason ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      metaJson: input.metaJson ?? undefined,
    },
  });
}

export function mapAwardError(e: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (
    e instanceof QuotationAwardError ||
    e instanceof PurchaseQuotationWorkflowError
  ) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("quotation award error:", e);
  return { status: 500, body: { error: "Erro na adjudicação da cotação." } };
}

export async function getQuotationAwardDetail(prisma: PrismaClient, quotationId: string) {
  const award = await prisma.purchaseQuotationAward.findFirst({
    where: { quotationId },
    orderBy: { submittedAt: "desc" },
    include: AWARD_INCLUDE,
  });
  return award;
}

export async function listQuotationAwards(prisma: PrismaClient, quotationId: string) {
  return prisma.purchaseQuotationAward.findMany({
    where: { quotationId },
    orderBy: { submittedAt: "desc" },
    include: AWARD_INCLUDE,
  });
}

export async function submitQuotationAward(
  prisma: PrismaClient,
  quotationId: string,
  actor: AwardActor,
  input: {
    mode: AwardMode;
    justification: string;
    finalRoundId?: string | null;
    allocations: AwardAllocationInput[];
    rejections?: AwardRejectionInput[];
    notes?: string | null;
    exceptionJustification?: string | null;
    hasExceptionPermission?: boolean;
  }
) {
  const quotation = await prisma.purchaseQuotation.findUnique({
    where: { id: quotationId },
    include: {
      items: true,
      offers: {
        include: {
          items: true,
          quotationSupplier: true,
        },
      },
      rounds: { orderBy: { roundNumber: "desc" } },
    },
  });
  if (!quotation) {
    throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
  }

  const existing = await prisma.purchaseQuotationAward.findFirst({
    where: {
      quotationId,
      status: { in: ["PENDENTE_APROVACAO", "APROVADA"] },
    },
  });

  const openRound = quotation.rounds.find((r) => r.status === "ABERTA");
  const closedRounds = quotation.rounds.filter((r) => r.status === "FECHADA");
  const finalRoundId =
    input.finalRoundId ||
    (closedRounds[0]?.id ?? null);

  if (finalRoundId) {
    const ok = quotation.rounds.some((r) => r.id === finalRoundId && r.status === "FECHADA");
    if (!ok) {
      throw new QuotationAwardError("Rodada final inválida ou não fechada.", "FINAL_ROUND_INVALID");
    }
  }

  const evidenceCount =
    (await countActiveEvidences(prisma, "QUOTATION", quotationId)) +
    (await countActiveEvidences(prisma, "CONFIRMATION", quotationId));

  const offerItems = quotation.offers.flatMap((offer) =>
    offer.items.map((it) => {
      let unitPrice = Number(it.initialUnitPrice);
      if (finalRoundId) {
        // preço negociado resolvido depois via round line lookup no create
      }
      return {
        offerId: offer.id,
        offerItemId: it.id,
        quotationItemId: it.quotationItemId,
        offerStatus: offer.status,
        unitPrice,
        quantityOffered: it.initialQuantity != null ? Number(it.initialQuantity) : null,
        validityDate: offer.initialValidityDate
          ? offer.initialValidityDate.toISOString().slice(0, 10)
          : null,
        currency: offer.currency || quotation.currency || "BRL",
      };
    })
  );

  // Resolve negotiated unit prices from final round when present
  if (finalRoundId) {
    const lines = await prisma.purchaseNegotiationRoundLine.findMany({
      where: { roundId: finalRoundId },
    });
    const byOfferItem = new Map(lines.map((l) => [l.offerItemId, l]));
    for (const oi of offerItems) {
      const line = byOfferItem.get(oi.offerItemId);
      if (line) oi.unitPrice = Number(line.unitPrice);
    }
  }

  const validation = validateAwardPackage({
    quotationStatus: quotation.status,
    currency: quotation.currency || "BRL",
    mode: input.mode,
    justification: input.justification,
    finalRoundId,
    hasClosedRound: closedRounds.length > 0,
    openRoundExists: Boolean(openRound),
    demandItems: quotation.items.map((it) => ({
      quotationItemId: it.id,
      quantityDemanded: Number(it.quantity),
    })),
    offerItems,
    allocations: input.allocations,
    rejections: input.rejections ?? [],
    activeEvidenceCount: evidenceCount,
    exceptionJustification: input.exceptionJustification,
    hasExceptionPermission: Boolean(input.hasExceptionPermission),
    existingPendingOrApprovedAward: Boolean(existing),
  });

  // Gains snapshot — soma por oferta vencedora
  const winnerOfferIds = validation.winnerOfferIds;
  let initialComparableTotal = 0;
  let awardedComparableTotal = 0;
  for (const offerId of winnerOfferIds) {
    try {
      const s = await computeOfferRoundSavings(
        prisma,
        quotationId,
        offerId,
        finalRoundId ?? undefined
      );
      initialComparableTotal += s.savings.initialComparableCost;
      awardedComparableTotal += s.savings.negotiatedComparableCost;
    } catch {
      // fallback abaixo
    }
  }
  if (initialComparableTotal === 0 && awardedComparableTotal === 0) {
    for (const alloc of input.allocations) {
      const ref = offerItems.find(
        (o) => o.offerId === alloc.offerId && o.quotationItemId === alloc.quotationItemId
      );
      if (!ref) continue;
      const offer = quotation.offers.find((o) => o.id === alloc.offerId);
      const offerItem = offer?.items.find((i) => i.quotationItemId === alloc.quotationItemId);
      const initialUnit = offerItem ? Number(offerItem.initialUnitPrice) : ref.unitPrice;
      initialComparableTotal += initialUnit * alloc.quantityAwarded;
      awardedComparableTotal += ref.unitPrice * alloc.quantityAwarded;
    }
  }
  const gain = computeAwardGainSnapshot({ initialComparableTotal, awardedComparableTotal });

  const roundLines = finalRoundId
    ? await prisma.purchaseNegotiationRoundLine.findMany({ where: { roundId: finalRoundId } })
    : [];
  const roundLineByOfferItem = new Map(roundLines.map((l) => [l.offerItemId, l]));

  const commercialConditions = winnerOfferIds.map((offerId) => {
    const offer = quotation.offers.find((o) => o.id === offerId)!;
    return {
      offerId,
      supplierId: offer.quotationSupplier.supplierId,
      supplierName: offer.quotationSupplier.supplierDisplayNameSnapshot,
      paymentTerms: offer.initialPaymentTerms,
      deliveryTerms: offer.initialDeliveryTerms,
      freightValue: offer.initialFreightValue != null ? Number(offer.initialFreightValue) : null,
      leadTimeDays: offer.initialLeadTimeDays,
      validityDate: offer.initialValidityDate
        ? offer.initialValidityDate.toISOString().slice(0, 10)
        : null,
      currency: offer.currency,
    };
  });

  return prisma.$transaction(async (tx) => {
    const approval = await tx.purchaseApproval.create({
      data: {
        targetType: "QUOTATION",
        status: "PENDENTE",
        quotationId,
        requestedByUserId: actor.userId,
        reason: input.justification.trim(),
        notes: input.notes?.trim() || null,
      },
    });

    const award = await tx.purchaseQuotationAward.create({
      data: {
        quotationId,
        status: "PENDENTE_APROVACAO",
        mode: input.mode,
        finalRoundId,
        justification: input.justification.trim(),
        responsibleUserId: actor.userId,
        responsibleUserName: actor.userName ?? null,
        currency: quotation.currency || "BRL",
        initialComparableTotal: toDec(initialComparableTotal),
        awardedComparableTotal: toDec(awardedComparableTotal),
        totalGain: toDec(gain.totalGain),
        percentGain: toDec(gain.percentGain),
        evidenceCountSnapshot: evidenceCount,
        usedEvidenceException: validation.usedEvidenceException,
        commercialConditionsJson: commercialConditions,
        notes: input.notes?.trim() || null,
        approvalId: approval.id,
      },
    });

    for (const alloc of input.allocations) {
      const offer = quotation.offers.find((o) => o.id === alloc.offerId)!;
      const offerItem = offer.items.find((i) => i.quotationItemId === alloc.quotationItemId)!;
      const roundLine = roundLineByOfferItem.get(offerItem.id);
      const unitPrice = roundLine
        ? Number(roundLine.unitPrice)
        : Number(offerItem.initialUnitPrice);
      const qty = alloc.quantityAwarded;
      await tx.purchaseQuotationAwardAllocation.create({
        data: {
          awardId: award.id,
          offerId: offer.id,
          offerItemId: offerItem.id,
          quotationItemId: alloc.quotationItemId,
          supplierId: offer.quotationSupplier.supplierId,
          supplierNameSnapshot: offer.quotationSupplier.supplierDisplayNameSnapshot,
          quantityAwarded: new Prisma.Decimal(qty),
          unitPriceAwarded: new Prisma.Decimal(unitPrice),
          lineTotalAwarded: new Prisma.Decimal(unitPrice * qty),
          roundLineId: roundLine?.id ?? null,
          paymentTermsSnapshot: roundLine?.paymentTerms ?? offer.initialPaymentTerms,
          deliveryTermsSnapshot: roundLine?.deliveryTerms ?? offer.initialDeliveryTerms,
          freightValueSnapshot: toDec(
            roundLine?.freightValue != null
              ? Number(roundLine.freightValue)
              : offer.initialFreightValue != null
                ? Number(offer.initialFreightValue)
                : null
          ),
          leadTimeDaysSnapshot: roundLine?.leadTimeDays ?? offer.initialLeadTimeDays,
          validityDateSnapshot: offer.initialValidityDate,
        },
      });
    }

    for (const rej of input.rejections ?? []) {
      const offer = quotation.offers.find((o) => o.id === rej.offerId)!;
      await tx.purchaseQuotationAwardRejection.create({
        data: {
          awardId: award.id,
          offerId: offer.id,
          quotationSupplierId: offer.quotationSupplierId,
          supplierId: offer.quotationSupplier.supplierId,
          supplierNameSnapshot: offer.quotationSupplier.supplierDisplayNameSnapshot,
          reason: rej.reason.trim(),
        },
      });
    }

    if (quotation.status === "ENVIADA" || quotation.status === "RASCUNHO") {
      await tx.purchaseQuotation.update({
        where: { id: quotationId },
        data: { status: "EM_ANALISE" },
      });
    }

    await writeAwardHistory(tx, {
      awardId: award.id,
      action: "SUBMITTED",
      reason: input.justification.trim(),
      userId: actor.userId,
      userName: actor.userName,
      metaJson: {
        mode: input.mode,
        winnerOfferIds: validation.winnerOfferIds,
        rejectedOfferIds: validation.rejectedOfferIds,
      },
    });

    return tx.purchaseQuotationAward.findUniqueOrThrow({
      where: { id: award.id },
      include: AWARD_INCLUDE,
    });
  });
}

export async function approveQuotationAward(
  prisma: PrismaClient,
  quotationId: string,
  awardId: string,
  actor: AwardActor,
  input?: { notes?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const award = await tx.purchaseQuotationAward.findFirst({
      where: { id: awardId, quotationId },
      include: {
        allocations: true,
        rejections: true,
        quotation: true,
      },
    });
    if (!award) {
      throw new PurchaseQuotationWorkflowError("Adjudicação não encontrada.", "NOT_FOUND");
    }
    if (award.status !== "PENDENTE_APROVACAO") {
      throw new QuotationAwardError("Adjudicação não está pendente de aprovação.", "AWARD_STATUS");
    }
    if (award.quotation.status === "ADJUDICADA") {
      throw new QuotationAwardError("Cotação já adjudicada.", "ALREADY_AWARDED");
    }

    const otherApproved = await tx.purchaseQuotationAward.findFirst({
      where: {
        quotationId,
        status: "APROVADA",
        NOT: { id: awardId },
      },
    });
    if (otherApproved) {
      throw new QuotationAwardError(
        "Já existe adjudicação aprovada — impedido múltiplos vencedores conflitantes.",
        "CONFLICTING_AWARD"
      );
    }

    const winnerOfferIds = [...new Set(award.allocations.map((a) => a.offerId))];
    const rejectedOfferIds = award.rejections.map((r) => r.offerId);

    // Marca vencedores / rejeitados
    await tx.purchaseQuotationOffer.updateMany({
      where: { quotationId, id: { in: rejectedOfferIds } },
      data: { status: "DESCARTADA" },
    });
    for (const rej of award.rejections) {
      await tx.purchaseQuotationSupplier.update({
        where: { id: rej.quotationSupplierId },
        data: { status: "DESCARTADO", notes: rej.reason },
      });
    }

    // Limpa outros vencedores conflitantes
    await tx.purchaseQuotationOffer.updateMany({
      where: {
        quotationId,
        status: "VENCEDORA",
        NOT: { id: { in: winnerOfferIds } },
      },
      data: {
        status: "DESCARTADA",
        selectionJustification: null,
        selectedAt: null,
        selectedByUserId: null,
        selectedByUserName: null,
      },
    });

    const now = new Date();
    for (const offerId of winnerOfferIds) {
      const offerAllocs = award.allocations.filter((a) => a.offerId === offerId);
      const header = offerAllocs[0];
      await tx.purchaseQuotationOffer.update({
        where: { id: offerId },
        data: {
          status: "VENCEDORA",
          selectionJustification: award.justification,
          selectedAt: award.submittedAt,
          selectedByUserId: award.responsibleUserId,
          selectedByUserName: award.responsibleUserName,
          awardedPaymentTerms: header?.paymentTermsSnapshot ?? undefined,
          awardedDeliveryTerms: header?.deliveryTermsSnapshot ?? undefined,
          awardedFreightValue: header?.freightValueSnapshot ?? undefined,
          awardedValidityDate: header?.validityDateSnapshot ?? undefined,
          awardedLeadTimeDays: header?.leadTimeDaysSnapshot ?? undefined,
          awardedAt: now,
        },
      });
      const offer = await tx.purchaseQuotationOffer.findUniqueOrThrow({
        where: { id: offerId },
        select: { quotationSupplierId: true },
      });
      await tx.purchaseQuotationSupplier.update({
        where: { id: offer.quotationSupplierId },
        data: { status: "VENCEDOR" },
      });

      for (const alloc of offerAllocs) {
        const offerItem = await tx.purchaseQuotationOfferItem.findUniqueOrThrow({
          where: { id: alloc.offerItemId },
        });
        assertAwardDoesNotOverwriteInitial(
          Number(offerItem.initialUnitPrice),
          Number(alloc.unitPriceAwarded)
        );
        await tx.purchaseQuotationOfferItem.update({
          where: { id: alloc.offerItemId },
          data: {
            awardedUnitPrice: alloc.unitPriceAwarded,
            awardedQuantity: alloc.quantityAwarded,
            awardedLeadTimeDays: alloc.leadTimeDaysSnapshot,
            awardedFreightValue: alloc.freightValueSnapshot,
            awardedAt: now,
            ...(alloc.roundLineId ? { awardedRoundLineId: alloc.roundLineId } : {}),
          },
        });
      }
    }

    // Demais ofertas RECEBIDAS sem alocação → DESCARTADA se não rejeitadas explicitamente
    await tx.purchaseQuotationOffer.updateMany({
      where: {
        quotationId,
        status: "RECEBIDA",
        NOT: { id: { in: [...winnerOfferIds, ...rejectedOfferIds] } },
      },
      data: { status: "DESCARTADA" },
    });

    await tx.purchaseQuotation.update({
      where: { id: quotationId },
      data: {
        status: "ADJUDICADA",
        awardedAt: now,
        awardedByUserId: actor.userId,
      },
    });

    if (award.approvalId) {
      await tx.purchaseApproval.update({
        where: { id: award.approvalId },
        data: {
          status: "APROVADA",
          decidedByUserId: actor.userId,
          decidedAt: now,
          notes: input?.notes?.trim() || award.notes,
        },
      });
    }

    await tx.purchaseQuotationAward.update({
      where: { id: awardId },
      data: {
        status: "APROVADA",
        approverUserId: actor.userId,
        approverUserName: actor.userName ?? null,
        decidedAt: now,
        decisionReason: input?.notes?.trim() || null,
      },
    });

    const lockReason = `Adjudicação aprovada ${awardId}`;
    await lockEvidencesForEntity(tx as unknown as PrismaClient, "QUOTATION", quotationId, lockReason, actor);
    await lockEvidencesForEntity(tx as unknown as PrismaClient, "CONFIRMATION", quotationId, lockReason, actor);
    for (const offerId of winnerOfferIds) {
      await lockEvidencesForEntity(tx as unknown as PrismaClient, "OFFER", offerId, lockReason, actor);
    }
    if (award.finalRoundId) {
      await lockEvidencesForEntity(
        tx as unknown as PrismaClient,
        "NEGOTIATION_ROUND",
        award.finalRoundId,
        lockReason,
        actor
      );
    }

    await writeAwardHistory(tx, {
      awardId,
      action: "APPROVED",
      reason: input?.notes?.trim() || null,
      userId: actor.userId,
      userName: actor.userName,
      metaJson: { winnerOfferIds, rejectedOfferIds },
    });

    return tx.purchaseQuotationAward.findUniqueOrThrow({
      where: { id: awardId },
      include: AWARD_INCLUDE,
    });
  });
}

export async function rejectQuotationAward(
  prisma: PrismaClient,
  quotationId: string,
  awardId: string,
  actor: AwardActor,
  input: { reason: string }
) {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 5) {
    throw new QuotationAwardError("Motivo da rejeição obrigatório (mín. 5 caracteres).", "REJECT_REASON");
  }

  return prisma.$transaction(async (tx) => {
    const award = await tx.purchaseQuotationAward.findFirst({
      where: { id: awardId, quotationId },
    });
    if (!award) {
      throw new PurchaseQuotationWorkflowError("Adjudicação não encontrada.", "NOT_FOUND");
    }
    if (award.status !== "PENDENTE_APROVACAO") {
      throw new QuotationAwardError("Só adjudicações pendentes podem ser rejeitadas.", "AWARD_STATUS");
    }

    const now = new Date();
    if (award.approvalId) {
      await tx.purchaseApproval.update({
        where: { id: award.approvalId },
        data: {
          status: "REJEITADA",
          decidedByUserId: actor.userId,
          decidedAt: now,
          reason,
        },
      });
    }

    await tx.purchaseQuotationAward.update({
      where: { id: awardId },
      data: {
        status: "REJEITADA",
        approverUserId: actor.userId,
        approverUserName: actor.userName ?? null,
        decidedAt: now,
        decisionReason: reason,
      },
    });

    await writeAwardHistory(tx, {
      awardId,
      action: "REJECTED",
      reason,
      userId: actor.userId,
      userName: actor.userName,
    });

    return tx.purchaseQuotationAward.findUniqueOrThrow({
      where: { id: awardId },
      include: AWARD_INCLUDE,
    });
  });
}

export { num };
