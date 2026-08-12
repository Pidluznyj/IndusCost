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
  todayTreasuryCivilDateInSaoPaulo,
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
  TREASURY_CLOSING_STATUSES,
  TREASURY_COLLECTION_ACTION_TYPES,
  TREASURY_CURRENCIES,
  TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES,
  TREASURY_DISPUTE_STATUSES,
  TREASURY_LEDGER_DIRECTIONS,
  TREASURY_LEDGER_NATURES,
  TREASURY_PAYABLE_OPERATIONAL_STATUSES,
  TREASURY_PAYABLE_PROGRAMMING_STATUSES,
  TREASURY_PAYABLE_SORT_FIELDS,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_RECEIVABLE_OPERATIONAL_STATUSES,
  TREASURY_RECEIVABLE_SORT_FIELDS,
  TREASURY_SIDES,
  TREASURY_TITLE_OPERATIONAL_PRIORITIES,
  TREASURY_TITLE_OPERATIONAL_STATUSES,
  TREASURY_EXCEPTION_ENTITY_KINDS,
  TREASURY_EXCEPTION_OPERATIONAL_STATUSES,
  TREASURY_EXCEPTION_SEVERITIES,
  TREASURY_EXCEPTION_SORT_FIELDS,
  TREASURY_EXCEPTION_STATUSES,
  TREASURY_EXCEPTION_TYPES,
  TREASURY_TRANSFER_STATUSES,
  TREASURY_BANK_IMPORT_BATCH_STATUSES,
  TREASURY_BANK_MOVEMENT_FILTER_BUCKETS,
  TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES,
  TREASURY_RECONCILIATION_ALLOCATION_KINDS,
  TREASURY_RECONCILIATION_DIFFERENCE_CODES,
  TREASURY_REPORT_KEYS,
  TREASURY_PROMISE_STATUSES,
  TREASURY_RECONCILIATION_MATCH_STATUSES,
  type TreasuryReconciliationAllocationKind,
  type TreasuryReportKey,
  type TreasuryAccountAccessLevel,
  type TreasuryBankImportBatchStatus,
  type TreasuryBankMovementFilterBucket,
  type TreasuryBankMovementReconciliationStatus,
  type TreasuryAccountLiquidity,
  type TreasuryAccountSortField,
  type TreasuryAccountType,
  type TreasuryBalanceOrigin,
  type TreasuryCollectionActionType,
  type TreasuryCurrency,
  type TreasuryDisputeStatus,
  type TreasuryLedgerDirection,
  type TreasuryLedgerNature,
  type TreasuryPayableOperationalStatus,
  type TreasuryPayableProgrammingStatus,
  type TreasuryPayableSortField,
  type TreasuryProjectionLayer,
  type TreasuryReceivableOperationalStatus,
  type TreasuryReceivableSortField,
  type TreasurySide,
  type TreasuryTitleOperationalPriority,
  type TreasuryTitleOperationalStatusCode,
  type TreasuryExceptionEntityKind,
  type TreasuryExceptionSeverity,
  type TreasuryExceptionStatus,
  type TreasuryExceptionType,
  type TreasuryTransferStatus,
} from "./treasuryEnums.js";
import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import {
  parseOptionalTreasuryTimestampIso,
  parseTreasuryTimestampIso,
} from "./treasuryTimestamp.js";
import { TreasuryContractError } from "./treasuryErrorCodes.js";
import {
  parseOptionalTreasuryMoneyString,
  parseTreasuryMoneyString,
} from "./treasuryMoneyContract.js";
import { treasuryMoneyToCents } from "../treasuryMoney.js";
import {
  parseTreasuryAuthorizedSort,
  parseTreasuryPagination,
  type TreasuryPaginationInput,
  type TreasurySortInput,
} from "./treasuryPagination.js";

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
  /** FORECAST (default) ou SCHEDULED. */
  status?: "FORECAST" | "SCHEDULED";
  expectedUpdatedAt?: never;
};

export type TreasuryTransferTransitionInput = {
  civilDate?: string | null;
  memo?: string | null;
  expectedVersion: number;
  justification?: string | null;
};

export type TreasuryTransferCancelInput = {
  expectedVersion: number;
  justification: string;
};

export type TreasuryExceptionUpsertInput = {
  companyCode: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  severity: TreasuryExceptionSeverity;
  entityKind: TreasuryExceptionEntityKind | null;
  entityId: string | null;
  accountId: string | null;
  nomusExternalId: string | null;
  title: string;
  description: string | null;
  amount: string | null;
  detectedAt?: string | null;
  dueAt: string | null;
  responsibleUserId: string | null;
  metadata: Record<string, unknown> | null;
};

export type TreasuryExceptionResolveInput = {
  expectedVersion: number;
  resolution: string;
};

export type TreasuryExceptionIgnoreInput = {
  expectedVersion: number;
  ignoreJustification: string;
};

export type TreasuryExceptionsListQuery = {
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: "asc" | "desc";
  companyCode: string | null;
  status: TreasuryExceptionStatus | null;
  /** Uso interno (engine): lista vários status em uma query. */
  statuses?: TreasuryExceptionStatus[] | null;
  type: TreasuryExceptionType | null;
  severity: TreasuryExceptionSeverity | null;
  responsibleUserId: string | null;
  search: string | null;
};

export type TreasuryExceptionAssignInput = {
  expectedVersion: number;
  responsibleUserId: string | null;
  justification?: string | null;
};

export type TreasuryExceptionSetDueAtInput = {
  expectedVersion: number;
  dueAt: string | null;
  justification?: string | null;
};

export type TreasuryExceptionSetStatusInput = {
  expectedVersion: number;
  status: (typeof TREASURY_EXCEPTION_OPERATIONAL_STATUSES)[number];
  justification?: string | null;
};

export type TreasuryExceptionCancelInput = {
  expectedVersion: number;
  justification: string;
};

export type TreasuryExceptionAcknowledgeInput = {
  expectedVersion: number;
  justification?: string | null;
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

/** POST /payables/:titleId/program-payment */
export type TreasuryPayableProgramPaymentInput = {
  scheduledDate: string;
  plannedAccountId: string;
  scheduledAmount: string;
  priority: TreasuryTitleOperationalPriority;
  responsibleUserId: string | null;
  justification: string;
  notes: string | null;
  status: TreasuryPayableProgrammingStatus;
  expectedVersion: number;
};

/** PUT /payables/:titleId/program-payment */
export type TreasuryPayableProgramPaymentUpdateInput = {
  scheduledDate?: string;
  plannedAccountId?: string;
  scheduledAmount?: string;
  priority?: TreasuryTitleOperationalPriority;
  responsibleUserId?: string | null;
  justification: string;
  notes?: string | null;
  status?: TreasuryPayableProgrammingStatus;
  expectedVersion: number;
};

/** POST /payables/:titleId/program-payment/cancel */
export type TreasuryPayableProgramPaymentCancelInput = {
  reason: string;
  expectedVersion: number;
};

/** POST /payables/:titleId/hold | /release-hold */
export type TreasuryPayableHoldInput = {
  reason: string;
  expectedVersion: number;
  notes?: string | null;
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
  field: keyof typeof TREASURY_FIELD_LIMITS | (string & {}),
  options?: { required?: boolean }
): string | null {
  const required = options?.required ?? true;
  const max =
    (TREASURY_FIELD_LIMITS as Record<string, number>)[field] ??
    TREASURY_FIELD_LIMITS.description;
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

export type TreasuryManualLedgerReverseInput = {
  expectedVersion: number;
  justification: string;
};

export function parseTreasuryManualLedgerReverseInput(
  body: Record<string, unknown>
): TreasuryManualLedgerReverseInput {
  const expectedVersion = parsePositiveInt(
    body.expectedVersion,
    "expectedVersion",
    true
  );
  if (expectedVersion == null) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "expectedVersion é obrigatório.",
      "expectedVersion"
    );
  }
  const justification = parseTreasuryBoundedString(
    body.justification ?? body.reason,
    "justification",
    { required: true }
  );
  if (!justification) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "justification é obrigatória.",
      "justification"
    );
  }
  return { expectedVersion, justification };
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
  const amount = parseTreasuryMoneyString(body.amount, "amount");
  if (treasuryMoneyToCents(amount) <= 0n) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "amount deve ser positivo.",
      "amount"
    );
  }
  const statusRaw = parseTreasuryEnum(
    body.status,
    ["FORECAST", "SCHEDULED"] as const,
    "status",
    false
  );
  return {
    fromAccountId,
    toAccountId,
    civilDate: parseTreasuryCivilDate(body.civilDate, "civilDate"),
    amount,
    memo: parseTreasuryBoundedString(body.memo, "memo", { required: false }),
    status: statusRaw ?? undefined,
  };
}

