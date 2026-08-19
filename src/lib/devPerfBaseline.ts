/**
 * PERFORMANCE 02 — tipos e flags da linha de base (frontend + backend).
 *
 * Habilitar:
 * - Backend: INDUSCOST_PERF_BASELINE=1 — DESLIGADO por padrão em QUALQUER
 *   ambiente, produção inclusive. Ligar exige a variável explícita; ausência,
 *   "0" ou "false" mantêm desligado.
 * - Frontend: localStorage.setItem("induscost_perf_baseline","1") em DEV
 *   ou VITE_PERF_BASELINE=1 (o front segue bloqueado em build de produção).
 *
 * Não altera regras de negócio nem payloads funcionais: apenas conta queries,
 * mede tempo e estima bytes. Nenhum SQL, parâmetro, cabeçalho, cookie, token
 * ou conteúdo de payload é registrado.
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
  | "finance_cash_flow_annual_comparison"
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
  /**
   * SOMA das durações das operações Prisma do request — NÃO é wall-clock.
   *
   * Com operações concorrentes (Promise.all), `dbMs` PODE ULTRAPASSAR
   * `totalMs`: oito operações de 1 s em paralelo somam 8 s em ~1 s de
   * relógio. Por isso NUNCA derive "tempo de CPU" de `totalMs - dbMs` — a
   * conta só fecha em caminho estritamente sequencial. Para separar CPU de
   * espera, use profiling de verdade.
   *
   * Mede a operação Prisma inteira (engine + rede + serialização), que é um
   * limite SUPERIOR do tempo gasto dentro do Postgres.
   */
  dbMs: number | null;
  /** Operações Prisma no request (uma operação pode virar mais de um SQL). */
  queryCount: number | null;
  payloadBytesApprox: number | null;
  rowCountApprox: number | null;
  /**
   * Duração wall-clock de `res.json` (serialização real do Express), quando
   * o sample veio de HTTP. Ausente no runner de serviço, que não responde HTTP.
   */
  serializeMs?: number | null;
  /**
   * Custo de um `JSON.stringify` EXTRA usado só para estimar bytes.
   * NÃO faz parte de `totalMs`. Não é o custo de serialização do response.
   */
  profilingSerializeMs?: number | null;
  /** Fases nomeadas (wall-clock). Podem ser aninhadas — não some cegamente. */
  phases?: Record<string, number> | null;
  /**
   * Fases WALL-CLOCK sequenciais (`account: true`). Podem ser somadas.
   * Não inclui fases aninhadas (arLoad dentro de loadRows, etc.).
   */
  accountedPhases?: Record<string, number> | null;
  /** Soma de `accountedPhases` (+ serializeMs HTTP, se houver). Não usa dbMs. */
  accountedWallMs?: number | null;
  /**
   * totalMs - accountedWallMs. NÃO usa dbMs.
   * Residual do caminho ainda sem fase sequencial.
   */
  unaccountedWallMs?: number | null;
  /** Contagens inteiras (AR/AP/pedidos). Sem nomes, CNPJ ou payload. */
  rowCounts?: DevPerfRowCounts | null;
  notes?: string;
};

export type DevPerfRowCounts = {
  ar?: number;
  ap?: number;
  orders?: number;
};

export type DevPerfRunSummary = {
  generatedAt: string;
  mode: "server_script" | "http_middleware" | "browser_fetch";
  samples: DevPerfEndpointSample[];
};

/**
 * Opt-in explícito, sem exceção por ambiente.
 *
 * Antes o guard proibia produção por completo, o que tornava a instrumentação
 * inútil justamente onde os problemas de performance aparecem. A proteção
 * continua existindo — ela agora é a própria variável: nada liga sozinho, e
 * só o valor exato "1" habilita.
 */
export function isDevPerfBaselineEnvEnabled(): boolean {
  if (typeof process === "undefined" || !process.env) return false;
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

export function roundDevPerfMs(ms: number): number {
  return Math.round(ms * 100) / 100;
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
