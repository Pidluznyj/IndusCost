import type { CommissionAccessScope } from "./commissionAccessScope.js";
import { buildReceiptClosingHashFromPreview } from "./commissionReceiptClosing.js";
import { findClosedReceiptClosing } from "./commissionReceiptClosing.server.js";
import { loadCommissionReceiptPreview } from "./commissionReceiptEngine.server.js";
import { resolveMonthlyPayableReport } from "./commissionReportSource.server.js";
import {
  buildCommissionReceiptClosingValidationReport,
  buildValidationCompareLines,
  type CommissionReceiptClosingValidationReport,
} from "./commissionReceiptClosingValidation.js";
import { prisma } from "@/src/lib/prisma.js";

export type LoadCommissionReceiptClosingValidationInput = {
  year: number;
  month: number;
  seller?: string | null;
  customer?: string | null;
  compareLegacy?: boolean;
  includeLines?: boolean;
  nomusBase?: number | null;
  nomusCommission?: number | null;
  scope: CommissionAccessScope;
};

export type CommissionReceiptClosingValidationResult = {
  report: CommissionReceiptClosingValidationReport;
  compareLines: ReturnType<typeof buildValidationCompareLines>;
};

/**
 * Validação read-only — nunca grava fechamento.
 * Novo motor: sempre prévia live (`loadCommissionReceiptPreview`).
 */
export async function loadCommissionReceiptClosingValidation(
  input: LoadCommissionReceiptClosingValidationInput
): Promise<CommissionReceiptClosingValidationResult> {
  const query = {
    year: input.year,
    month: input.month,
    sellerId: input.seller ?? null,
    customer: input.customer ?? null,
  };

  const [preview, closed, legacySummary] = await Promise.all([
    loadCommissionReceiptPreview({
      year: input.year,
      month: input.month,
      seller: input.seller ?? null,
      customer: input.customer ?? null,
      includeExcluded: true,
      includeExceptions: true,
    }),
    findClosedReceiptClosing(prisma, input.year, input.month),
    input.compareLegacy
      ? resolveMonthlyPayableReport(query, input.scope, "legacy")
      : Promise.resolve(null),
  ]);

  const calculationHash = buildReceiptClosingHashFromPreview(preview);
  const nomusReference =
    input.nomusBase != null || input.nomusCommission != null
      ? `base=${input.nomusBase ?? ""};commission=${input.nomusCommission ?? ""}`
      : null;
  const compareLines = buildValidationCompareLines({
    year: input.year,
    month: input.month,
    previewLines: preview.lines,
    legacyDetails: legacySummary?.details ?? null,
    calculationHash,
    nomusReference,
  });

  const report = buildCommissionReceiptClosingValidationReport({
    year: input.year,
    month: input.month,
    seller: input.seller ?? null,
    customer: input.customer ?? null,
    preview,
    calculationHash,
    legacySummary,
    closedLedger: closed
      ? {
          closingId: closed.closingId,
          payableCommissionTotal: closed.totalReleasedCommission,
        }
      : null,
    nomusBase: input.nomusBase ?? null,
    nomusCommission: input.nomusCommission ?? null,
    includeLines: input.includeLines ?? false,
  });

  return { report, compareLines };
}
