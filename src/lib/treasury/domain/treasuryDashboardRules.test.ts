import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryFinancialPositionDto } from "../contracts/treasuryDto.js";
import {
  assertTreasuryDashboardTotalsConsistent,
  buildFreshnessDto,
  buildTreasuryDashboardDto,
  computeProjectedClosingBalance,
  emptyTreasuryDashboardDayFlow,
} from "./treasuryDashboardRules.js";

function samplePosition(
  overrides: Partial<TreasuryFinancialPositionDto> = {}
): TreasuryFinancialPositionDto {
  return {
    asOf: "2026-07-27T23:59:59.000-03:00",
    companyCode: null,
    accounts: [
      {
        accountId: "acc-1",
        accountCode: "CX01",
        accountName: "Caixa",
        accountType: "CHECKING",
        includeInConsolidated: true,
        liquidity: "IMMEDIATE",
        allowNegativeBalance: false,
        isNegative: false,
        hasSnapshot: true,
        snapshotId: "snap-1",
        snapshotReferenceAt: "2026-07-27T10:00:00.000-03:00",
        snapshotOrigin: "MANUAL",
        observedBalance: "1000.00",
        operationalAvailableBalance: "900.00",
        calculatedBalance: "980.00",
        reconciledBalance: null,
        divergence: "20.00",
        hasDivergence: true,
        blockedBalance: "50.00",
        investmentsBalance: "50.00",
        usedLimit: "0.00",
        officialMovementCount: 1,
        officialMovementNet: "-20.00",
        origins: {
          observed: { origin: "BALANCE_SNAPSHOT", detail: "snap" },
          operationalAvailable: {
            origin: "BALANCE_SNAPSHOT",
            detail: "snap",
          },
          calculated: {
            origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
            detail: "mov",
          },
          reconciled: { origin: "MISSING", detail: "ausente" },
          blocked: { origin: "BALANCE_SNAPSHOT", detail: "snap" },
          investments: { origin: "BALANCE_SNAPSHOT", detail: "snap" },
          usedLimit: { origin: "BALANCE_SNAPSHOT", detail: "snap" },
        },
        alerts: ["Divergência entre observado e calculado"],
        layers: ["observed", "calculated"],
      },
    ],
    consolidated: {
      accountCount: 1,
      includedAccountCount: 1,
      excludedAccountCount: 0,
      accountsMissingSnapshot: 0,
      observedBalance: "1000.00",
      operationalAvailableBalance: "900.00",
      calculatedBalance: "980.00",
      reconciledBalance: null,
      divergence: "20.00",
      hasDivergence: true,
      blockedBalance: "50.00",
      investmentsBalance: "50.00",
      usedLimit: "0.00",
      alerts: ["Divergência consolidada"],
    },
    alerts: [
      "Divergência consolidada",
      "Divergência entre observado e calculado",
    ],
    ...overrides,
  };
}

describe("treasuryDashboardRules", () => {
  it("projeta encerramento = atual + previstos CR − previstos CP", () => {
    const projected = computeProjectedClosingBalance({
      currentBalance: "1000.00",
      plannedReceipts: "200.00",
      plannedPayments: "150.00",
    });
    assert.equal(projected.projectedClosingBalance, "1050.00");
  });

  it("monta dashboard com totais consistentes (composição = resumo)", () => {
    const dayFlow = emptyTreasuryDashboardDayFlow();
    dayFlow.receivables = {
      plannedAmount: "200.00",
      plannedTitleCount: 2,
      realizedAmount: "80.00",
      realizedTitleCount: 1,
      pendingAmount: "200.00",
      pendingTitleCount: 2,
    };
    dayFlow.payables = {
      plannedAmount: "150.00",
      plannedTitleCount: 1,
      realizedAmount: "50.00",
      realizedTitleCount: 1,
      pendingAmount: "150.00",
      pendingTitleCount: 1,
    };

    const dto = buildTreasuryDashboardDto({
      civilDate: "2026-07-27",
      scenario: "PROBABLE",
      accountIds: ["acc-1"],
      position: samplePosition(),
      dayFlow,
      freshness: buildFreshnessDto({
        asOf: "2026-07-27T23:59:59.000-03:00",
        sources: [
          {
            source: "BALANCE_SNAPSHOTS",
            label: "Snapshots",
            lastSuccessAt: "2026-07-27T10:00:00.000-03:00",
            isStale: false,
            detail: "ok",
          },
        ],
      }),
      highPriorityReceivableCount: 1,
      highPriorityPayableCount: 0,
    });

    assert.equal(dto.observedBalance, "1000.00");
    assert.equal(dto.calculatedBalance, "980.00");
    assert.equal(dto.divergence, "20.00");
    assert.equal(dto.receipts.plannedAmount, "200.00");
    assert.equal(dto.payments.plannedAmount, "150.00");
    assert.equal(dto.currentBalance, "1000.00");
    assert.equal(dto.projectedClosingBalance, "1050.00");
    assert.ok(dto.priorityExceptions.length >= 1);
    assert.ok(dto.composition.some((c) => c.key === "receiptsPlanned"));
    assert.ok(dto.freshness.sources.length >= 1);

    assert.doesNotThrow(() => assertTreasuryDashboardTotalsConsistent(dto));
  });

  it("detecta inconsistência se composição divergir do resumo", () => {
    const dto = buildTreasuryDashboardDto({
      civilDate: "2026-07-27",
      scenario: "CONTRACTUAL",
      accountIds: null,
      position: samplePosition(),
      dayFlow: emptyTreasuryDashboardDayFlow(),
      freshness: buildFreshnessDto({
        asOf: "2026-07-27T00:00:00.000+00:00",
        sources: [],
      }),
    });
    dto.receipts.plannedAmount = "999.00";
    assert.throws(() => assertTreasuryDashboardTotalsConsistent(dto), /Inconsistência/);
  });

  it("ausência de saldo atual não inventa projeção", () => {
    const position = samplePosition({
      consolidated: {
        ...samplePosition().consolidated,
        observedBalance: null,
        calculatedBalance: null,
        divergence: null,
        hasDivergence: false,
      },
      accounts: [],
      alerts: [],
    });
    const dto = buildTreasuryDashboardDto({
      civilDate: "2026-07-27",
      scenario: "CONFIRMED",
      accountIds: null,
      position,
      dayFlow: emptyTreasuryDashboardDayFlow(),
      freshness: buildFreshnessDto({
        asOf: "2026-07-27T00:00:00.000+00:00",
        sources: [],
      }),
    });
    assert.equal(dto.currentBalance, null);
    assert.equal(dto.projectedClosingBalance, null);
    assert.doesNotThrow(() => assertTreasuryDashboardTotalsConsistent(dto));
  });
});
