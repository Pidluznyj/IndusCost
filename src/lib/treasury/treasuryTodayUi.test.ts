import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_TODAY_ACCOUNT_STATUS_LABELS,
  TREASURY_TODAY_DENIED_MESSAGE,
  TREASURY_TODAY_EMPTY_CTA_HREF,
  TREASURY_TODAY_METRIC_LABELS,
  TREASURY_TODAY_PAGE_TITLE,
  TREASURY_TODAY_STEP_STATUS_LABELS,
  buildTreasuryTodayPageSubtitle,
  formatTreasuryTodayCivilDate,
  resolveTreasuryTodayDivergenceTone,
  resolveTreasuryTodayPrimaryStep,
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
    assert.equal(TREASURY_TODAY_METRIC_LABELS.divergence, "Divergência");
    assert.equal(TREASURY_TODAY_EMPTY_CTA_HREF, "/finance/treasury/accounts");
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

  it("escolhe o próximo passo e tom da divergência", () => {
    assert.equal(
      resolveTreasuryTodayPrimaryStep([
        {
          id: "OPENING_BALANCES",
          order: 1,
          title: "Informar saldos iniciais",
          status: "DONE",
          continueHref: "/finance/treasury/today/opening",
          continueLabel: "Continuar",
        },
        {
          id: "REVIEW_RECEIPTS",
          order: 2,
          title: "Revisar recebimentos",
          status: "PENDING",
          continueHref: "/finance/treasury/today/receivables",
          continueLabel: "Continuar",
        },
      ])?.id,
      "REVIEW_RECEIPTS"
    );
    assert.equal(resolveTreasuryTodayDivergenceTone("0.00"), "success");
    assert.equal(resolveTreasuryTodayDivergenceTone("12.50"), "warning");
    assert.equal(resolveTreasuryTodayDivergenceTone(null), "neutral");
  });

  it("monta subtítulo com data civil", () => {
    const subtitle = buildTreasuryTodayPageSubtitle({
      civilDate: "2026-07-29",
      asOf: null,
    });
    assert.match(subtitle, /29\/07\/2026/);
  });
});
