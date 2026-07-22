/**
 * Serviço de coleta de cotações por fornecedor (OP-15).
 * Fornecedores oficiais via providers read-only.
 * Não adjudica vencedor, não cria PurchaseOrder nem Contas a Pagar.
 */
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import {
  assertPositiveQuantity,
  assertPositiveUnitPrice,
  PurchasingInvariantError,
} from "./purchasingPriceInvariants.js";
import {
  assertCanEditInitialOffer,
  canEditQuotationMeta,
  isPurchaseQuotationCollectionStatus,
  PurchaseQuotationWorkflowError,
  resolvePurchaseQuotationTransition,
} from "./purchaseQuotationWorkflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type PurchaseQuotationActor = {
  userId: string;
  userName?: string | null;
};

const DETAIL_INCLUDE = {
  purchaseRequest: {
    select: { id: true, number: true, status: true, justification: true },
  },
  items: { orderBy: { lineNumber: "asc" as const } },
  suppliers: {
    include: {
      offers: {
        include: {
          items: {
            include: {
              quotationItem: {
                select: {
                  id: true,
                  lineNumber: true,
                  description: true,
                  quantity: true,
                  unit: true,
                  materialCodeSnapshot: true,
                },
              },
            },
          },
        },
      },
    },
    orderBy: { invitedAt: "asc" as const },
  },
  offers: {
    include: {
      quotationSupplier: true,
      items: {
        include: {
          quotationItem: {
            select: {
              id: true,
              lineNumber: true,
              description: true,
              quantity: true,
              unit: true,
            },
          },
        },
      },
    },
  },
  rounds: { select: { id: true, roundNumber: true, status: true }, orderBy: { roundNumber: "asc" as const } },
} satisfies Prisma.PurchaseQuotationInclude;

function toDec(value: unknown): Prisma.Decimal | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new PurchaseQuotationWorkflowError("Valor numérico inválido.", "NUMBER_INVALID");
  }
  return new Prisma.Decimal(n);
}

function toInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new PurchaseQuotationWorkflowError("Inteiro inválido.", "INT_INVALID");
  }
  return n;
}

