/**
 * Período canônico do REALIZADO financeiro (Recebido / Pago).
 *
 * Não é um segundo motor: só resolve a janela temporal que os primitives
 * oficiais (`sumFinanceArReceivedBySettlementInPeriod` /
 * `sumFinanceApPaidInPaymentPeriod`) já aplicam sobre a data do movimento.
 *
 * - mês explícito → calendário daquele mês (cap no YTD do ano corrente);
 * - ano sem mês, ou sem recorte temporal → YTD oficial
 *   (ano corrente: 01/01 → data-base; ano encerrado: 01/01 → 31/12).
 */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export type FinanceCanonicalRealizedPeriodKind = "month" | "ytd";

export type FinanceCanonicalRealizedPeriod = {
  kind: FinanceCanonicalRealizedPeriodKind;
  periodStart: Date;
  periodEnd: Date;
};

/** Janela Prisma `[from, toExclusive)` para admitir movimento no ano além do vencimento. */
export type FinanceCanonicalRealizedLoadWindow = {
  from: Date;
  toExclusive: Date;
};

export function resolveFinanceCanonicalRealizedPeriod(
  filters: { year?: number; month?: number },
  referenceDate: Date
): FinanceCanonicalRealizedPeriod {
  const today = startOfLocalDay(referenceDate);
  const year = filters.year ?? referenceDate.getFullYear();
  const isCurrentYear = year === referenceDate.getFullYear();
  const ytdStart = startOfLocalDay(new Date(year, 0, 1));
  const ytdEnd = isCurrentYear ? today : startOfLocalDay(new Date(year, 11, 31));

  if (filters.month != null) {
    const monthStart = startOfLocalDay(new Date(year, filters.month - 1, 1));
    const monthEnd = endOfLocalDay(new Date(year, filters.month, 0));
    const ytdEndInclusive = endOfLocalDay(ytdEnd);
    const periodEnd = monthEnd.getTime() <= ytdEndInclusive.getTime() ? monthEnd : ytdEndInclusive;
    return { kind: "month", periodStart: monthStart, periodEnd };
  }

  return { kind: "ytd", periodStart: ytdStart, periodEnd: ytdEnd };
}

/** Ano civil completo — mesma janela de baixa que o Fluxo de Caixa admite além do vencimento. */
export function resolveFinanceCanonicalRealizedLoadWindow(
  year: number | undefined
): FinanceCanonicalRealizedLoadWindow | null {
  if (year == null) return null;
  return {
    from: new Date(year, 0, 1, 0, 0, 0, 0),
    toExclusive: new Date(year + 1, 0, 1, 0, 0, 0, 0),
  };
}
