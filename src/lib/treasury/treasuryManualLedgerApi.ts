/**
 * Cliente HTTP — lançamentos manuais do ledger da Tesouraria (browser-safe).
 */

import { fetchJsonOk } from "@/src/lib/http.js";
import { TREASURY_LEDGER_ENTRIES_PATH } from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryLedgerEntryDto } from "@/src/lib/treasury/contracts/index.js";

export type CreateTreasuryManualLedgerEntryBody = {
  accountId: string;
  civilDate: string;
  amount: string;
  direction: "DEBIT" | "CREDIT";
  nature?: "MANUAL";
  memo?: string | null;
  counterpartRef?: string | null;
};

export type CreateTreasuryManualLedgerEntryPayload = {
  ok?: true;
  entry: TreasuryLedgerEntryDto;
  requestId?: string;
};

export async function createTreasuryManualLedgerEntry(
  body: CreateTreasuryManualLedgerEntryBody
): Promise<TreasuryLedgerEntryDto> {
  const res = await fetchJsonOk<CreateTreasuryManualLedgerEntryPayload>(
    TREASURY_LEDGER_ENTRIES_PATH,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId: body.accountId,
        civilDate: body.civilDate,
        amount: body.amount,
        direction: body.direction,
        nature: body.nature ?? "MANUAL",
        memo: body.memo ?? null,
        counterpartRef: body.counterpartRef ?? null,
      }),
    }
  );
  return res.entry;
}
