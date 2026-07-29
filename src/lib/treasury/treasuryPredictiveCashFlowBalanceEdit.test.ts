import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEditTreasuryCivilDateBalances,
  parseMoneyInputPtBr,
} from "./treasuryPredictiveCashFlowBalanceEdit.js";

describe("treasuryPredictiveCashFlowBalanceEdit", () => {
  it("permite o dia vigente para qualquer papel", () => {
    assert.deepEqual(
      canEditTreasuryCivilDateBalances({
        civilDate: "2026-07-29",
        todayCivilDate: "2026-07-29",
        isSuperAdmin: false,
      }),
      { allowed: true, reason: null }
    );
  });

  it("bloqueia dias passados para não SUPER_ADMIN", () => {
    const r = canEditTreasuryCivilDateBalances({
      civilDate: "2026-07-28",
      todayCivilDate: "2026-07-29",
      isSuperAdmin: false,
    });
    assert.equal(r.allowed, false);
    assert.match(String(r.reason), /SUPER_ADMIN/);
  });

  it("permite dias passados para SUPER_ADMIN", () => {
    assert.deepEqual(
      canEditTreasuryCivilDateBalances({
        civilDate: "2026-07-28",
        todayCivilDate: "2026-07-29",
        isSuperAdmin: true,
      }),
      { allowed: true, reason: null }
    );
  });

  it("bloqueia dias futuros", () => {
    const r = canEditTreasuryCivilDateBalances({
      civilDate: "2026-07-30",
      todayCivilDate: "2026-07-29",
      isSuperAdmin: true,
    });
    assert.equal(r.allowed, false);
    assert.match(String(r.reason), /futuros/);
  });

  it("parseia dinheiro pt-BR", () => {
    assert.equal(parseMoneyInputPtBr("60.351,00"), "60351.00");
    assert.equal(parseMoneyInputPtBr(""), null);
  });
});
