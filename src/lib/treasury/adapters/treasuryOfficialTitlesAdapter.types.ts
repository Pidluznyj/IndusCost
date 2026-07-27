/**
 * Tipos compartilhados do adapter de títulos oficiais Nomus (sem Prisma).
 */

import type {
  OfficialPayableView,
  OfficialReceivableView,
} from "../contracts/treasuryOfficialTitleContracts.js";

export type OfficialTitlesListFilter = {
  openOnly?: boolean;
  dueFrom?: Date | null;
  dueTo?: Date | null;
  personId?: number | null;
  externalIds?: number[] | null;
  page?: number;
  pageSize?: number;
};

export type OfficialTitlesListResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type TreasuryOfficialTitlesAdapter = {
  findReceivableById(id: string): Promise<OfficialReceivableView | null>;
  findReceivableByExternalId(
    externalId: number
  ): Promise<OfficialReceivableView | null>;
  listReceivables(
    filter?: OfficialTitlesListFilter
  ): Promise<OfficialTitlesListResult<OfficialReceivableView>>;
  findPayableById(id: string): Promise<OfficialPayableView | null>;
  findPayableByExternalId(
    externalId: number
  ): Promise<OfficialPayableView | null>;
  listPayables(
    filter?: OfficialTitlesListFilter
  ): Promise<OfficialTitlesListResult<OfficialPayableView>>;
};
