import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  listTreasurySimpleCashRiskCompanyCodes,
  resolveTreasurySimpleCashRiskRange,
} from "./treasurySimpleCashRiskProjectionUi.js";

describe("treasurySimpleCashRiskProjectionUi — Fluxo Gerencial filters", () => {
  it("lista companyCodes distintos e ordenados (ignora vazio)", () => {
    const codes = listTreasurySimpleCashRiskCompanyCodes([
      { companyCode: " EMP2 " },
      { companyCode: "EMP1" },
      { companyCode: "EMP2" },
      { companyCode: "" },
      { companyCode: "   " },
      { companyCode: "EMP1" },
    ]);
    assert.deepEqual(codes, ["EMP1", "EMP2"]);
  });

  it("resolve horizonte a partir do dia civil selecionado (não só today)", () => {
    const range = resolveTreasurySimpleCashRiskRange(
      "30d",
      "2026-07-30",
      "2026-06-01"
    );
    assert.equal(range.baseDate, "2026-06-01");
    assert.equal(range.endDate, "2026-06-30");
  });
});
