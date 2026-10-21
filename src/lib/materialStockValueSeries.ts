/**
 * Série histórica do valor de matéria-prima em estoque — regras puras.
 *
 * O gráfico mostra CADA conferência física aplicada. Cada snapshot capturado
 * após `generateInventoryCountAdjustments` vira um ponto: o valor total de MP
 * (mesma fórmula do card "Valor em estoque (MP)") imediatamente depois daquela
 * contagem. Várias conferências na mesma semana (ou no mesmo dia) aparecem
 * todas — a série não esconde ponto atrás de agregação semanal.
 *
 * A janela (8/13/26/52 semanas) só recorta o período; não muda a regra do ponto.
 */

/** Série do valor de MP em estoque (leitura). */
export const MATERIAL_STOCK_VALUE_SERIES_PATH =
  "/api/materials/stock-value/series" as const;

export type MaterialStockValueSnapshotPoint = {
  /** Data civil da captura (YYYY-MM-DD). */
  civilDate: string;
  /** Σ (quantidade × custo atual) no instante da captura. */
  totalValue: number;
  /** Materiais com quantidade > 0 no momento da captura. */
  materialsWithStock: number;
  /** Materiais considerados no somatório. */
  materialsConsidered: number;
  /** Instante exato — desempata dois snapshots no mesmo dia civil. */
  capturedAt: string;
};

export type MaterialStockValueCountPoint = {
  civilDate: string;
  capturedAt: string;
  totalValue: number;
  materialsWithStock: number;
  materialsConsidered: number;
  /**
   * Variação absoluta em relação à conferência anterior da série.
   * `null` no primeiro ponto (não há com o que comparar) — nunca 0, que
   * significaria "não mudou".
   */
  deltaFromPrevious: number | null;
  /** Variação percentual; `null` quando não há anterior ou anterior é zero. */
  deltaPercentFromPrevious: number | null;
};

function roundValue(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Segunda-feira da semana ISO que contém `civilDate`.
 * Trabalha em UTC puro sobre a data civil (sem hora) — não há risco de o
 * fuso empurrar o dia para a semana vizinha.
 */
export function resolveIsoWeekStart(civilDate: string): string {
  const [y, m, d] = civilDate.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  // getUTCDay: 0=domingo … 6=sábado. ISO quer segunda como início.
  const dow = dt.getUTCDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - daysSinceMonday);
  return dt.toISOString().slice(0, 10);
}

/** Domingo da semana ISO iniciada em `weekStart`. */
export function resolveIsoWeekEnd(weekStart: string): string {
  const [y, m, d] = weekStart.slice(0, 10).split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + 6);
  return dt.toISOString().slice(0, 10);
}

/**
 * Segunda-feira da semana ISO mais antiga da janela de `weeks` semanas,
 * incluindo a semana corrente de `civilToday`.
 */
export function resolveMaterialStockValueWindowStart(
  civilToday: string,
  weeks: number
): string {
  const currentWeekStart = resolveIsoWeekStart(civilToday);
  const safeWeeks = Number.isFinite(weeks) && weeks > 0 ? Math.floor(weeks) : 1;
  const [y, m, d] = currentWeekStart.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() - (safeWeeks - 1) * 7);
  return dt.toISOString().slice(0, 10);
}

function snapshotSortKey(snap: MaterialStockValueSnapshotPoint): string {
  return `${snap.capturedAt}\0${snap.civilDate}`;
}

/**
 * Monta a série com um ponto por conferência (snapshot).
 *
 * Regra: cada snapshot vira ponto, na ordem cronológica de `capturedAt`
 * (desempate por `civilDate`). Semanas ou dias sem conferência simplesmente
 * não aparecem — a série não inventa pontos, e o gráfico liga os que existem.
 */
export function buildMaterialStockValueCountSeries(
  snapshots: readonly MaterialStockValueSnapshotPoint[]
): MaterialStockValueCountPoint[] {
  const ordered = snapshots
    .filter((snap) => Boolean(snap.civilDate) && Boolean(snap.capturedAt))
    .slice()
    .sort((a, b) => {
      const ka = snapshotSortKey(a);
      const kb = snapshotSortKey(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

  const out: MaterialStockValueCountPoint[] = [];
  let previousValue: number | null = null;

  for (const snap of ordered) {
    const totalValue = roundValue(snap.totalValue);
    const delta =
      previousValue != null ? roundValue(totalValue - previousValue) : null;
    const deltaPercent =
      previousValue != null && previousValue !== 0
        ? Math.round(
            ((totalValue - previousValue) / Math.abs(previousValue)) * 10000
          ) / 100
        : null;

    out.push({
      civilDate: snap.civilDate,
      capturedAt: snap.capturedAt,
      totalValue,
      materialsWithStock: snap.materialsWithStock,
      materialsConsidered: snap.materialsConsidered,
      deltaFromPrevious: delta,
      deltaPercentFromPrevious: deltaPercent,
    });
    previousValue = totalValue;
  }

  return out;
}

export type MaterialStockValueSeriesSummary = {
  /** Valor da conferência mais recente da série. */
  latestValue: number | null;
  latestCapturedAt: string | null;
  latestCivilDate: string | null;
  /** Variação da última conferência em relação à anterior. */
  latestDelta: number | null;
  latestDeltaPercent: number | null;
  /** Maior e menor valor observados no período. */
  maxValue: number | null;
  maxCapturedAt: string | null;
  minValue: number | null;
  minCapturedAt: string | null;
  /** Quantas conferências (fotos) há no período. */
  totalSnapshots: number;
};

/** Resumo para os cards ao lado do gráfico — derivado da própria série. */
export function summarizeMaterialStockValueSeries(
  points: readonly MaterialStockValueCountPoint[]
): MaterialStockValueSeriesSummary {
  if (points.length === 0) {
    return {
      latestValue: null,
      latestCapturedAt: null,
      latestCivilDate: null,
      latestDelta: null,
      latestDeltaPercent: null,
      maxValue: null,
      maxCapturedAt: null,
      minValue: null,
      minCapturedAt: null,
      totalSnapshots: 0,
    };
  }

  const last = points[points.length - 1]!;
  let maxValue = points[0]!.totalValue;
  let maxCapturedAt = points[0]!.capturedAt;
  let minValue = points[0]!.totalValue;
  let minCapturedAt = points[0]!.capturedAt;

  for (const point of points) {
    if (point.totalValue > maxValue) {
      maxValue = point.totalValue;
      maxCapturedAt = point.capturedAt;
    }
    if (point.totalValue < minValue) {
      minValue = point.totalValue;
      minCapturedAt = point.capturedAt;
    }
  }

  return {
    latestValue: last.totalValue,
    latestCapturedAt: last.capturedAt,
    latestCivilDate: last.civilDate,
    latestDelta: last.deltaFromPrevious,
    latestDeltaPercent: last.deltaPercentFromPrevious,
    maxValue,
    maxCapturedAt,
    minValue,
    minCapturedAt,
    totalSnapshots: points.length,
  };
}

/** Rótulo curto pt-BR do eixo: "05/08" (data civil da conferência). */
export function formatCivilDateAxisLabel(civilDate: string): string {
  const [, m, d] = civilDate.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Resposta do endpoint da série — contrato compartilhado client/servidor. */
export type MaterialStockValueSeriesResponse = {
  points: MaterialStockValueCountPoint[];
  summary: MaterialStockValueSeriesSummary;
  /** Janela consultada, em semanas ISO (só recorte; cada conferência vira ponto). */
  weeksRequested: number;
  /** Data civil do snapshot mais recente (null quando não há histórico). */
  lastCapturedCivilDate: string | null;
};
