/**
 * Filtro executivo de período (Ano/Mês) para Pedidos de Venda.
 *
 * Módulo puro (sem Prisma/Node), compartilhado entre frontend e backend.
 * A base do filtro é sempre `SalesOrder.issueDate` (data de emissão) —
 * nunca NF-e, processamento, entrega ou criação.
 *
 * Convenção de fuso: usa horário local (igual aos demais filtros de data da
 * rota GET /api/sales-orders, que constroem `new Date("YYYY-MM-DDT00:00:00")`).
 */

export const SALES_ORDER_MONTH_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Janeiro" },
  { value: 2, label: "Fevereiro" },
  { value: 3, label: "Março" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Maio" },
  { value: 6, label: "Junho" },
  { value: 7, label: "Julho" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Setembro" },
  { value: 10, label: "Outubro" },
  { value: 11, label: "Novembro" },
  { value: 12, label: "Dezembro" },
];

/** Anos para o select: do ano atual até `currentYear - span` (default 5). */
export function buildSalesOrderYearOptions(currentYear: number, span = 5): number[] {
  if (!Number.isInteger(currentYear)) return [];
  const years: number[] = [];
  for (let year = currentYear; year >= currentYear - span; year -= 1) {
    years.push(year);
  }
  return years;
}

export function isValidSalesOrderYear(year: unknown): year is number {
  return (
    typeof year === "number" &&
    Number.isInteger(year) &&
    year >= 1970 &&
    year <= 9999
  );
}

export function isValidSalesOrderMonth(month: unknown): month is number {
  return (
    typeof month === "number" &&
    Number.isInteger(month) &&
    month >= 1 &&
    month <= 12
  );
}

/** Lê o query param `year`; retorna null quando ausente/ inválido (filtro ignorado). */
export function parseSalesOrderYearParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  return isValidSalesOrderYear(parsed) ? parsed : null;
}

/** Lê o query param `month` (1-12); retorna null quando ausente/ inválido. */
export function parseSalesOrderMonthParam(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  return isValidSalesOrderMonth(parsed) ? parsed : null;
}

/**
 * Resolve o intervalo de `issueDate` para o filtro Ano/Mês.
 *
 * - Só `year`:         [year-01-01, (year+1)-01-01)
 * - `year` + `month`:  [year-month-01, próximo mês-01)  (fim exclusivo)
 * - `month=12`:        [year-12-01, (year+1)-01-01)     (virada de dezembro)
 *
 * Retorna null quando o ano é inválido (o mês isolado é ignorado sem ano).
 * O fim é sempre exclusivo (`lt`).
 */
export function resolveSalesOrderIssueDateRange(
  year: number | null | undefined,
  month: number | null | undefined
): { gte: Date; lt: Date } | null {
  if (!isValidSalesOrderYear(year)) return null;

  if (isValidSalesOrderMonth(month)) {
    // new Date(year, month, 1) usa índice 0-based; passar `month` (1-based) aponta
    // para o mês seguinte e cobre a virada de dezembro (mês 12 -> Jan do ano+1).
    return {
      gte: new Date(year, month - 1, 1, 0, 0, 0, 0),
      lt: new Date(year, month, 1, 0, 0, 0, 0),
    };
  }

  return {
    gte: new Date(year, 0, 1, 0, 0, 0, 0),
    lt: new Date(year + 1, 0, 1, 0, 0, 0, 0),
  };
}
