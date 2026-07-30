/**
 * Apresentação dos títulos CR/CP por conta (modal tela cheia).
 * Frontend-safe: sem Prisma.
 */

import type { TreasuryCrCpTitleDto } from "./treasuryPredictiveCrCpByAccountRules.js";
import { treasuryMoneyToNumber } from "../treasuryPredictiveCashFlow.js";
import { SALES_ORDER_MONTH_OPTIONS } from "../../salesOrderPeriodFilter.js";

export type TreasuryCrCpTitlesSituationFilter = "ALL" | "OVERDUE" | "UPCOMING";

export type TreasuryCrCpTitlesSortKey =
  | "dueDate"
  | "situation"
  | "counterpartyName"
  | "documentNumber"
  | "installmentLabel"
  | "originalAmount"
  | "settledAmount"
  | "openBalance"
  | "nomusFinancialAccountName"
  | "destinationBucketLabel";

export type TreasuryCrCpTitlesSortDir = "asc" | "desc";

/** `all` = janeiro–dezembro; array = meses específicos (1–12). */
export type TreasuryCrCpTitlesMonthsFilter = number[] | "all";

export type TreasuryCrCpTitlesPresentationFilters = {
  situation: TreasuryCrCpTitlesSituationFilter;
  /** Nome exato do cliente/fornecedor; vazio = todos. */
  counterparty: string;
  /** Busca livre em documento / parcela / conta Nomus. */
  query: string;
  /** Ano do vencimento; `null` = todos. */
  year: number | null;
  /** Meses do vencimento; `all` = todos. */
  months: TreasuryCrCpTitlesMonthsFilter;
};

export const TREASURY_CRCP_TITLES_ALL_MONTHS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;

export const TREASURY_CRCP_TITLES_MONTH_OPTIONS = SALES_ORDER_MONTH_OPTIONS;

export const EMPTY_TREASURY_CRCP_TITLES_FILTERS: TreasuryCrCpTitlesPresentationFilters =
  {
    situation: "ALL",
    counterparty: "",
    query: "",
    year: null,
    months: "all",
  };

export function parseTreasuryCrCpTitleDueYearMonth(
  dueDate: string | null | undefined
): { year: number; month: number } | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  const year = Number(dueDate.slice(0, 4));
  const month = Number(dueDate.slice(5, 7));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }
  return { year, month };
}

export function listTreasuryCrCpTitleDueYears(
  titles: readonly TreasuryCrCpTitleDto[],
  now: Date = new Date()
): number[] {
  const years = new Set<number>();
  const currentYear = now.getFullYear();
  if (Number.isInteger(currentYear)) years.add(currentYear);
  for (const title of titles) {
    const ym = parseTreasuryCrCpTitleDueYearMonth(title.dueDate);
    if (ym) years.add(ym.year);
  }
  return [...years].sort((a, b) => b - a);
}

export function resolveTreasuryCrCpTitlesMonths(
  months: TreasuryCrCpTitlesMonthsFilter
): number[] {
  if (months === "all") return [...TREASURY_CRCP_TITLES_ALL_MONTHS];
  const unique = [
    ...new Set(
      months.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
    ),
  ];
  return unique.sort((a, b) => a - b);
}

export function isTreasuryCrCpTitlesAllMonths(
  months: TreasuryCrCpTitlesMonthsFilter
): boolean {
  if (months === "all") return true;
  const resolved = resolveTreasuryCrCpTitlesMonths(months);
  return (
    resolved.length === 12 &&
    TREASURY_CRCP_TITLES_ALL_MONTHS.every((m, idx) => resolved[idx] === m)
  );
}

export function formatTreasuryCrCpTitlesMonthsLabel(
  months: TreasuryCrCpTitlesMonthsFilter
): string {
  if (isTreasuryCrCpTitlesAllMonths(months)) return "Todos os meses";
  const resolved = resolveTreasuryCrCpTitlesMonths(months);
  if (resolved.length === 0) return "Todos os meses";
  const labels = resolved.map((month) => {
    const opt = TREASURY_CRCP_TITLES_MONTH_OPTIONS.find((m) => m.value === month);
    return opt?.label ?? String(month);
  });
  if (labels.length <= 3) return labels.join(", ");
  return `${labels.length} meses selecionados`;
}

