/**
 * Enums de domínio da Central de Tesouraria (client-safe).
 * Valores estáveis para API/DTO — sem Prisma.
 */

export const TREASURY_SIDES = ["AR", "AP"] as const;
export type TreasurySide = (typeof TREASURY_SIDES)[number];

export const TREASURY_ACCOUNT_TYPES = [
  "CHECKING",
  "SAVINGS",
  "CASH",
  "INVESTMENT",
  "OTHER",
] as const;
export type TreasuryAccountType = (typeof TREASURY_ACCOUNT_TYPES)[number];

export const TREASURY_CURRENCIES = ["BRL"] as const;
export type TreasuryCurrency = (typeof TREASURY_CURRENCIES)[number];

export const TREASURY_BALANCE_LAYERS = [
  "observed",
  "calculated",
  "reconciled",
] as const;
export type TreasuryBalanceLayer = (typeof TREASURY_BALANCE_LAYERS)[number];

/** Origem explícita de cada valor na posição financeira (não esconder MISSING). */
export const TREASURY_POSITION_VALUE_ORIGINS = [
  "BALANCE_SNAPSHOT",
  "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
  "OFFICIAL_MOVEMENTS_ONLY",
  "ZERO_BASELINE",
  "RECONCILIATION",
  "MISSING",
] as const;
export type TreasuryPositionValueOrigin =
  (typeof TREASURY_POSITION_VALUE_ORIGINS)[number];

/** Origens de saldo/snapshot (alinhado a `TreasuryBalanceOrigin` no Prisma). */
export const TREASURY_BALANCE_ORIGINS = [
  "MANUAL",
  "OFX",
  "CLOSING",
  "SYSTEM",
  "IMPORT",
] as const;
export type TreasuryBalanceOrigin = (typeof TREASURY_BALANCE_ORIGINS)[number];

/** @deprecated Preferir `TREASURY_BALANCE_ORIGINS` / `TreasuryBalanceOrigin`. */
export const TREASURY_BALANCE_SOURCES = TREASURY_BALANCE_ORIGINS;
export type TreasuryBalanceSource = TreasuryBalanceOrigin;

export const TREASURY_ACCOUNT_LIQUIDITIES = [
  "IMMEDIATE",
  "D_PLUS_1",
  "D_PLUS_N",
  "TERM",
  "ILLIQUID",
] as const;
export type TreasuryAccountLiquidity =
  (typeof TREASURY_ACCOUNT_LIQUIDITIES)[number];

export const TREASURY_ACCOUNT_ACCESS_LEVELS = [
  "VIEW",
  "OPERATE",
  "MANAGE",
] as const;
export type TreasuryAccountAccessLevel =
  (typeof TREASURY_ACCOUNT_ACCESS_LEVELS)[number];

export const TREASURY_LEDGER_DIRECTIONS = ["DEBIT", "CREDIT"] as const;
export type TreasuryLedgerDirection = (typeof TREASURY_LEDGER_DIRECTIONS)[number];

export const TREASURY_LEDGER_NATURES = [
  "MANUAL",
  "TRANSFER",
  "OFX_MATCH",
  "ADJUSTMENT",
  "REVERSAL",
] as const;
export type TreasuryLedgerNature = (typeof TREASURY_LEDGER_NATURES)[number];

export const TREASURY_LEDGER_STATUSES = ["ACTIVE", "REVERSED"] as const;
export type TreasuryLedgerStatus = (typeof TREASURY_LEDGER_STATUSES)[number];

export const TREASURY_PROMISE_STATUSES = [
  "ACTIVE",
  "PARTIALLY_FULFILLED",
  "FULFILLED",
  "EXPIRED",
  "BROKEN",
  "CANCELLED",
] as const;
export type TreasuryPromiseStatus = (typeof TREASURY_PROMISE_STATUSES)[number];

/** Statuses que ainda afetam projeção / filtro "com promessa". */
export const TREASURY_ACTIVE_PROMISE_STATUSES = [
  "ACTIVE",
  "PARTIALLY_FULFILLED",
] as const;

