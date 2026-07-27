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
  TreasuryExceptionEntityKind,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryExceptionType,
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerStatus,
  TreasuryPositionValueOrigin,
  TreasuryProjectionLayer,
  TreasuryPromiseStatus,
  TreasuryReconciliationMatchStatus,
  TreasuryScheduleStatus,
  TreasurySide,
  TreasurySortDirection,
  TreasuryTransferStatus,
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

/** Metadado de origem — divergências e ausência nunca são omitidas. */
export type TreasuryPositionValueOriginMeta = {
  origin: TreasuryPositionValueOrigin;
  detail: string;
};

export type TreasuryAccountFinancialPositionDto = {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountType: string;
  includeInConsolidated: boolean;
  liquidity: TreasuryAccountLiquidity | string;
  allowNegativeBalance: boolean;
  /** true quando saldo observado/calculado disponível é < 0. */
  isNegative: boolean;
  hasSnapshot: boolean;
  snapshotId: string | null;
  snapshotReferenceAt: TreasuryTimestampIso | null;
  snapshotOrigin: TreasuryBalanceOrigin | string | null;
  /** Saldo observado total (available+blocked+investments) — null se sem snapshot. */
  observedBalance: TreasuryMoneyString | null;
  /** Saldo operacional disponível (availableBalance do snapshot). */
  operationalAvailableBalance: TreasuryMoneyString | null;
  /** Saldo calculado (snapshot observado + movimentos oficiais posteriores, ou só movimentos). */
  calculatedBalance: TreasuryMoneyString | null;
  /** Saldo conciliado — null enquanto não houver conciliação bancária. */
  reconciledBalance: TreasuryMoneyString | null;
  /** diferença = observado − calculado (null se algum lado ausente). Nunca ocultada. */
  divergence: TreasuryMoneyString | null;
  hasDivergence: boolean;
  blockedBalance: TreasuryMoneyString | null;
  investmentsBalance: TreasuryMoneyString | null;
  usedLimit: TreasuryMoneyString | null;
  officialMovementCount: number;
  officialMovementNet: TreasuryMoneyString;
  origins: {
    observed: TreasuryPositionValueOriginMeta;
    operationalAvailable: TreasuryPositionValueOriginMeta;
    calculated: TreasuryPositionValueOriginMeta;
    reconciled: TreasuryPositionValueOriginMeta;
    blocked: TreasuryPositionValueOriginMeta;
    investments: TreasuryPositionValueOriginMeta;
    usedLimit: TreasuryPositionValueOriginMeta;
  };
  alerts: string[];
  layers: TreasuryBalanceLayer[];
};

export type TreasuryConsolidatedFinancialPositionDto = {
  accountCount: number;
  includedAccountCount: number;
  excludedAccountCount: number;
  accountsMissingSnapshot: number;
  observedBalance: TreasuryMoneyString | null;
  operationalAvailableBalance: TreasuryMoneyString | null;
  calculatedBalance: TreasuryMoneyString | null;
  reconciledBalance: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
  hasDivergence: boolean;
  blockedBalance: TreasuryMoneyString | null;
  investmentsBalance: TreasuryMoneyString | null;
  usedLimit: TreasuryMoneyString | null;
  alerts: string[];
};

export type TreasuryFinancialPositionDto = {
  asOf: TreasuryTimestampIso;
  companyCode: string | null;
  accounts: TreasuryAccountFinancialPositionDto[];
  consolidated: TreasuryConsolidatedFinancialPositionDto;
  alerts: string[];
};

/** Freshness de uma fonte do dashboard diário. */
export type TreasuryDashboardSourceFreshnessDto = {
  source:
    | "BALANCE_SNAPSHOTS"
    | "OFFICIAL_RECEIVABLES"
    | "OFFICIAL_PAYABLES"
    | "TITLE_COMPLEMENTS";
  label: string;
  lastSuccessAt: TreasuryTimestampIso | null;
  isStale: boolean;
  detail: string;
};

export type TreasuryDashboardFreshnessDto = {
  asOf: TreasuryTimestampIso;
  sources: TreasuryDashboardSourceFreshnessDto[];
  hasStaleSource: boolean;
  staleSourceCount: number;
};

