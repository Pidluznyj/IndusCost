import { prisma } from "@/src/lib/prisma.js";
import { CommissionValidationError } from "./commissionApiValidation.js";
import type { CommissionAccessScope } from "./commissionAccessScope.js";
import {
  buildReceiptClosingExportCsv,
  buildReceiptClosingPageEmpty,
  buildReceiptClosingPageFromLedger,
  buildReceiptClosingPageFromPreview,
  type ReceiptClosingOwnScopeFilter,
  type ReceiptClosingPagePayload,
} from "./commissionReceiptClosingApi.js";
import {
  buildReceiptClosingDetailExportBuffer,
  buildReceiptClosingDetailExportFilename,
} from "./commissionReceiptClosingDetailExport.js";
import {
  appendReceiptClosingNote,
  formatCriticalDivergenceAcceptanceNote,
} from "./commissionReceiptClosing.js";
import {
  applyCommissionReceiptClosing,
  cancelCommissionReceiptClosing,
  findClosedReceiptClosing,
  loadReceiptClosingLedgerLines,
  previewCommissionReceiptClosing,
  reprocessCommissionReceiptClosingApply,
  reprocessCommissionReceiptClosingPreview,
  type ReceiptClosingFilters,
} from "./commissionReceiptClosing.server.js";

export type { ReceiptClosingPagePayload };

/**
 * Resolve o filtro "own" a partir do escopo de auth — mesma consulta/regra
 * usada em Relatórios e Fechamentos (commissionReports.server.ts /
 * commissionClosings.server.ts): CommissionPerson.id vinculado ao
 * nomusPersonId do vendedor logado. `scope` ausente ou global/none não filtra.
 */
async function resolveReceiptClosingOwnScope(
  scope?: CommissionAccessScope
): Promise<ReceiptClosingOwnScopeFilter | null> {
  if (!scope || scope.dataScope !== "own") return null;
  const ownCanonicalSellerIds =
    scope.nomusSellerId != null
      ? new Set(
          (
            await prisma.commissionPerson.findMany({
              where: { nomusPersonId: scope.nomusSellerId, type: "SELLER" },
              select: { id: true },
            })
          ).map((p) => p.id)
        )
      : new Set<string>();
  return {
    nomusSellerId: scope.nomusSellerId,
    sellerResponsibleName: scope.sellerResponsibleName,
    ownCanonicalSellerIds,
  };
}

async function buildReceiptClosingPagePayload(
  filters: ReceiptClosingFilters,
  scope?: CommissionAccessScope
): Promise<ReceiptClosingPagePayload> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (closing) {
    const ledgerLines = await loadReceiptClosingLedgerLines(prisma, closing.closingId);
    const ownScope = await resolveReceiptClosingOwnScope(scope);
    return buildReceiptClosingPageFromLedger({
      closing,
      ledgerLines,
      nomusBase: filters.nomusBase,
      nomusCommission: filters.nomusCommission,
      ownScope,
    });
  }
  return buildReceiptClosingPageEmpty(filters.year, filters.month);
}

export async function getReceiptClosingPage(
  year: number,
  month: number,
  nomus?: { nomusBase?: number | null; nomusCommission?: number | null },
  scope?: CommissionAccessScope
): Promise<ReceiptClosingPagePayload> {
  return buildReceiptClosingPagePayload(
    {
      year,
      month,
      nomusBase: nomus?.nomusBase,
      nomusCommission: nomus?.nomusCommission,
    },
    scope
  );
}

export async function getReceiptClosingPreviewPage(
  filters: ReceiptClosingFilters,
  scope?: CommissionAccessScope
): Promise<ReceiptClosingPagePayload> {
  const payload = await previewCommissionReceiptClosing(filters);
  const ownScope = await resolveReceiptClosingOwnScope(scope);
  return buildReceiptClosingPageFromPreview({
    preview: payload.preview,
    closing: payload.existingClosing,
    canApply: payload.canApply,
    applyBlockedReason: payload.applyBlockedReason,
    nomusBase: filters.nomusBase,
    nomusCommission: filters.nomusCommission,
    ownScope,
  });
}

export async function exportReceiptClosingCsv(
  filters: ReceiptClosingFilters,
  scope?: CommissionAccessScope
): Promise<{ csv: string; filename: string }> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  const page = await loadReceiptClosingExportPage(filters, scope);
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
  filters: ReceiptClosingFilters,
  scope?: CommissionAccessScope
): Promise<ReceiptClosingPagePayload> {
  const closing = await findClosedReceiptClosing(prisma, filters.year, filters.month);
  if (closing) {
    return getReceiptClosingPage(
      filters.year,
      filters.month,
      {
        nomusBase: filters.nomusBase,
        nomusCommission: filters.nomusCommission,
      },
      scope
    );
  }
  return getReceiptClosingPreviewPage(filters, scope);
}

export async function exportReceiptClosingDetailXlsx(
  filters: ReceiptClosingFilters,
  scope?: CommissionAccessScope
): Promise<{ buffer: Buffer; filename: string }> {
  const page = await loadReceiptClosingExportPage(filters, scope);
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
  if (!preview.canApply) {
    throw new CommissionValidationError(
      "CLOSING_BLOCKED",
      preview.applyBlockedReason ?? "Fechamento bloqueado para este período."
    );
  }
  if (preview.requiresCriticalConfirmation && !input.acknowledgeCriticalDivergence) {
    throw new CommissionValidationError(
      "CRITICAL_DIVERGENCE",
      preview.criticalDivergenceReason ??
        "Divergência crítica detectada — confirme explicitamente antes de fechar."
    );
  }

  let notes = input.notes ?? null;
  if (preview.requiresCriticalConfirmation && input.acknowledgeCriticalDivergence) {
    const divergentTitleCount =
      preview.reconciliation?.divergentReceivableCount ??
      preview.materializationSummary?.receivablesWithoutScheduleCount ??
      0;
    notes = appendReceiptClosingNote(
      notes,
      formatCriticalDivergenceAcceptanceNote({
        acceptedBy: input.userId,
        divergentTitleCount,
        acceptanceNote: input.notes,
      })
    );
  }

  return applyCommissionReceiptClosing(prisma, {
    year: input.year,
    month: input.month,
    userId: input.userId,
    notes,
  });
}

export async function cancelReceiptClosingFromApi(input: {
  closingId: string;
  userId: string;
  reason: string;
}) {
  return cancelCommissionReceiptClosing(prisma, input);
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
