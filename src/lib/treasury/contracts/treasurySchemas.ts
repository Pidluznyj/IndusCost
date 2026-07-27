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
  TREASURY_ACCOUNT_ACCESS_LEVELS,
  TREASURY_ACCOUNT_LIQUIDITIES,
  TREASURY_ACCOUNT_SORT_FIELDS,
  TREASURY_ACCOUNT_TYPES,
  TREASURY_BALANCE_ORIGINS,
  TREASURY_CURRENCIES,
  TREASURY_LEDGER_DIRECTIONS,
  TREASURY_LEDGER_NATURES,
  TREASURY_RECEIVABLE_OPERATIONAL_STATUSES,
  TREASURY_RECEIVABLE_SORT_FIELDS,
  TREASURY_SIDES,
  TREASURY_TITLE_OPERATIONAL_PRIORITIES,
  TREASURY_TITLE_OPERATIONAL_STATUSES,
  type TreasuryAccountAccessLevel,
  type TreasuryAccountLiquidity,
  type TreasuryAccountSortField,
  type TreasuryAccountType,
  type TreasuryBalanceOrigin,
  type TreasuryCurrency,
  type TreasuryLedgerDirection,
  type TreasuryLedgerNature,
  type TreasuryReceivableOperationalStatus,
  type TreasuryReceivableSortField,
  type TreasurySide,
  type TreasuryTitleOperationalPriority,
  type TreasuryTitleOperationalStatusCode,
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
import { parseTreasuryTimestampIso } from "./treasuryTimestamp.js";

export type TreasuryCreateAccountInput = {
  companyCode: string;
  companyName: string | null;
  code: string;
  name: string;
  institutionName: string;
  institutionCode: string | null;
  accountType: TreasuryAccountType;
  currency: TreasuryCurrency;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated: boolean;
  minimumBalance: string;
  allowNegativeBalance: boolean;
  liquidity: TreasuryAccountLiquidity;
  defaultBalanceOrigin: TreasuryBalanceOrigin;
  sortOrder: number;
  nomusBankAccountId: string | null;
};

export type TreasuryUpdateAccountInput = {
  expectedUpdatedAt: string;
  name?: string;
  institutionName?: string;
  institutionCode?: string | null;
  accountType?: TreasuryAccountType;
  agencyMasked?: string;
  accountNumberMasked?: string;
  companyName?: string | null;
  nomusBankAccountId?: string | null;
  allowNegativeBalance?: boolean;
  defaultBalanceOrigin?: TreasuryBalanceOrigin;
  includeInConsolidated?: boolean;
  minimumBalance?: string;
  liquidity?: TreasuryAccountLiquidity;
  sortOrder?: number;
  justification?: string | null;
};

export type TreasuryDeactivateAccountInput = {
  reason: string;
  expectedUpdatedAt: string;
};

export type TreasuryReactivateAccountInput = {
  expectedUpdatedAt: string;
};

export type TreasuryPutAccountAccessInput = {
  userId: string;
  accessLevel: TreasuryAccountAccessLevel;
  canViewBalance: boolean;
  canMutateBalance: boolean;
  notes: string | null;
};

export type TreasuryAccountsListQuery = TreasuryPaginationInput &
  TreasurySortInput<TreasuryAccountSortField> & {
    companyCode: string | null;
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
  channel: string | null;
  notes: string | null;
  responsibleUserId: string | null;
  confirmAboveBalance: boolean;
  justification: string | null;
};

/** POST /receivables/:titleId/promises — título vem da rota. */
export type TreasuryReceivablePromiseCreateInput = {
  promisedDate: string;
  promisedAmount: string;
  contactNote: string | null;
  channel: string | null;
  notes: string | null;
  responsibleUserId: string | null;
  confirmAboveBalance: boolean;
  justification: string | null;
};

export type TreasuryPromiseCancelInput = {
  reason: string | null;
  expectedVersion: number;
};

