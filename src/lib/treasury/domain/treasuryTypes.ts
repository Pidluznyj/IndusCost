/**
 * Tipos de domínio da Tesouraria (sem I/O).
 * Models Prisma reais virão em prompts de schema — aqui só contratos de domínio.
 */

import type { TreasuryMoneyString } from "../contracts/treasuryMoneyContract.js";
import type {
  TreasuryBalanceLayer,
  TreasurySide,
} from "../contracts/treasuryEnums.js";
import { TREASURY_MODULE_LABEL } from "../contracts/treasuryConstants.js";

export type { TreasuryBalanceLayer, TreasurySide };
export type { TreasuryMoneyString };
export { TREASURY_MODULE_LABEL };

export type TreasuryAccountId = string;

/** Placeholder de posição de saldo — engine real em prompt futuro. */
export type TreasuryBalancePositionDraft = {
  accountId: TreasuryAccountId;
  civilDate: string;
  observed: TreasuryMoneyString | null;
  calculated: TreasuryMoneyString | null;
  reconciled: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
};
