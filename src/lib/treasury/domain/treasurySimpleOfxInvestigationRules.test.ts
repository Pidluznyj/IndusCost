import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS,
  TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS,
  assertTreasurySimpleOfxNoAutoMatch,
  buildTreasurySimpleOfxInvestigationResult,
  mapTreasurySimpleOfxUnidentifiedToAllocationKind,
  resolveTreasurySimpleOfxLedgerDirection,
} from "./treasurySimpleOfxInvestigationRules.js";

describe("treasurySimpleOfxInvestigationRules", () => {
  it("monta resultado com divergência antes/explicados/restante", () => {
    const result = buildTreasurySimpleOfxInvestigationResult({
      divergenceBefore: "100.00",
      movements: [
        {
          id: "m1",
          amount: "40.00",
          reconciliationStatus: "MATCHED",
          reconciledAmount: "40.00",
        },
        {
          id: "m2",
          amount: "30.00",
          reconciliationStatus: "PARTIAL",
          reconciledAmount: "10.00",
        },
        {
          id: "m3",
          amount: "25.00",
          reconciliationStatus: "PENDING",
          reconciledAmount: "0.00",
        },
      ],
    });
    assert.equal(result.divergenceBefore, "100.00");
    assert.equal(result.explainedAmount, "50.00");
    assert.equal(result.unexplainedAmount, "45.00");
    assert.equal(result.remainingDivergence, "50.00");
    assert.equal(result.explainedCount, 2);
    assert.equal(result.unexplainedCount, 2);
    assert.equal(
      result.labels.possibleMatch,
      "Possível correspondência"
    );
  });

  it("mapeia opções não identificadas sem auto-match", () => {
    assert.equal(mapTreasurySimpleOfxUnidentifiedToAllocationKind("FEE"), "FEE");
    assert.equal(
      mapTreasurySimpleOfxUnidentifiedToAllocationKind("OTHER"),
      "MANUAL_LEDGER"
    );
    assert.equal(
      resolveTreasurySimpleOfxLedgerDirection("UNIDENTIFIED_INFLOW", "DEBIT"),
      "CREDIT"
    );
    assert.equal(
      TREASURY_SIMPLE_OFX_UNIDENTIFIED_OPTION_LABELS.INTEREST,
      "Registrar como juros"
    );
    assert.doesNotThrow(() => assertTreasurySimpleOfxNoAutoMatch(false));
    assert.throws(() => assertTreasurySimpleOfxNoAutoMatch(true));
    assert.match(
      TREASURY_SIMPLE_OFX_INVESTIGATION_LABELS.createManualLedger,
      /lançamento manual/i
    );
  });
});
