/**
 * Orçamentos simples da solicitação de compra (fluxo direto do comprador).
 *
 * Regras:
 * - Orçamentos só podem ser editados com a solicitação EM_COTACAO.
 * - Fornecedor vem da lista oficial financeira (ACTIVE); nome/documento viram
 *   snapshot para o histórico não depender do cadastro.
 * - Vencedor é único por solicitação e exige justificativa — é o que o gestor
 *   aprova e o que abastece o pedido emitido.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { PurchaseRequestWorkflowError } from "./purchaseRequestWorkflow.js";
import type { PurchaseRequestActor } from "./purchaseRequestService.server.js";

const QUOTE_EDITABLE_STATUS = "EM_COTACAO";

async function assertQuotingOpen(
  db: PrismaClient | Prisma.TransactionClient,
  purchaseRequestId: string
) {
  const row = await db.purchaseRequest.findUnique({
    where: { id: purchaseRequestId },
    select: { id: true, status: true },
  });
  if (!row) {
    throw new PurchaseRequestWorkflowError("Solicitação não encontrada.", "NOT_FOUND");
  }
  if (row.status !== QUOTE_EDITABLE_STATUS) {
    throw new PurchaseRequestWorkflowError(
      "Orçamentos só podem ser alterados com a solicitação em orçamentação.",
      "QUOTING_LOCKED"
    );
  }
  return row;
}

export type QuoteInput = {
  supplierId: string;
  totalValue: number;
  paymentTerms?: string | null;
  deliveryDays?: number | null;
  validUntil?: string | null;
  notes?: string | null;
};

function normalizeQuoteInput(input: QuoteInput) {
  const totalValue = Number(input.totalValue);
  if (!Number.isFinite(totalValue) || totalValue <= 0) {
    throw new PurchaseRequestWorkflowError("Valor total do orçamento inválido.", "INVALID_VALUE");
  }
  const deliveryDays =
    input.deliveryDays != null && input.deliveryDays !== ("" as never)
      ? Number(input.deliveryDays)
      : null;
  if (deliveryDays != null && (!Number.isInteger(deliveryDays) || deliveryDays < 0)) {
    throw new PurchaseRequestWorkflowError("Prazo de entrega inválido.", "INVALID_DELIVERY");
  }
  return {
    totalValue,
    deliveryDays,
    paymentTerms: input.paymentTerms?.trim() || null,
    validUntil: input.validUntil ? new Date(input.validUntil) : null,
    notes: input.notes?.trim() || null,
  };
}

async function resolveSupplierSnapshot(
  db: PrismaClient | Prisma.TransactionClient,
  supplierId: string
) {
  const supplier = await db.financialSupplier.findUnique({
    where: { id: supplierId },
    select: { id: true, displayName: true, document: true, status: true },
  });
  if (!supplier) {
    throw new PurchaseRequestWorkflowError("Fornecedor não encontrado.", "SUPPLIER_NOT_FOUND");
  }
  if (supplier.status !== "ACTIVE") {
    throw new PurchaseRequestWorkflowError(
      `Fornecedor ${supplier.displayName} está inativo.`,
      "SUPPLIER_INACTIVE"
    );
  }
  return supplier;
}

export async function addPurchaseRequestQuote(
  prisma: PrismaClient,
  purchaseRequestId: string,
  input: QuoteInput,
  actor: PurchaseRequestActor
) {
  await assertQuotingOpen(prisma, purchaseRequestId);
  const supplier = await resolveSupplierSnapshot(prisma, input.supplierId);
  const data = normalizeQuoteInput(input);
  return prisma.purchaseRequestQuote.create({
    data: {
      purchaseRequestId,
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.displayName,
      supplierDocumentSnapshot: supplier.document ?? null,
      ...data,
      createdByUserId: actor.userId,
      createdByName: actor.userName ?? null,
    },
  });
}

export async function updatePurchaseRequestQuote(
  prisma: PrismaClient,
  purchaseRequestId: string,
  quoteId: string,
  input: QuoteInput,
  _actor: PurchaseRequestActor
) {
  await assertQuotingOpen(prisma, purchaseRequestId);
  const existing = await prisma.purchaseRequestQuote.findFirst({
    where: { id: quoteId, purchaseRequestId },
  });
  if (!existing) {
    throw new PurchaseRequestWorkflowError("Orçamento não encontrado.", "QUOTE_NOT_FOUND");
  }
  const supplier = await resolveSupplierSnapshot(prisma, input.supplierId);
  const data = normalizeQuoteInput(input);
  return prisma.purchaseRequestQuote.update({
    where: { id: quoteId },
    data: {
      supplierId: supplier.id,
      supplierNameSnapshot: supplier.displayName,
      supplierDocumentSnapshot: supplier.document ?? null,
      ...data,
    },
  });
}

export async function deletePurchaseRequestQuote(
  prisma: PrismaClient,
  purchaseRequestId: string,
  quoteId: string
) {
  await assertQuotingOpen(prisma, purchaseRequestId);
  const existing = await prisma.purchaseRequestQuote.findFirst({
    where: { id: quoteId, purchaseRequestId },
    select: { id: true },
  });
  if (!existing) {
    throw new PurchaseRequestWorkflowError("Orçamento não encontrado.", "QUOTE_NOT_FOUND");
  }
  await prisma.purchaseRequestQuote.delete({ where: { id: quoteId } });
}

/** Marca o vencedor (único) com justificativa obrigatória. */
export async function markPurchaseRequestQuoteWinner(
  prisma: PrismaClient,
  purchaseRequestId: string,
  quoteId: string,
  winnerReason: string,
  _actor: PurchaseRequestActor
) {
  const reason = String(winnerReason ?? "").trim();
  if (!reason) {
    throw new PurchaseRequestWorkflowError(
      "Justifique a escolha do fornecedor vencedor.",
      "WINNER_REASON_REQUIRED"
    );
  }
  return prisma.$transaction(async (tx) => {
    await assertQuotingOpen(tx, purchaseRequestId);
    const quote = await tx.purchaseRequestQuote.findFirst({
      where: { id: quoteId, purchaseRequestId },
      select: { id: true },
    });
    if (!quote) {
      throw new PurchaseRequestWorkflowError("Orçamento não encontrado.", "QUOTE_NOT_FOUND");
    }
    await tx.purchaseRequestQuote.updateMany({
      where: { purchaseRequestId, isWinner: true },
      data: { isWinner: false, winnerReason: null },
    });
    return tx.purchaseRequestQuote.update({
      where: { id: quoteId },
      data: { isWinner: true, winnerReason: reason },
    });
  });
}
