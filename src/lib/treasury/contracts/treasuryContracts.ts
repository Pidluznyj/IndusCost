/**
 * Barrel client-safe dos contratos da Central de Tesouraria.
 * Sem Prisma e sem I/O — seguro para frontend e backend.
 *
 * Validação: parse tipado no padrão IndusCost (projeto não adota Zod).
 */

export {
  TREASURY_API_PREFIX,
  TREASURY_AVAILABILITY_PATH,
  TREASURY_DEFAULT_CURRENCY,
  TREASURY_DEFAULT_PAGE,
  TREASURY_DEFAULT_PAGE_SIZE,
  TREASURY_FIELD_LIMITS,
  TREASURY_MAX_PAGE_SIZE,
  TREASURY_MIN_PAGE_SIZE,
  TREASURY_MODULE_ID,
  TREASURY_MODULE_LABEL,
  TREASURY_SCAFFOLD_VERSION,
} from "./treasuryConstants.js";
export type { TreasuryFieldLimitKey } from "./treasuryConstants.js";

export {
  TREASURY_ACCOUNT_ACCESS_LEVELS,
  TREASURY_ACCOUNT_LIQUIDITIES,
  TREASURY_ACCOUNT_SORT_FIELDS,
  TREASURY_ACCOUNT_TYPES,
  TREASURY_AGENDA_SORT_FIELDS,
  TREASURY_AVAILABILITY_STATUSES,
  TREASURY_BALANCE_LAYERS,
  TREASURY_BALANCE_ORIGINS,
  TREASURY_BALANCE_SOURCES,
  TREASURY_CLOSING_STATUSES,
  TREASURY_CURRENCIES,
  TREASURY_DISPUTE_STATUSES,
  TREASURY_EXCEPTION_SEVERITIES,
  TREASURY_EXCEPTION_STATUSES,
  TREASURY_LEDGER_DIRECTIONS,
  TREASURY_LEDGER_NATURES,
  TREASURY_LEDGER_SORT_FIELDS,
  TREASURY_LEDGER_STATUSES,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_PROMISE_STATUSES,
  TREASURY_RECONCILIATION_MATCH_STATUSES,
  TREASURY_SCHEDULE_STATUSES,
  TREASURY_SIDES,
  TREASURY_SORT_DIRECTIONS,
} from "./treasuryEnums.js";
export type {
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryAccountSortField,
  TreasuryAccountType,
  TreasuryAgendaSortField,
  TreasuryAvailabilityStatus,
  TreasuryBalanceLayer,
  TreasuryBalanceOrigin,
  TreasuryBalanceSource,
  TreasuryClosingStatus,
  TreasuryCurrency,
  TreasuryDisputeStatus,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerSortField,
  TreasuryLedgerStatus,
  TreasuryProjectionLayer,
  TreasuryPromiseStatus,
  TreasuryReconciliationMatchStatus,
  TreasuryScheduleStatus,
  TreasurySide,
  TreasurySortDirection,
} from "./treasuryEnums.js";

export {
  TREASURY_ERROR_CODES,
  TreasuryContractError,
  isTreasuryErrorCode,
} from "./treasuryErrorCodes.js";
export type { TreasuryErrorBody, TreasuryErrorCode } from "./treasuryErrorCodes.js";

export {
  isTreasuryCivilDate,
  parseOptionalTreasuryCivilDate,
  parseTreasuryCivilDate,
} from "./treasuryCivilDate.js";
export type { TreasuryCivilDate } from "./treasuryCivilDate.js";

export {
  formatTreasuryTimestampIso,
  isTreasuryTimestampIso,
  parseOptionalTreasuryTimestampIso,
  parseTreasuryTimestampIso,
} from "./treasuryTimestamp.js";
export type { TreasuryTimestampIso } from "./treasuryTimestamp.js";

export {
  isTreasuryMoneyString,
  normalizeTreasuryMoneyString,
  parseOptionalTreasuryMoneyString,
  parseTreasuryMoneyString,
} from "./treasuryMoneyContract.js";
export type { TreasuryMoneyString } from "./treasuryMoneyContract.js";

export {
  buildTreasuryPaginationMeta,
  parseTreasuryAuthorizedSort,
  parseTreasuryPage,
  parseTreasuryPageSize,
  parseTreasuryPagination,
  parseTreasurySortDirection,
} from "./treasuryPagination.js";
export type {
  TreasuryPaginationInput,
  TreasuryPaginationMeta,
  TreasurySortInput,
} from "./treasuryPagination.js";

export type {
  TreasuryAvailabilityResponse,
  TreasuryBalancePositionDto,
  TreasuryBalanceSnapshotDto,
  TreasuryDailyClosingDto,
  TreasuryDisputeDto,
  TreasuryExceptionDto,
  TreasuryFinancialAccountAccessDto,
  TreasuryFinancialAccountDto,
  TreasuryLedgerEntryDto,
  TreasuryListResponse,
  TreasuryModuleId,
  TreasuryPaymentPromiseDto,
  TreasuryPaymentScheduleItemDto,
  TreasuryProjectionPointDto,
  TreasuryReconciliationMatchDto,
  TreasuryTransferDto,
} from "./treasuryDto.js";

export {
  assertTreasuryKnownString,
  isTreasuryFinancialAccountDto,
  parseTreasuryAccountsListQuery,
  parseTreasuryCreateAccountInput,
  parseTreasuryDateRangeFilter,
  parseTreasuryEnum,
  parseTreasuryBoundedString,
  parseTreasuryManualLedgerEntryInput,
  parseTreasuryPromiseCreateInput,
  parseTreasuryTransferCreateInput,
} from "./treasurySchemas.js";
export type {
  TreasuryAccountsListQuery,
  TreasuryCreateAccountInput,
  TreasuryManualLedgerEntryInput,
  TreasuryPromiseCreateInput,
  TreasuryTransferCreateInput,
} from "./treasurySchemas.js";
