/**
 * Schemas de validação da Tesouraria (padrão IndusCost: parse tipado).
 * Sem Zod no projeto — helpers fail-closed, sem Prisma.
 */

import {
  TREASURY_DEFAULT_CURRENCY,
  TREASURY_FIELD_LIMITS,
} from "./treasuryConstants.js";
import {
  parseOptionalTreasuryCivilDate,
  parseTreasuryCivilDate,
} from "./treasuryCivilDate.js";
import type {
  TreasuryFinancialAccountDto,
} from "./treasuryDto.js";
import {
  TREASURY_ACCOUNT_SORT_FIELDS,
  TREASURY_ACCOUNT_TYPES,
  TREASURY_CURRENCIES,
  TREASURY_LEDGER_DIRECTIONS,
  TREASURY_LEDGER_NATURES,
  TREASURY_SIDES,
  type TreasuryAccountSortField,
  type TreasuryAccountType,
  type TreasuryCurrency,
  type TreasuryLedgerDirection,
  type TreasuryLedgerNature,
  type TreasurySide,
} from "./treasuryEnums.js";
import { TreasuryContractError } from "./treasuryErrorCodes.js";
import {
  parseOptionalTreasuryMoneyString,
  parseTreasuryMoneyString,
} from "./treasuryMoneyContract.js";
import {
  parseTreasuryAuthorizedSort,
  parseTreasuryPagination,
  type TreasuryPaginationInput,
  type TreasurySortInput,
} from "./treasuryPagination.js";

export type TreasuryCreateAccountInput = {
  code: string;
  name: string;
  accountType: TreasuryAccountType;
  currency: TreasuryCurrency;
  bankCode: string | null;
  agency: string | null;
  accountNumber: string | null;
  nomusBankAccountId: string | null;
  isActive: boolean;
};

export type TreasuryAccountsListQuery = TreasuryPaginationInput &
  TreasurySortInput<TreasuryAccountSortField> & {
    search: string | null;
    isActive: boolean | null;
    accountType: TreasuryAccountType | null;
  };

export type TreasuryManualLedgerEntryInput = {
  accountId: string;
  civilDate: string;
  amount: string;
  direction: TreasuryLedgerDirection;
  nature: TreasuryLedgerNature;
  memo: string | null;
  counterpartRef: string | null;
};

export type TreasuryTransferCreateInput = {
  fromAccountId: string;
  toAccountId: string;
  civilDate: string;
  amount: string;
  memo: string | null;
};

export type TreasuryPromiseCreateInput = {
  side: TreasurySide;
  nomusExternalId: string;
  promisedDate: string;
  promisedAmount: string;
  contactNote: string | null;
};

function asTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

