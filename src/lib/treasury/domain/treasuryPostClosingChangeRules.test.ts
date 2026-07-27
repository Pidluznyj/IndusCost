import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  POST_CLOSING_FINANCIAL_CHANGE,
  buildTreasuryPostClosingChangeId,
  buildTreasuryPostClosingTreatmentHref,
  computeTreasuryPostClosingDifferenceAmount,
  detectTreasuryPostClosingFinancialChange,
  isTreasuryDayClosedForPostClosingDetection,
} from "./treasuryPostClosingChangeRules.js";
import { runTreasuryExceptionEngine } from "./treasuryExceptionEngine.js";

const closed = {
  id: "close-1",
  companyCode: "EMP1",
  civilDate: "2026-07-20",
  status: "CLOSED",
  version: 1,
  sourceHash: "hash-frozen",
  observedBalance: "1000.00",
  closingBalance: "1000.00",
  differenceAmount: "0.00",
};

describe("treasuryPostClosingChangeRules", () => {
  it("alias POST_CLOSING_FINANCIAL_CHANGE aponta para tipo persistido", () => {
    assert.equal(POST_CLOSING_FINANCIAL_CHANGE, "FINANCIAL_CHANGE_AFTER_CLOSING");
    assert.equal(isTreasuryDayClosedForPostClosingDetection("CLOSED"), true);
    assert.equal(isTreasuryDayClosedForPostClosingDetection("OPEN"), false);
    assert.equal(isTreasuryDayClosedForPostClosingDetection("REOPENED"), false);
  });

  it("baixa tardia gera detecção com diferença e não reescreve fechamento", () => {
    const detection = detectTreasuryPostClosingFinancialChange({
      closing: closed,
      event: {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_SETTLEMENT",
        entityKind: "RECEIVABLE",
        entityId: "ar-99",
        amount: "150.00",
        frozenAmount: "150.00",
        currentAmount: "0.00",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
    });
    assert.ok(detection);
    assert.equal(detection!.shouldRaise, true);
    assert.equal(detection!.differenceAmount, "-150.00");
    assert.equal(detection!.closingId, "close-1");
    assert.match(detection!.description, /imutável/);
    assert.equal(
      detection!.changeId,
      buildTreasuryPostClosingChangeId({
        changeKind: "LATE_SETTLEMENT",
        entityKind: "RECEIVABLE",
        entityId: "ar-99",
        civilDate: "2026-07-20",
      })
    );
  });

  it("cancelamento tardio e movimento bancário tardio", () => {
    const cancel = detectTreasuryPostClosingFinancialChange({
      closing: closed,
      event: {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_CANCELLATION",
        entityKind: "PAYABLE",
        entityId: "ap-1",
        amount: "80.00",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
    });
    assert.ok(cancel);
    assert.match(cancel!.title, /Cancelamento tardio/);

    const bank = detectTreasuryPostClosingFinancialChange({
      closing: closed,
      event: {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_BANK_MOVEMENT",
        entityKind: "RECONCILIATION",
        entityId: "ofx-1",
        amount: "25.50",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
    });
    assert.ok(bank);
    assert.equal(bank!.differenceAmount, "25.50");
  });

  it("alteração de saldo calcula diferença current - frozen", () => {
    assert.equal(
      computeTreasuryPostClosingDifferenceAmount({
        frozenAmount: "1000.00",
        currentAmount: "1100.00",
      }),
      "100.00"
    );
    const detection = detectTreasuryPostClosingFinancialChange({
      closing: closed,
      event: {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "BALANCE_CHANGE",
        entityKind: "ACCOUNT",
        entityId: "acc-1",
        accountId: "acc-1",
        frozenAmount: "1000.00",
        currentAmount: "950.00",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
    });
    assert.equal(detection?.differenceAmount, "-50.00");
  });

  it("ignora dia não fechado e sync com mesmo hash", () => {
    assert.equal(
      detectTreasuryPostClosingFinancialChange({
        closing: { ...closed, status: "OPEN" },
        event: {
          companyCode: "EMP1",
          civilDate: "2026-07-20",
          changeKind: "LATE_SETTLEMENT",
          entityKind: "RECEIVABLE",
          entityId: "ar-1",
          amount: "10.00",
          changedAtIso: "2026-07-22T12:00:00.000Z",
        },
      }),
      null
    );
    assert.equal(
      detectTreasuryPostClosingFinancialChange({
        closing: closed,
        event: {
          companyCode: "EMP1",
          civilDate: "2026-07-20",
          changeKind: "SYNC_CHANGE",
          entityKind: "CLOSING",
          entityId: "close-1",
          currentSourceHash: "hash-frozen",
          changedAtIso: "2026-07-22T12:00:00.000Z",
        },
      }),
      null
    );
    assert.ok(
      detectTreasuryPostClosingFinancialChange({
        closing: closed,
        event: {
          companyCode: "EMP1",
          civilDate: "2026-07-20",
          changeKind: "SYNC_CHANGE",
          entityKind: "CLOSING",
          entityId: "close-1",
          currentSourceHash: "hash-new",
          changedAtIso: "2026-07-22T12:00:00.000Z",
        },
      })
    );
  });

  it("motor gera FINANCIAL_CHANGE_AFTER_CLOSING com diferença e treatment href helper", () => {
    const detection = detectTreasuryPostClosingFinancialChange({
      closing: closed,
      event: {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_SETTLEMENT",
        entityKind: "RECEIVABLE",
        entityId: "ar-99",
        amount: "150.00",
        frozenAmount: "150.00",
        currentAmount: "0.00",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
    });
    assert.ok(detection);
    const engine = runTreasuryExceptionEngine({
      companyCode: "EMP1",
      asOfCivilDate: "2026-07-20",
      detectedAtIso: "2026-07-22T12:00:00.000Z",
      nowEpochMs: Date.parse("2026-07-22T12:00:00.000Z"),
      postClosingChanges: [detection!.seed],
      openExceptions: [],
    });
    assert.equal(engine.plan.upserts.length, 1);
    assert.equal(engine.plan.upserts[0]!.type, "FINANCIAL_CHANGE_AFTER_CLOSING");
    assert.equal(engine.plan.upserts[0]!.amount, "-150.00");
    assert.match(engine.plan.upserts[0]!.description!, /Diferença: -150\.00/);
    assert.equal(engine.plan.autoResolves.length, 0);
    assert.equal(
      buildTreasuryPostClosingTreatmentHref({
        companyCode: "EMP1",
        closedCivilDate: "2026-07-20",
      }),
      "/finance/treasury/closing?date=2026-07-20&companyCode=EMP1"
    );
  });
});
