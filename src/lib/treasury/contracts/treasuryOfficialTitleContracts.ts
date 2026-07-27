/**
 * DTOs canônicos de leitura dos títulos oficiais Nomus (CR/CP).
 * Client-safe — sem Prisma. Não são cópia persistida; só projeção.
 */

import type { TreasuryCivilDate } from "./treasuryCivilDate.js";
import type { TreasuryMoneyString } from "./treasuryMoneyContract.js";
import type { TreasuryTimestampIso } from "./treasuryTimestamp.js";

export type OfficialTitleSourcePresenceStatus =
  | "PRESENT"
  | "MISSING_CANDIDATE"
  | "MISSING_CONFIRMED"
  | string;

export type OfficialCounterpartyView = {
  personId: number | null;
  name: string | null;
  taxId: string | null;
  /** Cliente (AR) ou fornecedor (AP) — denormalizado Nomus, sem FK canônica. */
  role: "CUSTOMER" | "SUPPLIER";
};

export type OfficialInvoiceRefView = {
  externalId: number | null;
  number: string | null;
};

export type OfficialSettlementView = {
  /** Valor baixado (AR: amountReceived; AP: amountPaid). */
  settledAmount: TreasuryMoneyString | null;
  /** Data da baixa (settlementDate). */
  settledAt: TreasuryCivilDate | null;
  /** AP: paymentDate quando distinto de settlementDate. */
  paidAt: TreasuryCivilDate | null;
};

export type OfficialCancellationView = {
  /**
   * Derivado de presença na origem (MISSING_CONFIRMED / sourceRemovedAt).
   * Não confundir com `nomusStatus` booleano de baixa.
   */
  isCancelledOrRemovedFromSource: boolean;
  sourcePresenceStatus: OfficialTitleSourcePresenceStatus;
  sourceRemovedAt: TreasuryTimestampIso | null;
};

export type OfficialStatusView = {
  /** Boolean cru do Nomus (`status`). Semântica: ver docs do adapter. */
  nomusStatus: boolean | null;
  isOpen: boolean;
  isSettled: boolean;
  sourcePresenceStatus: OfficialTitleSourcePresenceStatus;
};

/**
 * Visão canônica de Contas a Receber oficial (somente leitura).
 * Fonte: `NomusAccountsReceivable` — sem upsert/cópia local Tesouraria.
 */
export type OfficialReceivableView = {
  id: string;
  externalId: number;
  /** Melhor esforço a partir de rawPayload (coluna dedicada inexistente). */
  installmentNumber: number | null;
  installmentLabel: string | null;
  counterparty: OfficialCounterpartyView;
  /** Descrição Nomus (útil para filtro de documento quando não há documentNumber). */
  description: string | null;
  /** AR não tem `documentNumber` tipado — ver docs. */
  documentNumber: string | null;
  /** Pedido: só se vier no rawPayload; join SalesOrder fica fora deste adapter. */
  salesOrderExternalId: number | null;
  salesOrderCode: string | null;
  invoice: OfficialInvoiceRefView;
  /** Competência / melhor proxy de emissão no stage local. */
  issuedOn: TreasuryCivilDate | null;
  dueDate: TreasuryCivilDate | null;
  originalAmount: TreasuryMoneyString | null;
  openBalance: TreasuryMoneyString | null;
  settlements: OfficialSettlementView;
  cancellation: OfficialCancellationView;
  officialStatus: OfficialStatusView;
  lastSyncedAt: TreasuryTimestampIso;
};

/**
 * Visão canônica de Contas a Pagar oficial (somente leitura).
 * Fonte: `NomusAccountsPayable` — sem upsert/cópia local Tesouraria.
 */
export type OfficialPayableView = {
  id: string;
  externalId: number;
  installmentNumber: number | null;
  installmentLabel: string | null;
  counterparty: OfficialCounterpartyView;
  description: string | null;
  documentNumber: string | null;
  salesOrderExternalId: number | null;
  salesOrderCode: string | null;
  invoice: OfficialInvoiceRefView;
  issuedOn: TreasuryCivilDate | null;
  dueDate: TreasuryCivilDate | null;
  originalAmount: TreasuryMoneyString | null;
  openBalance: TreasuryMoneyString | null;
  settlements: OfficialSettlementView;
  cancellation: OfficialCancellationView;
  officialStatus: OfficialStatusView;
  lastSyncedAt: TreasuryTimestampIso;
};