export type TreasuryDashboardCashFlowBucketDto = {
  kind: "RECEIPTS" | "PAYMENTS";
  plannedAmount: TreasuryMoneyString;
  plannedTitleCount: number;
  realizedAmount: TreasuryMoneyString;
  realizedTitleCount: number;
  pendingAmount: TreasuryMoneyString;
  pendingTitleCount: number;
};

export type TreasuryDashboardTitleCountDto = {
  receivablesPlanned: number;
  receivablesRealized: number;
  receivablesPending: number;
  payablesPlanned: number;
  payablesRealized: number;
  payablesPending: number;
  totalBucketSum: number;
  openOnDay: number;
};

export type TreasuryDashboardCompositionItemDto = {
  key: string;
  label: string;
  amount: TreasuryMoneyString | null;
  titleCount: number | null;
  origin: string;
  detailable: boolean;
};

export type TreasuryDashboardExceptionItemDto = {
  id: string;
  type: string;
  severity: TreasuryExceptionSeverity;
  status: TreasuryExceptionStatus;
  title: string;
  accountId: string | null;
  nomusExternalId: string | null;
  source: string;
};

/** Alerta operacional (configurável) — dashboard/agenda. */
export type TreasuryAlertItemDto = {
  id: string;
  kind: string;
  severity: TreasuryExceptionSeverity;
  title: string;
  description: string;
  amount: TreasuryMoneyString | null;
  accountId: string | null;
  civilDate: TreasuryCivilDate | null;
  entityId: string | null;
  metadata: Record<string, unknown> | null;
};

