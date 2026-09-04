/**
 * Contrato único de período (Ano/Mês) do CRM Comercial.
 *
 * Regra de produto (auditoria CRM 09/2026): toda tela analítica/operacional
 * do CRM mostra Ano + Mês de forma explícita. O ano vigente é sempre
 * derivado em runtime (fuso America/Sao_Paulo) — nunca hardcoded. O mês
 * default depende da natureza da tela:
 *   - movimento/performance (Gestão por Responsável) → mês atual;
 *   - carteira/relacionamento (Carteira de Clientes) → "Ano inteiro".
 *
 * Usado por `CrmPeriodFilterBar` (src/components/crm/CrmPeriodFilterBar.tsx).
 * Mantido separado da UI porque a resolução de ano/mês/intervalo de datas é
 * pura e precisa ser testável sem renderizar React.
 */

export type CrmPeriodFilter = {
  /** Ano com 4 dígitos, como string. Sempre explícito nestas telas. */
  year: string;
  /** Mês 1..12 como string, ou "" para "ano inteiro". */
  month: string;
};

export const CRM_PERIOD_MONTH_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Ano inteiro" },
  { value: "1", label: "Janeiro" },
  { value: "2", label: "Fevereiro" },
  { value: "3", label: "Março" },
  { value: "4", label: "Abril" },
  { value: "5", label: "Maio" },
  { value: "6", label: "Junho" },
  { value: "7", label: "Julho" },
  { value: "8", label: "Agosto" },
  { value: "9", label: "Setembro" },
  { value: "10", label: "Outubro" },
  { value: "11", label: "Novembro" },
  { value: "12", label: "Dezembro" },
];

const SAO_PAULO_TIME_ZONE = "America/Sao_Paulo";

/** Ano/mês vigentes no fuso operacional — nunca hardcode um ano fixo. */
export function resolveCrmCurrentYearMonth(now: Date = new Date()): { year: number; month: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: SAO_PAULO_TIME_ZONE,
      year: "numeric",
      month: "numeric",
    }).formatToParts(now);
    const year = Number(parts.find((p) => p.type === "year")?.value);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    if (Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12) {
      return { year, month };
    }
  } catch {
    // Intl/timeZone indisponível (ambiente de teste antigo) — cai no fallback local.
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/** Anos exibidos no seletor: ano vigente + N anteriores (nunca hardcoded). */
export function buildCrmPeriodYearOptions(spanBack = 4, now: Date = new Date()): number[] {
  const { year } = resolveCrmCurrentYearMonth(now);
  return Array.from({ length: spanBack + 1 }, (_, i) => year - i);
}

export type CrmPeriodMonthDefault = "current" | "all";

/** Default oficial de cada tela: "current" = mês vigente, "all" = ano inteiro. */
export function buildDefaultCrmPeriodFilter(
  monthDefault: CrmPeriodMonthDefault,
  now: Date = new Date()
): CrmPeriodFilter {
  const { year, month } = resolveCrmCurrentYearMonth(now);
  return {
    year: String(year),
    month: monthDefault === "current" ? String(month) : "",
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/**
 * Converte {year, month} em [dateFrom, dateTo] (YYYY-MM-DD, intervalo
 * inclusivo). month="" = ano inteiro (01/01 a 31/12). Retorna null para
 * entrada inválida (ano vazio/NaN, mês fora de 1..12).
 */
export function buildCrmPeriodDateRange(
  period: CrmPeriodFilter
): { dateFrom: string; dateTo: string } | null {
  const yearTrim = period.year.trim();
  const year = Number(yearTrim);
  if (yearTrim === "" || !Number.isFinite(year) || !/^\d{4}$/.test(yearTrim)) return null;

  const monthTrim = period.month.trim();
  if (monthTrim === "") {
    return { dateFrom: `${yearTrim}-01-01`, dateTo: `${yearTrim}-12-31` };
  }
  const month = Number(monthTrim);
  if (!Number.isFinite(month) || month < 1 || month > 12) return null;
  const lastDay = lastDayOfMonth(year, month);
  return {
    dateFrom: `${yearTrim}-${pad2(month)}-01`,
    dateTo: `${yearTrim}-${pad2(month)}-${pad2(lastDay)}`,
  };
}

/** Lê {year, month} de query params com prefixo (`${prefix}Year`/`${prefix}Month`), caindo no default oficial da tela quando ausente/inválido — preserva deep-link explícito. */
export function crmPeriodFilterFromSearchParams(
  params: URLSearchParams,
  prefix: string,
  monthDefault: CrmPeriodMonthDefault,
  now: Date = new Date()
): CrmPeriodFilter {
  const fallback = buildDefaultCrmPeriodFilter(monthDefault, now);
  const year = params.get(`${prefix}Year`);
  const month = params.get(`${prefix}Month`);
  const validYear = year != null && /^\d{4}$/.test(year) ? year : fallback.year;
  const validMonth =
    month != null && (month === "" || /^([1-9]|1[0-2])$/.test(month)) ? month : fallback.month;
  return { year: validYear, month: validMonth };
}

/** Patch de query params para refletir o período atual na URL (deep-link). */
export function crmPeriodFilterToSearchParamsPatch(
  period: CrmPeriodFilter,
  prefix: string
): Record<string, string> {
  return { [`${prefix}Year`]: period.year, [`${prefix}Month`]: period.month };
}
