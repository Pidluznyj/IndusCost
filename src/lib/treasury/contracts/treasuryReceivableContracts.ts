/**
 * Contratos da listagem/consulta de Contas a Receber (Tesouraria).
 * Oficial + complemento local — sem duplicar pessoa/vencimento/valor original.
 */

import type { OfficialReceivableView } from "./treasuryOfficialTitleContracts.js";
import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import type { TreasuryMoneyString } from "./treasuryMoneyContract.js";
import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";
import type {
  TreasuryReceivableOperationalStatus,
  TreasuryReceivableSortField,
  TreasurySortDirection,
  TreasuryTitleOperationalPriority,
  TreasuryTitleOperationalStatusCode,
} from "./treasuryEnums.js";
import type { TreasuryPaginationMeta } from "./treasuryPagination.js";

/** Complemento local embutido na listagem (sem espelhar campos oficiais). */
export type TreasuryReceivableComplementView = {
  id: string;
  expectedDate: TreasuryCivilDate | null;
  confirmedDate: TreasuryCivilDate | null;
  scheduledDate: TreasuryCivilDate | null;
  expectedAmount: TreasuryMoneyString | null;
  confirmedAmount: TreasuryMoneyString | null;
  scheduledAmount: TreasuryMoneyString | null;
  status: TreasuryTitleOperationalStatusCode;
  priority: TreasuryTitleOperationalPriority;
  plannedAccountId: string | null;
  responsibleUserId: string | null;
  nextAction: string | null;
  reason: string | null;
  notes: string | null;
  version: number;
  updatedAt: TreasuryTimestampIso;
  cancelledAt: TreasuryTimestampIso | null;
};

export type TreasuryReceivableActionView = {
  at: TreasuryTimestampIso;
  summary: string;
};

/**
 * Linha canônica da API de receivables.
 * `official` carrega o título Nomus; `complement` o overlay local (ou null).
 */
export type TreasuryReceivableListItemDto = {
  titleId: string;
  externalId: number;
  official: OfficialReceivableView;
  complement: TreasuryReceivableComplementView | null;
  /** Melhor esforço a partir de rawPayload Nomus (sem coluna tipada). */
  sellerName: string | null;
  commercialOwnerName: string | null;
  openAmount: TreasuryMoneyString | null;
  receivedAmount: TreasuryMoneyString | null;
  daysOverdue: number;
  operationalStatus: TreasuryReceivableOperationalStatus;
  lastAction: TreasuryReceivableActionView | null;
  nextAction: string | null;
};

export type TreasuryReceivablesListSummary = {
  titleCount: number;
  openAmountTotal: TreasuryMoneyString;
};

export type TreasuryReceivablesListResponse = {
  ok: true;
  rows: TreasuryReceivableListItemDto[];
  pagination: TreasuryPaginationMeta;
  summary: TreasuryReceivablesListSummary;
  sortBy: TreasuryReceivableSortField;
  sortDirection: TreasurySortDirection;
};

export type TreasuryReceivableDetailResponse = {
  ok: true;
  receivable: TreasuryReceivableListItemDto;
};

/** Recebimento recente do cliente (baixa oficial). */
export type TreasuryCustomerRecentReceiptItem = {
  titleId: string;
  externalId: number;
  settledAt: TreasuryCivilDate | null;
  settledAmount: TreasuryMoneyString | null;
  documentLabel: string | null;
};

/** Item do histórico de cobrança do cliente (append-only local). */
export type TreasuryCustomerCollectionHistoryItem = {
  actionId: string;
  titleId: string;
  actionType: string;
  performedAt: TreasuryTimestampIso;
  result: string | null;
  nextAction: string | null;
  contactPerson: string | null;
};

/**
 * Visão financeira resumida do cliente no detalhe de CR.
 * Totais agregam títulos oficiais do personId; atribuições do título âncora.
 * `sellerName` (vendedor do pedido) ≠ `commercialOwnerName` ≠ `collectionOwnerUserId`.
 */
export type TreasuryCustomerFinancialSummaryDto = {
  titleId: string;
  personId: number | null;
  personName: string | null;
  personTaxId: string | null;
  openAmountTotal: TreasuryMoneyString;
  overdueAmountTotal: TreasuryMoneyString;
  upcomingAmountTotal: TreasuryMoneyString;
  openTitleCount: number;
  overdueTitleCount: number;
  upcomingTitleCount: number;
  averageDaysOverdue: number | null;
  maxDaysOverdue: number;
  activePromiseCount: number;
  expiredPromiseCount: number;
  /** Taxa 0–1 (4 casas) ou null se não houver base (cumpridas+expiradas). */
  promiseFulfillmentRate: string | null;
  recentReceipts: TreasuryCustomerRecentReceiptItem[];
  collectionHistory: TreasuryCustomerCollectionHistoryItem[];
  sellerName: string | null;
  commercialOwnerName: string | null;
  collectionOwnerUserId: string | null;
};

export type TreasuryCustomerFinancialSummaryResponse = {
  ok: true;
  summary: TreasuryCustomerFinancialSummaryDto;
};
