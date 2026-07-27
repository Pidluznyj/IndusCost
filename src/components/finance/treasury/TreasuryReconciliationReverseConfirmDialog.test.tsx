import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TreasuryReconciliationMatchDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE } from "@/src/lib/treasury/contracts/index.js";
import { TreasuryReconciliationReverseConfirmDialog } from "./TreasuryReconciliationReverseConfirmDialog.js";

const match: TreasuryReconciliationMatchDto = {
  id: "match-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  status: "MATCHED",
  matchedAmount: "250.00",
  currency: "BRL",
  matchedCivilDate: "2026-07-20",
  justification: null,
  suggestionKey: null,
  algorithmVersion: null,
  suggestionScore: null,
  suggestionConfidence: null,
  suggestionReasons: null,
  version: 1,
  movements: [
    {
      id: "mm-1",
      matchId: "match-1",
      bankMovementId: "mov-1",
      amount: "250.00",
      sortOrder: 0,
    },
  ],
  allocations: [
    {
      id: "al-1",
      matchId: "match-1",
      kind: "TITLE",
      amount: "250.00",
      memo: null,
      nomusSide: "AR",
      officialTitleId: "t1",
      nomusExternalId: 1,
      transferId: null,
      transferGroupId: null,
      ledgerEntryId: null,
      differenceCode: null,
      sortOrder: 0,
    },
  ],
  createdAt: "2026-07-20T00:00:00.000+00:00",
  createdByUserId: "u1",
  updatedAt: "2026-07-20T00:00:00.000+00:00",
  updatedByUserId: null,
  unmatchedAt: null,
  unmatchedByUserId: null,
  unmatchReason: null,
  isReversed: false,
  doesNotRealizeOfficial: true,
};

describe("TreasuryReconciliationReverseConfirmDialog", () => {
  it("exige frase REVERTER e mostra resumo do match", () => {
    const html = renderToStaticMarkup(
      <TreasuryReconciliationReverseConfirmDialog
        open
        match={match}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    );
    assert.match(html, /treasury-reconciliation-reverse-dialog/);
    assert.match(html, /Reverter conciliação/);
    assert.match(html, new RegExp(TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE));
    assert.match(html, /TITLE/);
    assert.match(html, /disabled/);
    assert.match(html, /Não altera títulos oficiais Nomus/);
  });
});
