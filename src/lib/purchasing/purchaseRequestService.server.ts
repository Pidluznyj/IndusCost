/**
 * Serviço de workflow de solicitações de compra (OP-14).
 * Consome Material / CostCenter / Project via providers read-only.
 * Não cria PurchaseOrder nem Contas a Pagar.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { createOfficialDataProviders } from "@/src/lib/supply-chain/officialDataProviders.server.js";
import {
  assertReasonRequired,
  canEditPurchaseRequestContent,
  isPurchaseRequestStatus,
  resolvePurchaseRequestTransition,
  type PurchaseRequestWorkflowAction,
  type PurchaseRequestWorkflowStatus,
  PurchaseRequestWorkflowError,
} from "./purchaseRequestWorkflow.js";

type Db = PrismaClient | Prisma.TransactionClient;

export type PurchaseRequestActor = {
  userId: string;
  userName?: string | null;
};

const DETAIL_INCLUDE = {
  defaultCostCenter: true,
  project: { select: { id: true, code: true, title: true, status: true } },
  items: {
    include: { material: true, costCenter: true },
    orderBy: { id: "asc" as const },
  },
  historyEvents: { orderBy: { createdAt: "desc" as const }, take: 100 },
  quotations: { select: { id: true, code: true, status: true }, orderBy: { createdAt: "desc" as const } },
  quotes: { orderBy: { createdAt: "asc" as const } },
  purchaseOrders: {
    select: { id: true, code: true, status: true, totalAmountSnapshot: true, supplierDisplayNameSnapshot: true, createdAt: true },
    orderBy: { createdAt: "desc" as const },
  },
} satisfies Prisma.PurchaseRequestInclude;

async function writeHistory(
  db: Db,
  input: {
    purchaseRequestId: string;
    action: string;
    fromStatus?: PurchaseRequestWorkflowStatus | null;
    toStatus?: PurchaseRequestWorkflowStatus | null;
    reason?: string | null;
    notes?: string | null;
    actor?: PurchaseRequestActor | null;
    metaJson?: Prisma.InputJsonValue;
  }
) {
  await db.purchaseRequestHistoryEvent.create({
    data: {
      purchaseRequestId: input.purchaseRequestId,
      action: input.action,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      userId: input.actor?.userId ?? null,
      userName: input.actor?.userName ?? null,
      metaJson: input.metaJson,
    },
  });
}

export async function getPurchaseRequestDetail(prisma: PrismaClient, id: string) {
  return prisma.purchaseRequest.findUnique({
    where: { id },
    include: DETAIL_INCLUDE,
  });
}

export async function listPurchaseRequestHistory(prisma: PrismaClient, id: string) {
  return prisma.purchaseRequestHistoryEvent.findMany({
    where: { purchaseRequestId: id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

async function applyTransition(
  prisma: PrismaClient,
  id: string,
  action: PurchaseRequestWorkflowAction,
  actor: PurchaseRequestActor,
  reason?: string | null,
  notes?: string | null,
  extra?: (tx: Prisma.TransactionClient, next: PurchaseRequestWorkflowStatus) => Promise<Record<string, unknown> | void>
) {
  const normalizedReason = assertReasonRequired(action, reason);

  return prisma.$transaction(async (tx) => {
    const row = await tx.purchaseRequest.findUnique({ where: { id } });
    if (!row) {
      throw new PurchaseRequestWorkflowError("Solicitação não encontrada.", "NOT_FOUND");
    }
    if (!isPurchaseRequestStatus(row.status)) {
      throw new PurchaseRequestWorkflowError("Status atual inválido.", "INVALID_STATUS");
    }
    const next = resolvePurchaseRequestTransition(row.status, action);
    const meta = (await extra?.(tx, next)) ?? undefined;

    const updated = await tx.purchaseRequest.update({
      where: { id },
      data: { status: next },
      include: DETAIL_INCLUDE,
    });

    await writeHistory(tx, {
      purchaseRequestId: id,
      action,
      fromStatus: row.status,
      toStatus: next,
      reason: normalizedReason || null,
      notes: notes ?? null,
      actor,
      metaJson: meta as Prisma.InputJsonValue | undefined,
    });

    // Aprovação do gestor nasce no SEND_TO_APPROVAL (decisão de compra),
    // não mais no SUBMIT — a fila inicial é do comprador (fluxo simplificado).
    if (action === "SEND_TO_APPROVAL") {
      await tx.purchaseApproval.create({
        data: {
          targetType: "REQUEST",
          status: "PENDENTE",
          purchaseRequestId: id,
          requestedByUserId: actor.userId,
          reason: notes ?? null,
        },
      });
    }
    if (action === "APPROVE" || action === "REJECT") {
      const pending = await tx.purchaseApproval.findFirst({
        where: { purchaseRequestId: id, targetType: "REQUEST", status: "PENDENTE" },
        orderBy: { createdAt: "desc" },
      });
      if (pending) {
        await tx.purchaseApproval.update({
          where: { id: pending.id },
          data: {
            status: action === "APPROVE" ? "APROVADA" : "REJEITADA",
            decidedByUserId: actor.userId,
            decidedAt: new Date(),
            reason: normalizedReason || null,
            notes: notes ?? null,
          },
        });
      }
    }

    return updated;
  });
}

export async function submitPurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor
) {
  return applyTransition(prisma, id, "SUBMIT", actor);
}

/**
 * Aprovação do gestor: no MESMO ato, o pedido de compra é emitido a partir do
 * orçamento vencedor (PurchaseOrder APROVADO com snapshots do fornecedor).
 * "O gestor aprova e o pedido é emitido" — um passo, tudo registrado.
 */