export type TreasuryPromiseMarkFulfilledInput = {
  /** Valor cumprido acumulado; omitido = cumpre o restante (total). */
  fulfilledAmount: string | null;
  notes: string | null;
  expectedVersion: number;
};

export type TreasuryCreateBalanceSnapshotInput = {
  referenceAt: string;
  availableBalance: string;
  blockedBalance: string;
  investmentsBalance: string;
  usedLimit: string;
  origin: TreasuryBalanceOrigin;
  notes: string | null;
  attachmentUrl: string | null;
  justification: string | null;
  idempotencyKey: string;
};

export type TreasuryBalancesListQuery = TreasuryPaginationInput & {
  origin: TreasuryBalanceOrigin | null;
  from: string | null;
  to: string | null;
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
  const companyCode = parseTreasuryBoundedString(body.companyCode, "companyCode", {
    required: true,
  });
  const code = parseTreasuryBoundedString(body.code, "code", { required: true });
  const name = parseTreasuryBoundedString(body.name, "name", { required: true });
  const institutionName = parseTreasuryBoundedString(
    body.institutionName,
    "institutionName",
    { required: true }
  );
  const agencyMasked = parseTreasuryBoundedString(
    body.agencyMasked,
    "agencyMasked",
    { required: true }
  );
  const accountNumberMasked = parseTreasuryBoundedString(
    body.accountNumberMasked,
    "accountNumberMasked",
    { required: true }
  );
  const accountType = parseTreasuryEnum(
    body.accountType,
    TREASURY_ACCOUNT_TYPES,
    "accountType",
    true
  );
  const currency =
    parseTreasuryEnum(body.currency, TREASURY_CURRENCIES, "currency", false) ??
    TREASURY_DEFAULT_CURRENCY;
  const liquidity =
    parseTreasuryEnum(
      body.liquidity,
      TREASURY_ACCOUNT_LIQUIDITIES,
      "liquidity",
      false
    ) ?? "IMMEDIATE";
  const defaultBalanceOrigin =
    parseTreasuryEnum(
      body.defaultBalanceOrigin,
      TREASURY_BALANCE_ORIGINS,
      "defaultBalanceOrigin",
      false
    ) ?? "MANUAL";

  if (
    !companyCode ||
    !code ||
    !name ||
    !institutionName ||
    !agencyMasked ||
    !accountNumberMasked ||
    !accountType
  ) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Payload de conta incompleto."
    );
  }

  let sortOrder = 0;
  if (body.sortOrder != null && body.sortOrder !== "") {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n)) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "sortOrder deve ser inteiro.",
        "sortOrder"
      );
    }
    sortOrder = n;
  }

  return {
    companyCode,
    companyName: parseTreasuryBoundedString(body.companyName, "companyName", {
      required: false,
    }),
    code,
    name,
    institutionName,
    institutionCode: parseTreasuryBoundedString(
      body.institutionCode,
      "institutionCode",
      { required: false }
    ),
    accountType,
    currency,
    agencyMasked,
    accountNumberMasked,
    includeInConsolidated: body.includeInConsolidated === false ? false : true,
    minimumBalance: parseTreasuryMoneyString(
      body.minimumBalance ?? "0",
      "minimumBalance"
    ),
    allowNegativeBalance: body.allowNegativeBalance === true,
    liquidity,
    defaultBalanceOrigin,
    sortOrder,
    nomusBankAccountId: parseTreasuryBoundedString(
      body.nomusBankAccountId,
      "nomusBankAccountId",
      { required: false }
    ),
  };
}

