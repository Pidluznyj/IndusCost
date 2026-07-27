/**
 * Paginação e ordenação autorizada da Tesouraria (client-safe).
 */

import {
  TREASURY_DEFAULT_PAGE,
  TREASURY_DEFAULT_PAGE_SIZE,
  TREASURY_MAX_PAGE_SIZE,
  TREASURY_MIN_PAGE_SIZE,
} from "./treasuryConstants.js";
import {
  TREASURY_SORT_DIRECTIONS,
  type TreasurySortDirection,
} from "./treasuryEnums.js";
import { TreasuryContractError } from "./treasuryErrorCodes.js";

export type TreasuryPaginationInput = {
  page: number;
  pageSize: number;
};

export type TreasuryPaginationMeta = TreasuryPaginationInput & {
  totalRows: number;
  totalPages: number;
};

export type TreasurySortInput<TField extends string> = {
  sortBy: TField;
  sortDirection: TreasurySortDirection;
};

export function parseTreasuryPage(value: unknown, field = "page"): number {
  if (value == null || value === "") return TREASURY_DEFAULT_PAGE;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} inválido.`,
      field
    );
  }
  return n;
}

export function parseTreasuryPageSize(
  value: unknown,
  field = "pageSize"
): number {
  if (value == null || value === "") return TREASURY_DEFAULT_PAGE_SIZE;
  const n = typeof value === "number" ? value : Number(String(value));
  if (
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < TREASURY_MIN_PAGE_SIZE
  ) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} inválido.`,
      field
    );
  }
  if (n > TREASURY_MAX_PAGE_SIZE) {
    throw new TreasuryContractError(
      "PAYLOAD_TOO_LARGE",
      `${field} excede o máximo (${TREASURY_MAX_PAGE_SIZE}).`,
      field
    );
  }
  return n;
}

export function parseTreasuryPagination(
  query: Record<string, unknown>
): TreasuryPaginationInput {
  return {
    page: parseTreasuryPage(query.page),
    pageSize: parseTreasuryPageSize(query.pageSize),
  };
}

export function buildTreasuryPaginationMeta(input: {
  page: number;
  pageSize: number;
  totalRows: number;
}): TreasuryPaginationMeta {
  const totalPages = Math.max(
    1,
    Math.ceil(input.totalRows / input.pageSize) || 1
  );
  return {
    page: input.page,
    pageSize: input.pageSize,
    totalRows: input.totalRows,
    totalPages,
  };
}

export function parseTreasurySortDirection(
  value: unknown,
  fallback: TreasurySortDirection = "asc"
): TreasurySortDirection {
  if (value == null || value === "") return fallback;
  const dir = String(value).trim().toLowerCase();
  if (!(TREASURY_SORT_DIRECTIONS as readonly string[]).includes(dir)) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "sortDirection inválido (asc|desc).",
      "sortDirection"
    );
  }
  return dir as TreasurySortDirection;
}

/**
 * Ordenação autorizada — campo fora da whitelist é negado (não silenciosamente ignorado).
 */
export function parseTreasuryAuthorizedSort<TField extends string>(input: {
  sortBy: unknown;
  sortDirection?: unknown;
  allowed: readonly TField[];
  defaultSortBy: TField;
  defaultSortDirection?: TreasurySortDirection;
  required?: boolean;
}): TreasurySortInput<TField> {
  const fallbackDir = input.defaultSortDirection ?? "asc";
  if (input.sortBy == null || input.sortBy === "") {
    if (input.required) {
      throw new TreasuryContractError(
        "REQUIRED_FIELD",
        "sortBy é obrigatório.",
        "sortBy"
      );
    }
    return {
      sortBy: input.defaultSortBy,
      sortDirection: parseTreasurySortDirection(
        input.sortDirection,
        fallbackDir
      ),
    };
  }
  const sortBy = String(input.sortBy).trim();
  if (!(input.allowed as readonly string[]).includes(sortBy)) {
    throw new TreasuryContractError(
      "UNKNOWN_SORT_FIELD",
      `sortBy não autorizado: ${sortBy}.`,
      "sortBy"
    );
  }
  return {
    sortBy: sortBy as TField,
    sortDirection: parseTreasurySortDirection(input.sortDirection, fallbackDir),
  };
}
