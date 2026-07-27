/**
 * Contratos da listagem/consulta de Contas a Pagar (Tesouraria).
 * Oficial Nomus + complemento local — sem duplicar pessoa/vencimento/valor original.
 */

import type { OfficialPayableView } from "./treasuryOfficialTitleContracts.js";
import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import type { TreasuryMoneyString } from "./treasuryMoneyContract.js";
import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";
import type {
  TreasuryPayableOperationalStatus,
  TreasuryPayableSortField,
  TreasurySortDirection,
  TreasuryTitleOperationalPriority,
  TreasuryTitleOperationalStatusCode,
} from "./treasuryEnums.js";
import type { TreasuryPaginationMeta } from "./treasuryPagination.js";

/** Complemento local embutido na listagem CP. */
export type TreasuryPayableComplementView = {
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

export type TreasuryPayableActionView = {
  at: TreasuryTimestampIso;
  summary: string;
};

/**
 * Linha canônica da API de payables.
 * `official` = Nomus; `complement` = overlay local (ou null).
 */
export type TreasuryPayableListItemDto = {
  titleId: string;
  externalId: number;
  official: OfficialPayableView;
  complement: TreasuryPayableComplementView | null;
  /** Categoria/classificação oficial. */
  classification: string | null;
  /** Centro de custo principal (alocação local, batch). */
  costCenterId: string | null;
  costCenterLabel: string | null;
  openAmount: TreasuryMoneyString | null;
  paidAmount: TreasuryMoneyString | null;
  /** Programação efetiva: complemento local, senão Nomus. */
  scheduledDate: TreasuryCivilDate | null;
  scheduledAmount: TreasuryMoneyString | null;
  plannedAccountId: string | null;
  priority: TreasuryTitleOperationalPriority | null;
  notes: string | null;
  daysOverdue: number;
  operationalStatus: TreasuryPayableOperationalStatus;
  lastAction: TreasuryPayableActionView | null;
  nextAction: string | null;
};

export type TreasuryPayablesListSummary = {
  titleCount: number;
  openAmountTotal: TreasuryMoneyString;
};

export type TreasuryPayablesListResponse = {
  ok: true;
  rows: TreasuryPayableListItemDto[];
  pagination: TreasuryPaginationMeta;
  summary: TreasuryPayablesListSummary;
  sortBy: TreasuryPayableSortField;
  sortDirection: TreasurySortDirection;
};

export type TreasuryPayableDetailResponse = {
  ok: true;
  payable: TreasuryPayableListItemDto;
};
