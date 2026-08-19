/**
 * PERF 3.1 — estatísticas do benchmark de Fluxo de Caixa.
 * Sem dados financeiros: só números.
 */

export const CASH_FLOW_PERF_PERCENTILE_METHOD =
  "nearest-rank: index = clamp(ceil(p/100*n)-1)";

export const CASH_FLOW_PERF_DBMS_DISCLAIMER =
  "dbMs é a SOMA das durações das operações Prisma, não wall-clock. Com queries em paralelo (Promise.all), dbMs PODE ser maior que totalMs. NUNCA derive CPU/processamento como totalMs - dbMs.";

export const CASH_FLOW_PERF_SERIALIZE_DISCLAIMER =
  "profilingSerializeMs é um JSON.stringify extra só para estimar bytes; está excluído de totalMs. serializeMs (HTTP) é a duração de res.json. O runner de serviço não tem serialização Express (serializeMs=null).";

export const CASH_FLOW_PERF_OPENING_DISCLAIMER =
  "OPENING BACKEND WORK soma as medianas dos três endpoints de uma abertura típica (dashboard + annual-comparison + daily-radar). Não é tempo de tela: o frontend dispara annual e radar só depois do dashboard (waterfall) e só se as seções entram na viewport. A métrica de tela pronta é cf:ready.";

export const CASH_FLOW_PERF_NESTED_PHASES_NOTE =
  "orderProjection corre dentro do enrich AR; arLoad é a carga Nomus AR. Não some fases como se fossem disjuntas.";

export function sortedFinite(values: number[]): number[] {
  return values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}

export function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  }
  return sorted[mid] ?? null;
}

export function nearestRankPercentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx] ?? null;
}

export type NumericSummary = {
  n: number;
  min: number | null;
  median: number | null;
  p95: number | null;
  max: number | null;
};

export function summarizeNumeric(values: number[]): NumericSummary {
  const sorted = sortedFinite(values);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    median: medianOfSorted(sorted),
    p95: nearestRankPercentile(sorted, 95),
    max: sorted.at(-1) ?? null,
  };
}

export function roundPerfMs(ms: number | null | undefined): number | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return Math.round(ms * 100) / 100;
}
