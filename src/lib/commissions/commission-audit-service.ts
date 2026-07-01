import type { PrismaClient } from "@prisma/client";
import { buildAuditIssueKey } from "./commission-calculation-hash.js";
import type {
  CommissionAuditIssueDraft,
  CommissionOrderSourceBundle,
  CommissionLinkedNfeSource,
} from "./commission-types.js";
import { isActiveCommissionStatus, isPaidCommissionStatus } from "./commission-calculation-hash.js";

export function buildOrderWithoutSellerIssue(order: CommissionOrderSourceBundle): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "ORDER_WITHOUT_SELLER",
      entityType: "SalesOrder",
      entityId: order.localOrderId,
    }),
    severity: "WARNING",
    type: "ORDER_WITHOUT_SELLER",
    entityType: "SalesOrder",
    entityId: order.localOrderId,
    message: `Pedido ${order.orderCode} sem vendedor (externalSellerId/responsible).`,
    metadataJson: { orderCode: order.orderCode, nomusOrderId: order.nomusOrderId },
  };
}

export function buildOrderWithoutRepresentativeIssue(
  order: CommissionOrderSourceBundle
): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "ORDER_WITHOUT_REPRESENTATIVE",
      entityType: "SalesOrder",
      entityId: order.localOrderId,
    }),
    severity: "INFO",
    type: "ORDER_WITHOUT_REPRESENTATIVE",
    entityType: "SalesOrder",
    entityId: order.localOrderId,
    message: `Pedido ${order.orderCode} sem representante identificado no payload Nomus.`,
    metadataJson: { orderCode: order.orderCode },
  };
}

export function buildNoCommissionRuleIssue(input: {
  order: CommissionOrderSourceBundle;
  itemId: string;
  beneficiaryType: string;
}): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "NO_COMMISSION_RULE",
      entityType: "SalesOrderItem",
      entityId: input.itemId,
    }),
    severity: "WARNING",
    type: "NO_COMMISSION_RULE",
    entityType: "SalesOrderItem",
    entityId: input.itemId,
    message: `Sem regra de comissão para ${input.beneficiaryType} no pedido ${input.order.orderCode}.`,
    metadataJson: {
      orderCode: input.order.orderCode,
      beneficiaryType: input.beneficiaryType,
    },
  };
}

export function buildNfeWithoutOutputDocumentIssue(
  order: CommissionOrderSourceBundle,
  nfe: CommissionLinkedNfeSource
): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "NFE_WITHOUT_OUTPUT_DOCUMENT",
      entityType: "NomusNfe",
      entityId: String(nfe.nfeExternalId),
    }),
    severity: "WARNING",
    type: "NFE_WITHOUT_OUTPUT_DOCUMENT",
    entityType: "NomusNfe",
    entityId: String(nfe.nfeExternalId),
    message: `NF-e ${nfe.nfeNumber ?? nfe.nfeExternalId} autorizada sem Documento de Saída local vinculado.`,
    metadataJson: { orderCode: order.orderCode, nfeExternalId: nfe.nfeExternalId },
  };
}

export function buildNfeWithoutReceivableIssue(
  order: CommissionOrderSourceBundle,
  nfe: CommissionLinkedNfeSource
): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "NFE_WITHOUT_RECEIVABLE",
      entityType: "NomusNfe",
      entityId: String(nfe.nfeExternalId),
    }),
    severity: "WARNING",
    type: "NFE_WITHOUT_RECEIVABLE",
    entityType: "NomusNfe",
    entityId: String(nfe.nfeExternalId),
    message: `NF-e ${nfe.nfeNumber ?? nfe.nfeExternalId} sem títulos de Contas a Receber vinculados.`,
    metadataJson: { orderCode: order.orderCode, nfeExternalId: nfe.nfeExternalId },
  };
}

export function buildCancelledNfeWithActiveCommissionIssue(input: {
  nfeExternalId: number;
  recordId: string;
  orderCode: string | null;
}): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "CANCELLED_NFE_WITH_ACTIVE_COMMISSION",
      entityType: "CommissionRecord",
      entityId: input.recordId,
    }),
    severity: "CRITICAL",
    type: "CANCELLED_NFE_WITH_ACTIVE_COMMISSION",
    entityType: "CommissionRecord",
    entityId: input.recordId,
    message: `NF-e cancelada ${input.nfeExternalId} com comissão ativa no pedido ${input.orderCode ?? "?"}.`,
    metadataJson: { nfeExternalId: input.nfeExternalId },
  };
}

