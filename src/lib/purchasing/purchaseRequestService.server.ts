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

    if (action === "SUBMIT") {
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

export async function approvePurchaseRequest(
  prisma: PrismaClient,
  id: string,
  actor: PurchaseRequestActor,
  notes?: string | null
) {
  return applyTransition(prisma, id, "APPROVE", actor, null, notes);
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
