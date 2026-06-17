import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import { hasExecutiveReportDataQualityAlerts } from "./financeExecutiveReportViewModel.js";

export const EXECUTIVE_REPORT_PRINT_BLOCK_LOADING_MESSAGE =
  "Aguarde o carregamento completo do relatório antes de imprimir.";

export const EXECUTIVE_REPORT_PRINT_QUALITY_CONFIRM_MESSAGE =
  "Existem avisos de qualidade dos dados. Deseja imprimir mesmo assim?";

export function canPrintExecutiveReport(input: {
  loading: boolean;
  report: FinanceExecutiveReport | null;
}): boolean {
  return !input.loading && input.report != null;
}

export function executiveReportPrintNeedsQualityConfirm(
  report: FinanceExecutiveReport | null
): boolean {
  if (!report) return false;
  return hasExecutiveReportDataQualityAlerts(report);
}

export function resolveExecutiveReportPrintAction(input: {
  loading: boolean;
  report: FinanceExecutiveReport | null;
  confirmFn?: (message: string) => boolean;
}): "blocked-loading" | "blocked-cancelled" | "print" {
  if (!canPrintExecutiveReport(input)) return "blocked-loading";
  if (
    executiveReportPrintNeedsQualityConfirm(input.report) &&
    input.confirmFn &&
    !input.confirmFn(EXECUTIVE_REPORT_PRINT_QUALITY_CONFIRM_MESSAGE)
  ) {
    return "blocked-cancelled";
  }
  return "print";
}
