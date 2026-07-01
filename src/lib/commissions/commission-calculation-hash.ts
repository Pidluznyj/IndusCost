import { createHash } from "node:crypto";
import type {
  CommissionOrderSourceBundle,
  CommissionRecordDraft,
  CommissionRuleMatchContext,
} from "./commission-types.js";

export function buildCommissionCalculationHash(input: {
  nomusOrderId: number | null;
  orderCode: string | null;
  nomusOrderItemId: number | null;
  nomusNfeId: number | null;
  nomusOutputDocumentId: number | null;
  commissionPersonId: string;
  beneficiaryType: string;
  originStage: string;
}): string {
  const payload = [
    input.nomusOrderId ?? "",
    input.orderCode ?? "",
    input.nomusOrderItemId ?? "",
    input.nomusNfeId ?? "",
    input.nomusOutputDocumentId ?? "",
    input.commissionPersonId,
    input.beneficiaryType,
    input.originStage,
  ].join("|");
  return createHash("sha256").update(payload).digest("hex");
}

export function buildPaymentScheduleKey(input: {
  calculationHash: string;
  source: string;
  nomusReceivableId: number | null;
  installmentNumber: number | null;
}): string {
  return [
    input.calculationHash,
    input.source,
    input.nomusReceivableId ?? "",
    input.installmentNumber ?? "",
  ].join("|");
}

export function buildAuditIssueKey(input: {
  type: string;
  entityType: string;
  entityId: string | null;
}): string {
  return [input.type, input.entityType, input.entityId ?? ""].join("|");
}

export function isPaidCommissionStatus(status: string): boolean {
  return status === "PAID_PARTIAL" || status === "PAID_TOTAL";
}

export function isActiveCommissionStatus(status: string): boolean {
  return !["CANCELLED", "REVERSED", "SUPERSEDED_BY_OUTPUT_DOCUMENT", "ERROR"].includes(status);
}

export function shouldBlockAutoChangePaidRecord(
  status: string,
  blockAutoChange: boolean
): boolean {
  return blockAutoChange && isPaidCommissionStatus(status);
}

export function resolveOrderHasAuthorizedOutputNfe(order: CommissionOrderSourceBundle): boolean {
  return order.authorizedOutputNfes.length > 0;
}

export function pickPrimaryAuthorizedNfe(order: CommissionOrderSourceBundle) {
  return order.authorizedOutputNfes[0] ?? null;
}

export function buildRuleMatchContext(
  order: CommissionOrderSourceBundle,
  item: CommissionOrderSourceBundle["items"][number],
  beneficiaryType: CommissionRuleMatchContext["beneficiaryType"],
  commissionPersonId: string | null,
  referenceDate: Date
): CommissionRuleMatchContext {
  return {
    referenceDate,
    order,
    item,
    beneficiaryType,
    nomusSellerId: order.seller.nomusSellerId,
    nomusRepresentativeId: order.representative.nomusRepresentativeId,
    commissionPersonId,
  };
}

export function summarizeRecordDraft(draft: CommissionRecordDraft): Record<string, unknown> {
  return {
    orderCode: draft.orderCode,
    productCode: draft.productCode,
    status: draft.status,
    baseAmount: draft.baseAmount,
    commissionAmount: draft.commissionAmount,
    nomusNfeId: draft.nomusNfeId,
  };
}