export function parseTreasuryUpdateAccountInput(
  body: Record<string, unknown>
): TreasuryUpdateAccountInput {
  const expectedUpdatedAt = parseTreasuryBoundedString(
    body.expectedUpdatedAt,
    "expectedUpdatedAt",
    { required: true }
  );
  if (!expectedUpdatedAt) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "expectedUpdatedAt é obrigatório.",
      "expectedUpdatedAt"
    );
  }
  const out: TreasuryUpdateAccountInput = { expectedUpdatedAt };
  if (body.name !== undefined) {
    out.name =
      parseTreasuryBoundedString(body.name, "name", { required: true }) ??
      undefined;
  }
  if (body.institutionName !== undefined) {
    out.institutionName =
      parseTreasuryBoundedString(body.institutionName, "institutionName", {
        required: true,
      }) ?? undefined;
  }
  if (body.institutionCode !== undefined) {
    out.institutionCode = parseTreasuryBoundedString(
      body.institutionCode,
      "institutionCode",
      { required: false }
    );
  }
  if (body.accountType !== undefined) {
    out.accountType =
      parseTreasuryEnum(
        body.accountType,
        TREASURY_ACCOUNT_TYPES,
        "accountType",
        true
      ) ?? undefined;
  }
  if (body.agencyMasked !== undefined) {
    out.agencyMasked =
      parseTreasuryBoundedString(body.agencyMasked, "agencyMasked", {
        required: true,
      }) ?? undefined;
  }
  if (body.accountNumberMasked !== undefined) {
    out.accountNumberMasked =
      parseTreasuryBoundedString(
        body.accountNumberMasked,
        "accountNumberMasked",
        { required: true }
      ) ?? undefined;
  }
  if (body.companyName !== undefined) {
    out.companyName = parseTreasuryBoundedString(body.companyName, "companyName", {
      required: false,
    });
  }
  if (body.nomusBankAccountId !== undefined) {
    out.nomusBankAccountId = parseTreasuryBoundedString(
      body.nomusBankAccountId,
      "nomusBankAccountId",
      { required: false }
    );
  }
  if (body.allowNegativeBalance !== undefined) {
    out.allowNegativeBalance = body.allowNegativeBalance === true;
  }
  if (body.defaultBalanceOrigin !== undefined) {
    out.defaultBalanceOrigin =
      parseTreasuryEnum(
        body.defaultBalanceOrigin,
        TREASURY_BALANCE_ORIGINS,
        "defaultBalanceOrigin",
        true
      ) ?? undefined;
  }
  if (body.includeInConsolidated !== undefined) {
    out.includeInConsolidated = body.includeInConsolidated !== false;
  }
  if (body.minimumBalance !== undefined) {
    out.minimumBalance = parseTreasuryMoneyString(
      body.minimumBalance,
      "minimumBalance"
    );
  }
  if (body.liquidity !== undefined) {
    out.liquidity =
      parseTreasuryEnum(
        body.liquidity,
        TREASURY_ACCOUNT_LIQUIDITIES,
        "liquidity",
        true
      ) ?? undefined;
  }
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n)) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "sortOrder deve ser inteiro.",
        "sortOrder"
      );
    }
    out.sortOrder = n;
  }
  if (body.justification !== undefined) {
    out.justification = parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    );
  }
  return out;
}

export function parseTreasuryDeactivateAccountInput(
  body: Record<string, unknown>
): TreasuryDeactivateAccountInput {
  const reason = parseTreasuryBoundedString(body.reason, "reason", {
    required: true,
  });
  const expectedUpdatedAt = parseTreasuryBoundedString(
    body.expectedUpdatedAt,
    "expectedUpdatedAt",
    { required: true }
  );
  if (!reason || !expectedUpdatedAt) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Payload de desativação incompleto."
    );
  }
  return { reason, expectedUpdatedAt };
}

export function parseTreasuryReactivateAccountInput(
  body: Record<string, unknown>
): TreasuryReactivateAccountInput {
  const expectedUpdatedAt = parseTreasuryBoundedString(
    body.expectedUpdatedAt,
    "expectedUpdatedAt",
    { required: true }
  );
  if (!expectedUpdatedAt) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "expectedUpdatedAt é obrigatório.",
      "expectedUpdatedAt"
    );
  }
  return { expectedUpdatedAt };
}