export function parseTreasuryEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
  required = true
): T | null {
  if (value == null || value === "") {
    if (required) {
      throw new TreasuryContractError(
        "REQUIRED_FIELD",
        `${field} é obrigatório.`,
        field
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new TreasuryContractError(
      "INVALID_ENUM",
      `${field} inválido.`,
      field
    );
  }
  const trimmed = value.trim();
  if (!(allowed as readonly string[]).includes(trimmed)) {
    throw new TreasuryContractError(
      "INVALID_ENUM",
      `${field} desconhecido: ${trimmed}.`,
      field
    );
  }
  return trimmed as T;
}

export function parseTreasuryBoundedString(
  value: unknown,
  field: keyof typeof TREASURY_FIELD_LIMITS,
  options?: { required?: boolean }
): string | null {
  const required = options?.required ?? true;
  const max = TREASURY_FIELD_LIMITS[field];
  if (value == null || value === "") {
    if (required) {
      throw new TreasuryContractError(
        "REQUIRED_FIELD",
        `${field} é obrigatório.`,
        field
      );
    }
    return null;
  }
  if (typeof value !== "string") {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} deve ser string.`,
      field
    );
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      throw new TreasuryContractError(
        "REQUIRED_FIELD",
        `${field} é obrigatório.`,
        field
      );
    }
    return null;
  }
  if (trimmed.length > max) {
    throw new TreasuryContractError(
      "PAYLOAD_TOO_LARGE",
      `${field} excede ${max} caracteres.`,
      field
    );
  }
  return trimmed;
}

export function parseTreasuryCreateAccountInput(
  body: Record<string, unknown>
): TreasuryCreateAccountInput {
  const code = parseTreasuryBoundedString(body.code, "code", { required: true });
  const name = parseTreasuryBoundedString(body.name, "name", { required: true });
  const accountType = parseTreasuryEnum(
    body.accountType,
    TREASURY_ACCOUNT_TYPES,
    "accountType",
    true
  );
  const currency =
    parseTreasuryEnum(body.currency, TREASURY_CURRENCIES, "currency", false) ??
    TREASURY_DEFAULT_CURRENCY;

  if (!code || !name || !accountType) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Payload de conta incompleto."
    );
  }

  return {
    code,
    name,
    accountType,
    currency,
    bankCode: parseTreasuryBoundedString(body.bankCode, "bankCode", {
      required: false,
    }),
    agency: parseTreasuryBoundedString(body.agency, "agency", {
      required: false,
    }),
    accountNumber: parseTreasuryBoundedString(
      body.accountNumber,
      "accountNumber",
      { required: false }
    ),
    nomusBankAccountId: parseTreasuryBoundedString(
      body.nomusBankAccountId,
      "nomusBankAccountId",
      { required: false }
    ),
    isActive: body.isActive === false ? false : true,
  };
}

export function parseTreasuryAccountsListQuery(
  query: Record<string, unknown>
): TreasuryAccountsListQuery {
  const pagination = parseTreasuryPagination(query);
  const sort = parseTreasuryAuthorizedSort({
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    allowed: TREASURY_ACCOUNT_SORT_FIELDS,
    defaultSortBy: "code",
    defaultSortDirection: "asc",
  });
  const isActiveRaw = query.isActive;
  let isActive: boolean | null = null;
  if (isActiveRaw != null && isActiveRaw !== "") {
    if (isActiveRaw === true || isActiveRaw === "true" || isActiveRaw === "1") {
      isActive = true;
    } else if (
      isActiveRaw === false ||
      isActiveRaw === "false" ||
      isActiveRaw === "0"
    ) {
      isActive = false;
    } else {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "isActive inválido.",
        "isActive"
      );
    }
  }

  return {
    ...pagination,
    ...sort,
    search: parseTreasuryBoundedString(query.search, "search", {
      required: false,
    }),
    isActive,
    accountType: parseTreasuryEnum(
      query.accountType,
      TREASURY_ACCOUNT_TYPES,
      "accountType",
      false
    ),
  };
}

export function parseTreasuryManualLedgerEntryInput(
  body: Record<string, unknown>
): TreasuryManualLedgerEntryInput {
  const accountId = parseTreasuryBoundedString(body.accountId, "accountId", {
    required: true,
  });
  if (!accountId) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "accountId é obrigatório.",
      "accountId"
    );
  }
  const direction = parseTreasuryEnum(
    body.direction,
    TREASURY_LEDGER_DIRECTIONS,
    "direction",
    true
  );
  const nature = parseTreasuryEnum(
    body.nature,
    TREASURY_LEDGER_NATURES,
    "nature",
    true
  );
  if (!direction || !nature) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Lançamento incompleto."
    );
  }
  return {
    accountId,
    civilDate: parseTreasuryCivilDate(body.civilDate, "civilDate"),
    amount: parseTreasuryMoneyString(body.amount, "amount"),
    direction,
    nature,
    memo: parseTreasuryBoundedString(body.memo, "memo", { required: false }),
    counterpartRef: parseTreasuryBoundedString(
      body.counterpartRef,
      "counterpartRef",
      { required: false }
    ),
  };
}

export function parseTreasuryTransferCreateInput(
  body: Record<string, unknown>
): TreasuryTransferCreateInput {
  const fromAccountId = parseTreasuryBoundedString(
    body.fromAccountId,
    "fromAccountId",
    { required: true }
  );
  const toAccountId = parseTreasuryBoundedString(
    body.toAccountId,
    "toAccountId",
    { required: true }
  );
  if (!fromAccountId || !toAccountId) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "fromAccountId e toAccountId são obrigatórios."
    );
  }
  if (fromAccountId === toAccountId) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "fromAccountId e toAccountId devem ser distintos.",
      "toAccountId"
    );
  }
  return {
    fromAccountId,
    toAccountId,
    civilDate: parseTreasuryCivilDate(body.civilDate, "civilDate"),
    amount: parseTreasuryMoneyString(body.amount, "amount"),
    memo: parseTreasuryBoundedString(body.memo, "memo", { required: false }),
  };
}

export function parseTreasuryPromiseCreateInput(
  body: Record<string, unknown>
): TreasuryPromiseCreateInput {
  const side = parseTreasuryEnum(body.side, TREASURY_SIDES, "side", true);
  const nomusExternalId = parseTreasuryBoundedString(
    body.nomusExternalId,
    "nomusExternalId",
    { required: true }
  );
  if (!side || !nomusExternalId) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Promessa incompleta."
    );
  }
  return {
    side,
    nomusExternalId,
    promisedDate: parseTreasuryCivilDate(body.promisedDate, "promisedDate"),
    promisedAmount: parseTreasuryMoneyString(
      body.promisedAmount,
      "promisedAmount"
    ),
    contactNote: parseTreasuryBoundedString(body.contactNote, "contactNote", {
      required: false,
    }),
  };
}

export function parseTreasuryDateRangeFilter(query: Record<string, unknown>): {
  from: string | null;
  to: string | null;
} {
  const from = parseOptionalTreasuryCivilDate(query.from, "from");
  const to = parseOptionalTreasuryCivilDate(query.to, "to");
  if (from && to && from > to) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "from não pode ser posterior a to.",
      "from"
    );
  }
  return { from, to };
}

/** Type guard leve para DTO de conta (campos obrigatórios). */
export function isTreasuryFinancialAccountDto(
  value: unknown
): value is TreasuryFinancialAccountDto {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.code === "string" &&
    typeof row.name === "string" &&
    typeof row.accountType === "string" &&
    typeof row.currency === "string" &&
    typeof row.isActive === "boolean" &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
  );
}

export function assertTreasuryKnownString(
  value: unknown,
  field: string
): string {
  const t = asTrimmedString(value);
  if (!t) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      `${field} é obrigatório.`,
      field
    );
  }
  return t;
}

export { parseOptionalTreasuryMoneyString, parseTreasuryMoneyString };
