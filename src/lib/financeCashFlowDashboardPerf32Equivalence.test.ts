import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { startOfLocalDay } from "./financeAccountsReceivableDashboard.js";
import { sumOfficialArReceivedBySettlementInPeriod } from "./financeAccountsReceivableRulesAdapter.js";
import { sumOfficialApPaidInPaymentPeriod } from "./financeAccountsPayableRulesAdapter.js";
import {
  buildCashFlowDailyCalendarFromMovements,
  buildFinanceCashFlowCalendar,
  calendarDayToDailyPoint,
} from "./financeCashFlowCalendar.js";
import {
  buildFinanceCashFlowDashboard,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowDashboardPayload } from "./financeCashFlowDashboardTypes.js";
import {
  buildFinanceCashFlowDataset,
} from "./financeCashFlowDataset.js";
import { buildExecutiveMonthlyTimeline } from "./financeCashFlowExecutiveSummary.js";
import {
  buildCashFlowForecast,
  buildCashFlowForecastWithScenarios,
  buildConservativeScenario,
  buildStressScenario,
} from "./financeCashFlowForecast.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "./financeCostCenterAnnualSpendingChart.js";
import {
  buildFinanceCostCenterDashboard,
  collectFinanceCostCenterMonthlyByCostCenter,
  type AllocationDashboardRow,
  type CostCenterMetaRow,
} from "./financeCostCenterDashboard.js";
import type { FinanceApDashboardRow } from "./financeAccountsPayableDashboard.js";
import type { SupplierWithAliases } from "./financeSupplierCostCenterRules.js";
import { buildRawMaterialCostCenterSpotlight } from "./financeCashFlowRawMaterialSpotlight.js";

const REF = new Date(2026, 5, 9);

const FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: null,
    dueDate: new Date(2026, 5, 20),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 5, 2),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function representativeRows(): {
  ar: FinanceCashFlowArRow[];
  ap: FinanceCashFlowApRow[];
} {
  return {
    ar: [
      arRow({ externalId: 1, balanceReceivable: 1000, amountReceivable: 1000, dueDate: new Date(2026, 5, 15) }),
      arRow({
        externalId: 3,
        balanceReceivable: 0,
        amountReceived: 1500,
        amountReceivable: 1500,
        dueDate: new Date(2026, 1, 8),
        settlementDate: new Date(2026, 2, 15),
      }),
      arRow({
        externalId: 4,
        balanceReceivable: 400,
        amountReceivable: 400,
        dueDate: new Date(2026, 4, 1),
        personName: "Cliente Overdue",
      }),
      arRow({
        externalId: 5,
        balanceReceivable: 800,
        amountReceivable: 800,
        dueDate: new Date(2026, 0, 10),
        personName: "Cliente Jan",
      }),
    ],
    ap: [
      apRow({ externalId: 2, balancePayable: 500, amountPayable: 500, dueDate: new Date(2026, 5, 20) }),
      apRow({
        externalId: 6,
        balancePayable: 0,
        amountPaid: 200,
        amountPayable: 200,
        dueDate: new Date(2026, 5, 5),
        paymentDate: new Date(2026, 5, 5),
        settlementDate: new Date(2026, 5, 5),
      }),
      apRow({
        externalId: 7,
        balancePayable: 300,
        amountPayable: 300,
        dueDate: new Date(2026, 7, 12),
        personName: "Fornecedor Ago",
      }),
    ],
  };
}

