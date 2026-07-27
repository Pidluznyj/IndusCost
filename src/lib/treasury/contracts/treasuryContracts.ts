/**
 * Barrel client-safe dos contratos da Central de Tesouraria.
 * Sem Prisma e sem I/O — seguro para frontend e backend.
 *
 * Validação: parse tipado no padrão IndusCost (projeto não adota Zod).
 */

export {
  TREASURY_ACCOUNTS_PATH,
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
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_PAYABLES_PATH,
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
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
  TREASURY_COLLECTION_ACTION_TYPES,
  TREASURY_DISPUTE_STATUSES,
  TREASURY_EXCEPTION_SEVERITIES,
  TREASURY_EXCEPTION_STATUSES,
  TREASURY_LEDGER_DIRECTIONS,
  TREASURY_LEDGER_NATURES,
  TREASURY_LEDGER_SORT_FIELDS,
  TREASURY_LEDGER_STATUSES,
  TREASURY_PROJECTION_LAYERS,
  TREASURY_ACTIVE_PROMISE_STATUSES,
  TREASURY_PROMISE_STATUSES,
  TREASURY_PAYABLE_OPERATIONAL_STATUSES,
  TREASURY_PAYABLE_PROGRAMMING_STATUSES,
  TREASURY_PAYABLE_SORT_FIELDS,
  TREASURY_RECEIVABLE_OPERATIONAL_STATUSES,
  TREASURY_RECEIVABLE_SORT_FIELDS,
  TREASURY_RECONCILIATION_MATCH_STATUSES,
  TREASURY_SCHEDULE_STATUSES,
  TREASURY_SIDES,
  TREASURY_SORT_DIRECTIONS,
  TREASURY_TITLE_OPERATIONAL_PRIORITIES,
  TREASURY_TITLE_OPERATIONAL_STATUSES,
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
  TreasuryCollectionActionType,
  TreasuryDisputeStatus,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerSortField,
  TreasuryLedgerStatus,
  TreasuryProjectionLayer,
  TreasuryPayableOperationalStatus,
  TreasuryPayableProgrammingStatus,
  TreasuryPayableSortField,
  TreasuryPromiseStatus,
  TreasuryReceivableOperationalStatus,
  TreasuryReceivableSortField,
  TreasuryReconciliationMatchStatus,
  TreasuryScheduleStatus,
  TreasurySide,
  TreasurySortDirection,
  TreasuryTitleOperationalPriority,
  TreasuryTitleOperationalStatusCode,
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
  TreasuryCollectionActionDto,
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
  parseTreasuryBalancesListQuery,
  parseTreasuryCreateAccountInput,
  parseTreasuryCreateBalanceSnapshotInput,
  parseTreasuryDateRangeFilter,
  parseTreasuryDeactivateAccountInput,
  parseTreasuryEnum,
  parseTreasuryBoundedString,
  parseTreasuryManualLedgerEntryInput,
  parseTreasuryCollectionActionCancelInput,
  parseTreasuryCollectionActionCreateInput,
  parseTreasuryDisputeCreateInput,
  parseTreasuryDisputeUpdateStatusInput,
  parseTreasuryPromiseCancelInput,
  parseTreasuryPromiseCreateInput,
  parseTreasuryPromiseMarkFulfilledInput,
  parseTreasuryPutAccountAccessInput,
  parseTreasuryReactivateAccountInput,
  parseTreasuryPayableHoldInput,
  parseTreasuryPayableProgramPaymentCancelInput,
  parseTreasuryPayableProgramPaymentInput,
  parseTreasuryPayableProgramPaymentUpdateInput,
  parseTreasuryPayablesListQuery,
  parseTreasuryReceivableExpectationInput,
  parseTreasuryReceivablePromiseCreateInput,
  parseTreasuryReceivablesListQuery,
  parseTreasuryTransferCreateInput,
  parseTreasuryUpdateAccountInput,
} from "./treasurySchemas.js";
export type {
  TreasuryAccountsListQuery,
  TreasuryBalancesListQuery,
  TreasuryCollectionActionCancelInput,
  TreasuryCollectionActionCreateInput,
  TreasuryCreateAccountInput,
  TreasuryCreateBalanceSnapshotInput,
  TreasuryDeactivateAccountInput,
  TreasuryDisputeCreateInput,
  TreasuryDisputeUpdateStatusInput,
  TreasuryManualLedgerEntryInput,
  TreasuryPayableHoldInput,
  TreasuryPayableProgramPaymentCancelInput,
  TreasuryPayableProgramPaymentInput,
  TreasuryPayableProgramPaymentUpdateInput,
  TreasuryPayablesListQuery,
  TreasuryPromiseCancelInput,
  TreasuryPromiseCreateInput,
  TreasuryPromiseMarkFulfilledInput,
  TreasuryPutAccountAccessInput,
  TreasuryReactivateAccountInput,
  TreasuryReceivableExpectationInput,
  TreasuryReceivablePromiseCreateInput,
  TreasuryReceivablesListQuery,
  TreasuryTransferCreateInput,
  TreasuryUpdateAccountInput,
} from "./treasurySchemas.js";

export type {
  TreasuryCustomerCollectionHistoryItem,
  TreasuryCustomerFinancialSummaryDto,
  TreasuryCustomerFinancialSummaryResponse,
  TreasuryCustomerRecentReceiptItem,
  TreasuryReceivableActionView,
  TreasuryReceivableComplementView,
  TreasuryReceivableDetailResponse,
  TreasuryReceivableListItemDto,
  TreasuryReceivablesListResponse,
  TreasuryReceivablesListSummary,
} from "./treasuryReceivableContracts.js";

export type {
  TreasuryPayableActionView,
  TreasuryPayableComplementView,
  TreasuryPayableDetailResponse,
  TreasuryPayableListItemDto,
  TreasuryPayableProgramPaymentResponse,
  TreasuryPayableProgrammingImpactDto,
  TreasuryPayableProgrammingView,
  TreasuryPayablesListResponse,
  TreasuryPayablesListSummary,
} from "./treasuryPayableContracts.js";

export {
  TREASURY_AUDIT_ACTIONS,
  TREASURY_AUDIT_ENTITY_TYPES,
  isTreasuryAuditAction,
  isTreasuryAuditEntityType,
} from "./treasuryAuditContracts.js";
export type {
  TreasuryAuditAction,
  TreasuryAuditActorContext,
  TreasuryAuditEntityType,
  TreasuryAuditEventInput,
  TreasuryAuditLogDto,
} from "./treasuryAuditContracts.js";

export type {
  OfficialCancellationView,
  OfficialCounterpartyView,
  OfficialInvoiceRefView,
  OfficialPayableView,
  OfficialReceivableView,
  OfficialSettlementView,
  OfficialStatusView,
  OfficialTitleSourcePresenceStatus,
} from "./treasuryOfficialTitleContracts.js";
