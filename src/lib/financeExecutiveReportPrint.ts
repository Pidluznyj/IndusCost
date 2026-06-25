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

const EXECUTIVE_REPORT_MIN_CHART_FRAMES = 6;

function chartFrameIsReady(chart: Element): boolean {
  const svg = chart.querySelector("svg");
  const box = chart.getBoundingClientRect();
  return Boolean(svg && svg.getBoundingClientRect().width > 50 && box.width > 80 && box.height > 80);
}

/** Aguarda SVGs do Recharts antes de window.print() (PDF do navegador). */
export async function waitForExecutiveReportChartsReady(
  timeoutMs = 10_000,
  pollMs = 120
): Promise<boolean> {
  if (typeof document === "undefined") return true;

  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const charts = Array.from(document.querySelectorAll("[data-report-chart]"));
    if (charts.length >= EXECUTIVE_REPORT_MIN_CHART_FRAMES && charts.every(chartFrameIsReady)) {
      window.dispatchEvent(new Event("resize"));
      await new Promise((resolve) => window.setTimeout(resolve, pollMs));
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  return false;
}
