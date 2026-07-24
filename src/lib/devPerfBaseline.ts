/**
 * PERFORMANCE 02 — tipos e flags da linha de base (frontend + backend).
 *
 * Habilitar:
 * - Backend: INDUSCOST_PERF_BASELINE=1 (nunca em produção)
 * - Frontend: localStorage.setItem("induscost_perf_baseline","1") em DEV
 *   ou VITE_PERF_BASELINE=1
 *
 * Não altera regras de negócio nem payloads funcionais.
 */

export const DEV_PERF_BASELINE_STORAGE_KEY = "induscost_perf_baseline";
export const DEV_PERF_BASELINE_ENV = "INDUSCOST_PERF_BASELINE";

export type DevPerfScenarioId =
  | "so_list_default"
  | "so_list_filtered"
  | "so_list_page2"
  | "so_detail"
  | "so_detail_tabs_payload"
  | "so_management"
  | "so_results"
  | "finance_ar_dashboard"
  | "finance_ar_overdue_path"
  | "finance_ar_titles"
  | "finance_ap_dashboard"
  | "finance_ap_titles"
  | "finance_cash_flow_dashboard"
  | "finance_cash_flow_daily_radar"
  | "finance_billing_dashboard"
  | "finance_billing_nfes"
  | "finance_dre"
  | "finance_executive"
  | "finance_cost_centers"
  | "finance_sales_orders";

export type DevPerfEndpointSample = {
  scenario: DevPerfScenarioId | string;
  method: string;
  path: string;
  status: number;
  totalMs: number;
  dbMs: number | null;
  queryCount: number | null;
  payloadBytesApprox: number | null;
  rowCountApprox: number | null;
  notes?: string;
};

export type DevPerfRunSummary = {
  generatedAt: string;
  mode: "server_script" | "http_middleware" | "browser_fetch";
  samples: DevPerfEndpointSample[];
};

export function isDevPerfBaselineEnvEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
  if (process.env.NODE_ENV === "production") return false;
  return process.env[DEV_PERF_BASELINE_ENV] === "1";
}

export function isDevPerfBaselineClientEnabled(): boolean {
  try {
    if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return false;
    if (typeof import.meta !== "undefined" && import.meta.env?.VITE_PERF_BASELINE === "1") {
      return true;
    }
    if (typeof window === "undefined") return false;
    return window.localStorage?.getItem(DEV_PERF_BASELINE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function approxJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    try {
      return new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
      return 0;
    }
  }
}

export function summarizeDevPerfSamples(samples: DevPerfEndpointSample[]): {
  byTotalMs: DevPerfEndpointSample[];
  byPayload: DevPerfEndpointSample[];
  duplicatePaths: { path: string; count: number }[];
} {
  const byTotalMs = [...samples].sort((a, b) => b.totalMs - a.totalMs);
  const byPayload = [...samples]
    .filter((s) => (s.payloadBytesApprox ?? 0) > 0)
    .sort((a, b) => (b.payloadBytesApprox ?? 0) - (a.payloadBytesApprox ?? 0));
  const counts = new Map<string, number>();
  for (const s of samples) {
    counts.set(s.path, (counts.get(s.path) ?? 0) + 1);
  }
  const duplicatePaths = [...counts.entries()]
    .filter(([, c]) => c > 1)
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);
  return { byTotalMs, byPayload, duplicatePaths };
}
