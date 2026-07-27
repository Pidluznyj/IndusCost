import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TreasuryDomainError } from "./treasuryErrors.js";
import {
  assertTreasuryDailyClosingCanClose,
  assertTreasuryDailyClosingCanReopen,
  assertTreasuryDailyClosingMutable,
  isTreasuryDailyClosingMutable,
  planTreasuryDailyClosingReopen,
  TREASURY_DAILY_CLOSING_IMMUTABLE_PAYLOAD_FIELDS,
} from "./treasuryDailyClosingRules.js";

const closed = {
  id: "closing-v1",
  companyCode: "EMP1",
  civilDate: "2026-08-17",
  version: 1,
  status: "CLOSED" as const,
  sourceHash: "src-abc",
};

describe("treasuryDailyClosingRules", () => {
  it("OPEN é mutável; CLOSED/REOPENED são imutáveis", () => {
    assert.equal(isTreasuryDailyClosingMutable("OPEN"), true);
    assert.equal(isTreasuryDailyClosingMutable("CLOSED"), false);
    assert.equal(isTreasuryDailyClosingMutable("REOPENED"), false);

    assert.doesNotThrow(() => assertTreasuryDailyClosingMutable("OPEN"));
    assert.throws(
      () => assertTreasuryDailyClosingMutable("CLOSED", "update"),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.code === "CONFLICT" &&
        /imutável/.test(err.message)
    );
    assert.throws(
      () => assertTreasuryDailyClosingMutable("REOPENED", "delete"),
      TreasuryDomainError
    );
  });

  it("somente OPEN fecha; somente CLOSED reabre", () => {
    assert.doesNotThrow(() => assertTreasuryDailyClosingCanClose("OPEN"));
    assert.throws(
      () => assertTreasuryDailyClosingCanClose("CLOSED"),
      TreasuryDomainError
    );
    assert.doesNotThrow(() => assertTreasuryDailyClosingCanReopen("CLOSED"));
    assert.throws(
      () => assertTreasuryDailyClosingCanReopen("OPEN"),
      TreasuryDomainError
    );
    assert.throws(
      () => assertTreasuryDailyClosingCanReopen("REOPENED"),
      /preservada/
    );
  });

  it("reabertura preserva versão anterior e incrementa version", () => {
    const plan = planTreasuryDailyClosingReopen({
      current: closed,
      reason: "Ajuste de baixa Nomus",
    });
    assert.equal(plan.previousClosingId, "closing-v1");
    assert.equal(plan.previousStatus, "REOPENED");
    assert.equal(plan.nextVersion, 2);
    assert.equal(plan.newStatus, "OPEN");
    assert.equal(plan.companyCode, "EMP1");
    assert.equal(plan.civilDate, "2026-08-17");
    assert.equal(plan.inheritSourceHash, "src-abc");
    assert.equal(plan.reason, "Ajuste de baixa Nomus");
  });

  it("reabertura exige motivo e rejeita status inválido", () => {
    assert.throws(
      () =>
        planTreasuryDailyClosingReopen({
          current: closed,
          reason: "   ",
        }),
      /Motivo/
    );
    assert.throws(
      () =>
        planTreasuryDailyClosingReopen({
          current: { ...closed, status: "OPEN" },
          reason: "x",
        }),
      TreasuryDomainError
    );
  });

  it("lista campos de payload imutável cobre saldos e hash da fonte", () => {
    for (const field of [
      "sourceHash",
      "openingBalance",
      "realizedInflows",
      "realizedOutflows",
      "pendenciesAmount",
      "closingBalance",
      "observedBalance",
      "reconciledBalance",
      "differenceAmount",
      "exceptionsCount",
      "exceptionsAmount",
    ] as const) {
      assert.ok(
        (
          TREASURY_DAILY_CLOSING_IMMUTABLE_PAYLOAD_FIELDS as readonly string[]
        ).includes(field),
        field
      );
    }
  });
});
