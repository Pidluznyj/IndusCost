/**
 * KPIs compactos do Kanban — Fluxo de Pedidos.
 * Total filtrado e SLA (emissão → concluído) com média aparada.
 */

export type SalesOrderFlowKanbanValueColumn = {
  orderValue: number | null;
  isCanceledColumn?: boolean;
};

/**
 * Soma o valor dos pedidos no filtro (colunas operacionais / resumo).
 * Ignora coluna cancelada quando marcada.
 */
export function sumSalesOrderFlowFilteredOrderValue(
  columns: ReadonlyArray<SalesOrderFlowKanbanValueColumn>
): number | null {
  let sum = 0;
  let any = false;
  for (const column of columns) {
    if (column.isCanceledColumn) continue;
    if (column.orderValue == null || !Number.isFinite(column.orderValue)) continue;
    sum += column.orderValue;
    any = true;
  }
  return any ? sum : null;
}

/**
 * Dias civis entre emissão e conclusão (não negativos).
 */
export function salesOrderFlowCycleDays(
  issueDate: Date | string | null | undefined,
  completedAt: Date | string | null | undefined
): number | null {
  if (issueDate == null || completedAt == null) return null;
  const start = issueDate instanceof Date ? issueDate : new Date(issueDate);
  const end = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - start.getTime();
  if (!(ms >= 0)) return null;
  return ms / (24 * 60 * 60 * 1000);
}

/**
 * Média aparada: remove caudas muito baixas e muito altas (P10–P90).
 * Amostras pequenas: n≥3 remove min/máx; n<3 usa a média simples.
 */
export function trimmedMean(values: ReadonlyArray<number>): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const sorted = [...finite].sort((a, b) => a - b);
  const n = sorted.length;

  let slice: number[];
  if (n >= 10) {
    const trim = Math.max(1, Math.floor(n * 0.1));
    slice = sorted.slice(trim, n - trim);
  } else if (n >= 3) {
    slice = sorted.slice(1, n - 1);
  } else {
    slice = sorted;
  }
  if (slice.length === 0) return null;
  const avg = slice.reduce((acc, v) => acc + v, 0) / slice.length;
  return Number.isFinite(avg) ? avg : null;
}

export function computeSalesOrderFlowAvgCycleDaysTrimmed(
  rows: ReadonlyArray<{
    issueDate: Date | string | null | undefined;
    completedAt: Date | string | null | undefined;
  }>
): { avgDays: number | null; sampleSize: number; usedSize: number } {
  const days: number[] = [];
  for (const row of rows) {
    const value = salesOrderFlowCycleDays(row.issueDate, row.completedAt);
    if (value != null) days.push(value);
  }
  const avg = trimmedMean(days);
  let usedSize = 0;
  if (days.length >= 10) {
    const trim = Math.max(1, Math.floor(days.length * 0.1));
    usedSize = Math.max(0, days.length - trim * 2);
  } else if (days.length >= 3) {
    usedSize = days.length - 2;
  } else {
    usedSize = days.length;
  }
  return {
    avgDays: avg,
    sampleSize: days.length,
    usedSize,
  };
}

export function formatSalesOrderFlowSlaDaysLabel(
  avgDays: number | null
): string {
  if (avgDays == null || !Number.isFinite(avgDays)) return "—";
  const rounded =
    avgDays >= 10
      ? Math.round(avgDays)
      : Math.round(avgDays * 10) / 10;
  const text = rounded.toLocaleString("pt-BR", {
    maximumFractionDigits: avgDays >= 10 ? 0 : 1,
  });
  return Number(rounded) === 1 ? `${text} dia` : `${text} dias`;
}
