/**
 * Tipos de domínio da Tesouraria (sem I/O).
 * Models Prisma reais virão em prompts de schema — aqui só contratos de domínio.
 */

import type { TreasuryMoneyString } from "../contracts/treasuryContracts.js";

export type TreasuryAccountId = string;

export type TreasurySide = "AR" | "AP";

/** Placeholder de posição de saldo — engine real em prompt futuro. */
export type TreasuryBalanceLayer = "observed" | "calculated" | "reconciled";

export type TreasuryBalancePositionDraft = {
  accountId: TreasuryAccountId;
  civilDate: string;
  observed: TreasuryMoneyString | null;
  calculated: TreasuryMoneyString | null;
  reconciled: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
};

export const TREASURY_MODULE_LABEL = "Central de Tesouraria" as const;
