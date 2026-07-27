import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { subtractTreasuryMoney } from "../treasuryMoney.js";
import {
  assertScenarioDifferenceConsistency,
  buildTreasuryProjectionComparison,
  findFirstNegativeCivilDate,
  findMinimumClosingBalance,
} from "./treasuryProjectionComparisonRules.js";

describe("treasuryProjectionComparisonRules — consistência entre cenários", () => {
  it("diferenças = subtract dos saldos (money string, sem float)", () => {
    const result = buildTreasuryProjectionComparison({
      byScenario: {
        CONTRACTUAL: [
          {
            civilDate: "2026-07-28",
            closingBalance: "1000.00",
            uncertainReceivables: "50.00",
            riskAmount: "10.00",
            riskCode: "LOW",
          },
          {
            civilDate: "2026-07-29",
            closingBalance: "900.00",
            uncertainReceivables: "80.00",
            riskAmount: "20.00",
            riskCode: "MEDIUM",
          },
        ],
        PROBABLE: [
          {
            civilDate: "2026-07-28",
            closingBalance: "1100.00",
            uncertainReceivables: "30.00",
            riskAmount: "5.00",
            riskCode: "NONE",
          },
          {
            civilDate: "2026-07-29",
            closingBalance: "-50.00",
            uncertainReceivables: "40.00",
            riskAmount: "100.00",
            riskCode: "HIGH",
          },
        ],
        CONFIRMED: [
          {
            civilDate: "2026-07-28",
            closingBalance: "1050.00",
            uncertainReceivables: "0.00",
            riskAmount: "0.00",
            riskCode: "NONE",
          },
          {
            civilDate: "2026-07-29",
            closingBalance: "200.00",
            uncertainReceivables: "0.00",
            riskAmount: "0.00",
            riskCode: "NONE",
          },
        ],
      },
    });

    assert.equal(result.days.length, 2);
    for (const day of result.days) {
      assertScenarioDifferenceConsistency(day);
      assert.equal(
        day.differences.probableMinusContractual,
        day.balances.PROBABLE != null && day.balances.CONTRACTUAL != null
          ? subtractTreasuryMoney(
              day.balances.PROBABLE,
              day.balances.CONTRACTUAL
            )
          : null
      );
    }

    const d28 = result.days.find((d) => d.civilDate === "2026-07-28")!;
    assert.equal(d28.differences.probableMinusContractual, "100.00");
    assert.equal(d28.differences.confirmedMinusProbable, "-50.00");
    assert.equal(d28.differences.confirmedMinusContractual, "50.00");
    assert.equal(d28.uncertainReceivables.primary, "50.00");
    assert.equal(d28.uncertainReceivables.max, "50.00");

    const d29 = result.days.find((d) => d.civilDate === "2026-07-29")!;
    assert.equal(d29.highestRisk.riskCode, "HIGH");
    assert.equal(d29.highestRisk.scenario, "PROBABLE");
    assert.match(d29.highestRisk.riskLabel, /Alto/);

    assert.equal(result.byScenario.PROBABLE.firstNegativeDate, "2026-07-29");
    assert.equal(result.firstNegativeDateOverall, "2026-07-29");
    assert.equal(result.minimumBalanceOverall, "-50.00");
    assert.equal(result.minimumBalanceOverallScenario, "PROBABLE");
  });

  it("cenários idênticos → diferenças zero; sem data negativa", () => {
    const seed = {
      civilDate: "2026-07-27",
      closingBalance: "500.00",
      uncertainReceivables: "0.00",
      riskAmount: "0.00",
      riskCode: "NONE",
    };
    const result = buildTreasuryProjectionComparison({
      byScenario: {
        CONTRACTUAL: [seed],
        PROBABLE: [seed],
        CONFIRMED: [seed],
      },
    });
    const day = result.days[0]!;
    assertScenarioDifferenceConsistency(day);
    assert.equal(day.differences.probableMinusContractual, "0.00");
    assert.equal(day.differences.confirmedMinusProbable, "0.00");
    assert.equal(day.differences.confirmedMinusContractual, "0.00");
    assert.equal(result.firstNegativeDateOverall, null);
    assert.equal(result.minimumBalanceOverall, "500.00");
  });

  it("findFirstNegative / findMinimum são determinísticos", () => {
    assert.equal(
      findFirstNegativeCivilDate([
        { civilDate: "2026-08-02", closingBalance: "10.00" },
        { civilDate: "2026-08-01", closingBalance: "-1.00" },
        { civilDate: "2026-08-03", closingBalance: "-9.00" },
      ]),
      "2026-08-01"
    );
    const min = findMinimumClosingBalance([
      { civilDate: "2026-08-02", closingBalance: "10.00" },
      { civilDate: "2026-08-01", closingBalance: "-1.00" },
      { civilDate: "2026-08-03", closingBalance: "-9.00" },
    ]);
    assert.equal(min?.balance, "-9.00");
    assert.equal(min?.civilDate, "2026-08-03");
  });

  it("cenário ausente → diferenças null sem inventar saldo", () => {
    const result = buildTreasuryProjectionComparison({
      byScenario: {
        CONTRACTUAL: [
          {
            civilDate: "2026-07-27",
            closingBalance: "100.00",
            uncertainReceivables: "1.00",
            riskAmount: "0.00",
            riskCode: "NONE",
          },
        ],
        PROBABLE: [],
        CONFIRMED: [],
      },
    });
    const day = result.days[0]!;
    assert.equal(day.balances.PROBABLE, null);
    assert.equal(day.differences.probableMinusContractual, null);
    assert.equal(result.byScenario.PROBABLE.available, false);
  });
});
