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
  "FULFILLED",
  "BROKEN",
  "CANCELLED",
] as const;
export type TreasuryPromiseStatus = (typeof TREASURY_PROMISE_STATUSES)[number];

export const TREASURY_DISPUTE_STATUSES = [
  "OPEN",
  "RESOLVED",
  "CANCELLED",
] as const;
export type TreasuryDisputeStatus = (typeof TREASURY_DISPUTE_STATUSES)[number];

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
] as const;
export type TreasuryProjectionLayer = (typeof TREASURY_PROJECTION_LAYERS)[number];

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
