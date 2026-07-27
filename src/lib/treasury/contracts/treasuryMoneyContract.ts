/**
 * Contrato monetário da Tesouraria para schemas/DTOs (client-safe).
 */

import {
  isTreasuryMoneyString,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryContractError } from "./treasuryErrorCodes.js";

export type { TreasuryMoneyString };
export { isTreasuryMoneyString, normalizeTreasuryMoneyString };

export function parseTreasuryMoneyString(
  value: unknown,
  field = "amount"
): TreasuryMoneyString {
  if (value == null || value === "") {
    throw new TreasuryContractError(
      "REQUIRED_FIELD",
      `${field} é obrigatório.`,
      field
    );
  }
  if (typeof value !== "string") {
    throw new TreasuryContractError(
      "INVALID_MONEY",
      `${field} deve ser string decimal.`,
      field
    );
  }
  if (!isTreasuryMoneyString(value)) {
    throw new TreasuryContractError(
      "INVALID_MONEY",
      `${field} inválido (use string decimal com até 2 casas, sem vírgula).`,
      field
    );
  }
  return normalizeTreasuryMoneyString(value);
}

export function parseOptionalTreasuryMoneyString(
  value: unknown,
  field = "amount"
): TreasuryMoneyString | null {
  if (value == null || value === "") return null;
  return parseTreasuryMoneyString(value, field);
}