export type TreasuryTransfersListQuery = TreasuryPaginationInput & {
  companyCode: string | null;
  status: TreasuryTransferStatus | null;
  fromAccountId: string | null;
  toAccountId: string | null;
  from: TreasuryCivilDate | null;
  to: TreasuryCivilDate | null;
};

export function parseTreasuryTransfersListQuery(
  query: Record<string, unknown>
): TreasuryTransfersListQuery {
  const pagination = parseTreasuryPagination(query);
  const range = parseTreasuryDateRangeFilter(query);
  return {
    ...pagination,
    companyCode: parseTreasuryBoundedString(query.companyCode, "companyCode", {
      required: false,
    }),
    status: parseTreasuryEnum(
      query.status,
      TREASURY_TRANSFER_STATUSES,
      "status",
      false
    ),
    fromAccountId: parseTreasuryBoundedString(
      query.fromAccountId,
      "fromAccountId",
      { required: false }
    ),
    toAccountId: parseTreasuryBoundedString(query.toAccountId, "toAccountId", {
      required: false,
    }),
    from: range.from,
    to: range.to,
  };
}

export function parseTreasuryTransferTransitionInput(
  body: Record<string, unknown>
): TreasuryTransferTransitionInput {
  return {
    civilDate: parseOptionalTreasuryCivilDate(body.civilDate, "civilDate"),
    memo: parseTreasuryBoundedString(body.memo, "memo", { required: false }),
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryTransferCancelInput(
  body: Record<string, unknown>
): TreasuryTransferCancelInput {
  const justification = parseTreasuryBoundedString(
    body.justification ?? body.cancellationReason,
    "justification",
    { required: true }
  );
  if (!justification?.trim()) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "justification é obrigatória para cancelar transferência.",
      "justification"
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    justification,
  };
}

function parseExceptionMetadata(
  value: unknown
): Record<string, unknown> | null {
  if (value == null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "metadata deve ser objeto JSON.",
      "metadata"
    );
  }
  return value as Record<string, unknown>;
}

export function parseTreasuryExceptionUpsertInput(
  body: Record<string, unknown>
): TreasuryExceptionUpsertInput {
  const companyCode = parseTreasuryBoundedString(
    body.companyCode,
    "companyCode",
    { required: true }
  );
  const uniqueKey = parseTreasuryBoundedString(body.uniqueKey, "uniqueKey", {
    required: true,
  });
  const title = parseTreasuryBoundedString(body.title, "title", {
    required: true,
  });
  if (!companyCode || !uniqueKey || !title) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "companyCode, uniqueKey e title são obrigatórios."
    );
  }
  const type = parseTreasuryEnum(
    body.type,
    TREASURY_EXCEPTION_TYPES,
    "type",
    true
  );
  const severity = parseTreasuryEnum(
    body.severity,
    TREASURY_EXCEPTION_SEVERITIES,
    "severity",
    true
  );
  if (!type || !severity) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "type e severity são obrigatórios."
    );
  }
  return {
    companyCode,
    uniqueKey,
    type,
    severity,
    entityKind: parseTreasuryEnum(
      body.entityKind,
      TREASURY_EXCEPTION_ENTITY_KINDS,
      "entityKind",
      false
    ),
    entityId: parseTreasuryBoundedString(body.entityId, "entityId", {
      required: false,
    }),
    accountId: parseTreasuryBoundedString(body.accountId, "accountId", {
      required: false,
    }),
    nomusExternalId: parseTreasuryBoundedString(
      body.nomusExternalId,
      "nomusExternalId",
      { required: false }
    ),
    title,
    description: parseTreasuryBoundedString(body.description, "description", {
      required: false,
    }),
    amount: parseOptionalTreasuryMoneyString(body.amount, "amount"),
    detectedAt: parseOptionalTreasuryTimestampIso(
      body.detectedAt,
      "detectedAt"
    ),
    dueAt: parseOptionalTreasuryCivilDate(body.dueAt, "dueAt"),
    responsibleUserId: parseTreasuryBoundedString(
      body.responsibleUserId,
      "responsibleUserId",
      { required: false }
    ),
    metadata: parseExceptionMetadata(body.metadata ?? body.metadataJson),
  };
}

export function parseTreasuryExceptionResolveInput(
  body: Record<string, unknown>
): TreasuryExceptionResolveInput {
  const resolution = parseTreasuryBoundedString(body.resolution, "resolution", {
    required: true,
  });
  if (!resolution?.trim()) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "resolution é obrigatória.",
      "resolution"
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    resolution,
  };
}

export function parseTreasuryExceptionIgnoreInput(
  body: Record<string, unknown>
): TreasuryExceptionIgnoreInput {
  const ignoreJustification = parseTreasuryBoundedString(
    body.ignoreJustification ?? body.justification,
    "ignoreJustification",
    { required: true }
  );
  if (!ignoreJustification?.trim()) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "ignoreJustification é obrigatória para ignorar.",
      "ignoreJustification"
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    ignoreJustification,
  };
}

export function parseTreasuryExceptionAcknowledgeInput(
  body: Record<string, unknown>
): TreasuryExceptionAcknowledgeInput {
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryExceptionsListQuery(
  query: Record<string, unknown>
): TreasuryExceptionsListQuery {
  const pagination = parseTreasuryPagination(query);
  const sort = parseTreasuryAuthorizedSort({
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    allowed: TREASURY_EXCEPTION_SORT_FIELDS,
    defaultSortBy: "detectedAt",
    defaultSortDirection: "desc",
  });
  return {
    ...pagination,
    ...sort,
    companyCode: parseTreasuryBoundedString(query.companyCode, "companyCode", {
      required: false,
    }),
    status: parseTreasuryEnum(
      query.status,
      TREASURY_EXCEPTION_STATUSES,
      "status",
      false
    ),
    type: parseTreasuryEnum(
      query.type,
      TREASURY_EXCEPTION_TYPES,
      "type",
      false
    ),
    severity: parseTreasuryEnum(
      query.severity,
      TREASURY_EXCEPTION_SEVERITIES,
      "severity",
      false
    ),
    responsibleUserId: parseTreasuryBoundedString(
      query.responsibleUserId,
      "responsibleUserId",
      { required: false }
    ),
    search: parseTreasuryBoundedString(query.search, "search", {
      required: false,
    }),
  };
}

export function parseTreasuryExceptionAssignInput(
  body: Record<string, unknown>
): TreasuryExceptionAssignInput {
  const hasResponsible =
    Object.prototype.hasOwnProperty.call(body, "responsibleUserId") ||
    Object.prototype.hasOwnProperty.call(body, "responsible");
  if (!hasResponsible) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "responsibleUserId é obrigatório (use null para desatribuir).",
      "responsibleUserId"
    );
  }
  const raw = body.responsibleUserId ?? body.responsible;
  let responsibleUserId: string | null = null;
  if (raw != null && raw !== "") {
    responsibleUserId = parseTreasuryBoundedString(
      raw,
      "responsibleUserId",
      { required: true }
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    responsibleUserId,
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryExceptionSetDueAtInput(
  body: Record<string, unknown>
): TreasuryExceptionSetDueAtInput {
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    dueAt: parseOptionalTreasuryCivilDate(body.dueAt, "dueAt"),
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryExceptionSetStatusInput(
  body: Record<string, unknown>
): TreasuryExceptionSetStatusInput {
  const status = parseTreasuryEnum(
    body.status,
    TREASURY_EXCEPTION_OPERATIONAL_STATUSES,
    "status",
    true
  );
  if (!status) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "status é obrigatório.",
      "status"
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    status,
    justification: parseTreasuryBoundedString(
      body.justification,
      "justification",
      { required: false }
    ),
  };
}

export function parseTreasuryExceptionCancelInput(
  body: Record<string, unknown>
): TreasuryExceptionCancelInput {
  const justification = parseTreasuryBoundedString(
    body.justification ?? body.cancellationReason,
    "justification",
    { required: true }
  );
  if (!justification?.trim()) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "justification é obrigatória para cancelar.",
      "justification"
    );
  }
  return {
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    justification,
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
    nextAction: string | null;
    includeCancelled: boolean;
    /** Quando true com dueFrom/dueTo: inclui títulos baixados no intervalo (além do vencimento). */
    includeSettledInDueRange: boolean;
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
    nextAction: parseTreasuryBoundedString(
      query.nextAction ?? query.proximaAcao,
      "nextAction",
      { required: false }
    ),
    includeCancelled: parseOptionalBool(query.includeCancelled, "includeCancelled") === true,
    includeSettledInDueRange:
      parseOptionalBool(
        query.includeSettledInDueRange ?? query.incluirBaixadosNoPeriodo,
        "includeSettledInDueRange"
      ) === true,
  };
}