export function listTreasuryCrCpTitleCounterparties(
  titles: readonly TreasuryCrCpTitleDto[]
): string[] {
  const names = new Set<string>();
  for (const title of titles) {
    const name = title.counterpartyName?.trim();
    if (name) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

export function sumTreasuryCrCpTitlesOpenBalance(
  titles: readonly TreasuryCrCpTitleDto[]
): number {
  let total = 0;
  for (const title of titles) {
    total += treasuryMoneyToNumber(title.openBalance);
  }
  return Math.round(total * 100) / 100;
}

export function filterTreasuryCrCpTitles(
  titles: readonly TreasuryCrCpTitleDto[],
  filters: TreasuryCrCpTitlesPresentationFilters
): TreasuryCrCpTitleDto[] {
  const counterparty = filters.counterparty.trim();
  const query = filters.query.trim().toLowerCase();
  const yearFilter = filters.year;
  const allMonths = isTreasuryCrCpTitlesAllMonths(filters.months);
  const monthsSet = allMonths
    ? null
    : new Set(resolveTreasuryCrCpTitlesMonths(filters.months));
  const hasPeriodFilter = yearFilter != null || monthsSet != null;

  return titles.filter((title) => {
    if (filters.situation === "OVERDUE" && title.situation !== "OVERDUE") {
      return false;
    }
    if (filters.situation === "UPCOMING" && title.situation !== "UPCOMING") {
      return false;
    }
    if (counterparty && (title.counterpartyName?.trim() ?? "") !== counterparty) {
      return false;
    }
    if (hasPeriodFilter) {
      const ym = parseTreasuryCrCpTitleDueYearMonth(title.dueDate);
      if (!ym) return false;
      if (yearFilter != null && ym.year !== yearFilter) return false;
      if (monthsSet && !monthsSet.has(ym.month)) return false;
    }
    if (!query) return true;
    const haystack = [
      title.counterpartyName,
      title.documentNumber,
      title.installmentLabel,
      title.nomusFinancialAccountName,
      title.destinationBucketLabel,
      title.nomusFinancialAccountId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", "pt-BR", { sensitivity: "base" });
}

function compareMoney(
  a: string | null | undefined,
  b: string | null | undefined
): number {
  return treasuryMoneyToNumber(a) - treasuryMoneyToNumber(b);
}

function compareTitlesByKey(
  a: TreasuryCrCpTitleDto,
  b: TreasuryCrCpTitleDto,
  key: TreasuryCrCpTitlesSortKey
): number {
  switch (key) {
    case "dueDate":
      return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    case "situation":
      if (a.situation === b.situation) return 0;
      return a.situation === "OVERDUE" ? -1 : 1;
    case "counterpartyName":
      return compareText(a.counterpartyName, b.counterpartyName);
    case "documentNumber":
      return compareText(a.documentNumber, b.documentNumber);
    case "installmentLabel":
      return compareText(a.installmentLabel, b.installmentLabel);
    case "originalAmount":
      return compareMoney(a.originalAmount, b.originalAmount);
    case "settledAmount":
      return compareMoney(a.settledAmount, b.settledAmount);
    case "openBalance":
      return compareMoney(a.openBalance, b.openBalance);
    case "nomusFinancialAccountName":
      return compareText(
        a.nomusFinancialAccountName ?? a.nomusFinancialAccountId,
        b.nomusFinancialAccountName ?? b.nomusFinancialAccountId
      );
    case "destinationBucketLabel":
      return compareText(a.destinationBucketLabel, b.destinationBucketLabel);
    default:
      return 0;
  }
}

export function sortTreasuryCrCpTitles(
  titles: readonly TreasuryCrCpTitleDto[],
  sortKey: TreasuryCrCpTitlesSortKey,
  sortDir: TreasuryCrCpTitlesSortDir
): TreasuryCrCpTitleDto[] {
  const factor = sortDir === "asc" ? 1 : -1;
  return [...titles].sort((a, b) => {
    const primary = compareTitlesByKey(a, b, sortKey);
    if (primary !== 0) return primary * factor;
    // Desempate estável: vencimento → id
    const due = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    if (due !== 0) return due;
    return a.id.localeCompare(b.id);
  });
}

export function presentTreasuryCrCpTitles(
  titles: readonly TreasuryCrCpTitleDto[],
  filters: TreasuryCrCpTitlesPresentationFilters,
  sortKey: TreasuryCrCpTitlesSortKey,
  sortDir: TreasuryCrCpTitlesSortDir
): TreasuryCrCpTitleDto[] {
  return sortTreasuryCrCpTitles(
    filterTreasuryCrCpTitles(titles, filters),
    sortKey,
    sortDir
  );
}

export function toggleTreasuryCrCpTitlesSort(
  currentKey: TreasuryCrCpTitlesSortKey,
  currentDir: TreasuryCrCpTitlesSortDir,
  nextKey: TreasuryCrCpTitlesSortKey
): { sortKey: TreasuryCrCpTitlesSortKey; sortDir: TreasuryCrCpTitlesSortDir } {
  if (currentKey === nextKey) {
    return { sortKey: nextKey, sortDir: currentDir === "asc" ? "desc" : "asc" };
  }
  return { sortKey: nextKey, sortDir: "asc" };
}
