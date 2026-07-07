import { prisma } from "@/src/lib/prisma.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import {
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageEmpty,
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
  type ReceiptClosingPagePayload,
} from "./commissionReceiptClosingApi.js";
import {
  buildReceiptClosingDetailExportBuffer,
  buildReceiptClosingDetailExportFilename,
} from "./commissionReceiptClosingDetailExport.js";
import {
  applyCommissionReceiptClosing,
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
  reprocessCommissionReceiptClosingApply,
  reprocessCommissionReceiptClosingPreview,
  type ReceiptClosingFilters,
} from "./commissionReceiptClosing.server.js";

export type { ReceiptClosingPagePayload };

async function buildReceiptClosingPagePayload(
  filters: ReceiptClosingFilters
): Promise<ReceiptClosingPagePayload> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    return buildReceiptClosingPageFromLedger({
      closing,
      ledgerLines,
      nomusBase: filters.nomusBase,
      nomusCommission: filters.nomusCommission,
    });
  }
  return buildReceiptClosingPageEmpty(filters.year, filters.month);
}

export async function getReceiptClosingPage(
  year: number,
  month: number,
  nomus?: { nomusBase?: number | null; nomusCommission?: number | null }
): Promise<ReceiptClosingPagePayload> {
  return buildReceiptClosingPagePayload({
    year,
    month,
    nomusBase: nomus?.nomusBase,
    nomusCommission: nomus?.nomusCommission,
  });
}

export async function getReceiptClosingPreviewPage(
  filters: ReceiptClosingFilters
): Promise<ReceiptClosingPagePayload> {
  const payload = await previewCommissionReceiptClosing(filters);
  return buildReceiptClosingPageFromPreview({
    preview: payload.preview,
    closing: payload.existingClosing,
    canApply: payload.canApply,
    applyBlockedReason: payload.applyBlockedReason,
    nomusBase: filters.nomusBase,
    nomusCommission: filters.nomusCommission,
  });
}

export async function exportReceiptClosingCsv(
  filters: ReceiptClosingFilters
): Promise<{ csv: string; filename: string }> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  const page = await loadReceiptClosingExportPage(filters);
  const exportMode = closing ? "CLOSED" : "PREVIEW";
  const hash = closing?.calculationHash ?? page.closing?.calculationHash ?? null;
  return {
    csv: buildReceiptClosingExportCsv({
      year: filters.year,
      month: filters.month,
      closing,
      exportMode,
      lines: page.lines,
      cards: page.cards,
      materializationSummary: page.materializationSummary,
      calculationHash: hash,
    }),
    filename: `commission-receipt-closing-${filters.year}-${String(filters.month).padStart(2, "0")}-${exportMode === "CLOSED" ? "closed" : "preview"}.csv`,
  };
}

async function loadReceiptClosingExportPage(
  filters: ReceiptClosingFilters
): Promise<ReceiptClosingPagePayload> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (closing) {
    return getReceiptClosingPage(filters.year, filters.month, {
      nomusBase: filters.nomusBase,
      nomusCommission: filters.nomusCommission,
    });
  }
  return getReceiptClosingPreviewPage(filters);
}

export async function exportReceiptClosingDetailXlsx(
  filters: ReceiptClosingFilters
): Promise<{ buffer: Buffer; filename: string }> {
  const page = await loadReceiptClosingExportPage(filters);
  return {
    buffer: buildReceiptClosingDetailExportBuffer(page),
    filename: buildReceiptClosingDetailExportFilename(page.year, page.month, page.exportMode),
  };
}

export async function applyReceiptClosingFromApi(input: {
  year: number;
  month: number;
  userId: string;
  notes?: string | null;
  acknowledgeCriticalDivergence?: boolean;
}) {
  const preview = await getReceiptClosingPreviewPage({ year: input.year, month: input.month });
  if (preview.requiresCriticalConfirmation && !input.acknowledgeCriticalDivergence) {
    throw new CommissionValidationError(
      "CRITICAL_DIVERGENCE",
      preview.criticalDivergenceReason ??
        "Divergência crítica detectada — confirme explicitamente antes de fechar."
    );
  }
  return applyCommissionReceiptClosing(prisma, input);
}

export async function reprocessReceiptClosingPreviewFromApi(filters: ReceiptClosingFilters) {
  return reprocessCommissionReceiptClosingPreview(filters);
}

export async function reprocessReceiptClosingApplyFromApi(input: {
  year: number;
  month: number;
  userId: string;
  reason: string;
}) {
  return reprocessCommissionReceiptClosingApply(prisma, input);
}
