import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryAgendaDay,
  mergeAgendaScenarioSeeds,
  pickHigherRiskCode,
  treasuryAgendaRiskLabel,
} from "./treasuryAgendaDayRules.js";

describe("treasuryAgendaDayRules", () => {
  it("rótulo de risco é textual e não só código", () => {
    assert.equal(treasuryAgendaRiskLabel("NONE", "0.00"), "Sem risco material");
    assert.match(treasuryAgendaRiskLabel("HIGH", "120.50"), /Risco Alto/);
    assert.match(treasuryAgendaRiskLabel("HIGH", "120.50"), /HIGH/);
    assert.match(treasuryAgendaRiskLabel("HIGH", "120.50"), /120\.50/);
  });

  it("pickHigherRiskCode escolhe o maior", () => {
    assert.equal(pickHigherRiskCode("LOW", "HIGH"), "HIGH");
    assert.equal(pickHigherRiskCode("CRITICAL", "MEDIUM"), "CRITICAL");
    assert.equal(pickHigherRiskCode("NONE", "NONE"), "NONE");
  });

  it("monta buckets por cenário com money string", () => {
    const day = buildTreasuryAgendaDay({
      civilDate: "2026-07-27",
      accountId: "acc-1",
      accountCode: "CX01",
      accountName: "Caixa",
      primaryScenario: "PROBABLE",
      byScenario: {
        CONTRACTUAL: {
          civilDate: "2026-07-27",
          accountId: "acc-1",
          openingBalance: "1000.00",
          inflows: "200.00",
          outflows: "50.00",
          transfers: "0.00",
          realized: "0.00",
          closingBalance: "1150.00",
          riskAmount: "10.00",
          riskCode: "LOW",
          itemCount: 1,
        },
        PROBABLE: {
          civilDate: "2026-07-27",
          accountId: "acc-1",
          openingBalance: "1000.00",
          inflows: "180.00",
          outflows: "80.00",
          transfers: "5.00",
          realized: "30.00",
          closingBalance: "1105.00",
          riskAmount: "25.00",
          riskCode: "MEDIUM",
          itemCount: 2,
        },
        CONFIRMED: {
          civilDate: "2026-07-27",
          accountId: "acc-1",
          openingBalance: "1000.00",
          inflows: "100.00",
          outflows: "0.00",
          transfers: "0.00",
          realized: "100.00",
          closingBalance: "1100.00",
          riskAmount: "0.00",
          riskCode: "NONE",
          itemCount: 1,
        },
      },
    });

    assert.equal(day.openingBalance, "1000.00");
    assert.equal(day.plannedInflows, "200.00");
    assert.equal(day.confirmedInflows, "100.00");
    assert.equal(day.realizedInflows, "30.00");
    assert.equal(day.plannedOutflows, "50.00");
    assert.equal(day.programmedOutflows, "80.00");
    assert.equal(day.transfers, "5.00");
    assert.equal(day.closingBalance, "1105.00");
    assert.equal(day.riskCode, "MEDIUM");
    assert.match(day.riskLabel, /Médio/);
    assert.match(day.openingBalance, /^-?\d+\.\d{2}$/);
  });

  it("mergeAgendaScenarioSeeds soma money string e eleva risco", () => {
    const merged = mergeAgendaScenarioSeeds([
      {
        civilDate: "2026-07-27",
        accountId: "a",
        openingBalance: "10.00",
        inflows: "1.00",
        outflows: "2.00",
        transfers: "0.00",
        realized: "0.00",
        closingBalance: "9.00",
        riskAmount: "1.00",
        riskCode: "LOW",
        itemCount: 1,
      },
      {
        civilDate: "2026-07-27",
        accountId: "a",
        openingBalance: "5.00",
        inflows: "3.00",
        outflows: "1.00",
        transfers: "0.50",
        realized: "2.00",
        closingBalance: "7.00",
        riskAmount: "4.00",
        riskCode: "HIGH",
        itemCount: 2,
      },
    ]);
    assert.ok(merged);
    assert.equal(merged!.inflows, "4.00");
    assert.equal(merged!.outflows, "3.00");
    assert.equal(merged!.riskCode, "HIGH");
    assert.equal(merged!.itemCount, 3);
  });
});
