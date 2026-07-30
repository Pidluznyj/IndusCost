/**
 * Apresentação dos títulos CR/CP por conta (modal tela cheia).
 * Frontend-safe: sem Prisma.
 */

import type { TreasuryCrCpTitleDto } from "./treasuryPredictiveCrCpByAccountRules.js";
import { treasuryMoneyToNumber } from "../treasuryPredictiveCashFlow.js";

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

export type TreasuryCrCpTitlesPresentationFilters = {
  situation: TreasuryCrCpTitlesSituationFilter;
  /** Nome exato do cliente/fornecedor; vazio = todos. */
  counterparty: string;
  /** Busca livre em documento / parcela / conta Nomus. */
  query: string;
};

export const EMPTY_TREASURY_CRCP_TITLES_FILTERS: TreasuryCrCpTitlesPresentationFilters =
  {
    situation: "ALL",
    counterparty: "",
    query: "",
  };

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

export function filterTreasuryCrCpTitles(
  titles: readonly TreasuryCrCpTitleDto[],
  filters: TreasuryCrCpTitlesPresentationFilters
): TreasuryCrCpTitleDto[] {
  const counterparty = filters.counterparty.trim();
  const query = filters.query.trim().toLowerCase();
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
