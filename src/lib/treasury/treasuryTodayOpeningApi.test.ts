import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TREASURY_TODAY_OPENING_PATH } from "./contracts/index.js";
import { buildTreasuryTodayOpeningUrl } from "./treasuryTodayOpeningApi.js";
import {
  TREASURY_TODAY_OPENING_DIFF_LABELS,
  TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS,
  TREASURY_TODAY_OPENING_PAGE_TITLE,
  createTreasuryTodayOpeningDrafts,
  resolveTreasuryTodayOpeningViewKind,
} from "./treasuryTodayOpeningUi.js";
import type { TreasuryGuidedDailyOpeningWorkspaceDto } from "./contracts/index.js";

describe("treasuryTodayOpeningApi/Ui", () => {
  it("monta URL do workspace", () => {
    assert.equal(buildTreasuryTodayOpeningUrl(), TREASURY_TODAY_OPENING_PATH);
    assert.match(
      buildTreasuryTodayOpeningUrl({ date: "2026-07-28" }),
      /date=2026-07-28/
    );
  });

  it("usa linguagem simples e motivos de diferença", () => {
    assert.equal(TREASURY_TODAY_OPENING_PAGE_TITLE, "Saldos iniciais de hoje");
    assert.equal(
      TREASURY_TODAY_OPENING_DIFF_LABELS.previous,
      "Saldo final anterior"
    );
    assert.equal(
      TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS.AUTOMATIC_DEBIT,
      "Débito automático"
    );
    const corpus = JSON.stringify({
      ...TREASURY_TODAY_OPENING_DIFF_LABELS,
      ...TREASURY_TODAY_OPENING_JUSTIFICATION_OPTIONS,
    }).toLowerCase();
    for (const word of ["overlay", "ledger", "allocation", "snapshot"]) {
      assert.equal(corpus.includes(word), false, word);
    }
  });

  it("cria drafts e resolve view kinds", () => {
    const workspace: TreasuryGuidedDailyOpeningWorkspaceDto = {
      ok: true,
      civilDate: "2026-07-28",
      asOf: "2026-07-28T12:00:00.000+00:00",
      title: "Saldos iniciais de hoje",
      accounts: [
        {
          accountId: "a1",
          accountCode: "CX",
          accountName: "Caixa",
          bank: "Itaú",
          previousClosingBalance: "10.00",
          previousClosingCivilDate: "2026-07-27",
          previousClosingId: "c1",
          suggestedOpeningBalance: "10.00",
          currentOpeningBalance: null,
          expectedVersion: 0,
          situation: "READY_TO_CONFIRM",
          situationLabel: "Pronto para confirmar",
          requiresManualInput: false,
          canConfirmSuggested: true,
        },
      ],
      confirmableCount: 1,
      pendingCount: 1,
      confirmedCount: 0,
    };
    const drafts = createTreasuryTodayOpeningDrafts(workspace);
    assert.equal(drafts.a1?.displayAmount.includes("10"), true);
    assert.equal(
      resolveTreasuryTodayOpeningViewKind({
        canView: false,
        loading: false,
        error: null,
        data: null,
      }),
      "denied"
    );
  });
});