export type TreasuryPayablesListQuery = TreasuryPaginationInput &
  TreasurySortInput<TreasuryPayableSortField> & {
    supplierName: string | null;
    supplierTaxId: string | null;
    document: string | null;
    classification: string | null;
    costCenter: string | null;
    costCenterId: string | null;
    dueFrom: string | null;
    dueTo: string | null;
    scheduledFrom: string | null;
    scheduledTo: string | null;
    operationalStatus: TreasuryPayableOperationalStatus | null;
    complementStatus: TreasuryTitleOperationalStatusCode | null;
    openAmountMin: string | null;
    openAmountMax: string | null;
    plannedAccountId: string | null;
    priority: TreasuryTitleOperationalPriority | null;
    responsibleUserId: string | null;
    includeCancelled: boolean;
    includeSettledInDueRange: boolean;
  };

export function parseTreasuryPayablesListQuery(
  query: Record<string, unknown>
): TreasuryPayablesListQuery {
  const pagination = parseTreasuryPagination(query);
  const sort = parseTreasuryAuthorizedSort({
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    allowed: TREASURY_PAYABLE_SORT_FIELDS,
    defaultSortBy: "dueDate",
    defaultSortDirection: "asc",
  });
  const dueRange = parseTreasuryDateRangeFilter({
    from: query.dueFrom ?? query.from,
    to: query.dueTo ?? query.to,
  });

  return {
    ...pagination,
    ...sort,
    supplierName: parseTreasuryBoundedString(
      query.supplierName ?? query.fornecedor ?? query.customerName,
      "supplierName",
      { required: false }
    ),
    supplierTaxId: parseTreasuryBoundedString(
      query.supplierTaxId ?? query.taxId ?? query.cnpj ?? query.cpf,
      "supplierTaxId",
      { required: false }
    ),
    document: parseTreasuryBoundedString(
      query.document ?? query.documento,
      "document",
      { required: false }
    ),
    classification: parseTreasuryBoundedString(
      query.classification ?? query.categoria ?? query.category,
      "classification",
      { required: false }
    ),
    costCenter: parseTreasuryBoundedString(
      query.costCenter ?? query.centroCusto,
      "costCenter",
      { required: false }
    ),
    costCenterId: parseTreasuryBoundedString(
      query.costCenterId,
      "costCenterId",
      { required: false }
    ),
    dueFrom: dueRange.from,
    dueTo: dueRange.to,
    scheduledFrom: parseOptionalTreasuryCivilDate(
      query.scheduledFrom ?? query.dataProgramadaFrom,
      "scheduledFrom"
    ),
    scheduledTo: parseOptionalTreasuryCivilDate(
      query.scheduledTo ?? query.dataProgramadaTo,
      "scheduledTo"
    ),
    operationalStatus: parseTreasuryEnum(
      query.operationalStatus ?? query.status,
      TREASURY_PAYABLE_OPERATIONAL_STATUSES,
      "operationalStatus",
      false
    ),
    complementStatus: parseTreasuryEnum(
      query.complementStatus,
      TREASURY_TITLE_OPERATIONAL_STATUSES,
      "complementStatus",
      false
    ),
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
    responsibleUserId: parseTreasuryBoundedString(
      query.responsibleUserId ?? query.responsavel,
      "responsibleUserId",
      { required: false }
    ),
    includeCancelled:
      parseOptionalBool(query.includeCancelled, "includeCancelled") === true,
    includeSettledInDueRange:
      parseOptionalBool(
        query.includeSettledInDueRange ?? query.incluirBaixadosNoPeriodo,
        "includeSettledInDueRange"
      ) === true,
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

export type TreasuryCollectionActionCreateInput = {
  actionType: TreasuryCollectionActionType;
  performedAt: string;
  contactPerson: string | null;
  result: string | null;
  notes: string | null;
  nextAction: string | null;
  responsibleUserId: string | null;
};

export type TreasuryCollectionActionCancelInput = {
  reason: string | null;
  expectedVersion: number;
};

export type TreasuryDisputeCreateInput = {
  reason: string;
  amountDisputed: string | null;
  responsibleUserId: string | null;
  involvedArea: string | null;
  dueDate: string | null;
  notes: string | null;
};

export type TreasuryDisputeUpdateStatusInput = {
  status: Exclude<TreasuryDisputeStatus, "OPEN">;
  resolutionNote: string | null;
  notes: string | null;
  expectedVersion: number;
};

export function parseTreasuryCollectionActionCreateInput(
  body: Record<string, unknown>
): TreasuryCollectionActionCreateInput {
  const actionType = parseTreasuryEnum(
    body.actionType ?? body.tipo,
    TREASURY_COLLECTION_ACTION_TYPES,
    "actionType",
    true
  );
  if (!actionType) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "actionType é obrigatório.",
      "actionType"
    );
  }
  return {
    actionType,
    performedAt: parseTreasuryTimestampIso(
      body.performedAt ?? body.dataHora ?? body.at,
      "performedAt"
    ),
    contactPerson: parseTreasuryBoundedString(
      body.contactPerson ?? body.pessoaContato ?? body.contato,
      "contactPerson",
      { required: false }
    ),
    result: parseTreasuryBoundedString(
      body.result ?? body.resultado,
      "result",
      { required: false }
    ),
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao,
      "notes",
      { required: false }
    ),
    nextAction: parseTreasuryBoundedString(
      body.nextAction ?? body.proximaAcao,
      "nextAction",
      { required: false }
    ),
    responsibleUserId: parseTreasuryBoundedString(
      body.responsibleUserId ?? body.responsavel,
      "userId",
      { required: false }
    ),
  };
}

export function parseTreasuryCollectionActionCancelInput(
  body: Record<string, unknown>
): TreasuryCollectionActionCancelInput {
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

export function parseTreasuryDisputeCreateInput(
  body: Record<string, unknown>
): TreasuryDisputeCreateInput {
  const reason = parseTreasuryBoundedString(
    body.reason ?? body.motivo,
    "reason",
    { required: true }
  );
  if (!reason) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "reason é obrigatório.",
      "reason"
    );
  }
  return {
    reason,
    amountDisputed: parseOptionalTreasuryMoneyString(
      body.amountDisputed ?? body.valorContestado,
      "amountDisputed"
    ),
    responsibleUserId: parseTreasuryBoundedString(
      body.responsibleUserId ?? body.responsavelInterno ?? body.responsavel,
      "userId",
      { required: false }
    ),
    involvedArea: parseTreasuryBoundedString(
      body.involvedArea ?? body.areaEnvolvida,
      "involvedArea",
      { required: false }
    ),
    dueDate: parseOptionalTreasuryCivilDate(
      body.dueDate ?? body.prazo,
      "dueDate"
    ),
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao,
      "notes",
      { required: false }
    ),
  };
}

