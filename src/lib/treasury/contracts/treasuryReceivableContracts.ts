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

export type TreasuryReceivablesListResponse = {
  ok: true;
  rows: TreasuryReceivableListItemDto[];
  pagination: TreasuryPaginationMeta;
  sortBy: TreasuryReceivableSortField;
  sortDirection: TreasurySortDirection;
};

export type TreasuryReceivableDetailResponse = {
  ok: true;
  receivable: TreasuryReceivableListItemDto;
};
