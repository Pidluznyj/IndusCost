import type { FinanceExecutiveReport } from "./financeExecutiveReportTypes.js";
import { hasExecutiveReportDataQualityAlerts } from "./financeExecutiveReportViewModel.js";

export const EXECUTIVE_REPORT_PRINT_BLOCK_LOADING_MESSAGE =
  "Aguarde o carregamento completo do relatório antes de imprimir.";

export const EXECUTIVE_REPORT_PRINT_QUALITY_CONFIRM_MESSAGE =
  "Existem avisos de qualidade dos dados. Deseja imprimir mesmo assim?";

export const EXECUTIVE_REPORT_CHARTS_LOADING_MESSAGE =
  "Os gráficos ainda estão carregando. Aguarde alguns segundos e tente exportar novamente.";

export const EXECUTIVE_REPORT_MIN_CHARTS = 5;
export const EXECUTIVE_REPORT_MIN_CHART_WIDTH = 400;
export const EXECUTIVE_REPORT_MIN_CHART_HEIGHT = 250;

export function markExecutiveReportDocumentReady(ready: boolean): void {
  if (typeof document === "undefined") return;
  const root = document.querySelector(".executive-report-print-root");
  if (root instanceof HTMLElement) {
    root.dataset.reportReady = ready ? "true" : "false";
  }
  document.documentElement.dataset.reportReady = ready ? "true" : "false";
  document.body.dataset.reportReady = ready ? "true" : "false";
}

export async function prepareExecutiveReportForPrint(): Promise<void> {
  if (typeof document === "undefined") return;
  document.body.classList.add("executive-report-pdf-mode");
  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }
  await prepareExecutiveReportChartsForPrint();
}

export function teardownExecutiveReportPrintMode(): void {
  if (typeof document === "undefined") return;
  document.body.classList.remove("executive-report-pdf-mode");
}

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

function frameHasExplicitHeight(chart: HTMLElement): boolean {
  const raw = chart.style.height || chart.style.minHeight;
  if (!raw) return false;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 40;
}

/** Frames marcados como vazios/prontos ou com SVG Recharts montado. */
export function chartFrameIsReady(chart: Element): boolean {
  if (chart.getAttribute("data-chart-empty") === "true") return true;
  if (chart.getAttribute("data-chart-ready") === "true") return true;

  const svg = chart.querySelector("svg");
  if (!svg) return false;

  const widthAttr = Number.parseFloat(svg.getAttribute("width") ?? "");
  const heightAttr = Number.parseFloat(svg.getAttribute("height") ?? "");
  if (widthAttr > 20 && heightAttr > 20) return true;

  const hasRechartsSurface = Boolean(
    svg.querySelector(".recharts-surface, .recharts-layer, .recharts-cartesian-grid")
  );
  if (hasRechartsSurface && frameHasExplicitHeight(chart as HTMLElement)) {
    return true;
  }

  const box = chart.getBoundingClientRect();
  const svgBox = svg.getBoundingClientRect();
  return (
    box.width >= EXECUTIVE_REPORT_MIN_CHART_WIDTH &&
    box.height >= EXECUTIVE_REPORT_MIN_CHART_HEIGHT &&
    svgBox.width > 10 &&
    svgBox.height > 10
  );
}

export function areExecutiveReportChartsReady(charts: Element[]): boolean {
  if (charts.length < EXECUTIVE_REPORT_MIN_CHARTS) return false;
  return charts.every(chartFrameIsReady);
}

/** Força layout do Recharts: rola cada frame para a viewport e dispara resize. */
export async function prepareExecutiveReportChartsForPrint(): Promise<void> {
  if (typeof document === "undefined") return;

  const charts = Array.from(document.querySelectorAll("[data-report-chart]"));
  for (const chart of charts) {
    chart.scrollIntoView({ block: "center", behavior: "instant" });
    await new Promise((resolve) => window.setTimeout(resolve, 40));
  }

  window.dispatchEvent(new Event("resize"));
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
  await new Promise((resolve) => window.setTimeout(resolve, 200));
  window.dispatchEvent(new Event("resize"));
}

/**
 * Prepara gráficos e aguarda estabilização curta antes de window.print().
 * Não bloqueia a exportação indefinidamente — após o timeout imprime mesmo assim.
 */
export async function waitForExecutiveReportChartsReady(
  timeoutMs = 8_000,
  pollMs = 80,
  stablePollsRequired = 2
): Promise<boolean> {
  if (typeof document === "undefined") return true;

  try {
    await document.fonts?.ready;
  } catch {
    /* ignore */
  }

  await prepareExecutiveReportChartsForPrint();

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
        await prepareExecutiveReportChartsForPrint();
        markExecutiveReportDocumentReady(true);
        return true;
      }
    } else {
      stableReadyPolls = 0;
      lastCount = charts.length;
    }

    await new Promise((resolve) => window.setTimeout(resolve, pollMs));
  }

  await prepareExecutiveReportChartsForPrint();
  teardownExecutiveReportPrintMode();
  return true;
}
