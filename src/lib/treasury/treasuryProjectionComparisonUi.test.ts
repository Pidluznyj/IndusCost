import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildTreasuryComparisonQuery,
  createEmptyTreasuryComparisonFilters,
  parseVisibleScenariosParam,
  toggleVisibleScenario,
  treasuryComparisonFetchKey,
} from "./treasuryProjectionComparisonUi.js";
import { buildTreasuryProjectionCompareUrl } from "./treasuryProjectionComparisonApi.js";

describe("treasuryProjectionComparisonUi", () => {
  it("toggle de cenário não altera chave de fetch", () => {
    const accounts = [
      {
        id: "a1",
        companyCode: "LAZARIOS",
        companyName: null,
        code: "CX",
        name: "Caixa",
        institutionName: "Banco",
        institutionCode: null,
        accountType: "CHECKING" as const,
        currency: "BRL" as const,
        agencyMasked: "*",
        accountNumberMasked: "*",
        includeInConsolidated: true,
        minimumBalance: "0.00",
        allowNegativeBalance: false,
        liquidity: "IMMEDIATE" as const,
        defaultBalanceOrigin: "MANUAL" as const,
        sortOrder: 0,
        nomusBankAccountId: null,
        isActive: true,
        createdByUserId: "u",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        deactivatedAt: null,
        deactivatedByUserId: null,
        deactivationReason: null,
      },
    ];
    const base = createEmptyTreasuryComparisonFilters("2026-07-27");
    const q1 = buildTreasuryComparisonQuery({
      filters: base,
      accounts,
      today: "2026-07-27",
    });
    const q2 = buildTreasuryComparisonQuery({
      filters: {
        ...base,
        visibleScenarios: toggleVisibleScenario(base.visibleScenarios, "CONFIRMED"),
      },
      accounts,
      today: "2026-07-27",
    });
    assert.equal(treasuryComparisonFetchKey(q1), treasuryComparisonFetchKey(q2));
    const toggled = toggleVisibleScenario(base.visibleScenarios, "CONFIRMED");
    assert.equal(toggled.includes("CONFIRMED"), false);
    assert.equal(base.visibleScenarios.includes("CONFIRMED"), true);
  });

  it("parseVisibleScenarios e URL compare", () => {
    assert.deepEqual(parseVisibleScenariosParam("PROBABLE,CONTRACTUAL"), [
      "PROBABLE",
      "CONTRACTUAL",
    ]);
    const url = buildTreasuryProjectionCompareUrl({
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-08-26",
      consolidated: true,
    });
    assert.match(url, /\/api\/finance\/treasury\/projections\/compare\?/);
    assert.match(url, /companyCode=LAZARIOS/);
    assert.doesNotMatch(url, /scenario=/);
  });
});