export const TREASURY_DISPUTE_STATUSES = [
  "OPEN",
  "RESOLVED",
  "CANCELLED",
] as const;
export type TreasuryDisputeStatus = (typeof TREASURY_DISPUTE_STATUSES)[number];

export const TREASURY_COLLECTION_ACTION_TYPES = [
  "PHONE",
  "WHATSAPP",
  "EMAIL",
  "MEETING",
  "COMMERCIAL_CONTACT",
  "INTERNAL_ANALYSIS",
  "OTHER",
] as const;
export type TreasuryCollectionActionType =
  (typeof TREASURY_COLLECTION_ACTION_TYPES)[number];

export const TREASURY_SCHEDULE_STATUSES = [
  "PLANNED",
  "APPROVED",
  "EXECUTED",
  "CANCELLED",
] as const;
export type TreasuryScheduleStatus = (typeof TREASURY_SCHEDULE_STATUSES)[number];

export const TREASURY_PROJECTION_LAYERS = [
  "CONTRACTUAL",
  "PROBABLE",
  "CONFIRMED",
  "MANUAL",
] as const;
export type TreasuryProjectionLayer = (typeof TREASURY_PROJECTION_LAYERS)[number];

/** Alias semântico alinhado ao enum Prisma `TreasuryProjectionScenario`. */
export const TREASURY_PROJECTION_SCENARIOS = TREASURY_PROJECTION_LAYERS;
export type TreasuryProjectionScenario = TreasuryProjectionLayer;

export const TREASURY_PROJECTION_RUN_STATUSES = [
  "PENDING",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "PARTIAL",
  "CANCELLED",
] as const;
export type TreasuryProjectionRunStatus =
  (typeof TREASURY_PROJECTION_RUN_STATUSES)[number];