/** Resposta canônica GET /api/finance/treasury/dashboard */
export type TreasuryDashboardDto = {
  ok: true;
  civilDate: TreasuryCivilDate;
  scenario: TreasuryProjectionLayer;
  accountIds: string[] | null;
  asOf: TreasuryTimestampIso;
  freshness: TreasuryDashboardFreshnessDto;
  observedBalance: TreasuryMoneyString | null;
  calculatedBalance: TreasuryMoneyString | null;
  reconciledBalance: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
  hasDivergence: boolean;
  receipts: TreasuryDashboardCashFlowBucketDto;
  payments: TreasuryDashboardCashFlowBucketDto;
  currentBalance: TreasuryMoneyString | null;
  currentBalanceOrigin: string;
  projectedClosingBalance: TreasuryMoneyString | null;
  projectedClosingOrigin: string;
  titleCount: TreasuryDashboardTitleCountDto;
  accounts: TreasuryAccountFinancialPositionDto[];
  consolidated: TreasuryConsolidatedFinancialPositionDto;
  priorityExceptions: TreasuryDashboardExceptionItemDto[];
  /** Alertas configuráveis (limites/severidade em TreasuryAlertSettings). */
  alerts: TreasuryAlertItemDto[];
  composition: TreasuryDashboardCompositionItemDto[];
  origins: Record<string, string>;
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
  companyCode: string;
  fromAccountId: string;
  toAccountId: string;
  civilDate: TreasuryCivilDate;
  amount: TreasuryMoneyString;
  currency: TreasuryCurrency;
  status: TreasuryTransferStatus;
  memo: string | null;
  /** true enquanto enviada e ainda não recebida. */
  fundsInTransit: boolean;
  sentCivilDate: TreasuryCivilDate | null;
  receivedCivilDate: TreasuryCivilDate | null;
  reconciledCivilDate: TreasuryCivilDate | null;
  sentAt: TreasuryTimestampIso | null;
  receivedAt: TreasuryTimestampIso | null;
  reconciledAt: TreasuryTimestampIso | null;
  version: number;
  createdAt: TreasuryTimestampIso;
  createdByUserId: string;
  updatedAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
  cancelledAt: TreasuryTimestampIso | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
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

export type TreasuryProjectionSourceFreshnessDto = {
  source:
    | "PROJECTION_RUN"
    | "BALANCE_SNAPSHOTS"
    | "OFFICIAL_RECEIVABLES"
    | "OFFICIAL_PAYABLES";
  label: string;
  lastSuccessAt: TreasuryTimestampIso | null;
  isStale: boolean;
  detail: string;
};

export type TreasuryProjectionFreshnessDto = {
  asOf: TreasuryTimestampIso;
  sources: TreasuryProjectionSourceFreshnessDto[];
  hasStaleSource: boolean;
  staleSourceCount: number;
};

export type TreasuryProjectionDayLineDto = {
  id: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  openingBalance: TreasuryMoneyString;
  inflows: TreasuryMoneyString;
  outflows: TreasuryMoneyString;
  transfers: TreasuryMoneyString;
  realized: TreasuryMoneyString;
  closingBalance: TreasuryMoneyString;
  uncertainReceivables: TreasuryMoneyString;
  minimumBalance: TreasuryMoneyString;
  riskAmount: TreasuryMoneyString;
  riskCode: string;
  itemCount: number;
};

export type TreasuryProjectionCompositionItemDto = {
  id: string;
  dayLineId: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  itemKind: string;
  amount: TreasuryMoneyString;
  label: string | null;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  ledgerEntryId: string | null;
  transferGroupId: string | null;
  sourceRef: string | null;
  sortOrder: number;
};

export type TreasuryProjectionConsolidatedDayDto = {
  civilDate: TreasuryCivilDate;
  openingBalance: TreasuryMoneyString;
  inflows: TreasuryMoneyString;
  outflows: TreasuryMoneyString;
  transfers: TreasuryMoneyString;
  realized: TreasuryMoneyString;
  closingBalance: TreasuryMoneyString;
  uncertainReceivables: TreasuryMoneyString;
  riskAmount: TreasuryMoneyString;
  itemCount: number;
};

export type TreasuryProjectionRunDto = {
  ok: true;
  id: string;
  companyCode: string | null;
  scenario: TreasuryProjectionLayer;
  status: string;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  sourceVersion: string;
  algorithmVersion: string;
  freshness: TreasuryProjectionFreshnessDto;
  lineCount: number;
  itemCount: number;
  requestedAt: TreasuryTimestampIso;
  startedAt: TreasuryTimestampIso | null;
  finishedAt: TreasuryTimestampIso | null;
  failureCode: string | null;
  failureMessage: string | null;
  dayLines: TreasuryProjectionDayLineDto[] | null;
  consolidatedDays: TreasuryProjectionConsolidatedDayDto[] | null;
  previousValidRunId?: string | null;
};

export type TreasuryProjectionCompositionResponseDto = {
  ok: true;
  runId: string;
  companyCode: string | null;
  scenario: TreasuryProjectionLayer;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  sourceVersion: string;
  algorithmVersion: string;
  freshness: TreasuryProjectionFreshnessDto;
  items: TreasuryProjectionCompositionItemDto[];
  accountIds: string[] | null;
};

export type TreasuryProjectionComparisonScenarioMetaDto = {
  scenario: "CONTRACTUAL" | "PROBABLE" | "CONFIRMED";
  runId: string | null;
  sourceVersion: string | null;
  algorithmVersion: string | null;
  available: boolean;
  freshness: TreasuryProjectionFreshnessDto | null;
  firstNegativeDate: TreasuryCivilDate | null;
  minimumBalance: TreasuryMoneyString | null;
  minimumBalanceDate: TreasuryCivilDate | null;
  dayCount: number;
};

export type TreasuryProjectionComparisonDayDto = {
  civilDate: TreasuryCivilDate;
  balances: {
    CONTRACTUAL: TreasuryMoneyString | null;
    PROBABLE: TreasuryMoneyString | null;
    CONFIRMED: TreasuryMoneyString | null;
  };
  differences: {
    probableMinusContractual: TreasuryMoneyString | null;
    confirmedMinusProbable: TreasuryMoneyString | null;
    confirmedMinusContractual: TreasuryMoneyString | null;
  };
  /** Recebíveis sem previsão confiável (uncertainReceivables do motor). */
  uncertainReceivables: {
    CONTRACTUAL: TreasuryMoneyString | null;
    PROBABLE: TreasuryMoneyString | null;
    CONFIRMED: TreasuryMoneyString | null;
    max: TreasuryMoneyString | null;
    primary: TreasuryMoneyString | null;
  };
  highestRisk: {
    riskCode: string;
    riskAmount: TreasuryMoneyString;
    riskLabel: string;
    scenario: "CONTRACTUAL" | "PROBABLE" | "CONFIRMED" | null;
  };
};

export type TreasuryProjectionComparisonDto = {
  ok: true;
  companyCode: string;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  consolidated: boolean;
  accountIds: string[] | null;
  /** Sempre false — comparação lê runs persistidos, não recalcula. */
  recalculated: false;
  scenarios: TreasuryProjectionComparisonScenarioMetaDto[];
  days: TreasuryProjectionComparisonDayDto[];
  summary: {
    firstNegativeDateOverall: TreasuryCivilDate | null;
    minimumBalanceOverall: TreasuryMoneyString | null;
    minimumBalanceOverallDate: TreasuryCivilDate | null;
    minimumBalanceOverallScenario:
      | "CONTRACTUAL"
      | "PROBABLE"
      | "CONFIRMED"
      | null;
  };
  freshness: TreasuryProjectionFreshnessDto;
  maxHorizonDays: number;
};

export type TreasuryAgendaDayDto = {
  civilDate: TreasuryCivilDate;
  /** Null quando visão consolidada. */
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  openingBalance: TreasuryMoneyString;
  plannedInflows: TreasuryMoneyString;
  confirmedInflows: TreasuryMoneyString;
  realizedInflows: TreasuryMoneyString;
  plannedOutflows: TreasuryMoneyString;
  programmedOutflows: TreasuryMoneyString;
  realizedOutflows: TreasuryMoneyString;
  transfers: TreasuryMoneyString;
  closingBalance: TreasuryMoneyString | null;
  riskAmount: TreasuryMoneyString;
  riskCode: string;
  /** Rótulo textual — não usar só cor. */
  riskLabel: string;
  inflows: TreasuryMoneyString;
  outflows: TreasuryMoneyString;
  net: TreasuryMoneyString;
  realized: TreasuryMoneyString;
  itemCount: number;
  items: TreasuryProjectionCompositionItemDto[] | null;
  /** Alertas do dia (subconjunto de `alerts` da agenda). */
  alerts: TreasuryAlertItemDto[];
};

export type TreasuryAgendaDto = {
  ok: true;
  runId: string | null;
  companyCode: string | null;
  scenario: TreasuryProjectionLayer;
  baseDate: TreasuryCivilDate;
  endDate: TreasuryCivilDate;
  consolidated: boolean;
  accountIds: string[] | null;
  sourceVersion: string | null;
  algorithmVersion: string | null;
  freshness: TreasuryProjectionFreshnessDto;
  days: TreasuryAgendaDayDto[];
  /** Alertas do horizonte (configuráveis). */
  alerts: TreasuryAlertItemDto[];
  maxHorizonDays: number;
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
  companyCode: string;
  uniqueKey: string;
  type: TreasuryExceptionType;
  severity: TreasuryExceptionSeverity;
  status: TreasuryExceptionStatus;
  entityKind: TreasuryExceptionEntityKind | null;
  entityId: string | null;
  accountId: string | null;
  nomusExternalId: string | null;
  title: string;
  description: string | null;
  amount: TreasuryMoneyString | null;
  detectedAt: TreasuryTimestampIso;
  dueAt: TreasuryCivilDate | null;
  responsibleUserId: string | null;
  resolution: string | null;
  ignoreJustification: string | null;
  recurrenceCount: number;
  metadata: Record<string, unknown> | null;
  version: number;
  createdAt: TreasuryTimestampIso;
  createdByUserId: string;
  updatedAt: TreasuryTimestampIso;
  updatedByUserId: string | null;
  acknowledgedAt: TreasuryTimestampIso | null;
  resolvedAt: TreasuryTimestampIso | null;
  cancelledAt: TreasuryTimestampIso | null;
  cancelledByUserId: string | null;
  /** Idade em dias civis desde detectedAt (calculada na leitura). */
  ageDays: number;
  recommendedAction: string;
  /** Deep-link relativo para a entidade relacionada. */
  entityHref: string | null;
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