export function parseTreasuryDisputeUpdateStatusInput(
  body: Record<string, unknown>
): TreasuryDisputeUpdateStatusInput {
  const status = parseTreasuryEnum(
    body.status,
    ["RESOLVED", "CANCELLED"] as const,
    "status",
    true
  );
  if (!status) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "status é obrigatório (RESOLVED ou CANCELLED).",
      "status"
    );
  }
  return {
    status,
    resolutionNote: parseTreasuryBoundedString(
      body.resolutionNote ?? body.notaResolucao,
      "notes",
      { required: false }
    ),
    notes: parseTreasuryBoundedString(body.notes ?? body.observacao, "notes", {
      required: false,
    }),
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
}

function assertNoOfficialDueDateInBody(body: Record<string, unknown>): void {
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
}

/**
 * POST /payables/:titleId/program-payment
 * Rejeita tentativas de mutar vencimento oficial.
 */
export function parseTreasuryPayableProgramPaymentInput(
  body: Record<string, unknown>
): TreasuryPayableProgramPaymentInput {
  assertNoOfficialDueDateInBody(body);
  const priorityRaw = body.priority ?? body.prioridade;
  const priority =
    priorityRaw == null || priorityRaw === ""
      ? ("NORMAL" as TreasuryTitleOperationalPriority)
      : parseTreasuryEnum(
          priorityRaw,
          TREASURY_TITLE_OPERATIONAL_PRIORITIES,
          "priority",
          true
        )!;
  const status = parseTreasuryEnum(
    body.status ?? body.situacao ?? "PROGRAMMED",
    TREASURY_PAYABLE_PROGRAMMING_STATUSES,
    "status",
    true
  );
  if (!status) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "status é obrigatório (PROGRAMMED ou AUTHORIZED).",
      "status"
    );
  }
  const justification = parseTreasuryBoundedString(
    body.justification ?? body.justificativa ?? body.reason ?? body.motivo,
    "justification",
    { required: true }
  );
  if (!justification) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "justification é obrigatória.",
      "justification"
    );
  }
  const plannedAccountId = parseTreasuryBoundedString(
    body.plannedAccountId ?? body.contaPagadora ?? body.accountId,
    "plannedAccountId",
    { required: true }
  );
  if (!plannedAccountId) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "plannedAccountId é obrigatório.",
      "plannedAccountId"
    );
  }
  let responsibleUserId: string | null = null;
  if (
    hasOwn(body, "responsibleUserId") ||
    hasOwn(body, "responsavel") ||
    hasOwn(body, "responsável")
  ) {
    const raw =
      body.responsibleUserId ?? body.responsavel ?? body["responsável"];
    if (raw === null || raw === "") {
      responsibleUserId = null;
    } else {
      responsibleUserId = parseTreasuryBoundedString(raw, "userId", {
        required: true,
      });
    }
  }
  return {
    scheduledDate: parseTreasuryCivilDate(
      body.scheduledDate ?? body.dataProgramada,
      "scheduledDate"
    ),
    plannedAccountId,
    scheduledAmount: parseTreasuryMoneyString(
      body.scheduledAmount ?? body.valorProgramado,
      "scheduledAmount"
    ),
    priority,
    responsibleUserId,
    justification,
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao ?? body["observação"],
      "notes",
      { required: false }
    ),
    status,
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
}

/**
 * PUT /payables/:titleId/program-payment
 */
export function parseTreasuryPayableProgramPaymentUpdateInput(
  body: Record<string, unknown>
): TreasuryPayableProgramPaymentUpdateInput {
  assertNoOfficialDueDateInBody(body);
  const justification = parseTreasuryBoundedString(
    body.justification ?? body.justificativa ?? body.reason ?? body.motivo,
    "justification",
    { required: true }
  );
  if (!justification) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "justification é obrigatória.",
      "justification"
    );
  }
  const out: TreasuryPayableProgramPaymentUpdateInput = {
    justification,
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
  if (hasOwn(body, "scheduledDate") || hasOwn(body, "dataProgramada")) {
    out.scheduledDate = parseTreasuryCivilDate(
      body.scheduledDate ?? body.dataProgramada,
      "scheduledDate"
    );
  }
  if (
    hasOwn(body, "plannedAccountId") ||
    hasOwn(body, "contaPagadora") ||
    hasOwn(body, "accountId")
  ) {
    const planned = parseTreasuryBoundedString(
      body.plannedAccountId ?? body.contaPagadora ?? body.accountId,
      "plannedAccountId",
      { required: true }
    );
    if (!planned) {
      throw new TreasuryContractError(
        "REQUIRED_FIELD",
        "plannedAccountId é obrigatório quando informado.",
        "plannedAccountId"
      );
    }
    out.plannedAccountId = planned;
  }
  if (hasOwn(body, "scheduledAmount") || hasOwn(body, "valorProgramado")) {
    out.scheduledAmount = parseTreasuryMoneyString(
      body.scheduledAmount ?? body.valorProgramado,
      "scheduledAmount"
    );
  }
  if (hasOwn(body, "priority") || hasOwn(body, "prioridade")) {
    out.priority = parseTreasuryEnum(
      body.priority ?? body.prioridade,
      TREASURY_TITLE_OPERATIONAL_PRIORITIES,
      "priority",
      true
    )!;
  }
  if (
    hasOwn(body, "responsibleUserId") ||
    hasOwn(body, "responsavel") ||
    hasOwn(body, "responsável")
  ) {
    const raw =
      body.responsibleUserId ?? body.responsavel ?? body["responsável"];
    if (raw === null || raw === "") {
      out.responsibleUserId = null;
    } else {
      out.responsibleUserId = parseTreasuryBoundedString(raw, "userId", {
        required: true,
      });
    }
  }
  if (hasOwn(body, "status") || hasOwn(body, "situacao")) {
    out.status = parseTreasuryEnum(
      body.status ?? body.situacao,
      TREASURY_PAYABLE_PROGRAMMING_STATUSES,
      "status",
      true
    )!;
  }
  if (
    hasOwn(body, "notes") ||
    hasOwn(body, "observacao") ||
    hasOwn(body, "observação")
  ) {
    out.notes = parseOptionalNullableBoundedString(
      hasOwn(body, "notes")
        ? body
        : {
            notes: body.observacao ?? body["observação"],
          },
      "notes",
      "notes"
    );
  }
  return out;
}

export function parseTreasuryPayableProgramPaymentCancelInput(
  body: Record<string, unknown>
): TreasuryPayableProgramPaymentCancelInput {
  const reason = parseTreasuryBoundedString(
    body.reason ?? body.motivo ?? body.cancellationReason ?? body.justification,
    "reason",
    { required: true }
  );
  if (!reason) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "reason é obrigatório para cancelar a programação.",
      "reason"
    );
  }
  return {
    reason,
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
  };
}

export function parseTreasuryPayableHoldInput(
  body: Record<string, unknown>
): TreasuryPayableHoldInput {
  const reason = parseTreasuryBoundedString(
    body.reason ?? body.motivo ?? body.justification ?? body.justificativa,
    "reason",
    { required: true }
  );
  if (!reason) {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      "reason é obrigatório.",
      "reason"
    );
  }
  return {
    reason,
    expectedVersion: parseNonNegativeInt(
      body.expectedVersion ?? body.version,
      "expectedVersion"
    ),
    notes: parseTreasuryBoundedString(
      body.notes ?? body.observacao,
      "notes",
      { required: false }
    ),
  };
}

export type TreasuryDashboardQuery = {
  /** Data civil do dashboard (America/Sao_Paulo / YYYY-MM-DD). */
  date: TreasuryCivilDate;
  /** Filtro opcional de contas financeiras. */
  accountIds: string[] | null;
  /** Cenário de projeção que define a data de planejamento dos títulos. */
  scenario: TreasuryProjectionLayer;
};