export async function approvePurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  notes?: string | null
) {
  return applyTransition(prisma, id, "APPROVE", actor, null, notes, async (tx) => {
    const winner = await tx.purchaseRequestQuote.findFirst({
      where: { purchaseRequestId: id, isWinner: true },
    });
    if (!winner) {
      throw new PurchaseRequestWorkflowError(
        "Nenhum orçamento vencedor marcado — não há o que aprovar.",
        "NO_WINNER_QUOTE"
      );
    }
    if (!winner.supplierId) {
      throw new PurchaseRequestWorkflowError(
        "Orçamento vencedor sem fornecedor oficial vinculado.",
        "WINNER_WITHOUT_SUPPLIER"
      );
    }
    const detail = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: { items: { where: { lineStatus: "ABERTA" }, orderBy: { id: "asc" } } },
    });

    const year = new Date().getFullYear();
    const prefix = `PC-${year}-`;
    const last = await tx.purchaseOrder.findFirst({
      where: { code: { startsWith: prefix } },
      orderBy: { code: "desc" },
      select: { code: true },
    });
    let seq = 1;
    if (last?.code) {
      const n = Number.parseInt(last.code.slice(prefix.length), 10);
      if (Number.isFinite(n)) seq = n + 1;
    }
    const code = `${prefix}${String(seq).padStart(4, "0")}`;

    const order = await tx.purchaseOrder.create({
      data: {
        code,
        status: "APROVADO",
        purchaseRequestId: id,
        supplierId: winner.supplierId,
        supplierDisplayNameSnapshot: winner.supplierNameSnapshot,
        supplierDocumentSnapshot: winner.supplierDocumentSnapshot,
        paymentTermsSnapshot: winner.paymentTerms,
        leadTimeDaysSnapshot: winner.deliveryDays,
        totalAmountSnapshot: winner.totalValue,
        awardJustificationSnapshot: winner.winnerReason,
        items: {
          create: detail.items.map((it, idx) => ({
            lineNumber: idx + 1,
            purchaseRequestItemId: it.id,
            materialId: it.materialId,
            description: it.description,
            quantityOrdered: it.quantity,
            unit: it.unit,
            // Fluxo simples: o orçamento traz VALOR TOTAL, não preço por item.
            // Os totais por linha ficam zerados de propósito; o valor do pedido
            // é o totalAmountSnapshot do cabeçalho.
            unitPriceSnapshot: 0,
            lineTotalSnapshot: 0,
          })),
        },
      },
      select: { id: true, code: true },
    });

    return { purchaseOrderId: order.id, purchaseOrderCode: order.code };
  });
}

export async function rejectPurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  reason: string
) {
  return applyTransition(prisma, id, "REJECT", actor, reason);
}

export async function cancelPurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  reason: string
) {
  return applyTransition(prisma, id, "CANCEL", actor, reason);
}

/** Comprador valida/assume a solicitação e abre a orçamentação. */
export async function validatePurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  notes?: string | null
) {
  return applyTransition(prisma, id, "VALIDATE", actor, null, notes, async (tx) => {
    await tx.purchaseRequest.update({
      where: { id },
      data: {
        buyerUserId: actor.userId,
        buyerName: actor.userName ?? null,
        buyerValidatedAt: new Date(),
      },
    });
    return { buyerUserId: actor.userId };
  });
}

