/**
 * Pedido de Compra formal a partir de cotação adjudicada (OP-20).
 * Congela snapshots; não cria Contas a Pagar nem movimento de estoque.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  buildOperationalCommitmentMeta,
  PurchaseOrderWorkflowError,
  resolvePurchaseOrderTransition,
  assertAwardApprovedForPo,
  assertQuotationAdjudicated,
  type PurchaseOrderAction,
  type PurchaseOrderStatusName,
} from "./purchaseOrderWorkflow.js";
import { QuotationAwardError } from "./quotationAwardEngine.js";

export type PoActor = {
  userId: string;
  userName?: string | null;
};

const DETAIL_INCLUDE = {
  items: { orderBy: { lineNumber: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
  quotation: { select: { id: true, code: true, status: true } },
  award: { select: { id: true, status: true, mode: true, justification: true } },
  supplier: { select: { id: true, displayName: true, document: true } },
} as const;

function toDec(v: number | null | undefined): Prisma.Decimal | null {
  if (v == null || !Number.isFinite(v)) return null;
  return new Prisma.Decimal(v);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function writeHistory(
  db: PrismaClient | Prisma.TransactionClient,
  input: {
    purchaseOrderId: string;
    action: string;
    fromStatus?: PurchaseOrderStatusName | null;
    toStatus?: PurchaseOrderStatusName | null;
    reason?: string | null;
    notes?: string | null;
    userId?: string | null;
    userName?: string | null;
    metaJson?: Prisma.InputJsonValue;
  }
) {
  await db.purchaseOrderHistoryEvent.create({
    data: {
      purchaseOrderId: input.purchaseOrderId,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      metaJson: input.metaJson ?? undefined,
    },
  });
}

async function nextPurchaseOrderCode(
  db: PrismaClient | Prisma.TransactionClient
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PC-${year}-`;
  const last = await db.purchaseOrder.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: "desc" },
    select: { code: true },
  });
  let seq = 1;
  if (last?.code) {
    const tail = last.code.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, "0")}`;
}

export function mapPurchaseOrderError(e: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (e instanceof PurchaseOrderWorkflowError || e instanceof QuotationAwardError) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("purchase-order error:", e);
  return { status: 500, body: { error: "Erro no pedido de compra." } };
}

export async function listPurchaseOrders(
  prisma: PrismaClient,
  filter?: { quotationId?: string; status?: string; awardId?: string }
) {
  return prisma.purchaseOrder.findMany({
    where: {
      ...(filter?.quotationId ? { quotationId: filter.quotationId } : {}),
      ...(filter?.awardId ? { awardId: filter.awardId } : {}),
      ...(filter?.status ? { status: filter.status as PurchaseOrderStatusName } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: {
      items: { select: { id: true } },
      quotation: { select: { id: true, code: true } },
      supplier: { select: { id: true, displayName: true } },
    },
  });
}

export async function getPurchaseOrderDetail(prisma: PrismaClient, id: string) {
  const row = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
  if (!row) {
    throw new PurchaseOrderWorkflowError("Pedido de compra não encontrado.", "NOT_FOUND");
  }
  return row;
}

/**
 * Gera um PO por fornecedor vencedor a partir da adjudicação aprovada.
 * Split → múltiplos POs. Sem AP / estoque.
 */