/** Default "hoje" operacional — America/Sao_Paulo (nunca UTC civil). */
function todayCivilDateOperational(): TreasuryCivilDate {
  return todayTreasuryCivilDateInSaoPaulo();
}

function parseAccountIdsFilter(raw: unknown): string[] | null {
  if (raw == null || raw === "") return null;
  const parts = Array.isArray(raw)
    ? raw.map((v) => String(v))
    : String(raw).split(/[,;]/);
  const ids = [
    ...new Set(
      parts
        .map((p) => p.trim())
        .filter((p) => p.length > 0 && p.length <= TREASURY_FIELD_LIMITS.accountId)
    ),
  ];
  return ids.length ? ids : null;
}

export function parseTreasuryDashboardQuery(
  query: Record<string, unknown>
): TreasuryDashboardQuery {
  const dateRaw = query.date ?? query.civilDate ?? query.asOfDate;
  const date =
    dateRaw == null || dateRaw === ""
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(dateRaw, "date");
  const scenario =
    parseTreasuryEnum(
      query.scenario ?? query.cenario ?? query.layer,
      TREASURY_PROJECTION_LAYERS,
      "scenario",
      false
    ) ?? "PROBABLE";
  return {
    date,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    scenario,
  };
}

export type TreasuryGuidedDailyOpeningQuery = {
  date: TreasuryCivilDate;
};

export function parseTreasuryGuidedDailyOpeningQuery(
  query: Record<string, unknown>
): TreasuryGuidedDailyOpeningQuery {
  const dateRaw = query.date ?? query.civilDate ?? query.asOfDate;
  const date =
    dateRaw == null || dateRaw === ""
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(dateRaw, "date");
  return { date };
}

export type TreasuryGuidedDailyOpeningSaveItemParsed = {
  accountId: string;
  expectedVersion: number;
  confirmSuggested: boolean;
  amount: string | null;
  notes: string | null;
  justificationCode:
    | (typeof TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES)[number]
    | null;
  justificationDetail: string | null;
};

export type TreasuryGuidedDailyOpeningSaveInput = {
  civilDate: TreasuryCivilDate;
  items: TreasuryGuidedDailyOpeningSaveItemParsed[];
};

export function parseTreasuryGuidedDailyOpeningSaveInput(
  body: Record<string, unknown>
): TreasuryGuidedDailyOpeningSaveInput {
  const civilDate =
    body.civilDate == null && body.date == null
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(body.civilDate ?? body.date, "civilDate");

  const rawItems = body.items ?? body.contas ?? body.accounts;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "items deve ser um array com ao menos uma conta.",
      "items"
    );
  }

  const items = rawItems.map((raw, index) => {
    const row =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    const accountId = parseTreasuryBoundedString(
      row.accountId ?? row.id,
      `items[${index}].accountId`,
      { required: true }
    )!;
    const confirmSuggested = Boolean(
      row.confirmSuggested ?? row.confirm ?? row.confirmar
    );
    const amountRaw = row.amount ?? row.saldoInicial ?? row.openingBalance;
    const amount =
      amountRaw == null || amountRaw === ""
        ? null
        : parseTreasuryMoneyString(amountRaw, `items[${index}].amount`);
    const justificationCode = parseTreasuryEnum(
      row.justificationCode ?? row.motivoCodigo ?? row.reasonCode,
      TREASURY_DAILY_OPENING_DIFF_JUSTIFICATION_CODES,
      `items[${index}].justificationCode`,
      false
    );
    return {
      accountId,
      expectedVersion: parseNonNegativeInt(
        row.expectedVersion ?? row.version,
        `items[${index}].expectedVersion`
      ),
      confirmSuggested,
      amount,
      notes: parseTreasuryBoundedString(
        row.notes ?? row.observacao ?? row.observation,
        `items[${index}].notes`,
        { required: false }
      ),
      justificationCode: justificationCode ?? null,
      justificationDetail: parseTreasuryBoundedString(
        row.justificationDetail ?? row.motivoDetalhe ?? row.otherReason,
        `items[${index}].justificationDetail`,
        { required: false }
      ),
    };
  });

  return { civilDate, items };
}

export type TreasuryGuidedDailyClosingQuery = {
  date: TreasuryCivilDate;
};

export function parseTreasuryGuidedDailyClosingQuery(
  query: Record<string, unknown>
): TreasuryGuidedDailyClosingQuery {
  const dateRaw = query.date ?? query.civilDate ?? query.asOfDate;
  const date =
    dateRaw == null || dateRaw === ""
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(dateRaw, "date");
  return { date };
}

export type TreasuryGuidedDailyClosingSaveItemParsed = {
  accountId: string;
  expectedVersion: number;
  amount: string;
  notes: string | null;
};

export type TreasuryGuidedDailyClosingSaveInput = {
  civilDate: TreasuryCivilDate;
  items: TreasuryGuidedDailyClosingSaveItemParsed[];
};

export function parseTreasuryGuidedDailyClosingSaveInput(
  body: Record<string, unknown>
): TreasuryGuidedDailyClosingSaveInput {
  const civilDate =
    body.civilDate == null && body.date == null
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(body.civilDate ?? body.date, "civilDate");

  const rawItems = body.items ?? body.contas ?? body.accounts;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "items deve ser um array com ao menos uma conta.",
      "items"
    );
  }

  const items = rawItems.map((raw, index) => {
    const row =
      raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : {};
    const accountId = parseTreasuryBoundedString(
      row.accountId ?? row.id,
      `items[${index}].accountId`,
      { required: true }
    )!;
    const amount = parseTreasuryMoneyString(
      row.amount ?? row.saldoFinal ?? row.informedClosingBalance,
      `items[${index}].amount`
    );
    return {
      accountId,
      expectedVersion: parseNonNegativeInt(
        row.expectedVersion ?? row.version,
        `items[${index}].expectedVersion`
      ),
      amount,
      notes: parseTreasuryBoundedString(
        row.notes ?? row.observacao ?? row.observation,
        `items[${index}].notes`,
        { required: false }
      ),
    };
  });

  return { civilDate, items };
}

export type TreasuryDailyClosingPreviewQuery = {
  date: TreasuryCivilDate;
  companyCode: string | null;
  accountIds: string[] | null;
};

export function parseTreasuryDailyClosingPreviewQuery(
  query: Record<string, unknown>
): TreasuryDailyClosingPreviewQuery {
  const dateRaw = query.date ?? query.civilDate ?? query.asOfDate;
  const date =
    dateRaw == null || dateRaw === ""
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(dateRaw, "date");
  const companyRaw = query.companyCode ?? query.empresa ?? query.company;
  const companyCode =
    companyRaw == null || companyRaw === ""
      ? null
      : parseTreasuryBoundedString(companyRaw, "companyCode", {
          required: true,
        });
  return {
    date,
    companyCode,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
  };
}

export type TreasuryDailyClosingCaveatInput = {
  code: string;
  message: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
};

export type TreasuryDailyClosingCloseInput = {
  companyCode: string;
  date: TreasuryCivilDate;
  sourceHash: string;
  accountIds: string[] | null;
  notes: string | null;
  caveats: TreasuryDailyClosingCaveatInput[];
};

export type TreasuryDailyClosingReopenInput = {
  reason: string;
};

export type TreasuryDailyClosingListQuery = {
  companyCode: string | null;
  dateFrom: TreasuryCivilDate | null;
  dateTo: TreasuryCivilDate | null;
  status: (typeof TREASURY_CLOSING_STATUSES)[number] | null;
  page: number;
  pageSize: number;
};