function pageFinancialSlice(payload: FinanceCashFlowDashboardPayload) {
  return {
    cards: payload.cards,
    executiveSummary: payload.executiveSummary,
    executiveYtd: payload.executiveYtd,
    executiveYtdReading: payload.executiveYtdReading,
    cashHealthScore: payload.cashHealthScore,
    reconciliation: payload.reconciliation,
    topCustomers: payload.topCustomers,
    topSuppliers: payload.topSuppliers,
    cashForecast: payload.cashForecast,
    conservativeScenario: payload.conservativeScenario,
    stressScenario: payload.stressScenario,
    scenarioChartPoints: payload.scenarioChartPoints,
    monthlySeries: payload.monthlySeries,
    dailyCalendar: payload.dailyCalendar,
    calendarMonthSummary: payload.calendar.monthSummary,
    calendarMonthNav: payload.calendar.monthNav,
    calendarYearMovementCount: payload.calendar.yearMovementCount,
    calendarDays: payload.calendar.days.map((day) => ({
      date: day.date,
      inflow: day.inflow,
      outflow: day.outflow,
      net: day.net,
      movementCount: day.movementCount,
      receivableCount: day.receivableCount,
      payableCount: day.payableCount,
      status: day.status,
      hasLargeInflow: day.hasLargeInflow,
      hasLargeOutflow: day.hasLargeOutflow,
    })),
    overdueReceivables: payload.overdueReceivables,
    overduePayables: payload.overduePayables,
    largestProjectedInflows: payload.largestProjectedInflows,
    largestProjectedOutflows: payload.largestProjectedOutflows,
    operationalRecommendations: payload.operationalRecommendations,
    executiveInsights: payload.executiveInsights,
    executiveReading: payload.executiveReading,
  };
}

function calendarMonthEnd(year: number, month: number): Date {
  return startOfLocalDay(new Date(year, month, 0));
}