export async function createPurchaseOrdersFromAward(
  prisma: PrismaClient,
  awardId: string,
  actor: PoActor,
  input?: { notes?: string | null }
) {
  const award = await prisma.purchaseQuotationAward.findUnique({
    where: { id: awardId },
    include: {
      quotation: {
        include: {
          items: true,
        },
      },
      allocations: true,
      approval: true,
    },
  });
  if (!award) {
    throw new PurchaseOrderWorkflowError("Adjudicação não encontrada.", "NOT_FOUND");
  }
  assertAwardApprovedForPo(award.status);
  assertQuotationAdjudicated(award.quotation.status);

  const existing = await prisma.purchaseOrder.count({
    where: { awardId, status: { not: "CANCELADO" } },
  });
  if (existing > 0) {
    throw new PurchaseOrderWorkflowError(
      "Já existem pedidos ativos para esta adjudicação.",
      "PO_EXISTS"
    );
  }

  if (award.allocations.length === 0) {
    throw new PurchaseOrderWorkflowError("Adjudicação sem alocações.", "NO_ALLOCATIONS");
  }

  const evidenceRows = await prisma.purchaseEvidence.findMany({
    where: {
      deletedAt: null,
      OR: [
        { entityType: "QUOTATION", entityId: award.quotationId },
        { entityType: "CONFIRMATION", entityId: award.quotationId },
        {
          entityType: "OFFER",
          entityId: { in: [...new Set(award.allocations.map((a) => a.offerId))] },
        },
        ...(award.finalRoundId
          ? [{ entityType: "NEGOTIATION_ROUND" as const, entityId: award.finalRoundId }]
          : []),
      ],
    },
    select: { id: true },
  });
  const evidenceIds = evidenceRows.map((e) => e.id);

  const byOffer = new Map<string, typeof award.allocations>();
  for (const alloc of award.allocations) {
    const list = byOffer.get(alloc.offerId) ?? [];
    list.push(alloc);
    byOffer.set(alloc.offerId, list);
  }

  const offerIds = [...byOffer.keys()];
  const offers = await prisma.purchaseQuotationOffer.findMany({
    where: { id: { in: offerIds } },
    include: {
      items: true,
      quotationSupplier: true,
    },
  });
  const offerMap = new Map(offers.map((o) => [o.id, o]));

  return prisma.$transaction(async (tx) => {
    const createdIds: string[] = [];

    for (const [offerId, allocs] of byOffer) {
      const offer = offerMap.get(offerId);
      if (!offer) {
        throw new PurchaseOrderWorkflowError(`Oferta ${offerId} não encontrada.`, "NOT_FOUND");
      }

      const code = await nextPurchaseOrderCode(tx);
      let totalAmount = 0;
      let freightSum = 0;
      let taxesSum = 0;
      let discountsSum = 0;
      let initialComparable = 0;
      let negotiatedComparable = 0;

      const lineData: Array<{
        lineNumber: number;
        purchaseRequestItemId: string | null;
        quotationItemId: string;
        offerItemId: string;
        awardAllocationId: string;
        materialId: string | null;
        materialCodeSnapshot: string | null;
        materialDescriptionSnapshot: string | null;
        materialUnitSnapshot: string | null;
        description: string;
        quantityOrdered: Prisma.Decimal;
        unit: string;
        initialUnitPriceSnapshot: Prisma.Decimal;
        unitPriceSnapshot: Prisma.Decimal;
        lineTotalSnapshot: Prisma.Decimal;
        lineGainSnapshot: Prisma.Decimal;
        freightValueSnapshot: Prisma.Decimal | null;
        nonRecoverableTaxesSnapshot: Prisma.Decimal | null;
        discountsSnapshot: Prisma.Decimal | null;
        leadTimeDaysSnapshot: number | null;
      }> = [];

      let lineNumber = 1;
      for (const alloc of allocs) {
        const qItem = award.quotation.items.find((i) => i.id === alloc.quotationItemId);
        const offerItem = offer.items.find((i) => i.id === alloc.offerItemId);
        if (!qItem || !offerItem) {
          throw new PurchaseOrderWorkflowError("Item de alocação inconsistente.", "ALLOCATION_INVALID");
        }
        const qty = num(alloc.quantityAwarded);
        const negotiated = num(alloc.unitPriceAwarded);
        const initial = num(offerItem.initialUnitPrice);
        const lineTotal = negotiated * qty;
        const lineGain = (initial - negotiated) * qty;
        totalAmount += lineTotal;
        initialComparable += initial * qty;
        negotiatedComparable += lineTotal;
        const freight = alloc.freightValueSnapshot != null ? num(alloc.freightValueSnapshot) : num(offerItem.initialFreightValue);
        const taxes = num(offerItem.initialNonRecoverableTaxes);
        const discounts = num(offerItem.initialDiscounts);
        freightSum += freight;
        taxesSum += taxes;
        discountsSum += discounts;

        lineData.push({
          lineNumber: lineNumber++,
          purchaseRequestItemId: qItem.purchaseRequestItemId,
          quotationItemId: qItem.id,
          offerItemId: offerItem.id,
          awardAllocationId: alloc.id,
          materialId: qItem.materialId,
          materialCodeSnapshot: qItem.materialCodeSnapshot,
          materialDescriptionSnapshot: qItem.materialDescriptionSnapshot,
          materialUnitSnapshot: qItem.materialUnitSnapshot,
          description: qItem.description,
          quantityOrdered: new Prisma.Decimal(qty),
          unit: qItem.unit,
          initialUnitPriceSnapshot: new Prisma.Decimal(initial),
          unitPriceSnapshot: new Prisma.Decimal(negotiated),
          lineTotalSnapshot: new Prisma.Decimal(lineTotal),
          lineGainSnapshot: new Prisma.Decimal(lineGain),
          freightValueSnapshot: toDec(freight),
          nonRecoverableTaxesSnapshot: toDec(taxes),
          discountsSnapshot: toDec(discounts),
          leadTimeDaysSnapshot: alloc.leadTimeDaysSnapshot ?? offerItem.initialLeadTimeDays,
        });
      }

      const header = allocs[0]!;
      const po = await tx.purchaseOrder.create({
        data: {
          code,
          status: "RASCUNHO",
          purchaseRequestId: award.quotation.purchaseRequestId,
          quotationId: award.quotationId,
          awardedOfferId: offerId,
          awardId: award.id,
          finalRoundId: award.finalRoundId,
          approvalId: award.approvalId,
          supplierId: offer.quotationSupplier.supplierId,
          supplierDisplayNameSnapshot: offer.quotationSupplier.supplierDisplayNameSnapshot,
          supplierDocumentSnapshot: offer.quotationSupplier.supplierDocumentSnapshot,
          currency: award.currency || offer.currency || "BRL",
          paymentTermsSnapshot: header.paymentTermsSnapshot ?? offer.initialPaymentTerms,
          deliveryTermsSnapshot: header.deliveryTermsSnapshot ?? offer.initialDeliveryTerms,
          freightValueSnapshot: toDec(freightSum || num(header.freightValueSnapshot)),
          nonRecoverableTaxesSnapshot: toDec(taxesSum),
          discountsSnapshot: toDec(discountsSum),
          leadTimeDaysSnapshot: header.leadTimeDaysSnapshot ?? offer.initialLeadTimeDays,
          totalAmountSnapshot: toDec(totalAmount),
          initialComparableTotalSnapshot: toDec(initialComparable),
          negotiatedComparableTotalSnapshot: toDec(negotiatedComparable),
          totalGainSnapshot: toDec(initialComparable - negotiatedComparable),
          quotationCodeSnapshot: award.quotation.code,
          awardJustificationSnapshot: award.justification,
          evidenceCountSnapshot: evidenceIds.length,
          evidenceIdsJson: evidenceIds,
          createdByUserId: actor.userId,
          createdByUserName: actor.userName ?? null,
          notes: input?.notes?.trim() || null,
          items: { create: lineData },
        },
      });

      await writeHistory(tx, {
        purchaseOrderId: po.id,
        action: "CREATED_FROM_AWARD",
        fromStatus: null,
        toStatus: "RASCUNHO",
        userId: actor.userId,
        userName: actor.userName,
        metaJson: {
          awardId: award.id,
          offerId,
          code,
          noAccountsPayable: true,
          noStockIncrease: true,
        },
      });

      createdIds.push(po.id);
    }

    return tx.purchaseOrder.findMany({
      where: { id: { in: createdIds } },
      include: DETAIL_INCLUDE,
      orderBy: { code: "asc" },
    });
  });
}