export function parseTreasuryPutAccountAccessInput(
  body: Record<string, unknown>
): TreasuryPutAccountAccessInput {
  const userId = parseTreasuryBoundedString(body.userId, "userId", {
    required: true,
  });
  const accessLevel = parseTreasuryEnum(
    body.accessLevel,
    TREASURY_ACCOUNT_ACCESS_LEVELS,
    "accessLevel",
    true
  );
  if (!userId || !accessLevel) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Payload de acesso incompleto."
    );
  }
  return {
    userId,
    accessLevel,
    canViewBalance: body.canViewBalance === false ? false : true,
    canMutateBalance: body.canMutateBalance === true,
    notes: parseTreasuryBoundedString(body.notes, "notes", { required: false }),
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
    defaultSortBy: "sortOrder",
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
    companyCode: parseTreasuryBoundedString(query.companyCode, "companyCode", {
      required: false,
    }),
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

function parseConfirmAboveBalance(value: unknown): boolean {
  if (value == null || value === "") return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const t = value.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes" || t === "sim") return true;
    if (t === "false" || t === "0" || t === "no" || t === "nao" || t === "não")
      return false;
  }
  throw new TreasuryContractError(
    "VALIDATION_ERROR",
    "confirmAboveBalance inválido.",
    "confirmAboveBalance"
  );
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
    channel: parseTreasuryBoundedString(body.channel ?? body.meio, "channel", {
      required: false,
    }),
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao ?? body["observação"],
      "notes",
      { required: false }
    ),
    responsibleUserId: parseTreasuryBoundedString(
      body.responsibleUserId ?? body.responsavel ?? body.responsável,
      "userId",
      { required: false }
    ),
    confirmAboveBalance: parseConfirmAboveBalance(
      body.confirmAboveBalance ?? body.confirmAboveOpenBalance
    ),
    justification: parseTreasuryBoundedString(
      body.justification ?? body.justificativa,
      "justification",
      { required: false }
    ),
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

export function parseTreasuryBalancesListQuery(
  query: Record<string, unknown>
): TreasuryBalancesListQuery {
  const pagination = parseTreasuryPagination(query);
  const origin = parseTreasuryEnum(
    query.origin,
    TREASURY_BALANCE_ORIGINS,
    "origin",
    false
  );
  const range = parseTreasuryDateRangeFilter(query);
  return {
    ...pagination,
    origin,
    from: range.from,
    to: range.to,
  };
}

export function parseTreasuryCreateBalanceSnapshotInput(
  body: Record<string, unknown>,
  headerIdempotencyKey?: string | null
): TreasuryCreateBalanceSnapshotInput {
  const referenceAt = parseTreasuryTimestampIso(body.referenceAt, "referenceAt");
  const availableBalance = parseTreasuryMoneyString(
    body.availableBalance,
    "availableBalance"
  );
  const blockedBalance = parseOptionalTreasuryMoneyString(
    body.blockedBalance,
    "blockedBalance"
  );
  const investmentsBalance = parseOptionalTreasuryMoneyString(
    body.investmentsBalance,
    "investmentsBalance"
  );
  const usedLimit = parseOptionalTreasuryMoneyString(
    body.usedLimit,
    "usedLimit"
  );
  const origin =
    parseTreasuryEnum(
      body.origin,
      TREASURY_BALANCE_ORIGINS,
      "origin",
      false
    ) ?? "MANUAL";
  const idempotencyKey = parseTreasuryBoundedString(
    headerIdempotencyKey ?? body.idempotencyKey,
    "idempotencyKey",
    { required: true }
  );
  if (!idempotencyKey) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "Idempotency-Key é obrigatório.",
      "idempotencyKey"
    );
  }
  return {
    referenceAt,
    availableBalance,
    blockedBalance: blockedBalance ?? "0.00",
    investmentsBalance: investmentsBalance ?? "0.00",
    usedLimit: usedLimit ?? "0.00",
    origin,
    notes: parseTreasuryBoundedString(body.notes, "notes", { required: false }),
    attachmentUrl: parseTreasuryBoundedString(
      body.attachmentUrl,
      "attachmentUrl",
      { required: false }
    ),
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
    idempotencyKey,
  };
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