describe("PERF 3.2 cash-flow dashboard equivalence", () => {
  it("campos da tela e contrato financeiro são finitos e determinísticos", () => {
    const { ar, ap } = representativeRows();
    const a = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    const b = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    const sliceA = pageFinancialSlice(a);
    const sliceB = pageFinancialSlice(b);
    assert.deepEqual(sliceA, sliceB);
    assert.equal(a.cards.totalReceivableOpen, 2200);
    assert.equal(a.cards.totalPayableOpen, 800);
    assert.equal(a.cards.inflowAmount, 2200);
    assert.equal(a.cards.outflowAmount, 800);
    assert.equal(a.cards.netFlowAmount, 1400);
    assert.equal(a.reconciliation.receivable.cashFlowInflow, a.cards.inflowAmount);
    assert.equal(a.reconciliation.payable.cashFlowOutflow, a.cards.outflowAmount);
    assert.equal(a.executiveSummary.monthlyTimeline.length, 12);
    assert.equal(a.cashForecast.monthlyPoints.length, 12);
    assert.equal(a.conservativeScenario.monthlyPoints.length, 12);
    assert.equal(a.stressScenario.monthlyPoints.length, 12);
    assert.ok(a.cashHealthScore);
    assert.ok(a.topCustomers.length >= 1);
    assert.ok(a.topSuppliers.length >= 1);
    assert.equal(financeSliceMoneyIsExact(a), true);
  });

  it("dailyCalendar deriva do calendário do display month", () => {
    const { ar, ap } = representativeRows();
    const payload = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    const fromCalendar = payload.calendar.days
      .filter((d) => d.movementCount > 0)
      .map(calendarDayToDailyPoint)
      .sort((left, right) => left.date.localeCompare(right.date));
    assert.deepEqual(payload.dailyCalendar, fromCalendar);
    assert.deepEqual(
      payload.dailyCalendar,
      buildCashFlowDailyCalendarFromMovements(ar, ap, FILTERS, REF)
    );
  });

  it("monthNav preserva arredondamento por dia do monthSummary", () => {
    const { ar, ap } = representativeRows();
    for (let month = 1; month <= 12; month += 1) {
      const calendar = buildFinanceCashFlowCalendar(
        ar,
        ap,
        { ...FILTERS, calendarDisplayMonth: month },
        REF
      );
      const nav = calendar.monthNav[month - 1]!;
      assert.equal(nav.inflow, calendar.monthSummary.inflow);
      assert.equal(nav.outflow, calendar.monthSummary.outflow);
      assert.equal(nav.net, calendar.monthSummary.net);
      assert.equal(nav.movementCount, calendar.monthSummary.movementCount);
      assert.equal(nav.inflowRealized, calendar.monthSummary.inflowRealized);
      assert.equal(nav.inflowOpen, calendar.monthSummary.inflowOpen);
      assert.equal(nav.outflowRealized, calendar.monthSummary.outflowRealized);
      assert.equal(nav.outflowOpen, calendar.monthSummary.outflowOpen);
    }
  });

  it("forecast+cenários em um passe = três builders públicos", () => {
    const { ar, ap } = representativeRows();
    const bundle = buildCashFlowForecastWithScenarios(ar, ap, FILTERS, REF);
    const forecast = buildCashFlowForecast(ar, ap, FILTERS, REF);
    const conservative = buildConservativeScenario(
      ar,
      ap,
      FILTERS,
      REF,
      forecast.horizons.next12Months
    );
    const stress = buildStressScenario(ar, ap, FILTERS, REF);
    assert.deepEqual(bundle.cashForecast, forecast);
    assert.deepEqual(bundle.conservativeScenario, conservative);
    assert.deepEqual(bundle.stressScenario, stress);
    const payload = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    assert.deepEqual(payload.cashForecast, forecast);
    assert.deepEqual(payload.conservativeScenario, conservative);
    assert.deepEqual(payload.stressScenario, stress);
  });

  it("timeline oficial filtra uma vez e soma igual ao motor mensal", () => {
    const { ar, ap } = representativeRows();
    const timeline = buildExecutiveMonthlyTimeline(ar, ap, 2026, REF, {
      filters: FILTERS,
    });
    assert.equal(timeline.length, 12);
    for (let month = 1; month <= 12; month += 1) {
      const monthStart = startOfLocalDay(new Date(2026, month - 1, 1));
      const monthEnd = calendarMonthEnd(2026, month);
      const received = sumOfficialArReceivedBySettlementInPeriod(
        ar,
        toArLoadFilters(FILTERS),
        REF,
        null,
        monthStart,
        monthEnd
      );
      const paid = sumOfficialApPaidInPaymentPeriod(
        ap,
        toApLoadFilters(FILTERS),
        REF,
        null,
        monthStart,
        monthEnd
      );
      assert.equal(timeline[month - 1]!.received, received);
      assert.equal(timeline[month - 1]!.paid, paid);
    }
    const payload = buildFinanceCashFlowDashboard(ar, ap, FILTERS, REF);
    assert.equal(payload.executiveSummary.monthlyTimeline.length, 12);
  });

  it("dataset sem trace preserva blocos financeiros", () => {
    const { ar, ap } = representativeRows();
    const withTrace = buildFinanceCashFlowDataset(
      ar,
      ap,
      FILTERS,
      toArLoadFilters(FILTERS),
      toApLoadFilters(FILTERS),
      REF
    );
    const withoutTrace = buildFinanceCashFlowDataset(
      ar,
      ap,
      FILTERS,
      toArLoadFilters(FILTERS),
      toApLoadFilters(FILTERS),
      REF,
      undefined,
      undefined,
      { includeTrace: false }
    );
    assert.ok(withTrace.arTrace.length > 0);
    assert.equal(withoutTrace.arTrace.length, 0);
    assert.equal(withoutTrace.apTrace.length, 0);
    assert.deepEqual(withoutTrace.blocks, withTrace.blocks);
    assert.equal(withoutTrace.arRowsSanitized.length, withTrace.arRowsSanitized.length);
    assert.equal(withoutTrace.apRowsSanitized.length, withTrace.apRowsSanitized.length);
  });

  it("collector de CC equivale a monthlySeries.byCostCenter e ao spotlight", () => {
    const apRows: FinanceApDashboardRow[] = [
      {
        ...apRow({
          externalId: 20,
          balancePayable: 1000,
          amountPayable: 1000,
          dueDate: new Date(2026, 5, 10),
          personName: "Fornecedor Teste",
          personCnpj: "12.345.678/0001-90",
        }),
      },
      {
        ...apRow({
          externalId: 21,
          balancePayable: 400,
          amountPayable: 400,
          dueDate: new Date(2026, 6, 8),
          personName: "Fornecedor Teste",
          personCnpj: "12.345.678/0001-90",
        }),
      },
    ];
    const allocations: AllocationDashboardRow[] = [
      {
        id: "a1",
        accountsPayableId: 20,
        supplierId: "sup-1",
        costCenterId: "cc-mp",
        amount: new Prisma.Decimal(700),
        percentage: new Prisma.Decimal(70),
      },
      {
        id: "a2",
        accountsPayableId: 20,
        supplierId: "sup-1",
        costCenterId: "cc-adm",
        amount: new Prisma.Decimal(300),
        percentage: new Prisma.Decimal(30),
      },
      {
        id: "a3",
        accountsPayableId: 21,
        supplierId: "sup-1",
        costCenterId: "cc-mp",
        amount: new Prisma.Decimal(400),
        percentage: new Prisma.Decimal(100),
      },
    ];
    const costCenters: CostCenterMetaRow[] = [
      { id: "cc-mp", code: "MP", name: "Matéria prima", status: "ACTIVE" },
      { id: "cc-adm", code: "ADM", name: "Administrativo", status: "ACTIVE" },
    ];
    const suppliers: SupplierWithAliases[] = [
      {
        id: "sup-1",
        displayName: "Fornecedor Teste",
        status: "ACTIVE",
        normalizedDocument: "12345678000190",
        normalizedName: "fornecedor teste",
        aliases: [
          { externalSupplierId: 10, normalizedDocument: "12345678000190", normalizedName: null },
        ],
      },
    ];
    const filters = buildExecutiveReportCostCenterDashboardFilters({ year: 2026, month: null });
    const full = buildFinanceCostCenterDashboard(
      apRows,
      allocations,
      costCenters,
      suppliers,
      new Set(["sup-1"]),
      filters,
      REF
    );
    const collected = collectFinanceCostCenterMonthlyByCostCenter(
      apRows,
      allocations,
      costCenters,
      suppliers,
      filters,
      REF
    );
    assert.deepEqual(collected, full.monthlySeries.byCostCenter);

    const mappingByCcId = new Map([
      ["cc-mp", "raw_material" as const],
      ["cc-adm", "admin" as const],
    ]);
    const toSpend = (rows: typeof collected) =>
      rows.map((row) => ({
        month: row.month,
        year: row.year,
        costCenterId: row.costCenterId,
        code: row.code,
        name: row.name,
        amount: row.amount,
      }));
    const fromCollector = buildRawMaterialCostCenterSpotlight({
      byCostCenter: toSpend(collected),
      ytdYear: 2026,
      referenceDate: REF,
      mappingByCcId,
    });
    const fromFull = buildRawMaterialCostCenterSpotlight({
      byCostCenter: toSpend(full.monthlySeries.byCostCenter),
      ytdYear: 2026,
      referenceDate: REF,
      mappingByCcId,
    });
    assert.deepEqual(fromCollector, fromFull);
    assert.equal(fromCollector.currentMonth.amount, 700);
  });
});

function financeSliceMoneyIsExact(payload: FinanceCashFlowDashboardPayload): boolean {
  const nums = [
    payload.cards.totalReceivableOpen,
    payload.cards.totalPayableOpen,
    payload.cards.inflowAmount,
    payload.cards.outflowAmount,
    payload.cards.netFlowAmount,
    payload.cards.overdueReceivableAmount,
    payload.cards.overduePayableAmount,
    payload.executiveSummary.receivable.receivedYtd,
    payload.executiveSummary.payable.paidYtd,
    payload.executiveYtd.totalReceivableOpen,
    payload.executiveYtd.totalPayableOpen,
    payload.reconciliation.netCashFlow,
    payload.cashForecast.horizons.next12Months.projectedInflow,
    payload.conservativeScenario.projectedInflowConservative,
    payload.stressScenario.projectedInflowStress,
  ];
  return nums.every((n) => Number.isFinite(n));
}
