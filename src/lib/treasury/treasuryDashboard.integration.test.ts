import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryFinancialPositionDto } from "./contracts/treasuryDto.js";
import { assertTreasuryDashboardTotalsConsistent } from "./domain/treasuryDashboardRules.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import {
  createMemoryTreasuryDashboardDayFlowRepository,
  createMemoryTreasuryDashboardFreshnessRepository,
} from "./repositories/treasuryDashboardDayFlowRepository.server.js";
import {
  createTreasuryDashboardService,
  type TreasuryDashboardActor,
} from "./services/treasuryDashboardService.server.js";
import type { TreasuryFinancialPositionService } from "./services/treasuryFinancialPositionService.server.js";

function positionFixture(): TreasuryFinancialPositionDto {
  return {
    asOf: "2026-07-27T23:59:59.000-03:00",
    companyCode: null,
    accounts: [
      {
        accountId: "acc-cash",
        accountCode: "CX",
        accountName: "Caixa",
        accountType: "CHECKING",
        includeInConsolidated: true,
        liquidity: "IMMEDIATE",
        allowNegativeBalance: false,
        isNegative: false,
        hasSnapshot: true,
        snapshotId: "s1",
        snapshotReferenceAt: "2026-07-27T08:00:00.000-03:00",
        snapshotOrigin: "MANUAL",
        observedBalance: "500.00",
        operationalAvailableBalance: "500.00",
        calculatedBalance: "500.00",
        reconciledBalance: "500.00",
        divergence: "0.00",
        hasDivergence: false,
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        officialMovementCount: 0,
        officialMovementNet: "0.00",
        origins: {
          observed: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          operationalAvailable: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          calculated: {
            origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
            detail: "ok",
          },
          reconciled: { origin: "RECONCILIATION", detail: "ok" },
          blocked: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          investments: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          usedLimit: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
        },
        alerts: [],
        layers: ["observed", "calculated", "reconciled"],
      },
      {
        accountId: "acc-out",
        accountCode: "OUT",
        accountName: "Fora consolidado",
        accountType: "CHECKING",
        includeInConsolidated: false,
        liquidity: "IMMEDIATE",
        allowNegativeBalance: true,
        isNegative: true,
        hasSnapshot: true,
        snapshotId: "s2",
        snapshotReferenceAt: "2026-07-27T08:00:00.000-03:00",
        snapshotOrigin: "MANUAL",
        observedBalance: "-10.00",
        operationalAvailableBalance: "-10.00",
        calculatedBalance: "-10.00",
        reconciledBalance: null,
        divergence: "0.00",
        hasDivergence: false,
        blockedBalance: "0.00",
        investmentsBalance: "0.00",
        usedLimit: "0.00",
        officialMovementCount: 0,
        officialMovementNet: "0.00",
        origins: {
          observed: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          operationalAvailable: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          calculated: {
            origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
            detail: "ok",
          },
          reconciled: { origin: "MISSING", detail: "ausente" },
          blocked: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          investments: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
          usedLimit: { origin: "BALANCE_SNAPSHOT", detail: "ok" },
        },
        alerts: ["Saldo negativo"],
        layers: ["observed", "calculated"],
      },
    ],
    consolidated: {
      accountCount: 2,
      includedAccountCount: 1,
      excludedAccountCount: 1,
      accountsMissingSnapshot: 0,
      observedBalance: "500.00",
      operationalAvailableBalance: "500.00",
      calculatedBalance: "500.00",
      reconciledBalance: "500.00",
      divergence: "0.00",
      hasDivergence: false,
      blockedBalance: "0.00",
      investmentsBalance: "0.00",
      usedLimit: "0.00",
      alerts: [],
    },
    alerts: ["Saldo negativo"],
  };
}

const actor: TreasuryDashboardActor = {
  userId: "admin-1",
  canViewDashboard: true,
  positionActor: {
    userId: "admin-1",
    role: "ADMIN",
    isSuperAdmin: true,
    canViewAccounts: true,
    canManageAccounts: true,
    canManageBalances: true,
  },
};