export function buildReceivedWithoutReleaseIssue(input: {
  recordId: string;
  receivableId: number;
}): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "RECEIVED_WITHOUT_RELEASE",
      entityType: "CommissionRecord",
      entityId: input.recordId,
    }),
    severity: "WARNING",
    type: "RECEIVED_WITHOUT_RELEASE",
    entityType: "CommissionRecord",
    entityId: input.recordId,
    message: `Conta a receber ${input.receivableId} com recebimento sem liberação proporcional de comissão.`,
    metadataJson: { receivableId: input.receivableId },
  };
}

export function buildPaidWithoutReleaseIssue(recordId: string): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "PAID_WITHOUT_RELEASE",
      entityType: "CommissionRecord",
      entityId: recordId,
    }),
    severity: "CRITICAL",
    type: "PAID_WITHOUT_RELEASE",
    entityType: "CommissionRecord",
    entityId: recordId,
    message: "Comissão paga ou parcialmente paga sem valor liberado correspondente.",
    metadataJson: null,
  };
}

export function buildManualReviewRequiredIssue(input: {
  recordId: string;
  reason: string;
}): CommissionAuditIssueDraft {
  return {
    issueKey: buildAuditIssueKey({
      type: "MANUAL_REVIEW_REQUIRED",
      entityType: "CommissionRecord",
      entityId: input.recordId,
    }),
    severity: "WARNING",
    type: "MANUAL_REVIEW_REQUIRED",
    entityType: "CommissionRecord",
    entityId: input.recordId,
    message: input.reason,
    metadataJson: null,
  };
}

export function collectOrderAuditIssues(order: CommissionOrderSourceBundle): CommissionAuditIssueDraft[] {
  const issues: CommissionAuditIssueDraft[] = [];
  if (order.seller.nomusSellerId == null && !order.seller.responsibleName) {
    issues.push(buildOrderWithoutSellerIssue(order));
  }
  if (order.representative.nomusRepresentativeId == null && !order.representative.name) {
    issues.push(buildOrderWithoutRepresentativeIssue(order));
  }
  for (const nfe of order.authorizedOutputNfes) {
    const docs = order.outputDocumentsByNfeId.get(nfe.nfeExternalId) ?? [];
    if (docs.length === 0) issues.push(buildNfeWithoutOutputDocumentIssue(order, nfe));
    const ar = order.receivablesByNfeId.get(nfe.nfeExternalId) ?? [];
    if (ar.length === 0) issues.push(buildNfeWithoutReceivableIssue(order, nfe));
  }
  return issues;
}

export async function upsertCommissionAuditIssues(
  db: Pick<PrismaClient, "commissionAuditIssue">,
  drafts: CommissionAuditIssueDraft[]
): Promise<number> {
  let created = 0;
  for (const draft of drafts) {
    const existing = await db.commissionAuditIssue.findFirst({
      where: {
        type: draft.type,
        entityType: draft.entityType,
        entityId: draft.entityId,
        resolved: false,
      },
      select: { id: true },
    });
    if (existing) continue;
    await db.commissionAuditIssue.create({
      data: {
        severity: draft.severity,
        type: draft.type,
        entityType: draft.entityType,
        entityId: draft.entityId,
        message: draft.message,
        metadataJson: (draft.metadataJson ?? undefined) as import("@prisma/client").Prisma.InputJsonValue | undefined,
      },
    });
    created += 1;
  }
  return created;
}

export function shouldFlagPaidWithoutRelease(input: {
  status: string;
  releasedAmount: number;
  paidAmount: number;
}): boolean {
  if (!isPaidCommissionStatus(input.status)) return false;
  return input.releasedAmount <= 0 && input.paidAmount > 0;
}

export function shouldFlagCancelledNfeWithActiveCommission(input: {
  nfe: CommissionLinkedNfeSource;
  recordStatus: string;
}): boolean {
  return input.nfe.isCancelled && isActiveCommissionStatus(input.recordStatus);
}