export const TREASURY_PROJECTION_RECALC_JOB_STATUSES = [
  "PENDING",
  "LOCKED",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type TreasuryProjectionRecalcJobStatus =
  (typeof TREASURY_PROJECTION_RECALC_JOB_STATUSES)[number];

export const TREASURY_PROJECTION_RECALC_EVENT_TYPES = [
  "AR_SYNC",
  "AP_SYNC",
  "SETTLEMENT",
  "CANCELLATION",
  "EXPECTATION",
  "PROMISE",
  "PROGRAMMING",
  "LEDGER_ENTRY",
  "TRANSFER",
  "BALANCE",
  "RECONCILIATION",
  "REVERSAL",
  "CLOSING",
  "REOPENING",
] as const;
export type TreasuryProjectionRecalcEventType =
  (typeof TREASURY_PROJECTION_RECALC_EVENT_TYPES)[number];

export const TREASURY_PROJECTION_RISK_CODES = [
  "NONE",
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;
export type TreasuryProjectionRiskCode =
  (typeof TREASURY_PROJECTION_RISK_CODES)[number];

export const TREASURY_PROJECTION_ITEM_KINDS = [
  "RECEIVABLE",
  "PAYABLE",
  "TRANSFER",
  "MANUAL_ENTRY",
  "REALIZED",
  "UNCERTAIN_RECEIVABLE",
  "OTHER",
] as const;
export type TreasuryProjectionItemKind =
  (typeof TREASURY_PROJECTION_ITEM_KINDS)[number];

export const TREASURY_CLOSING_STATUSES = ["OPEN", "CLOSED", "REOPENED"] as const;
export type TreasuryClosingStatus = (typeof TREASURY_CLOSING_STATUSES)[number];

export const TREASURY_EXCEPTION_STATUSES = [
  "OPEN",
  "ACK",
  "RESOLVED",
  "CANCELLED",
] as const;
export type TreasuryExceptionStatus = (typeof TREASURY_EXCEPTION_STATUSES)[number];

export const TREASURY_EXCEPTION_SEVERITIES = [
  "INFO",
  "WARNING",
  "CRITICAL",
] as const;
export type TreasuryExceptionSeverity =
  (typeof TREASURY_EXCEPTION_SEVERITIES)[number];

export const TREASURY_RECONCILIATION_MATCH_STATUSES = [
  "PENDING",
  "MATCHED",
  "UNMATCHED",
  "IGNORED",
] as const;
export type TreasuryReconciliationMatchStatus =
  (typeof TREASURY_RECONCILIATION_MATCH_STATUSES)[number];

export const TREASURY_AVAILABILITY_STATUSES = [
  "available",
  "disabled",
  "scaffold",
] as const;
export type TreasuryAvailabilityStatus =
  (typeof TREASURY_AVAILABILITY_STATUSES)[number];

export const TREASURY_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type TreasurySortDirection = (typeof TREASURY_SORT_DIRECTIONS)[number];

export const TREASURY_ACCOUNT_SORT_FIELDS = [
  "code",
  "name",
  "createdAt",
  "updatedAt",
  "sortOrder",
] as const;
export type TreasuryAccountSortField =
  (typeof TREASURY_ACCOUNT_SORT_FIELDS)[number];

export const TREASURY_LEDGER_SORT_FIELDS = [
  "civilDate",
  "createdAt",
  "amount",
] as const;
export type TreasuryLedgerSortField =
  (typeof TREASURY_LEDGER_SORT_FIELDS)[number];

export const TREASURY_AGENDA_SORT_FIELDS = [
  "civilDate",
  "amount",
  "side",
] as const;
export type TreasuryAgendaSortField =
  (typeof TREASURY_AGENDA_SORT_FIELDS)[number];

/** Status operacional derivado (oficial + complemento) na listagem de CR. */
export const TREASURY_RECEIVABLE_OPERATIONAL_STATUSES = [
  "OPEN",
  "OVERDUE",
  "SETTLED",
  "PROMISED",
  "EXPECTED",
  "ON_HOLD",
  "CANCELLED_SOURCE",
  "CANCELLED_LOCAL",
] as const;
export type TreasuryReceivableOperationalStatus =
  (typeof TREASURY_RECEIVABLE_OPERATIONAL_STATUSES)[number];

export const TREASURY_RECEIVABLE_SORT_FIELDS = [
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "expectedDate",
  "priority",
  "lastSyncedAt",
  "externalId",
] as const;
export type TreasuryReceivableSortField =
  (typeof TREASURY_RECEIVABLE_SORT_FIELDS)[number];

/** Status operacional derivado (oficial + complemento) na listagem de CP. */
export const TREASURY_PAYABLE_OPERATIONAL_STATUSES = [
  "OPEN",
  "OVERDUE",
  "SETTLED",
  "PROGRAMMED",
  "AUTHORIZED",
  "EXPECTED",
  "ON_HOLD",
  "CANCELLED_SOURCE",
  "CANCELLED_LOCAL",
] as const;
export type TreasuryPayableOperationalStatus =
  (typeof TREASURY_PAYABLE_OPERATIONAL_STATUSES)[number];

/** Status da programação local de pagamento (CP). */
export const TREASURY_PAYABLE_PROGRAMMING_STATUSES = [
  "PROGRAMMED",
  "AUTHORIZED",
] as const;
export type TreasuryPayableProgrammingStatus =
  (typeof TREASURY_PAYABLE_PROGRAMMING_STATUSES)[number];

export const TREASURY_PAYABLE_SORT_FIELDS = [
  "dueDate",
  "personName",
  "openAmount",
  "originalAmount",
  "daysOverdue",
  "scheduledDate",
  "priority",
  "lastSyncedAt",
  "externalId",
  "documentNumber",
] as const;
export type TreasuryPayableSortField =
  (typeof TREASURY_PAYABLE_SORT_FIELDS)[number];

export const TREASURY_TITLE_OPERATIONAL_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;
export type TreasuryTitleOperationalPriority =
  (typeof TREASURY_TITLE_OPERATIONAL_PRIORITIES)[number];

export const TREASURY_TITLE_OPERATIONAL_STATUSES = [
  "ACTIVE",
  "ON_HOLD",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TreasuryTitleOperationalStatusCode =
  (typeof TREASURY_TITLE_OPERATIONAL_STATUSES)[number];