export async function transitionPurchaseOrder(
  prisma: PrismaClient,
  id: string,
  actor: PoActor,
  action: PurchaseOrderAction,
  input?: { reason?: string | null; notes?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      throw new PurchaseOrderWorkflowError("Pedido de compra não encontrado.", "NOT_FOUND");
    }
    const from = po.status as PurchaseOrderStatusName;
    const to = resolvePurchaseOrderTransition(from, action);
    const now = new Date();
    const data: Prisma.PurchaseOrderUpdateInput = { status: to };

    if (action === "APPROVE") {
      const meta = buildOperationalCommitmentMeta(now.toISOString());
      data.approvedAt = now;
      data.approvedByUserId = actor.userId;
      data.approvedByUserName = actor.userName ?? null;
      data.operationalCommitmentAt = now;
      data.futureEntryPending = meta.futureEntryPending;
      data.futureEntryMarkedAt = now;
      // Compromisso operacional explícito via PurchaseApproval
      await tx.purchaseApproval.create({
        data: {
          targetType: "PURCHASE_ORDER",
          status: "APROVADA",
          purchaseOrderId: id,
          requestedByUserId: po.createdByUserId,
          decidedByUserId: actor.userId,
          decidedAt: now,
          reason: "Aprovação do pedido de compra — compromisso operacional (sem AP/estoque).",
          notes: input?.notes?.trim() || null,
        },
      });
    } else if (action === "SEND") {
      data.sentAt = now;
      data.issuedAt = po.issuedAt ?? now;
      data.issuedByUserId = actor.userId;
    } else if (action === "CONFIRM") {
      data.confirmedAt = now;
    } else if (action === "CANCEL") {
      const reason = String(input?.reason ?? "").trim();
      if (reason.length < 5) {
        throw new PurchaseOrderWorkflowError(
          "Motivo de cancelamento obrigatório (mín. 5 caracteres).",
          "CANCEL_REASON"
        );
      }
      data.cancelledAt = now;
      data.cancelReason = reason;
      data.futureEntryPending = false;
    }

    await tx.purchaseOrder.update({ where: { id }, data });
    await writeHistory(tx, {
      purchaseOrderId: id,
      action,
      fromStatus: from,
      toStatus: to,
      reason: input?.reason ?? null,
      notes: input?.notes ?? null,
      userId: actor.userId,
      userName: actor.userName,
      metaJson:
        action === "APPROVE"
          ? {
              operationalCommitment: true,
              futureEntryPending: true,
              createsAccountsPayable: false,
              increasesStock: false,
            }
          : undefined,
    });

    return tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      include: DETAIL_INCLUDE,
    });
  });
}

export async function listPurchaseOrderHistory(prisma: PrismaClient, id: string) {
  return prisma.purchaseOrderHistoryEvent.findMany({
    where: { purchaseOrderId: id },
    orderBy: { createdAt: "asc" },
  });
}
