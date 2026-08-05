/**
 * Série histórica do valor de matéria-prima em estoque — regras puras.
 *
 * O gráfico mostra a flutuação SEMANAL. Como cada conferência de estoque gera
 * uma foto (e o usuário confere várias MPs ao longo da semana), há vários
 * snapshots por semana. A regra de agregação é: **o último snapshot de cada
 * semana representa a semana** — é o valor com que a semana fechou, depois de
 * todas as conferências daquele período.
 *
 * Semana ISO: segunda a domingo. A data exibida é a SEGUNDA-feira da semana,
 * para o eixo do gráfico ficar estável e comparável.
 */

/** Série semanal do valor de MP em estoque (leitura). */
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

export type MaterialStockValueWeekPoint = {
  /** Segunda-feira da semana ISO (YYYY-MM-DD) — chave e rótulo do eixo. */
  weekStart: string;
  /** Domingo da mesma semana (YYYY-MM-DD). */
  weekEnd: string;
  /** Valor com que a semana fechou (último snapshot dentro dela). */
  totalValue: number;
  materialsWithStock: number;
  materialsConsidered: number;
  /** Quantas fotos existiram na semana (contexto de confiabilidade). */
  snapshotCount: number;
  /** Data civil do snapshot que representa a semana. */
  representativeCivilDate: string;
  /**
   * Variação absoluta em relação à semana anterior COM dado.
   * `null` na primeira semana da série (não há com o que comparar) —
   * nunca 0, que significaria "não mudou".
   */
  deltaFromPreviousWeek: number | null;
  /** Variação percentual; `null` quando não há anterior ou anterior é zero. */
  deltaPercentFromPreviousWeek: number | null;
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
 * Agrega snapshots em pontos semanais.
 *
 * Regra: dentro de cada semana ISO, vence o snapshot de `capturedAt` mais
 * recente (desempate por `civilDate` quando o instante empatar). Semanas sem
 * nenhum snapshot simplesmente não aparecem — a série não inventa pontos, e
 * o gráfico liga os que existem.
 */
export function aggregateMaterialStockValueByWeek(
  snapshots: readonly MaterialStockValueSnapshotPoint[]
): MaterialStockValueWeekPoint[] {
  if (snapshots.length === 0) return [];

  const byWeek = new Map<string, MaterialStockValueSnapshotPoint>();
  const countByWeek = new Map<string, number>();

  for (const snap of snapshots) {
    if (!snap.civilDate) continue;
    const weekStart = resolveIsoWeekStart(snap.civilDate);
    countByWeek.set(weekStart, (countByWeek.get(weekStart) ?? 0) + 1);

    const current = byWeek.get(weekStart);
    if (!current) {
      byWeek.set(weekStart, snap);
      continue;
    }
    // Mais recente vence: compara instante e, em empate, a data civil.
    const isNewer =
      snap.capturedAt > current.capturedAt ||
      (snap.capturedAt === current.capturedAt &&
        snap.civilDate > current.civilDate);
    if (isNewer) byWeek.set(weekStart, snap);
  }

  const weeks = [...byWeek.keys()].sort();
  const out: MaterialStockValueWeekPoint[] = [];
  let previousValue: number | null = null;

  for (const weekStart of weeks) {
    const snap = byWeek.get(weekStart)!;
    const totalValue = roundValue(snap.totalValue);
    const delta = previousValue != null ? roundValue(totalValue - previousValue) : null;
    const deltaPercent =
      previousValue != null && previousValue !== 0
        ? Math.round(((totalValue - previousValue) / Math.abs(previousValue)) * 10000) / 100
        : null;

    out.push({
      weekStart,
      weekEnd: resolveIsoWeekEnd(weekStart),
      totalValue,
      materialsWithStock: snap.materialsWithStock,
      materialsConsidered: snap.materialsConsidered,
      snapshotCount: countByWeek.get(weekStart) ?? 1,
      representativeCivilDate: snap.civilDate,
      deltaFromPreviousWeek: delta,
      deltaPercentFromPreviousWeek: deltaPercent,
    });
    previousValue = totalValue;
  }

  return out;
}

export type MaterialStockValueSeriesSummary = {
  /** Valor mais recente da série (última semana com dado). */
  latestValue: number | null;
  latestWeekStart: string | null;
  /** Variação da última semana em relação à anterior. */
  latestDelta: number | null;
  latestDeltaPercent: number | null;
  /** Maior e menor valor observados no período. */
  maxValue: number | null;
  maxWeekStart: string | null;
  minValue: number | null;
  minWeekStart: string | null;
  /** Quantas semanas têm dado. */
  weeksWithData: number;
  /** Total de fotos no período (contexto de densidade). */
  totalSnapshots: number;
};

/** Resumo para os cards ao lado do gráfico — derivado da própria série. */
export function summarizeMaterialStockValueSeries(
  weeks: readonly MaterialStockValueWeekPoint[]
): MaterialStockValueSeriesSummary {
  if (weeks.length === 0) {
    return {
      latestValue: null,
      latestWeekStart: null,
      latestDelta: null,
      latestDeltaPercent: null,
      maxValue: null,
      maxWeekStart: null,
      minValue: null,
      minWeekStart: null,
      weeksWithData: 0,
      totalSnapshots: 0,
    };
  }

  const last = weeks[weeks.length - 1]!;
  let maxValue = weeks[0]!.totalValue;
  let maxWeekStart = weeks[0]!.weekStart;
  let minValue = weeks[0]!.totalValue;
  let minWeekStart = weeks[0]!.weekStart;
  let totalSnapshots = 0;

  for (const w of weeks) {
    if (w.totalValue > maxValue) {
      maxValue = w.totalValue;
      maxWeekStart = w.weekStart;
    }
    if (w.totalValue < minValue) {
      minValue = w.totalValue;
      minWeekStart = w.weekStart;
    }
    totalSnapshots += w.snapshotCount;
  }

  return {
    latestValue: last.totalValue,
    latestWeekStart: last.weekStart,
    latestDelta: last.deltaFromPreviousWeek,
    latestDeltaPercent: last.deltaPercentFromPreviousWeek,
    maxValue,
    maxWeekStart,
    minValue,
    minWeekStart,
    weeksWithData: weeks.length,
    totalSnapshots,
  };
}

/** Rótulo curto pt-BR do eixo: "05/08" (segunda da semana). */
export function formatWeekAxisLabel(weekStart: string): string {
  const [, m, d] = weekStart.slice(0, 10).split("-");
  return `${d}/${m}`;
}

/** Resposta do endpoint da série — contrato compartilhado client/servidor. */
export type MaterialStockValueSeriesResponse = {
  weeks: MaterialStockValueWeekPoint[];
  summary: MaterialStockValueSeriesSummary;
  /** Janela consultada, em semanas. */
  weeksRequested: number;
  /** Data civil do snapshot mais recente (null quando não há histórico). */
  lastCapturedCivilDate: string | null;
};