function parseOptionalBool(
  value: unknown,
  field: string
): boolean | null {
  if (value == null || value === "") return null;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new TreasuryContractError(
    "VALIDATION_ERROR",
    `${field} inválido.`,
    field
  );
}

function parseOptionalInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} deve ser inteiro.`,
      field
    );
  }
  return n;
}

export type TreasuryReceivablesListQuery = TreasuryPaginationInput &
  TreasurySortInput<TreasuryReceivableSortField> & {
    customerName: string | null;
    customerTaxId: string | null;
    document: string | null;
    salesOrder: string | null;
    invoice: string | null;
    sellerName: string | null;
    commercialOwnerName: string | null;
    collectionOwnerUserId: string | null;
    dueFrom: string | null;
    dueTo: string | null;
    expectedFrom: string | null;
    expectedTo: string | null;
    hasPromise: boolean | null;
    operationalStatus: TreasuryReceivableOperationalStatus | null;
    complementStatus: TreasuryTitleOperationalStatusCode | null;
    daysOverdueMin: number | null;
    daysOverdueMax: number | null;
    openAmountMin: string | null;
    openAmountMax: string | null;
    plannedAccountId: string | null;
    priority: TreasuryTitleOperationalPriority | null;
    includeCancelled: boolean;
  };

export function parseTreasuryReceivablesListQuery(
  query: Record<string, unknown>
): TreasuryReceivablesListQuery {
  const pagination = parseTreasuryPagination(query);
  const sort = parseTreasuryAuthorizedSort({
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    allowed: TREASURY_RECEIVABLE_SORT_FIELDS,
    defaultSortBy: "dueDate",
    defaultSortDirection: "asc",
  });
  const range = parseTreasuryDateRangeFilter({
    from: query.dueFrom ?? query.from,
    to: query.dueTo ?? query.to,
  });

  return {
    ...pagination,
    ...sort,
    customerName: parseTreasuryBoundedString(query.customerName ?? query.cliente, "customerName", {
      required: false,
    }),
    customerTaxId: parseTreasuryBoundedString(
      query.customerTaxId ?? query.taxId ?? query.cnpj ?? query.cpf,
      "customerTaxId",
      { required: false }
    ),
    document: parseTreasuryBoundedString(query.document ?? query.documento, "document", {
      required: false,
    }),
    salesOrder: parseTreasuryBoundedString(query.salesOrder ?? query.pedido, "salesOrder", {
      required: false,
    }),
    invoice: parseTreasuryBoundedString(query.invoice ?? query.nota, "invoice", {
      required: false,
    }),
    sellerName: parseTreasuryBoundedString(query.sellerName ?? query.vendedor, "sellerName", {
      required: false,
    }),
    commercialOwnerName: parseTreasuryBoundedString(
      query.commercialOwnerName ?? query.responsavelComercial,
      "commercialOwnerName",
      { required: false }
    ),
    collectionOwnerUserId: parseTreasuryBoundedString(
      query.collectionOwnerUserId ?? query.responsavelCobranca,
      "collectionOwnerUserId",
      { required: false }
    ),
    dueFrom: range.from,
    dueTo: range.to,
    expectedFrom: parseOptionalTreasuryCivilDate(
      query.expectedFrom ?? query.dataEsperadaFrom,
      "expectedFrom"
    ),
    expectedTo: parseOptionalTreasuryCivilDate(
      query.expectedTo ?? query.dataEsperadaTo,
      "expectedTo"
    ),
    hasPromise: parseOptionalBool(query.hasPromise ?? query.promessa, "hasPromise"),
    operationalStatus: parseTreasuryEnum(
      query.operationalStatus ?? query.status,
      TREASURY_RECEIVABLE_OPERATIONAL_STATUSES,
      "operationalStatus",
      false
    ),
    complementStatus: parseTreasuryEnum(
      query.complementStatus,
      TREASURY_TITLE_OPERATIONAL_STATUSES,
      "complementStatus",
      false
    ),
    daysOverdueMin: parseOptionalInt(query.daysOverdueMin, "daysOverdueMin"),
    daysOverdueMax: parseOptionalInt(query.daysOverdueMax, "daysOverdueMax"),
    openAmountMin: parseOptionalTreasuryMoneyString(
      query.openAmountMin ?? query.valorMin,
      "openAmountMin"
    ),
    openAmountMax: parseOptionalTreasuryMoneyString(
      query.openAmountMax ?? query.valorMax,
      "openAmountMax"
    ),
    plannedAccountId: parseTreasuryBoundedString(
      query.plannedAccountId ?? query.accountId ?? query.conta,
      "plannedAccountId",
      { required: false }
    ),
    priority: parseTreasuryEnum(
      query.priority ?? query.prioridade,
      TREASURY_TITLE_OPERATIONAL_PRIORITIES,
      "priority",
      false
    ),
    includeCancelled: parseOptionalBool(query.includeCancelled, "includeCancelled") === true,
  };
}

export type TreasuryReceivableExpectationInput = {
  expectedDate?: string | null;
  plannedAccountId?: string | null;
  responsibleUserId?: string | null;
  priority?: TreasuryTitleOperationalPriority | null;
  nextAction?: string | null;
  reason?: string | null;
  notes?: string | null;
  expectedVersion: number;
};

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseOptionalNullableBoundedString(
  body: Record<string, unknown>,
  key: string,
  field: keyof typeof TREASURY_FIELD_LIMITS
): string | null | undefined {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === "") return null;
  return parseTreasuryBoundedString(value, field, { required: true });
}

function parseOptionalNullableCivilDate(
  body: Record<string, unknown>,
  key: string,
  field: string
): string | null | undefined {
  if (!hasOwn(body, key)) return undefined;
  const value = body[key];
  if (value === null || value === "") return null;
  return parseTreasuryCivilDate(value, field);
}

function parseNonNegativeInt(
  value: unknown,
  field: string
): number {
  if (value == null || value === "") {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      `${field} é obrigatório.`,
      field
    );
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} deve ser inteiro >= 0.`,
      field
    );
  }
  return n;
}

