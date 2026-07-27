/**
 * DTOs compartilhados da Central de Tesouraria (client-safe).
 * Money = string decimal; civil date = YYYY-MM-DD; timestamps = ISO com offset.
 */

import type { TreasuryMoneyString } from "./treasuryMoneyContract.js";
import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";
import type {
  TreasuryAccountType,
  TreasuryAvailabilityStatus,
  TreasuryBalanceLayer,
  TreasuryBalanceSource,
  TreasuryClosingStatus,
  TreasuryCurrency,
  TreasuryDisputeStatus,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerStatus,
  TreasuryProjectionLayer,
  TreasuryPromiseStatus,
  TreasuryReconciliationMatchStatus,
  TreasuryScheduleStatus,
  TreasurySide,
  TreasurySortDirection,
} from "./treasuryEnums.js";
import type { TreasuryPaginationMeta } from "./treasuryPagination.js";

export type TreasuryModuleId = "treasury";

export type TreasuryAvailabilityResponse = {
  ok: true;
  module: TreasuryModuleId;
  status: TreasuryAvailabilityStatus;
  enabled: boolean;
  /** Scaffold version — sem regras financeiras ainda. */
  scaffoldVersion: string;
  serverTimeIso: TreasuryTimestampIso;
};

export type TreasuryFinancialAccountDto = {
  id: string;
  code: string;
  name: string;
  accountType: TreasuryAccountType;
  currency: TreasuryCurrency;
  bankCode: string | null;
  agency: string | null;
  accountNumber: string | null;
  nomusBankAccountId: string | null;
  isActive: boolean;
  createdAt: TreasuryTimestampIso;
  updatedAt: TreasuryTimestampIso;
};

export type TreasuryBalanceSnapshotDto = {
  id: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  observedBalance: TreasuryMoneyString;
  source: TreasuryBalanceSource;
  version: number;
  supersedesId: string | null;
  createdBy: string | null;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryBalancePositionDto = {
  accountId: string;
  civilDate: TreasuryCivilDate;
  observed: TreasuryMoneyString | null;
  calculated: TreasuryMoneyString | null;
  reconciled: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
  layers: TreasuryBalanceLayer[];
};

export type TreasuryLedgerEntryDto = {
  id: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  amount: TreasuryMoneyString;
  direction: TreasuryLedgerDirection;
  nature: TreasuryLedgerNature;
  status: TreasuryLedgerStatus;
  memo: string | null;
  counterpartRef: string | null;
  transferGroupId: string | null;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryTransferDto = {
  id: string;
  transferGroupId: string;
  fromAccountId: string;
  toAccountId: string;
  civilDate: TreasuryCivilDate;
  amount: TreasuryMoneyString;
  memo: string | null;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryPaymentPromiseDto = {
  id: string;
  side: TreasurySide;
  nomusExternalId: string;
  promisedDate: TreasuryCivilDate;
  promisedAmount: TreasuryMoneyString;
  contactNote: string | null;
  status: TreasuryPromiseStatus;
  createdAt: TreasuryTimestampIso;
  updatedAt: TreasuryTimestampIso;
};

export type TreasuryDisputeDto = {
  id: string;
  side: TreasurySide;
  nomusExternalId: string;
  openedAt: TreasuryTimestampIso;
  reason: string;
  amountDisputed: TreasuryMoneyString | null;
  status: TreasuryDisputeStatus;
  resolutionNote: string | null;
};

export type TreasuryPaymentScheduleItemDto = {
  id: string;
  payableExternalId: string;
  scheduledDate: TreasuryCivilDate;
  scheduledAmount: TreasuryMoneyString;
  priority: number;
  accountId: string | null;
  status: TreasuryScheduleStatus;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryProjectionPointDto = {
  civilDate: TreasuryCivilDate;
  layer: TreasuryProjectionLayer;
  amount: TreasuryMoneyString;
  side: TreasurySide | null;
};

export type TreasuryDailyClosingDto = {
  id: string;
  civilDate: TreasuryCivilDate;
  status: TreasuryClosingStatus;
  version: number;
  contentHash: string | null;
  closedBy: string | null;
  closedAt: TreasuryTimestampIso | null;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryExceptionDto = {
  id: string;
  type: string;
  severity: TreasuryExceptionSeverity;
  status: TreasuryExceptionStatus;
  accountId: string | null;
  nomusExternalId: string | null;
  createdAt: TreasuryTimestampIso;
  updatedAt: TreasuryTimestampIso;
};

export type TreasuryReconciliationMatchDto = {
  id: string;
  ofxTxId: string;
  ledgerEntryId: string | null;
  nomusSide: TreasurySide | null;
  nomusExternalId: string | null;
  status: TreasuryReconciliationMatchStatus;
  confidence: number | null;
  createdAt: TreasuryTimestampIso;
};

export type TreasuryListResponse<T> = {
  ok: true;
  rows: T[];
  pagination: TreasuryPaginationMeta;
  sortBy: string;
  sortDirection: TreasurySortDirection;
};
