import { prisma } from "@/src/lib/prisma.js";
import {
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageEmpty,
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
  mapPreviewLineToApiLine,
  type ReceiptClosingPagePayload,
} from "./commissionReceiptClosingApi.js";
import {
  applyCommissionReceiptClosing,
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
  reprocessCommissionReceiptClosingApply,
  reprocessCommissionReceiptClosingPreview,
  type ReceiptClosingFilters,
} from "./commissionReceiptClosing.server.js";
import { buildReceiptClosingHashFromPreview } from "./commissionReceiptClosing.js";
import { loadCommissionReceiptPreview } from "./commissionReceiptEngine.server.js";

export type { ReceiptClosingPagePayload };

export async function getReceiptClosingPage(
  year: number,
  month: number
): Promise<ReceiptClosingPagePayload> {
  const closing = await findClosedReceiptClosing(prisma, year, month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    return buildReceiptClosingPageFromLedger({ closing, ledgerLines });
  }
  return buildReceiptClosingPageEmpty(year, month);
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
  });
}

export async function exportReceiptClosingCsv(
  filters: ReceiptClosingFilters
): Promise<{ csv: string; filename: string }> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    const page = buildReceiptClosingPageFromLedger({ closing, ledgerLines });
    return {
      csv: buildReceiptClosingExportCsv({
        year: filters.year,
        month: filters.month,
        closing,
        exportMode: "CLOSED",
        lines: page.lines,
        calculationHash: closing.calculationHash,
      }),
      filename: `commission-receipt-closing-${filters.year}-${String(filters.month).padStart(2, "0")}-closed.csv`,
    };
  }

  const preview = await loadCommissionReceiptPreview(filters);
  const lines = preview.lines.map(mapPreviewLineToApiLine);
  const hash = buildReceiptClosingHashFromPreview(preview);
  return {
    csv: buildReceiptClosingExportCsv({
      year: filters.year,
      month: filters.month,
      closing: null,
      exportMode: "PREVIEW",
      lines,
      calculationHash: hash,
    }),
    filename: `commission-receipt-closing-${filters.year}-${String(filters.month).padStart(2, "0")}-preview.csv`,
  };
}

export async function applyReceiptClosingFromApi(input: {
  year: number;
  month: number;
  userId: string;
  notes?: string | null;
}) {
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