/**
 * PUT expectativa operacional de CR.
 * Rejeita tentativas de mutar vencimento oficial no payload.
 */
export function parseTreasuryReceivableExpectationInput(
  body: Record<string, unknown>
): TreasuryReceivableExpectationInput {
  if (
    hasOwn(body, "dueDate") ||
    hasOwn(body, "vencimento") ||
    hasOwn(body, "officialDueDate")
  ) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Vencimento oficial não pode ser alterado pela Tesouraria.",
      "dueDate"
    );
  }

  const out: TreasuryReceivableExpectationInput = {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };

  if (hasOwn(body, "expectedDate") || hasOwn(body, "dataEsperada")) {
    out.expectedDate = parseOptionalNullableCivilDate(
      hasOwn(body, "expectedDate")
        ? body
        : { expectedDate: body.dataEsperada },
      "expectedDate",
      "expectedDate"
    );
  }

  const planned = parseOptionalNullableBoundedString(
    hasOwn(body, "plannedAccountId")
      ? body
      : hasOwn(body, "contaPrevista")
        ? { plannedAccountId: body.contaPrevista }
        : body,
    "plannedAccountId",
    "plannedAccountId"
  );
  if (planned !== undefined) out.plannedAccountId = planned;

  const responsibleKey = hasOwn(body, "responsibleUserId")
    ? "responsibleUserId"
    : hasOwn(body, "responsible")
      ? "responsible"
      : hasOwn(body, "responsavel")
        ? "responsavel"
        : null;
  if (responsibleKey) {
    const raw = body[responsibleKey];
    if (raw === null || raw === "") {
      out.responsibleUserId = null;
    } else {
      out.responsibleUserId = parseTreasuryBoundedString(raw, "userId", {
        required: true,
      });
    }
  }

  if (
    hasOwn(body, "priority") ||
    hasOwn(body, "prioridade")
  ) {
    const raw = hasOwn(body, "priority") ? body.priority : body.prioridade;
    if (raw === null || raw === "") {
      out.priority = null;
    } else {
      out.priority = parseTreasuryEnum(
        raw,
        TREASURY_TITLE_OPERATIONAL_PRIORITIES,
        "priority",
        true
      );
    }
  }

  const nextAction = parseOptionalNullableBoundedString(
    hasOwn(body, "nextAction")
      ? body
      : hasOwn(body, "proximaAcao")
        ? { nextAction: body.proximaAcao }
        : body,
    "nextAction",
    "nextAction"
  );
  if (nextAction !== undefined) out.nextAction = nextAction;

  const reason = parseOptionalNullableBoundedString(
    hasOwn(body, "reason")
      ? body
      : hasOwn(body, "motivo")
        ? { reason: body.motivo }
        : body,
    "reason",
    "reason"
  );
  if (reason !== undefined) out.reason = reason;

  const notes = parseOptionalNullableBoundedString(
    hasOwn(body, "notes")
      ? body
      : hasOwn(body, "observacao") || hasOwn(body, "observação")
        ? { notes: body.observacao ?? body["observação"] }
        : body,
    "notes",
    "notes"
  );
  if (notes !== undefined) out.notes = notes;

  return out;
}

