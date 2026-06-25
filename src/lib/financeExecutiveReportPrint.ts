import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import { hasExecutiveReportDataQualityAlerts } from "./financeExecutiveReportViewModel.js";

export const EXECUTIVE_REPORT_PRINT_BLOCK_LOADING_MESSAGE =
  "Aguarde o carregamento completo do relatório antes de imprimir.";

export const EXECUTIVE_REPORT_PRINT_QUALITY_CONFIRM_MESSAGE =
  "Existem avisos de qualidade dos dados. Deseja imprimir mesmo assim?";

export const EXECUTIVE_REPORT_CHARTS_LOADING_MESSAGE =
  "Os gráficos ainda estão carregando. Aguarde alguns segundos e tente exportar novamente.";

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

/** Frames marcados como vazios não renderizam SVG — considerados prontos para impressão. */
export function chartFrameIsReady(chart: Element): boolean {
  if (chart.getAttribute("data-chart-empty") === "true") return true;
  const box = chart.getBoundingClientRect();
  if (box.width <= 40 || box.height <= 40) return false;
  const svg = chart.querySelector("svg");
  if (!svg) return false;
  const svgBox = svg.getBoundingClientRect();
  return svgBox.width > 20 && svgBox.height > 20;
}

export function areExecutiveReportChartsReady(charts: Element[]): boolean {
  if (charts.length === 0) return true;
  return charts.every(chartFrameIsReady);
}

/**
 * Aguarda SVGs do Recharts antes de window.print() (PDF do navegador).
 * Não exige quantidade fixa de gráficos — apenas que todos os frames presentes
 * estejam prontos e estáveis (gráficos vazios ou sem pedidos de venda não bloqueiam).
 */
export async function waitForExecutiveReportChartsReady(
  timeoutMs = 12_000,
  pollMs = 100,
  stablePollsRequired = 2
): Promise<boolean> {
  if (typeof document === "undefined") return true;

  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }

  window.dispatchEvent(new Event("resize"));

  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableReadyPolls = 0;

  while (Date.now() < deadline) {
    const charts = Array.from(document.querySelectorAll("[data-report-chart]"));

    if (areExecutiveReportChartsReady(charts)) {
      if (charts.length === lastCount) {
        stableReadyPolls += 1;
      } else {
        stableReadyPolls = 1;
        lastCount = charts.length;
      }

      if (stableReadyPolls >= stablePollsRequired) {
        window.dispatchEvent(new Event("resize"));
        await new Promise((resolve) => window.setTimeout(resolve, pollMs));
        return true;
      }
    } else {
      stableReadyPolls = 0;
      lastCount = charts.length;
    }

    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  const charts = Array.from(document.querySelectorAll("[data-report-chart]"));
  return areExecutiveReportChartsReady(charts);
}