export function parseTreasuryDailyClosingCloseInput(
  body: Record<string, unknown>
): TreasuryDailyClosingCloseInput {
  const companyCode = parseTreasuryBoundedString(
    body.companyCode ?? body.empresa,
    "companyCode",
    { required: true }
  )!;
  const date = parseTreasuryCivilDate(
    body.date ?? body.civilDate ?? body.asOfDate,
    "date"
  );
  const sourceHash = parseTreasuryBoundedString(
    body.sourceHash ?? body.previewSourceHash,
    "sourceHash",
    { required: true }
  )!;
  if (sourceHash.length < 16) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "sourceHash inválido.",
      "sourceHash"
    );
  }
  const notes = parseTreasuryBoundedString(body.notes, "notes", {
    required: false,
  });
  const rawCaveats = body.caveats ?? body.ressalvas ?? [];
  if (!Array.isArray(rawCaveats)) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "caveats deve ser array.",
      "caveats"
    );
  }
  const caveats: TreasuryDailyClosingCaveatInput[] = rawCaveats.map(
    (item, index) => {
      if (!item || typeof item !== "object") {
        throw new TreasuryContractError(
          "VALIDATION_ERROR",
          `caveats[${index}] inválido.`,
          "caveats"
        );
      }
      const row = item as Record<string, unknown>;
      const code = parseTreasuryBoundedString(row.code, "code", {
        required: true,
      })!;
      const message = parseTreasuryBoundedString(row.message, "notes", {
        required: true,
      })!;
      const severity =
        parseTreasuryEnum(
          row.severity,
          ["INFO", "WARNING", "CRITICAL"] as const,
          "severity",
          false
        ) ?? "WARNING";
      return { code, message, severity };
    }
  );
  return {
    companyCode,
    date,
    sourceHash,
    accountIds: parseAccountIdsFilter(
      body.accountIds ?? body.accounts ?? body.contaIds
    ),
    notes,
    caveats,
  };
}

export function parseTreasuryDailyClosingReopenInput(
  body: Record<string, unknown>
): TreasuryDailyClosingReopenInput {
  const reason = parseTreasuryBoundedString(
    body.reason ?? body.justification ?? body.motivo,
    "reason",
    { required: true }
  )!;
  return { reason };
}

export function parseTreasuryDailyClosingListQuery(
  query: Record<string, unknown>
): TreasuryDailyClosingListQuery {
  const companyRaw = query.companyCode ?? query.empresa ?? query.company;
  const companyCode =
    companyRaw == null || companyRaw === ""
      ? null
      : parseTreasuryBoundedString(companyRaw, "companyCode", {
          required: true,
        });
  const dateFromRaw = query.dateFrom ?? query.from ?? query.inicio;
  const dateToRaw = query.dateTo ?? query.to ?? query.fim;
  const pagination = parseTreasuryPagination(query);
  return {
    companyCode,
    dateFrom:
      dateFromRaw == null || dateFromRaw === ""
        ? null
        : parseTreasuryCivilDate(dateFromRaw, "dateFrom"),
    dateTo:
      dateToRaw == null || dateToRaw === ""
        ? null
        : parseTreasuryCivilDate(dateToRaw, "dateTo"),
    status:
      parseTreasuryEnum(
        query.status,
        TREASURY_CLOSING_STATUSES,
        "status",
        false
      ) ?? null,
    page: pagination.page,
    pageSize: pagination.pageSize,
  };
}

export type TreasuryProjectionCalculateInput = {
  companyCode: string;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  scenario: TreasuryProjectionLayer;
  accountIds: string[] | null;
  consolidated: boolean;
  includeDayDetail: boolean;
  notes: string | null;
  idempotencyKey: string | null;
};

export type TreasuryProjectionLatestQuery = {
  companyCode: string;
  scenario: TreasuryProjectionLayer;
  accountIds: string[] | null;
  consolidated: boolean;
  includeDayDetail: boolean;
};

export type TreasuryProjectionGetQuery = {
  accountIds: string[] | null;
  consolidated: boolean;
  includeDayDetail: boolean;
};

export type TreasuryProjectionCompositionQuery = {
  from: TreasuryCivilDate | null;
  to: TreasuryCivilDate | null;
  accountIds: string[] | null;
};

export type TreasuryAgendaQuery = {
  companyCode: string;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  scenario: TreasuryProjectionLayer;
  accountIds: string[] | null;
  consolidated: boolean;
  includeDayDetail: boolean;
};

export type TreasuryProjectionCompareQuery = {
  companyCode: string;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  accountIds: string[] | null;
  consolidated: boolean;
};

function parseBooleanFlag(
  raw: unknown,
  field: string,
  defaultValue: boolean
): boolean {
  if (raw == null || raw === "") return defaultValue;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "sim"].includes(s)) return true;
  if (["0", "false", "no", "nao", "não"].includes(s)) return false;
  throw new TreasuryContractError(
    "VALIDATION_ERROR",
    `${field} deve ser booleano.`,
    field
  );
}

export function parseTreasuryProjectionCalculateInput(
  body: Record<string, unknown>,
  headerIdempotencyKey?: string | null
): TreasuryProjectionCalculateInput {
  const companyCode = parseTreasuryBoundedString(
    body.companyCode ?? body.empresa,
    "companyCode",
    { required: true }
  )!;
  const baseDate = parseTreasuryCivilDate(
    body.baseDate ?? body.from ?? body.periodFrom ?? body.startDate,
    "baseDate"
  );
  const endDate = parseTreasuryCivilDate(
    body.endDate ?? body.to ?? body.periodTo,
    "endDate"
  );
  const scenario =
    parseTreasuryEnum(
      body.scenario ?? body.cenario ?? body.layer,
      TREASURY_PROJECTION_LAYERS,
      "scenario",
      false
    ) ?? "PROBABLE";
  const idempotencyKey =
    parseTreasuryBoundedString(
      headerIdempotencyKey ?? body.idempotencyKey,
      "idempotencyKey",
      { required: false }
    ) ?? null;
  return {
    companyCode,
    baseDate,
    endDate,
    scenario,
    accountIds: parseAccountIdsFilter(
      body.accountIds ?? body.accounts ?? body.contaIds
    ),
    consolidated: parseBooleanFlag(
      body.consolidated ?? body.consolidacao,
      "consolidated",
      true
    ),
    includeDayDetail: parseBooleanFlag(
      body.includeDayDetail ?? body.dayDetail ?? body.detalhamentoPorDia,
      "includeDayDetail",
      true
    ),
    notes:
      parseTreasuryBoundedString(body.notes ?? body.observacoes, "notes", {
        required: false,
      }) ?? null,
    idempotencyKey,
  };
}

export function parseTreasuryProjectionLatestQuery(
  query: Record<string, unknown>
): TreasuryProjectionLatestQuery {
  const companyCode = parseTreasuryBoundedString(
    query.companyCode ?? query.empresa,
    "companyCode",
    { required: true }
  )!;
  const scenario =
    parseTreasuryEnum(
      query.scenario ?? query.cenario ?? query.layer,
      TREASURY_PROJECTION_LAYERS,
      "scenario",
      false
    ) ?? "PROBABLE";
  return {
    companyCode,
    scenario,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    consolidated: parseBooleanFlag(
      query.consolidated ?? query.consolidacao,
      "consolidated",
      true
    ),
    includeDayDetail: parseBooleanFlag(
      query.includeDayDetail ?? query.dayDetail ?? query.detalhamentoPorDia,
      "includeDayDetail",
      true
    ),
  };
}

export function parseTreasuryProjectionGetQuery(
  query: Record<string, unknown>
): TreasuryProjectionGetQuery {
  return {
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    consolidated: parseBooleanFlag(
      query.consolidated ?? query.consolidacao,
      "consolidated",
      true
    ),
    includeDayDetail: parseBooleanFlag(
      query.includeDayDetail ?? query.dayDetail ?? query.detalhamentoPorDia,
      "includeDayDetail",
      true
    ),
  };
}

export function parseTreasuryProjectionCompositionQuery(
  query: Record<string, unknown>
): TreasuryProjectionCompositionQuery {
  const range = parseTreasuryDateRangeFilter({
    from: query.from ?? query.baseDate,
    to: query.to ?? query.endDate,
  });
  return {
    from: range.from,
    to: range.to,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds ?? query.accountId
    ),
  };
}