function toDateOnly(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const s = String(value);
  const d = new Date(s.includes("T") ? s : `${s}T12:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new PurchaseQuotationWorkflowError("Data inválida.", "DATE_INVALID");
  }
  return d;
}

async function negotiationStarted(db: Db, quotationId: string): Promise<boolean> {
  const count = await db.purchaseNegotiationRound.count({ where: { quotationId } });
  return count > 0;
}

export async function listPurchaseQuotations(
  prisma: PrismaClient,
  filter?: { purchaseRequestId?: string; status?: string }
) {
  return prisma.purchaseQuotation.findMany({
    where: {
      ...(filter?.purchaseRequestId ? { purchaseRequestId: filter.purchaseRequestId } : {}),
      ...(filter?.status ? { status: filter.status as never } : {}),
    },
    include: {
      purchaseRequest: { select: { id: true, number: true, status: true } },
      _count: { select: { items: true, suppliers: true, offers: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPurchaseQuotationDetail(prisma: PrismaClient, id: string) {
  return prisma.purchaseQuotation.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
}

export async function updatePurchaseQuotationMeta(
  prisma: PrismaClient,
  id: string,
  input: {
    title?: string | null;
    currency?: string | null;
    notes?: string | null;
    justification?: string | null;
    neededByDate?: string | null;
    expiresAt?: string | null;
  }
) {
  const row = await prisma.purchaseQuotation.findUnique({ where: { id } });
  if (!row) throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
  if (!canEditQuotationMeta(row.status)) {
    throw new PurchaseQuotationWorkflowError(
      "Cotação não pode ser alterada neste status.",
      "QUOTATION_LOCKED"
    );
  }
  if (row.status === "ADJUDICADA") {
    throw new PurchaseQuotationWorkflowError("Cotação adjudicada — fora do escopo OP-15.", "ADJUDICATED");
  }

  return prisma.purchaseQuotation.update({
    where: { id },
    data: {
      ...(input.title !== undefined ? { title: input.title?.trim() || null } : {}),
      ...(input.currency !== undefined
        ? { currency: (input.currency || "BRL").trim().toUpperCase() || "BRL" }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      ...(input.justification !== undefined
        ? { justification: input.justification?.trim() || null }
        : {}),
      ...(input.neededByDate !== undefined ? { neededByDate: toDateOnly(input.neededByDate) } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: toDateOnly(input.expiresAt) } : {}),
    },
    include: DETAIL_INCLUDE,
  });
}

export async function inviteSupplierToQuotation(
  prisma: PrismaClient,
  quotationId: string,
  supplierId: string,
  notes?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const quotation = await tx.purchaseQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation) {
      throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
    }
    if (quotation.status === "CANCELADA" || quotation.status === "ADJUDICADA" || quotation.status === "EXPIRADA") {
      throw new PurchaseQuotationWorkflowError(
        "Não é possível convidar fornecedores neste status.",
        "QUOTATION_LOCKED"
      );
    }

    const reads = createOfficialDataProviders(tx as unknown as PrismaClient);
    const supplier = await reads.suppliers.findById(supplierId);
    if (!supplier) {
      throw new PurchaseQuotationWorkflowError(
        "Fornecedor oficial não encontrado.",
        "SUPPLIER_NOT_FOUND"
      );
    }

    const existing = await tx.purchaseQuotationSupplier.findUnique({
      where: { quotationId_supplierId: { quotationId, supplierId } },
    });
    if (existing) {
      throw new PurchaseQuotationWorkflowError(
        "Fornecedor já convidado nesta cotação.",
        "SUPPLIER_ALREADY_INVITED"
      );
    }

    const invited = await tx.purchaseQuotationSupplier.create({
      data: {
        quotationId,
        supplierId,
        status: "CONVIDADO",
        supplierDisplayNameSnapshot: supplier.displayName,
        supplierDocumentSnapshot: supplier.document,
        notes: notes?.trim() || null,
      },
    });

    await tx.purchaseQuotationOffer.create({
      data: {
        quotationId,
        quotationSupplierId: invited.id,
        status: "RASCUNHO",
        currency: quotation.currency || "BRL",
      },
    });

    if (quotation.status === "RASCUNHO" && isPurchaseQuotationCollectionStatus(quotation.status)) {
      const next = resolvePurchaseQuotationTransition("RASCUNHO", "MARK_SENT");
      await tx.purchaseQuotation.update({ where: { id: quotationId }, data: { status: next } });
    }

    return tx.purchaseQuotation.findUniqueOrThrow({
      where: { id: quotationId },
      include: DETAIL_INCLUDE,
    });
  });
}

export type UpsertOfferItemInput = {
  quotationItemId: string;
  initialUnitPrice: number;
  initialQuantity?: number | null;
  initialLeadTimeDays?: number | null;
  initialFreightValue?: number | null;
  initialNonRecoverableTaxes?: number | null;
  initialExpenses?: number | null;
  initialDiscounts?: number | null;
  initialMinOrderQty?: number | null;
  initialNotes?: string | null;
};

export type UpsertOfferInput = {
  currency?: string | null;
  initialPaymentTerms?: string | null;
  initialDeliveryTerms?: string | null;
  initialFreightValue?: number | null;
  initialNonRecoverableTaxes?: number | null;
  initialExpenses?: number | null;
  initialDiscounts?: number | null;
  initialMinOrderQty?: number | null;
  initialValidityDate?: string | null;
  initialLeadTimeDays?: number | null;
  notes?: string | null;
  items: UpsertOfferItemInput[];
};

export async function upsertSupplierOffer(
  prisma: PrismaClient,
  quotationId: string,
  quotationSupplierId: string,
  input: UpsertOfferInput
) {
  return prisma.$transaction(async (tx) => {
    const quotation = await tx.purchaseQuotation.findUnique({ where: { id: quotationId } });
    if (!quotation) {
      throw new PurchaseQuotationWorkflowError("Cotação não encontrada.", "NOT_FOUND");
    }
    if (quotation.status === "CANCELADA" || quotation.status === "ADJUDICADA") {
      throw new PurchaseQuotationWorkflowError("Cotação bloqueada.", "QUOTATION_LOCKED");
    }

    const qs = await tx.purchaseQuotationSupplier.findFirst({
      where: { id: quotationSupplierId, quotationId },
    });
    if (!qs) {
      throw new PurchaseQuotationWorkflowError("Fornecedor convidado não encontrado.", "NOT_FOUND");
    }

    let offer = await tx.purchaseQuotationOffer.findUnique({
      where: {
        quotationId_quotationSupplierId: { quotationId, quotationSupplierId },
      },
      include: { items: true },
    });

    const negoStarted = await negotiationStarted(tx, quotationId);
    if (offer) {
      assertCanEditInitialOffer({
        offerStatus: offer.status,
        negotiationStarted: negoStarted,
      });
    }

    if (!Array.isArray(input.items) || input.items.length === 0) {
      throw new PurchaseQuotationWorkflowError(
        "Informe ao menos um item na oferta.",
        "OFFER_ITEMS_REQUIRED"
      );
    }

    const demandItems = await tx.purchaseQuotationItem.findMany({
      where: { quotationId },
      select: { id: true },
    });
    const demandIds = new Set(demandItems.map((d) => d.id));
    for (const it of input.items) {
      if (!demandIds.has(it.quotationItemId)) {
        throw new PurchaseQuotationWorkflowError(
          "Item da oferta não pertence à cotação.",
          "OFFER_ITEM_MISMATCH"
        );
      }
      assertPositiveUnitPrice(Number(it.initialUnitPrice), "initialUnitPrice");
      if (it.initialQuantity != null) {
        assertPositiveQuantity(Number(it.initialQuantity), "initialQuantity");
      }
    }

    const headerData = {
      currency: (input.currency || quotation.currency || "BRL").trim().toUpperCase() || "BRL",
      initialPaymentTerms: input.initialPaymentTerms?.trim() || null,
      initialDeliveryTerms: input.initialDeliveryTerms?.trim() || null,
      initialFreightValue: toDec(input.initialFreightValue),
      initialNonRecoverableTaxes: toDec(input.initialNonRecoverableTaxes),
      initialExpenses: toDec(input.initialExpenses),
      initialDiscounts: toDec(input.initialDiscounts),
      initialMinOrderQty: toDec(input.initialMinOrderQty),
      initialValidityDate: toDateOnly(input.initialValidityDate),
      initialLeadTimeDays: toInt(input.initialLeadTimeDays),
      notes: input.notes?.trim() || null,
    };

    if (!offer) {
      offer = await tx.purchaseQuotationOffer.create({
        data: {
          quotationId,
          quotationSupplierId,
          status: "RASCUNHO",
          ...headerData,
        },
        include: { items: true },
      });
    } else {
      // Congela initial*: só atualiza se ainda editável (já assertado).
      offer = await tx.purchaseQuotationOffer.update({
        where: { id: offer.id },
        data: headerData,
        include: { items: true },
      });
    }

    for (const it of input.items) {
      const itemData = {
        initialUnitPrice: toDec(it.initialUnitPrice)!,
        initialQuantity: toDec(it.initialQuantity),
        initialLeadTimeDays: toInt(it.initialLeadTimeDays),
        initialFreightValue: toDec(it.initialFreightValue),
        initialNonRecoverableTaxes: toDec(it.initialNonRecoverableTaxes),
        initialExpenses: toDec(it.initialExpenses),
        initialDiscounts: toDec(it.initialDiscounts),
        initialMinOrderQty: toDec(it.initialMinOrderQty),
        initialNotes: it.initialNotes?.trim() || null,
      };
      await tx.purchaseQuotationOfferItem.upsert({
        where: {
          offerId_quotationItemId: {
            offerId: offer.id,
            quotationItemId: it.quotationItemId,
          },
        },
        create: {
          offerId: offer.id,
          quotationItemId: it.quotationItemId,
          ...itemData,
        },
        update: itemData,
      });
    }

    return tx.purchaseQuotation.findUniqueOrThrow({
      where: { id: quotationId },
      include: DETAIL_INCLUDE,
    });
  });
}

/**
 * Registra proposta recebida: congela initial* (status RECEBIDA).
 * Não escolhe vencedor nem gera PO.
 */
export async function markOfferProposalReceived(
  prisma: PrismaClient,
  quotationId: string,
  offerId: string,
  notes?: string | null
) {
  return prisma.$transaction(async (tx) => {
    const offer = await tx.purchaseQuotationOffer.findFirst({
      where: { id: offerId, quotationId },
      include: { items: true, quotationSupplier: true },
    });
    if (!offer) {
      throw new PurchaseQuotationWorkflowError("Oferta não encontrada.", "NOT_FOUND");
    }
    if (offer.status === "RECEBIDA") {
      return tx.purchaseQuotation.findUniqueOrThrow({
        where: { id: quotationId },
        include: DETAIL_INCLUDE,
      });
    }
    if (offer.status !== "RASCUNHO") {
      throw new PurchaseQuotationWorkflowError(
        "Só ofertas em rascunho podem ser registradas como recebidas.",
        "OFFER_STATUS"
      );
    }
    if (offer.items.length === 0) {
      throw new PurchaseQuotationWorkflowError(
        "Registre preços dos itens antes de marcar a proposta como recebida.",
        "OFFER_ITEMS_REQUIRED"
      );
    }

    const negoStarted = await negotiationStarted(tx, quotationId);
    assertCanEditInitialOffer({
      offerStatus: offer.status,
      negotiationStarted: negoStarted,
    });

    await tx.purchaseQuotationOffer.update({
      where: { id: offer.id },
      data: {
        status: "RECEBIDA",
        submittedAt: new Date(),
        proposalReceived: true,
        proposalReceivedAt: new Date(),
        proposalReceivedNotes: notes?.trim() || null,
      },
    });

    await tx.purchaseQuotationSupplier.update({
      where: { id: offer.quotationSupplierId },
      data: { status: "RESPONDIDO", respondedAt: new Date() },
    });

    const quotation = await tx.purchaseQuotation.findUniqueOrThrow({ where: { id: quotationId } });
    if (
      isPurchaseQuotationCollectionStatus(quotation.status) &&
      (quotation.status === "RASCUNHO" || quotation.status === "ENVIADA")
    ) {
      const next = resolvePurchaseQuotationTransition(quotation.status, "MARK_IN_ANALYSIS");
      await tx.purchaseQuotation.update({ where: { id: quotationId }, data: { status: next } });
    }

    return tx.purchaseQuotation.findUniqueOrThrow({
      where: { id: quotationId },
      include: DETAIL_INCLUDE,
    });
  });
}

export function mapPurchasingError(e: unknown): { status: number; body: { error: string; code?: string } } {
  if (e instanceof PurchaseQuotationWorkflowError || e instanceof PurchasingInvariantError) {
    const status = e.code === "NOT_FOUND" || e.code === "SUPPLIER_NOT_FOUND" ? 404 : 400;
    return { status, body: { error: e.message, code: e.code } };
  }
  console.error("purchase-quotation error:", e);
  return { status: 500, body: { error: "Erro na cotação de compra." } };
}

export { DETAIL_INCLUDE as purchaseQuotationDetailInclude };
