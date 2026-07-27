/**
 * DTOs compartilhados da Central de Tesouraria (client-safe).
 * Money = string decimal; civil date = YYYY-MM-DD; timestamps = ISO com offset.
 */

import type { TreasuryMoneyString } from "./treasuryMoneyContract.js";
import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";
import type {
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryAccountType,
  TreasuryAvailabilityStatus,
  TreasuryBalanceLayer,
  TreasuryBalanceOrigin,
  TreasuryClosingStatus,
  TreasuryCurrency,
  TreasuryCollectionActionType,
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
  minimumBalance: TreasuryMoneyString;
  allowNegativeBalance: boolean;
  liquidity: TreasuryAccountLiquidity;
  defaultBalanceOrigin: TreasuryBalanceOrigin;
  sortOrder: number;
  nomusBankAccountId: string | null;
  isActive: boolean;
  createdByUserId: string;
  createdAt: TreasuryTimestampIso;
  updatedAt: TreasuryTimestampIso;
  deactivatedAt: TreasuryTimestampIso | null;
  deactivatedByUserId: string | null;
  deactivationReason: string | null;
};

export type TreasuryFinancialAccountAccessDto = {
  id: string;
  accountId: string;
  userId: string;
  accessLevel: TreasuryAccountAccessLevel;
  canViewBalance: boolean;
  canMutateBalance: boolean;
  isActive: boolean;
  grantedByUserId: string | null;
  grantedAt: TreasuryTimestampIso;
  revokedAt: TreasuryTimestampIso | null;
};

export type TreasuryBalanceSnapshotDto = {
  id: string;
  accountId: string;
  referenceAt: TreasuryTimestampIso;
  /** Dia civil derivado de `referenceAt` (YYYY-MM-DD) para filtros de agenda. */
  civilDate: TreasuryCivilDate;
  /** Disponível livre persistido (base do operacional). */
  availableBalance: TreasuryMoneyString;
  blockedBalance: TreasuryMoneyString;
  investmentsBalance: TreasuryMoneyString;
  usedLimit: TreasuryMoneyString;
  /**
   * Calculado: available + blocked + investments (posição observada total).
   * Exposto separadamente do operacional.
   */
  observedBalance: TreasuryMoneyString;
  /** Calculado/alias: igual a availableBalance (saldo operacional disponível). */
  operationalAvailableBalance: TreasuryMoneyString;
  origin: TreasuryBalanceOrigin;
  idempotencyKey: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByUserId: string;
  previousSnapshotId: string | null;
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
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  nomusExternalId: string;
  promisedDate: TreasuryCivilDate;
  promisedAmount: TreasuryMoneyString;
  fulfilledAmount: TreasuryMoneyString;
  contactNote: string | null;
  channel: string | null;
  notes: string | null;
  responsibleUserId: string | null;
  status: TreasuryPromiseStatus;
  version: number;
  createdAt: TreasuryTimestampIso;
  createdByUserId: string;
  updatedAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
  cancelledAt: TreasuryTimestampIso | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  fulfilledAt: TreasuryTimestampIso | null;
};

export type TreasuryCollectionActionDto = {
  id: string;
  side: TreasurySide;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  nomusExternalId: string;
  actionType: TreasuryCollectionActionType;
  performedAt: TreasuryTimestampIso;
  contactPerson: string | null;
  result: string | null;
  notes: string | null;
  nextAction: string | null;
  responsibleUserId: string | null;
  version: number;
  createdAt: TreasuryTimestampIso;
  createdByUserId: string;
  updatedAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
  cancelledAt: TreasuryTimestampIso | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
};

export type TreasuryDisputeDto = {
  id: string;
  side: TreasurySide;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  nomusExternalId: string;
  openedAt: TreasuryTimestampIso;
  reason: string;
  amountDisputed: TreasuryMoneyString | null;
  responsibleUserId: string | null;
  involvedArea: string | null;
  dueDate: TreasuryCivilDate | null;
  notes: string | null;
  status: TreasuryDisputeStatus;
  resolutionNote: string | null;
  version: number;
  createdAt: TreasuryTimestampIso;
  createdByUserId: string;
  updatedAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
  cancelledAt: TreasuryTimestampIso | null;
  cancelledByUserId: string | null;
  resolvedAt: TreasuryTimestampIso | null;
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
