/**
 * Conversão de propostas em pedido de venda — série YTD e período default.
 *
 * A taxa mensal é a população do ano civil corrente em America/Sao_Paulo.
 * Não recebe filtro de lista (status, cliente, responsável, período, valor).
 *
 * Convertida = já tem pedido de venda OU status APPROVED.
 * É a mesma regra do card da listagem, para o gráfico e o indicador falarem
 * a mesma coisa.
 */

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

export const PROPOSAL_CONVERSION_MONTH_LABELS = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const;

export type ProposalConversionMonthInput = {
  commercialDate: Date | string;
  status: string;
  totalNetValue: number | string | null;
  hasSalesOrder: boolean;
};

export type ProposalConversionMonthPoint = {
  month: number;
  monthLabel: string;
  totalCount: number;
  convertedCount: number;
  convertedAmount: number;
  /** Null quando o mês ainda não começou ou não há propostas. 0% é conversão real. */
  conversionRate: number | null;
  isFuture: boolean;
};

export type ProposalConversionYtdPayload = {
  year: number;
  throughMonth: number;
  months: ProposalConversionMonthPoint[];
};

export function isProposalConvertedToSalesOrder(input: {
  status: string;
  hasSalesOrder: boolean;
}): boolean {
  return input.hasSalesOrder || input.status === "APPROVED";
}

/** Ano e mês civis (1–12) em America/Sao_Paulo. */
export function saoPauloCivilYearMonth(instant: Date = new Date()): {
  year: number;
  month: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  }).formatToParts(instant);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
    return { year, month };
  }
  return { year: instant.getFullYear(), month: instant.getMonth() + 1 };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Período com que a listagem de propostas abre: dia 1 até o último dia do
 * mês civil corrente, em America/Sao_Paulo. Strings `YYYY-MM-DD` do input date.
 */
export function currentMonthProposalListRange(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const { year, month } = saoPauloCivilYearMonth(now);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthText = pad2(month);
  return {
    startDate: `${year}-${monthText}-01`,
    endDate: `${year}-${monthText}-${pad2(lastDay)}`,
  };
}

/**
 * Janela [gte, lt) do ano civil em America/Sao_Paulo.
 * O fuso não observa horário de verão desde 2019 (UTC−3 o ano inteiro).
 */
export function proposalCalendarYearWindow(year: number): { gte: Date; lt: Date } {
  return {
    gte: new Date(Date.UTC(year, 0, 1, 3, 0, 0, 0)),
    lt: new Date(Date.UTC(year + 1, 0, 1, 3, 0, 0, 0)),
  };
}

function netAmount(value: number | string | null): number {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Doze meses do ano. Meses depois de `throughMonth` ficam vazios (YTD).
 * Mês passado sem proposta tem taxa null — não é 0%.
 */
export function buildProposalConversionYtdSeries(
  rows: readonly ProposalConversionMonthInput[],
  options: { year: number; throughMonth: number }
): ProposalConversionMonthPoint[] {
  const throughMonth = Math.min(12, Math.max(0, options.throughMonth));
  const buckets = PROPOSAL_CONVERSION_MONTH_LABELS.map(() => ({
    totalCount: 0,
    convertedCount: 0,
    convertedAmount: 0,
  }));

  for (const row of rows) {
    const instant =
      row.commercialDate instanceof Date
        ? row.commercialDate
        : new Date(row.commercialDate);
    if (Number.isNaN(instant.getTime())) continue;
    const { year, month } = saoPauloCivilYearMonth(instant);
    if (year !== options.year || month < 1 || month > throughMonth) continue;
    const bucket = buckets[month - 1];
    if (!bucket) continue;
    bucket.totalCount += 1;
    if (isProposalConvertedToSalesOrder(row)) {
      bucket.convertedCount += 1;
      bucket.convertedAmount += netAmount(row.totalNetValue);
    }
  }

  return PROPOSAL_CONVERSION_MONTH_LABELS.map((monthLabel, index) => {
    const month = index + 1;
    const isFuture = month > throughMonth;
    const bucket = buckets[index]!;
    const conversionRate =
      !isFuture && bucket.totalCount > 0
        ? (bucket.convertedCount / bucket.totalCount) * 100
        : null;
    return {
      month,
      monthLabel,
      totalCount: isFuture ? 0 : bucket.totalCount,
      convertedCount: isFuture ? 0 : bucket.convertedCount,
      convertedAmount: isFuture ? 0 : bucket.convertedAmount,
      conversionRate,
      isFuture,
    };
  });
}
