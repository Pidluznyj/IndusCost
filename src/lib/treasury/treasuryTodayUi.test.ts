import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_TODAY_ACCOUNT_STATUS_LABELS,
  TREASURY_TODAY_DENIED_MESSAGE,
  TREASURY_TODAY_METRIC_LABELS,
  TREASURY_TODAY_PAGE_TITLE,
  TREASURY_TODAY_STEP_STATUS_LABELS,
  formatTreasuryTodayCivilDate,
  resolveTreasuryTodayViewKind,
} from "./treasuryTodayUi.js";

describe("treasuryTodayUi", () => {
  it("usa linguagem simples na navegação do dia", () => {
    assert.equal(TREASURY_TODAY_PAGE_TITLE, "Tesouraria de hoje");
    assert.equal(TREASURY_TODAY_STEP_STATUS_LABELS.DONE, "Concluída");
    assert.equal(TREASURY_TODAY_STEP_STATUS_LABELS.PENDING, "Pendente");
    assert.equal(
      TREASURY_TODAY_STEP_STATUS_LABELS.NEEDS_ATTENTION,
      "Precisa de atenção"
    );
    assert.equal(TREASURY_TODAY_METRIC_LABELS.openingBalance, "Saldo inicial");
    assert.equal(
      TREASURY_TODAY_METRIC_LABELS.divergence,
      "Divergência total"
    );
  });

  it("não expõe termos técnicos na UI padrão", () => {
    const corpus = [
      TREASURY_TODAY_PAGE_TITLE,
      TREASURY_TODAY_DENIED_MESSAGE,
      ...Object.values(TREASURY_TODAY_METRIC_LABELS),
      ...Object.values(TREASURY_TODAY_STEP_STATUS_LABELS),
      ...Object.values(TREASURY_TODAY_ACCOUNT_STATUS_LABELS),
    ].join(" ");
    for (const forbidden of ["overlay", "ledger", "allocation", "snapshot"]) {
      assert.equal(
        corpus.toLowerCase().includes(forbidden),
        false,
        forbidden
      );
    }
  });

  it("formata data civil e resolve view kinds", () => {
    assert.equal(formatTreasuryTodayCivilDate("2026-07-28"), "28/07/2026");
    assert.equal(
      resolveTreasuryTodayViewKind({
        canView: false,
        loading: false,
        error: null,
        data: null,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryTodayViewKind({
        canView: true,
        loading: true,
        error: null,
        data: null,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryTodayViewKind({
        canView: true,
        loading: false,
        error: "falha",
        data: null,
      }),
      "error"
    );
  });
});