describe("treasuryDashboard — integração", () => {
  it("agrega dia multi-conta/cenário e mantém totais consistentes", async () => {
    const dayFlow = createMemoryTreasuryDashboardDayFlowRepository([
      {
        side: "AR",
        openBalance: "120.00",
        realizedAmount: "40.00",
        planningDateByScenario: {
          CONTRACTUAL: "2026-07-27",
          PROBABLE: "2026-07-27",
          CONFIRMED: "2026-07-28",
        },
        settlementDate: "2026-07-27",
        plannedAccountId: "acc-cash",
        priority: "HIGH",
      },
      {
        side: "AR",
        openBalance: "80.00",
        realizedAmount: "0.00",
        planningDateByScenario: {
          CONTRACTUAL: "2026-07-27",
          PROBABLE: "2026-07-27",
          CONFIRMED: "2026-07-27",
        },
        settlementDate: null,
        plannedAccountId: "acc-cash",
        priority: "NORMAL",
      },
      {
        side: "AP",
        openBalance: "90.00",
        realizedAmount: "30.00",
        planningDateByScenario: {
          CONTRACTUAL: "2026-07-27",
          PROBABLE: "2026-07-27",
          CONFIRMED: "2026-07-27",
        },
        settlementDate: "2026-07-27",
        plannedAccountId: "acc-cash",
        priority: "URGENT",
      },
      {
        side: "AP",
        openBalance: "25.00",
        realizedAmount: "0.00",
        planningDateByScenario: {
          CONTRACTUAL: "2026-07-27",
          PROBABLE: "2026-07-28",
          CONFIRMED: "2026-07-28",
        },
        settlementDate: null,
        plannedAccountId: "acc-out",
        priority: "NORMAL",
      },
    ]);

    const positionService: TreasuryFinancialPositionService = {
      async getCurrentPosition() {
        return positionFixture();
      },
    };

    const service = createTreasuryDashboardService({
      positionService,
      dayFlowRepository: dayFlow,
      freshnessRepository: createMemoryTreasuryDashboardFreshnessRepository([
        {
          source: "BALANCE_SNAPSHOTS",
          label: "Snapshots",
          lastSuccessAt: new Date("2026-07-27T08:00:00.000Z"),
          detail: "ok",
        },
        {
          source: "OFFICIAL_RECEIVABLES",
          label: "CR",
          lastSuccessAt: null,
          detail: "sem sync",
        },
        {
          source: "OFFICIAL_PAYABLES",
          label: "CP",
          lastSuccessAt: new Date("2026-07-20T08:00:00.000Z"),
          detail: "stale",
        },
        {
          source: "TITLE_COMPLEMENTS",
          label: "Complementos",
          lastSuccessAt: new Date("2026-07-27T09:00:00.000Z"),
          detail: "ok",
        },
      ]),
    });

    const dto = await service.getDailyDashboard(actor, {
      date: "2026-07-27",
      accountIds: ["acc-cash"],
      scenario: "PROBABLE",
    });

    assert.equal(dto.receipts.plannedAmount, "200.00");
    assert.equal(dto.receipts.realizedAmount, "40.00");
    assert.equal(dto.receipts.pendingAmount, "200.00");
    assert.equal(dto.payments.plannedAmount, "90.00");
    assert.equal(dto.payments.realizedAmount, "30.00");
    assert.equal(dto.currentBalance, "500.00");
    // 500 + 200 - 90
    assert.equal(dto.projectedClosingBalance, "610.00");
    assert.equal(dto.accounts.length, 2);
    assert.ok(dto.freshness.hasStaleSource);
    assert.ok(dto.priorityExceptions.some((e) => e.type === "HIGH_PRIORITY_RECEIVABLES"));
    assert.ok(dto.priorityExceptions.some((e) => e.type === "HIGH_PRIORITY_PAYABLES"));
    assert.doesNotThrow(() => assertTreasuryDashboardTotalsConsistent(dto));

    const contractual = await service.getDailyDashboard(actor, {
      date: "2026-07-27",
      accountIds: null,
      scenario: "CONTRACTUAL",
    });
    // inclui AP fora do filtro de conta (acc-out) no cenário contractual
    assert.equal(contractual.payments.plannedAmount, "115.00");
    assert.doesNotThrow(() =>
      assertTreasuryDashboardTotalsConsistent(contractual)
    );
  });

  it("nega sem permissão de dashboard", async () => {
    const service = createTreasuryDashboardService({
      positionService: {
        async getCurrentPosition() {
          return positionFixture();
        },
      },
      dayFlowRepository: createMemoryTreasuryDashboardDayFlowRepository([]),
      freshnessRepository: createMemoryTreasuryDashboardFreshnessRepository([]),
    });

    await assert.rejects(
      () =>
        service.getDailyDashboard(
          {
            userId: "v1",
            canViewDashboard: false,
            positionActor: {
              userId: "v1",
              role: "VIEWER",
              isSuperAdmin: false,
              canViewAccounts: false,
              canManageAccounts: false,
              canManageBalances: false,
            },
          },
          { date: "2026-07-27", accountIds: null, scenario: "PROBABLE" }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
