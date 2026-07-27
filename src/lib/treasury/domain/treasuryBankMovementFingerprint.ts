/**
 * Fingerprint e payload normalizado mínimo de movimentos bancários.
 * Sem I/O — usado por import/dedupe (prompts futuros) e testes de contrato.
 */

import { createHash } from "node:crypto";
import {
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import type { TreasuryBankMovementDirection } from "../contracts/treasuryEnums.js";

export type TreasuryBankMovementNormalizedPayload = {
  fitId: string | null;
  postedCivilDate: string;
  userCivilDate: string | null;
  direction: TreasuryBankMovementDirection;
  amount: TreasuryMoneyString;
  currency: string;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Fingerprint estável por conta.
 * Prefere FITID quando presente; senão compõe campos normalizados.
 */
export function buildTreasuryBankMovementFingerprint(input: {
  accountId: string;
  fitId?: string | null;
  postedCivilDate: string;
  direction: TreasuryBankMovementDirection;
  amount: string;
  description?: string | null;
  documentNumber?: string | null;
}): string {
  const accountId = input.accountId.trim();
  const fitId = input.fitId?.trim() || "";
  if (fitId) {
    return createHash("sha256")
      .update(`FIT|${accountId}|${fitId}`)
      .digest("hex");
  }
  const amount = normalizeTreasuryMoneyString(input.amount);
  const material = [
    "COMPOSED",
    accountId,
    input.postedCivilDate.trim(),
    input.direction,
    amount,
    normalizeText(input.description),
    normalizeText(input.documentNumber),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/** Monta payload JSON mínimo — sem raw OFX / sem dados bancários sensíveis. */
export function buildTreasuryBankMovementNormalizedPayload(input: {
  fitId?: string | null;
  postedCivilDate: string;
  userCivilDate?: string | null;
  direction: TreasuryBankMovementDirection;
  amount: string;
  currency?: string | null;
  description?: string | null;
  documentNumber?: string | null;
  counterpartyName?: string | null;
  trnType?: string | null;
}): TreasuryBankMovementNormalizedPayload {
  return {
    fitId: input.fitId?.trim() || null,
    postedCivilDate: input.postedCivilDate.trim(),
    userCivilDate: input.userCivilDate?.trim() || null,
    direction: input.direction,
    amount: normalizeTreasuryMoneyString(input.amount),
    currency: (input.currency ?? "BRL").trim().toUpperCase() || "BRL",
    description: input.description?.trim() || null,
    documentNumber: input.documentNumber?.trim() || null,
    counterpartyName: input.counterpartyName?.trim() || null,
    trnType: input.trnType?.trim() || null,
  };
}
