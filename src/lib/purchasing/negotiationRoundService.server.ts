/**
 * Serviço de rodadas de negociação imutáveis (OP-16).
 * Não adjudica vencedor, não cria PO nem Contas a Pagar.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  assertPositiveQuantity,
  assertPositiveUnitPrice,
  assertRoundHistoryAppendOnly,
  PurchasingInvariantError,
} from "./purchasingPriceInvariants.js";
import {
  computeNegotiationSavings,
  NegotiationSavingsError,
  type ComparableCostInput,
  type ConditionGain,
} from "./negotiationSavingsEngine.js";
import { PurchaseQuotationWorkflowError } from "./purchaseQuotationWorkflow.js";
import {
  assertCanConcludeNegotiation,
  lockEvidencesForEntity,
} from "./purchaseEvidenceService.server.js";
import { PurchaseEvidenceError } from "./purchaseEvidenceRules.js";
import { assertHumanWinnerSelection } from "./quotationComparisonEngine.js";

export type NegotiationActor = {
  userId: string;
  userName?: string | null;
};

function toDec(value: unknown): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new PurchaseQuotationWorkflowError("Valor numérico inválido.", "NUMBER_INVALID");
  }
  return new Prisma.Decimal(n);
}

function toNum(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown): number | null {
  const n = toNum(value);
  if (n == null) return null;
  if (!Number.isInteger(n)) {
    throw new PurchaseQuotationWorkflowError("Inteiro inválido.", "INT_INVALID");
  }
  return n;
}

const ROUND_INCLUDE = {
  lines: {
    include: {
      offerItem: {
        include: {
          quotationItem: {
            select: { id: true, lineNumber: true, description: true, unit: true },
          },
          offer: {
            select: {
              id: true,
              currency: true,
              initialFreightValue: true,
              initialNonRecoverableTaxes: true,
              initialExpenses: true,
              initialDiscounts: true,
              initialPaymentTerms: true,
              initialDeliveryTerms: true,
              initialLeadTimeDays: true,
              initialMinOrderQty: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.PurchaseNegotiationRoundInclude;

export async function listNegotiationRounds(prisma: PrismaClient, quotationId: string) {
  return prisma.purchaseNegotiationRound.findMany({
    where: { quotationId },
    include: ROUND_INCLUDE,
    orderBy: { roundNumber: "asc" },
  });
}

export async function openNegotiationRound(
  prisma: PrismaClient,
  quotationId: string,
  actor: NegotiationActor,
  input?: { buyerReport?: string | null; notes?: string | null }
) {
  return prisma.$transaction(async (tx) => {
    const quotation = await tx.purchaseQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation) {
      throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
    }
    if (
      quotation.status === "CANCELADA" ||
      quotation.status === "ADJUDICADA" ||
      quotation.status === "EXPIRADA"
    ) {
      throw new PurchaseQuotationWorkflowError(
        "Cotação não admite novas rodadas neste status.",
        "QUOTATION_LOCKED"
      );
    }

    const open = await tx.purchaseNegotiationRound.findFirst({
      where: { quotationId, status: "ABERTA" },
    });
    if (open) {
      throw new PurchaseQuotationWorkflowError(
        "Já existe uma rodada aberta. Feche-a antes de abrir outra.",
        "ROUND_ALREADY_OPEN"
      );
    }

    const last = await tx.purchaseNegotiationRound.findFirst({
      where: { quotationId },
      orderBy: { roundNumber: "desc" },
      select: { roundNumber: true },
    });
    const roundNumber = (last?.roundNumber ?? 0) + 1;

    if (quotation.status === "ENVIADA" || quotation.status === "RASCUNHO") {
      await tx.purchaseQuotation.update({
        where: { id: quotationId },
        data: { status: "EM_ANALISE" },
      });
    }

    return tx.purchaseNegotiationRound.create({
      data: {
        quotationId,
        roundNumber,
        status: "ABERTA",
        openedByUserId: actor.userId,
        responsibleUserName: actor.userName ?? null,
        buyerReport: input?.buyerReport?.trim() || null,
        notes: input?.notes?.trim() || null,
      },
      include: ROUND_INCLUDE,
    });
  });
}

export type AppendRoundLineInput = {
  offerItemId: string;
  unitPrice: number;
  quantity?: number | null;
  leadTimeDays?: number | null;
  freightValue?: number | null;
  nonRecoverableTaxes?: number | null;
  expenses?: number | null;
  discounts?: number | null;
  minOrderQty?: number | null;
  freightIncoterm?: string | null;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string | null;
  proposedBy?: "BUYER" | "SUPPLIER";
};

async function resolvePreviousCommercial(
  tx: Prisma.TransactionClient,
  offerItemId: string,
  quotationId: string
) {
  const priorLine = await tx.purchaseNegotiationRoundLine.findFirst({
    where: {
      offerItemId,
      round: { quotationId, status: "FECHADA" },
    },
    orderBy: [{ round: { roundNumber: "desc" } }, { createdAt: "desc" }],
  });
  if (priorLine) {
    return {
      previousUnitPrice: priorLine.unitPrice,
      previousQuantity: priorLine.quantity,
      previousLeadTimeDays: priorLine.leadTimeDays,
      previousFreightValue: priorLine.freightValue,
      previousNonRecoverableTaxes: priorLine.nonRecoverableTaxes,
      previousExpenses: priorLine.expenses,
      previousDiscounts: priorLine.discounts,
      previousMinOrderQty: priorLine.minOrderQty,
      previousPaymentTerms: priorLine.paymentTerms,
      previousDeliveryTerms: priorLine.deliveryTerms,
      previousFreightIncoterm: priorLine.freightIncoterm,
    };
  }

  const offerItem = await tx.purchaseQuotationOfferItem.findUniqueOrThrow({
    where: { id: offerItemId },
    include: { offer: true },
  });
  if (offerItem.offer.quotationId !== quotationId) {
    throw new PurchaseQuotationWorkflowError(
      "Item de oferta não pertence à cotação.",
      "OFFER_ITEM_MISMATCH"
    );
  }

  return {
    previousUnitPrice: offerItem.initialUnitPrice,
    previousQuantity: offerItem.initialQuantity,
    previousLeadTimeDays: offerItem.initialLeadTimeDays ?? offerItem.offer.initialLeadTimeDays,
    previousFreightValue: offerItem.initialFreightValue ?? offerItem.offer.initialFreightValue,
    previousNonRecoverableTaxes:
      offerItem.initialNonRecoverableTaxes ?? offerItem.offer.initialNonRecoverableTaxes,
    previousExpenses: offerItem.initialExpenses ?? offerItem.offer.initialExpenses,
    previousDiscounts: offerItem.initialDiscounts ?? offerItem.offer.initialDiscounts,
    previousMinOrderQty: offerItem.initialMinOrderQty ?? offerItem.offer.initialMinOrderQty,
    previousPaymentTerms: offerItem.offer.initialPaymentTerms,
    previousDeliveryTerms: offerItem.offer.initialDeliveryTerms,
    previousFreightIncoterm: null as string | null,
  };
}

export async function appendNegotiationRoundLines(
  prisma: PrismaClient,
  quotationId: string,
  roundId: string,
  actor: NegotiationActor,
  lines: AppendRoundLineInput[]
) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PurchaseQuotationWorkflowError("Informe ao menos uma linha.", "LINES_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const round = await tx.purchaseNegotiationRound.findFirst({
      where: { id: roundId, quotationId },
      include: { lines: true },
    });
    if (!round) {
      throw new PurchaseQuotationWorkflowError("Rodada não encontrada.", "NOT_FOUND");
    }
    if (round.status !== "ABERTA") {
      throw new PurchaseQuotationWorkflowError(
        "Só é possível acrescentar linhas em rodada ABERTA (histórico imutável).",
        "ROUND_LOCKED"
      );
    }

    const existingSnapshots = round.lines.map((l) => ({
      id: l.id,
      roundNumber: round.roundNumber,
      offerItemId: l.offerItemId,
      unitPrice: Number(l.unitPrice),
      createdAt: l.createdAt.toISOString(),
    }));

    for (const line of lines) {
      assertPositiveUnitPrice(Number(line.unitPrice), "unitPrice");
      if (line.quantity != null) assertPositiveQuantity(Number(line.quantity), "quantity");

      const offerItem = await tx.purchaseQuotationOfferItem.findFirst({
        where: { id: line.offerItemId, offer: { quotationId } },
      });
      if (!offerItem) {
        throw new PurchaseQuotationWorkflowError(
          "Item de oferta inválido para esta cotação.",
          "OFFER_ITEM_MISMATCH"
        );
      }

      const dup = round.lines.find((l) => l.offerItemId === line.offerItemId);
      if (dup) {
        throw new PurchasingInvariantError(
          "Já existe proposta para este item nesta rodada.",
          "ROUND_LINE_DUPLICATE"
        );
      }

      const tempId = `pending-${line.offerItemId}`;
      assertRoundHistoryAppendOnly(existingSnapshots, {
        id: tempId,
        roundNumber: round.roundNumber,
        offerItemId: line.offerItemId,
        unitPrice: Number(line.unitPrice),
        createdAt: new Date().toISOString(),
      });

      const previous = await resolvePreviousCommercial(tx, line.offerItemId, quotationId);

      const created = await tx.purchaseNegotiationRoundLine.create({
        data: {
          roundId,
          offerItemId: line.offerItemId,
          unitPrice: toDec(line.unitPrice)!,
          quantity: toDec(line.quantity),
          leadTimeDays: toInt(line.leadTimeDays),
          freightValue: toDec(line.freightValue),
          nonRecoverableTaxes: toDec(line.nonRecoverableTaxes),
          expenses: toDec(line.expenses),
          discounts: toDec(line.discounts),
          minOrderQty: toDec(line.minOrderQty),
          freightIncoterm: line.freightIncoterm?.trim().toUpperCase() || null,
          paymentTerms: line.paymentTerms?.trim() || null,
          deliveryTerms: line.deliveryTerms?.trim() || null,
          proposedBy: line.proposedBy === "SUPPLIER" ? "SUPPLIER" : "BUYER",
          notes: line.notes?.trim() || null,
          createdByUserId: actor.userId,
          previousUnitPrice: previous.previousUnitPrice,
          previousQuantity: previous.previousQuantity,
          previousLeadTimeDays: previous.previousLeadTimeDays,
          previousFreightValue: previous.previousFreightValue,
          previousNonRecoverableTaxes: previous.previousNonRecoverableTaxes,
          previousExpenses: previous.previousExpenses,
          previousDiscounts: previous.previousDiscounts,
          previousMinOrderQty: previous.previousMinOrderQty,
          previousPaymentTerms: previous.previousPaymentTerms,
          previousDeliveryTerms: previous.previousDeliveryTerms,
          previousFreightIncoterm: previous.previousFreightIncoterm,
        },
      });

      existingSnapshots.push({
        id: created.id,
        roundNumber: round.roundNumber,
        offerItemId: created.offerItemId,
        unitPrice: Number(created.unitPrice),
        createdAt: created.createdAt.toISOString(),
      });
      round.lines.push(created as (typeof round.lines)[number]);
    }

    return tx.purchaseNegotiationRound.findUniqueOrThrow({
      where: { id: roundId },
      include: ROUND_INCLUDE,
    });
  });
}

export async function closeNegotiationRound(
  prisma: PrismaClient,
  quotationId: string,
  roundId: string,
  actor: NegotiationActor,
  input?: {
    buyerReport?: string | null;
    notes?: string | null;
    exceptionJustification?: string | null;
    hasExceptionPermission?: boolean;
    /** true = conclusão final da negociação (exige evidência/relato). */
    requireEvidenceGate?: boolean;
  }
) {
  const requireGate = input?.requireEvidenceGate === true;
  return prisma.$transaction(async (tx) => {
    const round = await tx.purchaseNegotiationRound.findFirst({
      where: { id: roundId, quotationId },
      include: { lines: true },
    });
    if (!round) {
      throw new PurchaseQuotationWorkflowError("Rodada não encontrada.", "NOT_FOUND");
    }
    if (round.status !== "ABERTA") {
      throw new PurchaseQuotationWorkflowError("Rodada já está fechada/cancelada.", "ROUND_LOCKED");
    }
    if (round.lines.length === 0) {
      throw new PurchaseQuotationWorkflowError(
        "Feche a rodada apenas após registrar linhas.",
        "ROUND_EMPTY"
      );
    }

    const buyerReport = input?.buyerReport ?? round.buyerReport;
    if (requireGate) {
      await assertCanConcludeNegotiation(prisma, {
        quotationId,
        roundId,
        buyerReport,
        exceptionJustification: input?.exceptionJustification,
        hasExceptionPermission: Boolean(input?.hasExceptionPermission),
      });
    }

    return tx.purchaseNegotiationRound.update({
      where: { id: roundId },
      data: {
        status: "FECHADA",
        closedAt: new Date(),
        closedByUserId: actor.userId,
        ...(input?.buyerReport !== undefined
          ? { buyerReport: input.buyerReport?.trim() || null }
          : {}),
        ...(input?.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(actor.userName ? { responsibleUserName: actor.userName } : {}),
      },
      include: ROUND_INCLUDE,
    });
  });
}

/**
 * Marca oferta como vencedora (sem criar PO). Exige relato + evidência (ou exceção).
 * Trava evidências da cotação/rodada/oferta contra exclusão silenciosa.
 */
export async function markOfferAsWinner(
  prisma: PrismaClient,
  quotationId: string,
  offerId: string,
  actor: NegotiationActor,
  input: {
    buyerReport: string;
    selectionJustification?: string | null;
    autoPickByLowestPrice?: boolean;
    exceptionJustification?: string | null;
    hasExceptionPermission?: boolean;
  }
) {
  let selectionJustification: string;
  try {
    selectionJustification = assertHumanWinnerSelection({
      selectionJustification: input.selectionJustification,
      autoPickByLowestPrice: Boolean(input.autoPickByLowestPrice),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.startsWith("AUTO_PICK_FORBIDDEN")
      ? "AUTO_PICK_FORBIDDEN"
      : "JUSTIFICATION_REQUIRED";
    throw new PurchaseQuotationWorkflowError(msg, code);
  }

  const conclusion = await assertCanConcludeNegotiation(prisma, {
    quotationId,
    buyerReport: input.buyerReport,
    exceptionJustification: input.exceptionJustification,
    hasExceptionPermission: Boolean(input.hasExceptionPermission),
  });

  return prisma.$transaction(async (tx) => {
    const quotation = await tx.purchaseQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation) {
      throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
    }
    if (quotation.status === "CANCELADA" || quotation.status === "ADJUDICADA") {
      throw new PurchaseQuotationWorkflowError("Cotação bloqueada.", "QUOTATION_LOCKED");
    }

    const offer = await tx.purchaseQuotationOffer.findFirst({
      where: { id: offerId, quotationId },
      include: { quotationSupplier: true },
    });
    if (!offer) {
      throw new PurchaseQuotationWorkflowError("Oferta não encontrada.", "NOT_FOUND");
    }
    if (offer.status !== "RECEBIDA" && offer.status !== "VENCEDORA") {
      throw new PurchaseQuotationWorkflowError(
        "Só ofertas RECEBIDAS podem ser marcadas como vencedoras.",
        "OFFER_STATUS"
      );
    }

    await tx.purchaseQuotationOffer.updateMany({
      where: { quotationId, status: "VENCEDORA", NOT: { id: offerId } },
      data: {
        status: "DESCARTADA",
        selectionJustification: null,
        selectedAt: null,
        selectedByUserId: null,
        selectedByUserName: null,
      },
    });

    await tx.purchaseQuotationOffer.update({
      where: { id: offerId },
      data: {
        status: "VENCEDORA",
        selectionJustification,
        selectedAt: new Date(),
        selectedByUserId: actor.userId,
        selectedByUserName: actor.userName ?? null,
      },
    });
    await tx.purchaseQuotationSupplier.update({
      where: { id: offer.quotationSupplierId },
      data: { status: "VENCEDOR" },
    });
    await tx.purchaseQuotationSupplier.updateMany({
      where: {
        quotationId,
        status: "VENCEDOR",
        NOT: { id: offer.quotationSupplierId },
      },
      data: { status: "DESCARTADO" },
    });

    // Nota: não seta ADJUDICADA aqui para não conflitar com OP futura de adjudicação formal.
    const lockReason = conclusion.usedException
      ? `Vencedor com exceção: ${String(input.exceptionJustification).trim()}`
      : "Oferta escolhida — evidências protegidas";

    await lockEvidencesForEntity(tx as unknown as PrismaClient, "QUOTATION", quotationId, lockReason, actor);
    await lockEvidencesForEntity(tx as unknown as PrismaClient, "OFFER", offerId, lockReason, actor);
    await lockEvidencesForEntity(tx as unknown as PrismaClient, "CONFIRMATION", quotationId, lockReason, actor);

    const rounds = await tx.purchaseNegotiationRound.findMany({
      where: { quotationId },
      select: { id: true },
    });
    for (const r of rounds) {
      await lockEvidencesForEntity(
        tx as unknown as PrismaClient,
        "NEGOTIATION_ROUND",
        r.id,
        lockReason,
        actor
      );
    }

    return tx.purchaseQuotation.findUniqueOrThrow({
      where: { id: quotationId },
      include: {
        offers: { include: { quotationSupplier: true, items: true } },
        suppliers: true,
      },
    });
  });
}

export async function computeOfferRoundSavings(
  prisma: PrismaClient,
  quotationId: string,
  offerId: string,
  roundId?: string
): Promise<{
  offerId: string;
  roundId: string | null;
  roundNumber: number | null;
  savings: ReturnType<typeof computeNegotiationSavings>;
}> {
  const offer = await prisma.purchaseQuotationOffer.findFirst({
    where: { id: offerId, quotationId },
    include: { items: true },
  });
  if (!offer) {
    throw new PurchaseQuotationWorkflowError("Oferta não encontrada.", "NOT_FOUND");
  }

  const round = roundId
    ? await prisma.purchaseNegotiationRound.findFirst({
        where: { id: roundId, quotationId },
        include: { lines: true },
      })
    : await prisma.purchaseNegotiationRound.findFirst({
        where: { quotationId, status: "FECHADA" },
        include: { lines: true },
        orderBy: { roundNumber: "desc" },
      });

  const initial: ComparableCostInput = {
    currency: offer.currency || "BRL",
    freightIncoterm: "FOB",
    headerFreight: toNum(offer.initialFreightValue),
    headerNonRecoverableTaxes: toNum(offer.initialNonRecoverableTaxes),
    headerExpenses: toNum(offer.initialExpenses),
    headerDiscounts: toNum(offer.initialDiscounts),
    lines: offer.items.map((it) => ({
      unitPrice: Number(it.initialUnitPrice),
      quantity: Number(it.initialQuantity ?? 0) || 0,
      freightValue: toNum(it.initialFreightValue),
      nonRecoverableTaxes: toNum(it.initialNonRecoverableTaxes),
      expenses: toNum(it.initialExpenses),
      discounts: toNum(it.initialDiscounts),
    })),
  };

  const offerItemIds = new Set(offer.items.map((i) => i.id));
  const roundLines = (round?.lines ?? []).filter((l) => offerItemIds.has(l.offerItemId));

  const negotiatedLines =
    roundLines.length > 0
      ? roundLines.map((l) => ({
          unitPrice: Number(l.unitPrice),
          quantity: Number(l.quantity ?? 0) || 0,
          freightValue: toNum(l.freightValue),
          nonRecoverableTaxes: toNum(l.nonRecoverableTaxes),
          expenses: toNum(l.expenses),
          discounts: toNum(l.discounts),
        }))
      : initial.lines;

  const incoterm =
    roundLines.find((l) => l.freightIncoterm)?.freightIncoterm ||
    roundLines.find((l) => l.previousFreightIncoterm)?.previousFreightIncoterm ||
    "FOB";

  const negotiated: ComparableCostInput = {
    currency: offer.currency || "BRL",
    freightIncoterm: incoterm,
    headerFreight: 0,
    headerNonRecoverableTaxes: 0,
    headerExpenses: 0,
    headerDiscounts: 0,
    lines: negotiatedLines,
  };

  // Agrega condições da primeira linha do offer (ou todas)
  const conditionSamples = roundLines[0];
  const conditionGainsSeed = conditionSamples
    ? {
        previousLeadTimeDays: conditionSamples.previousLeadTimeDays,
        newLeadTimeDays: conditionSamples.leadTimeDays,
        previousPaymentTerms: conditionSamples.previousPaymentTerms,
        newPaymentTerms: conditionSamples.paymentTerms,
        previousDeliveryTerms: conditionSamples.previousDeliveryTerms,
        newDeliveryTerms: conditionSamples.deliveryTerms,
        previousMinOrderQty: toNum(conditionSamples.previousMinOrderQty),
        newMinOrderQty: toNum(conditionSamples.minOrderQty),
      }
    : {
        previousLeadTimeDays: offer.initialLeadTimeDays,
        newLeadTimeDays: offer.initialLeadTimeDays,
        previousPaymentTerms: offer.initialPaymentTerms,
        newPaymentTerms: offer.initialPaymentTerms,
        previousDeliveryTerms: offer.initialDeliveryTerms,
        newDeliveryTerms: offer.initialDeliveryTerms,
        previousMinOrderQty: toNum(offer.initialMinOrderQty),
        newMinOrderQty: toNum(offer.initialMinOrderQty),
      };

  const savings = computeNegotiationSavings({
    initial,
    negotiated,
    condition: conditionGainsSeed,
  });

  return {
    offerId,
    roundId: round?.id ?? null,
    roundNumber: round?.roundNumber ?? null,
    savings,
  };
}

export function mapNegotiationError(e: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (
    e instanceof PurchaseQuotationWorkflowError ||
    e instanceof PurchasingInvariantError ||
    e instanceof NegotiationSavingsError ||
    e instanceof PurchaseEvidenceError
  ) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("negotiation round error:", e);
  return { status: 500, body: { error: "Erro na rodada de negociação." } };
}

export type { ConditionGain };