/**
 * POST /receivables/:titleId/promises
 * Rejeita tentativas de mutar vencimento oficial.
 */
export function parseTreasuryReceivablePromiseCreateInput(
  body: Record<string, unknown>
): TreasuryReceivablePromiseCreateInput {
  if (
    hasOwn(body, "dueDate") ||
    hasOwn(body, "vencimento") ||
    hasOwn(body, "officialDueDate")
  ) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Promessa não pode alterar o vencimento oficial.",
      "dueDate"
    );
  }
  return {
    promisedDate: parseTreasuryCivilDate(
      body.promisedDate ?? body.dataPrometida,
      "promisedDate"
    ),
    promisedAmount: parseTreasuryMoneyString(
      body.promisedAmount ?? body.valorPrometido,
      "promisedAmount"
    ),
    contactNote: parseTreasuryBoundedString(
      body.contactNote ?? body.contato ?? body.contact,
      "contactNote",
      { required: false }
    ),
    channel: parseTreasuryBoundedString(body.channel ?? body.meio, "channel", {
      required: false,
    }),
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao ?? body["observação"],
      "notes",
      { required: false }
    ),
    responsibleUserId: parseTreasuryBoundedString(
      body.responsibleUserId ?? body.responsavel ?? body.responsável,
      "userId",
      { required: false }
    ),
    confirmAboveBalance: parseConfirmAboveBalance(
      body.confirmAboveBalance ?? body.confirmAboveOpenBalance
    ),
    justification: parseTreasuryBoundedString(
      body.justification ?? body.justificativa,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryPromiseCancelInput(
  body: Record<string, unknown>
): TreasuryPromiseCancelInput {
  return {
    reason: parseTreasuryBoundedString(
      body.reason ?? body.motivo ?? body.cancellationReason,
      "reason",
      { required: false }
    ),
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
}

export function parseTreasuryPromiseMarkFulfilledInput(
  body: Record<string, unknown>
): TreasuryPromiseMarkFulfilledInput {
  let fulfilledAmount: string | null = null;
  if (hasOwn(body, "fulfilledAmount") || hasOwn(body, "valorCumprido")) {
    const raw = hasOwn(body, "fulfilledAmount")
      ? body.fulfilledAmount
      : body.valorCumprido;
    if (raw != null && raw !== "") {
      fulfilledAmount = parseTreasuryMoneyString(raw, "fulfilledAmount");
    }
  }
  return {
    fulfilledAmount,
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao,
      "notes",
      { required: false }
    ),
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
}

export { parseOptionalTreasuryMoneyString, parseTreasuryMoneyString };