export function parseTreasuryAgendaQuery(
  query: Record<string, unknown>
): TreasuryAgendaQuery {
  const companyCode = parseTreasuryBoundedString(
    query.companyCode ?? query.empresa,
    "companyCode",
    { required: true }
  )!;
  const baseDate = parseTreasuryCivilDate(
    query.baseDate ?? query.from ?? query.startDate,
    "baseDate"
  );
  const endDate = parseTreasuryCivilDate(
    query.endDate ?? query.to,
    "endDate"
  );
  const scenario =
    parseTreasuryEnum(
      query.scenario ?? query.cenario ?? query.layer,
      TREASURY_PROJECTION_LAYERS,
      "scenario",
      false
    ) ?? "PROBABLE";
  return {
    companyCode,
    baseDate,
    endDate,
    scenario,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    consolidated: parseBooleanFlag(
      query.consolidated ?? query.consolidacao,
      "consolidated",
      true
    ),
    includeDayDetail: parseBooleanFlag(
      query.includeDayDetail ?? query.dayDetail ?? query.detalhamentoPorDia,
      "includeDayDetail",
      false
    ),
  };
}

export function parseTreasuryProjectionCompareQuery(
  query: Record<string, unknown>
): TreasuryProjectionCompareQuery {
  const companyCode = parseTreasuryBoundedString(
    query.companyCode ?? query.empresa,
    "companyCode",
    { required: true }
  )!;
  const baseDate = parseTreasuryCivilDate(
    query.baseDate ?? query.from ?? query.startDate,
    "baseDate"
  );
  const endDate = parseTreasuryCivilDate(
    query.endDate ?? query.to,
    "endDate"
  );
  return {
    companyCode,
    baseDate,
    endDate,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    consolidated: parseBooleanFlag(
      query.consolidated ?? query.consolidacao,
      "consolidated",
      true
    ),
  };
}

export type TreasuryBankImportOfxApplyInput = {
  previewToken: string;
  contentHash: string | null;
  notes: string | null;
};

export function parseTreasuryBankImportOfxApplyInput(
  body: Record<string, unknown>
): TreasuryBankImportOfxApplyInput {
  const previewToken = parseTreasuryBoundedString(
    body.previewToken ?? body.token,
    "previewToken",
    { required: true }
  )!;
  if (!previewToken.includes(".")) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "previewToken inválido.",
      "previewToken"
    );
  }
  const contentHash = parseTreasuryBoundedString(
    body.contentHash,
    "contentHash",
    { required: false }
  );
  const notes = parseTreasuryBoundedString(body.notes, "notes", {
    required: false,
  });
  return { previewToken, contentHash, notes };
}

export type TreasuryBankImportsListQuery = {
  page: number;
  pageSize: number;
  companyCode: string | null;
  accountId: string | null;
  status: TreasuryBankImportBatchStatus | null;
  from: string | null;
  to: string | null;
};

export type TreasuryBankMovementsListQuery = {
  page: number;
  pageSize: number;
  companyCode: string | null;
  accountId: string | null;
  batchId: string | null;
  bucket: TreasuryBankMovementFilterBucket | null;
  reconciliationStatus: TreasuryBankMovementReconciliationStatus | null;
  search: string | null;
  from: string | null;
  to: string | null;
};

export function parseTreasuryBankImportsListQuery(
  query: Record<string, unknown>
): TreasuryBankImportsListQuery {
  const pagination = parseTreasuryPagination(query);
  const range = parseTreasuryDateRangeFilter(query);
  return {
    ...pagination,
    companyCode: parseTreasuryBoundedString(query.companyCode, "companyCode", {
      required: false,
    }),
    accountId: parseTreasuryBoundedString(query.accountId, "accountId", {
      required: false,
    }),
    status: parseTreasuryEnum(
      query.status,
      TREASURY_BANK_IMPORT_BATCH_STATUSES,
      "status",
      false
    ),
    from: range.from,
    to: range.to,
  };
}

export function parseTreasuryBankMovementsListQuery(
  query: Record<string, unknown>
): TreasuryBankMovementsListQuery {
  const pagination = parseTreasuryPagination(query);
  const range = parseTreasuryDateRangeFilter(query);
  return {
    ...pagination,
    companyCode: parseTreasuryBoundedString(query.companyCode, "companyCode", {
      required: false,
    }),
    accountId: parseTreasuryBoundedString(query.accountId, "accountId", {
      required: false,
    }),
    batchId: parseTreasuryBoundedString(query.batchId, "id", {
      required: false,
    }),
    bucket: parseTreasuryEnum(
      query.bucket ?? query.filter ?? query.reconciliationBucket,
      TREASURY_BANK_MOVEMENT_FILTER_BUCKETS,
      "bucket",
      false
    ),
    reconciliationStatus: parseTreasuryEnum(
      query.reconciliationStatus ?? query.status,
      TREASURY_BANK_MOVEMENT_RECONCILIATION_STATUSES,
      "reconciliationStatus",
      false
    ),
    search: parseTreasuryBoundedString(query.search, "search", {
      required: false,
    }),
    from: range.from,
    to: range.to,
  };
}

export type TreasuryReconciliationAcceptMovementInput = {
  bankMovementId: string;
  amount: string;
};

export type TreasuryReconciliationAcceptAllocationInput = {
  kind: TreasuryReconciliationAllocationKind;
  amount: string;
  memo: string | null;
  nomusSide: TreasurySide | null;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  /** Saldo aberto do título (validação local; não muta Nomus). */
  openBalance: string | null;
  transferId: string | null;
  transferGroupId: string | null;
  ledgerEntryId: string | null;
  differenceCode: string | null;
};

export type TreasuryReconciliationAcceptInput = {
  companyCode: string;
  accountId: string;
  matchedCivilDate: string;
  justification: string | null;
  movements: TreasuryReconciliationAcceptMovementInput[];
  allocations: TreasuryReconciliationAcceptAllocationInput[];
  /** Idempotência do aceite — repetir com a mesma chave não cria outro match. */
  idempotencyKey?: string | null;
  suggestionKey: string | null;
  algorithmVersion: string | null;
  suggestionScore: number | null;
  suggestionConfidence: string | null;
  suggestionReasons: string[] | null;
};

export type TreasuryReconciliationUnmatchInput = {
  expectedVersion: number;
  reason: string;
};

function parsePositiveInt(
  value: unknown,
  field: string,
  required: boolean
): number | null {
  if (value == null || value === "") {
    if (required) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        `${field} é obrigatório.`,
        field
      );
    }
    return null;
  }
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      `${field} deve ser inteiro >= 0.`,
      field
    );
  }
  return n;
}