/** Envia a decisão de compra (orçamento vencedor) para aprovação do gestor. */
export async function sendPurchaseRequestToApproval(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  notes?: string | null
) {
  return applyTransition(prisma, id, "SEND_TO_APPROVAL", actor, null, notes, async (tx) => {
    const quotes = await tx.purchaseRequestQuote.findMany({
      where: { purchaseRequestId: id },
      select: { id: true, isWinner: true },
    });
    if (quotes.length === 0) {
      throw new PurchaseRequestWorkflowError(
        "Registre ao menos um orçamento antes de enviar para aprovação.",
        "NO_QUOTES"
      );
    }
    const winners = quotes.filter((q) => q.isWinner);
    if (winners.length !== 1) {
      throw new PurchaseRequestWorkflowError(
        "Marque exatamente um orçamento vencedor antes de enviar para aprovação.",
        "NO_WINNER_QUOTE"
      );
    }
    return { quotesCount: quotes.length };
  });
}

/** Reabre a orçamentação após rejeição do gestor (retrabalho do comprador). */
export async function reopenPurchaseRequestQuoting(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor
) {
  return applyTransition(prisma, id, "REOPEN_QUOTING", actor);
}

export async function reopenPurchaseRequestDraft(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor
) {
  return applyTransition(prisma, id, "REOPEN_DRAFT", actor);
}

/**
 * Encaminha para cotação SC: cria PurchaseQuotation em RASCUNHO + itens,
 * sem criar PurchaseOrder nem AP.
 */
export async function forwardPurchaseRequestToQuotation(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  notes?: string | null
) {
  return applyTransition(prisma, id, "FORWARD_TO_QUOTATION", actor, null, notes, async (tx) => {
    const detail = await tx.purchaseRequest.findUniqueOrThrow({
      where: { id },
      include: { items: { where: { lineStatus: "ABERTA" }, orderBy: { id: "asc" } } },
    });
    const openItems = detail.items;
    if (openItems.length === 0) {
      throw new PurchaseRequestWorkflowError(
        "Solicitação sem itens abertos para cotação.",
        "NO_OPEN_ITEMS"
      );
    }

    const code = `SC-${detail.number}-${Date.now().toString(36).toUpperCase()}`;
    const quotation = await tx.purchaseQuotation.create({
      data: {
        code,
        purchaseRequestId: id,
        status: "RASCUNHO",
        title: `Cotação da SC ${detail.number}`,
        justification: detail.justification,
        notes: notes ?? null,
        requestedByUserId: actor.userId,
        items: {
          create: openItems.map((it, idx) => ({
            lineNumber: idx + 1,
            purchaseRequestItemId: it.id,
            materialId: it.materialId,
            materialCodeSnapshot: null,
            materialDescriptionSnapshot: it.description,
            materialUnitSnapshot: it.unit,
            description: it.description,
            quantity: it.quantity,
            unit: it.unit,
            notes: it.notes,
          })),
        },
      },
      include: { items: true },
    });

    // Snapshots oficiais de MP via provider read-only
    const reads = createOfficialDataProviders(tx as unknown as PrismaClient);
    for (const qItem of quotation.items) {
      if (!qItem.materialId) continue;
      const mat = await reads.materials.findById(qItem.materialId);
      if (!mat) continue;
      await tx.purchaseQuotationItem.update({
        where: { id: qItem.id },
        data: {
          materialCodeSnapshot: mat.code,
          materialDescriptionSnapshot: mat.description,
          materialUnitSnapshot: mat.unit,
        },
      });
    }

    return { quotationId: quotation.id, quotationCode: quotation.code };
  });
}

export function assertContentEditable(status: string): void {
  if (!isPurchaseRequestStatus(status) || !canEditPurchaseRequestContent(status)) {
    throw new PurchaseRequestWorkflowError(
      "Conteúdo só pode ser editado em RASCUNHO ou REJEITADA. Use as ações de workflow.",
      "CONTENT_LOCKED"
    );
  }
}

export async function resolveOptionalProjectSnapshots(
  prisma: PrismaClient,
  projectId: string | null | undefined
): Promise<{
  projectId: string | null;
  projectCodeSnapshot: string | null;
  projectTitleSnapshot: string | null;
}> {
  if (!projectId) {
    return { projectId: null, projectCodeSnapshot: null, projectTitleSnapshot: null };
  }
  const reads = createOfficialDataProviders(prisma);
  const project = await reads.projects.findById(projectId);
  if (!project) {
    throw new PurchaseRequestWorkflowError("Projeto oficial não encontrado.", "PROJECT_NOT_FOUND");
  }
  return {
    projectId: project.id,
    projectCodeSnapshot: project.code,
    projectTitleSnapshot: project.title,
  };
}

export { DETAIL_INCLUDE as purchaseRequestDetailInclude };
