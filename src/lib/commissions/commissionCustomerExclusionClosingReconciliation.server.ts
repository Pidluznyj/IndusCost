import { prisma } from "@/src/lib/prisma.js";
import {
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
} from "./commissionReceiptClosingApi.js";
import {
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
} from "./commissionReceiptClosing.server.js";
import { loadActiveCustomerExclusionRuleSnapshots } from "./commissionCustomerExclusionRules.server.js";
import {
  buildCustomerExclusionClosingReconciliation,
  type CustomerExclusionClosingReconciliationPayload,
} from "./commissionCustomerExclusionClosingReconciliation.js";

async function loadClosingPageForExclusionReconciliation(
  year: number,
  month: number
) {
  const closing = await findClosedReceiptClosing(prisma, year, month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    return buildReceiptClosingPageFromLedger({ closing, ledgerLines });
  }

  const previewPayload = await previewCommissionReceiptClosing({ year, month });
  return buildReceiptClosingPageFromPreview({
    preview: previewPayload.preview,
    closing: previewPayload.existingClosing,
    canApply: previewPayload.canApply,
    applyBlockedReason: previewPayload.applyBlockedReason,
  });
}

export async function loadCustomerExclusionClosingReconciliation(
  year: number,
  month: number
): Promise<CustomerExclusionClosingReconciliationPayload> {
  const [closingPage, registeredRules] = await Promise.all([
    loadClosingPageForExclusionReconciliation(year, month),
    loadActiveCustomerExclusionRuleSnapshots(),
  ]);

  return buildCustomerExclusionClosingReconciliation(closingPage, registeredRules);
}
