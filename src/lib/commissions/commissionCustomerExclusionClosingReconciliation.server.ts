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
import type { CustomerExclusionRuleSnapshot } from "./commissionCustomerExclusion.js";
import {
  buildCustomerExclusionClosingReconciliation,
  type CustomerExclusionClosingReconciliationPayload,
} from "./commissionCustomerExclusionClosingReconciliation.js";

async function loadClosingPageForExclusionReconciliation(
  year: number,
  month: number,
  registeredRules: CustomerExclusionRuleSnapshot[]
) {
  const closing = await findClosedReceiptClosing(prisma, year, month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    // Mesmo universo do Fechamento do mês: histórico Nomus gravado aplica as regras ativas.
    return buildReceiptClosingPageFromLedger({
      closing,
      ledgerLines,
      legacyDisplayExclusionRules: registeredRules,
    });
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
  const registeredRules = await loadActiveCustomerExclusionRuleSnapshots();
  const closingPage = await loadClosingPageForExclusionReconciliation(year, month, registeredRules);

  return buildCustomerExclusionClosingReconciliation(closingPage, registeredRules);
}