export function parseTreasuryReconciliationAcceptInput(
  body: Record<string, unknown>
): TreasuryReconciliationAcceptInput {
  const companyCode = parseTreasuryBoundedString(
    body.companyCode,
    "companyCode",
    { required: true }
  )!;
  const accountId = parseTreasuryBoundedString(body.accountId, "accountId", {
    required: true,
  })!;
  const matchedCivilDate = parseTreasuryCivilDate(
    body.matchedCivilDate,
    "matchedCivilDate"
  );
  const justification = parseTreasuryBoundedString(
    body.justification,
    "justification",
    { required: false }
  );

  const rawMovements = body.movements;
  if (!Array.isArray(rawMovements) || rawMovements.length === 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Informe ao menos um movimento bancário.",
      "movements"
    );
  }
  const movements: TreasuryReconciliationAcceptMovementInput[] = rawMovements.map(
    (raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      return {
        bankMovementId: parseTreasuryBoundedString(
          row.bankMovementId ?? row.movementId,
          `movements[${index}].bankMovementId`,
          { required: true }
        )!,
        amount: parseTreasuryMoneyString(
          row.amount,
          `movements[${index}].amount`
        ),
      };
    }
  );

  const rawAllocations = body.allocations;
  if (!Array.isArray(rawAllocations) || rawAllocations.length === 0) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Informe ao menos uma allocation.",
      "allocations"
    );
  }
  const allocations: TreasuryReconciliationAcceptAllocationInput[] =
    rawAllocations.map((raw, index) => {
      const row = (raw ?? {}) as Record<string, unknown>;
      const kind = parseTreasuryEnum(
        row.kind,
        TREASURY_RECONCILIATION_ALLOCATION_KINDS,
        `allocations[${index}].kind`,
        true
      )!;
      const nomusSide = parseTreasuryEnum(
        row.nomusSide,
        TREASURY_SIDES,
        `allocations[${index}].nomusSide`,
        false
      );
      const nomusExternalId = parsePositiveInt(
        row.nomusExternalId,
        `allocations[${index}].nomusExternalId`,
        false
      );
      return {
        kind,
        amount: parseTreasuryMoneyString(
          row.amount,
          `allocations[${index}].amount`
        ),
        memo: parseTreasuryBoundedString(
          row.memo,
          `allocations[${index}].memo`,
          { required: false }
        ),
        nomusSide,
        officialTitleId: parseTreasuryBoundedString(
          row.officialTitleId,
          `allocations[${index}].officialTitleId`,
          { required: false }
        ),
        nomusExternalId,
        openBalance: parseOptionalTreasuryMoneyString(
          row.openBalance,
          `allocations[${index}].openBalance`
        ),
        transferId: parseTreasuryBoundedString(
          row.transferId,
          `allocations[${index}].transferId`,
          { required: false }
        ),
        transferGroupId: parseTreasuryBoundedString(
          row.transferGroupId,
          `allocations[${index}].transferGroupId`,
          { required: false }
        ),
        ledgerEntryId: parseTreasuryBoundedString(
          row.ledgerEntryId,
          `allocations[${index}].ledgerEntryId`,
          { required: false }
        ),
        // Vocabulário FECHADO: quando informado, precisa ser uma das
        // classificações oficiais (DESCONTO/JUROS/MULTA/TARIFA/RETENCAO/
        // ABATIMENTO/COMPENSACAO/ARREDONDAMENTO/OUTRO).
        differenceCode: parseTreasuryEnum(
          row.differenceCode,
          TREASURY_RECONCILIATION_DIFFERENCE_CODES,
          `allocations[${index}].differenceCode`,
          false
        ),
      };
    });

  const suggestionReasonsRaw = body.suggestionReasons;
  let suggestionReasons: string[] | null = null;
  if (Array.isArray(suggestionReasonsRaw)) {
    suggestionReasons = suggestionReasonsRaw
      .map((r) => String(r).trim())
      .filter(Boolean);
  }

  return {
    companyCode,
    accountId,
    matchedCivilDate,
    justification,
    movements,
    allocations,
    idempotencyKey: parseTreasuryBoundedString(
      body.idempotencyKey,
      "idempotencyKey",
      { required: false }
    ),
    suggestionKey: parseTreasuryBoundedString(
      body.suggestionKey,
      "suggestionKey",
      { required: false }
    ),
    algorithmVersion: parseTreasuryBoundedString(
      body.algorithmVersion,
      "algorithmVersion",
      { required: false }
    ),
    suggestionScore: parsePositiveInt(
      body.suggestionScore,
      "suggestionScore",
      false
    ),
    suggestionConfidence: parseTreasuryBoundedString(
      body.suggestionConfidence,
      "suggestionConfidence",
      { required: false }
    ),
    suggestionReasons,
  };
}

export function parseTreasuryReconciliationUnmatchInput(
  body: Record<string, unknown>
): TreasuryReconciliationUnmatchInput {
  const expectedVersion = parsePositiveInt(
    body.expectedVersion,
    "expectedVersion",
    true
  );
  if (expectedVersion == null) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "expectedVersion é obrigatório.",
      "expectedVersion"
    );
  }
  const reason = parseTreasuryBoundedString(body.reason, "reason", {
    required: true,
  });
  if (!reason) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Motivo do unmatch é obrigatório.",
      "reason"
    );
  }
  return { expectedVersion, reason };
}

export type TreasuryReconciliationReverseInput = {
  expectedVersion: number;
  reason: string;
  /** Deve ser exatamente REVERTER (confirmação forte). */
  confirmPhrase: string;
};

export function parseTreasuryReconciliationReverseInput(
  body: Record<string, unknown>
): TreasuryReconciliationReverseInput {
  const base = parseTreasuryReconciliationUnmatchInput(body);
  const confirmPhrase = parseTreasuryBoundedString(
    body.confirmPhrase ?? body.confirmation,
    "confirmPhrase",
    { required: true }
  );
  if (!confirmPhrase) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "confirmPhrase é obrigatório.",
      "confirmPhrase"
    );
  }
  return {
    expectedVersion: base.expectedVersion,
    reason: base.reason,
    confirmPhrase,
  };
}

export type TreasuryReportQuery = {
  reportKey: TreasuryReportKey;
  from: TreasuryCivilDate;
  to: TreasuryCivilDate;
  accountIds: string[] | null;
  scenario: TreasuryProjectionLayer;
  companyCode: string | null;
  page: number;
  pageSize: number;
  status: string | null;
  severity: TreasuryExceptionSeverity | null;
  search: string | null;
};

export function parseTreasuryReportKey(
  value: unknown,
  field = "reportKey"
): TreasuryReportKey {
  return parseTreasuryEnum(value, TREASURY_REPORT_KEYS, field, true)!;
}

export function parseTreasuryReportQuery(
  reportKeyRaw: unknown,
  query: Record<string, unknown>
): TreasuryReportQuery {
  const reportKey = parseTreasuryReportKey(reportKeyRaw);
  const fromRaw = query.from ?? query.periodFrom ?? query.startDate ?? query.date;
  const toRaw = query.to ?? query.periodTo ?? query.endDate ?? query.date ?? fromRaw;
  const from =
    fromRaw == null || fromRaw === ""
      ? todayCivilDateOperational()
      : parseTreasuryCivilDate(fromRaw, "from");
  const to =
    toRaw == null || toRaw === ""
      ? from
      : parseTreasuryCivilDate(toRaw, "to");
  if (to < from) {
    throw new TreasuryContractError(
      "VALIDATION_ERROR",
      "Período inválido: to deve ser >= from.",
      "to"
    );
  }
  const scenario =
    parseTreasuryEnum(
      query.scenario ?? query.cenario ?? query.layer,
      TREASURY_PROJECTION_LAYERS,
      "scenario",
      false
    ) ?? "PROBABLE";
  const companyRaw = query.companyCode ?? query.empresa ?? query.company;
  const companyCode =
    companyRaw == null || companyRaw === ""
      ? null
      : parseTreasuryBoundedString(companyRaw, "companyCode", {
          required: false,
        });
  const statusRaw = query.status;
  let status: string | null = null;
  if (statusRaw != null && statusRaw !== "") {
    status = String(statusRaw).trim();
    if (
      reportKey === "promises" &&
      !(TREASURY_PROMISE_STATUSES as readonly string[]).includes(status)
    ) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "status de promessa inválido.",
        "status"
      );
    }
    if (
      reportKey === "exceptions" &&
      !(TREASURY_EXCEPTION_STATUSES as readonly string[]).includes(status)
    ) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "status de exceção inválido.",
        "status"
      );
    }
    if (
      reportKey === "reconciliations" &&
      !(TREASURY_RECONCILIATION_MATCH_STATUSES as readonly string[]).includes(
        status
      )
    ) {
      throw new TreasuryContractError(
        "VALIDATION_ERROR",
        "status de conciliação inválido.",
        "status"
      );
    }
  }
  const severity =
    parseTreasuryEnum(
      query.severity,
      TREASURY_EXCEPTION_SEVERITIES,
      "severity",
      false
    ) ?? null;
  const searchRaw = query.search ?? query.q;
  const search =
    searchRaw == null || searchRaw === ""
      ? null
      : parseTreasuryBoundedString(searchRaw, "search", { required: false });
  const pagination = parseTreasuryPagination(query);
  return {
    reportKey,
    from,
    to,
    accountIds: parseAccountIdsFilter(
      query.accountIds ?? query.accounts ?? query.contaIds
    ),
    scenario,
    companyCode: companyCode ?? null,
    page: pagination.page,
    pageSize: pagination.pageSize,
    status,
    severity,
    search,
  };
}

export { parseOptionalTreasuryMoneyString, parseTreasuryMoneyString };
