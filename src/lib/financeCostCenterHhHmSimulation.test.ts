import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCostCenterMonthlyTotals,
  computeCostCenterHhHmItemCost,
  computeCostCenterHhHmRate,
  computeCostCenterHhHmSimulation,
  computeCostCenterMonthlyAverage,
  COST_CENTER_HH_HM_SIMULATION_ZERO_MONTHS_WARNING,
  EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
} from "./financeCostCenterHhHmSimulation.js";

function monthlyRowsForCenter(
  costCenterId: string,
  amounts: number[],
  startYear = 2026,
  startMonth = 1
) {
  return amounts.map((amount, index) => {
    const date = new Date(startYear, startMonth - 1 + index, 1);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      costCenterId,
      amount,
    };
  });
}

describe("financeCostCenterHhHmSimulation", () => {
  it("1 — centro com 6 meses de dados calcula média mensal corretamente", () => {
    const monthSlots = Array.from({ length: 6 }, (_, index) => ({
      year: 2026,
      month: index + 1,
    }));
    const buckets = aggregateCostCenterMonthlyTotals({
      rows: monthlyRowsForCenter("cc-a", [100_000, 110_000, 120_000, 130_000, 140_000, 150_000]),
      costCenterIds: ["cc-a"],
      monthSlots,
    });
    const average = computeCostCenterMonthlyAverage(buckets);
    assert.equal(average.monthsInPeriod, 6);
    assert.equal(average.monthsWithData, 6);
    assert.equal(average.monthlyAverageAmount, 125_000);
  });

  it("2 — múltiplos centros somam mês a mês e calculam média mensal", () => {
    const monthSlots = [
      { year: 2026, month: 1 },
      { year: 2026, month: 2 },
      { year: 2026, month: 3 },
    ];
    const buckets = aggregateCostCenterMonthlyTotals({
      rows: [
        ...monthlyRowsForCenter("cc-a", [40_000, 50_000, 60_000]),
        ...monthlyRowsForCenter("cc-b", [20_000, 30_000, 40_000]),
      ],
      costCenterIds: ["cc-a", "cc-b"],
      monthSlots,
    });
    const average = computeCostCenterMonthlyAverage(buckets);
    assert.deepEqual(
      buckets.map((bucket) => bucket.totalAmount),
      [60_000, 80_000, 100_000]
    );
    assert.equal(average.monthlyAverageAmount, 80_000);
  });

  it("3 — taxa HH = média mensal / horas base", () => {
    const rate = computeCostCenterHhHmRate({
      monthlyAverageAmount: 120_000,
      baseMonthlyHours: 4_000,
    });
    assert.equal(rate, 30);
  });

  it("4 — taxa HM = média mensal / horas base", () => {
    const result = computeCostCenterHhHmSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hourType: "HM",
        selectedCostCenterIds: ["cc-a"],
        baseMonthlyHours: "4000",
        quantityUsedInItem: "2.5",
      },
      monthlyBuckets: [
        { year: 2026, month: 1, totalAmount: 120_000 },
        { year: 2026, month: 2, totalAmount: 120_000 },
        { year: 2026, month: 3, totalAmount: 120_000 },
        { year: 2026, month: 4, totalAmount: 120_000 },
        { year: 2026, month: 5, totalAmount: 120_000 },
        { year: 2026, month: 6, totalAmount: 120_000 },
      ],
    });
    assert.equal(result.composition.calculatedRatePerHour, 30);
    assert.equal(result.composition.effectiveRatePerHour, 30);
    assert.equal(result.composition.simulatedItemCost, 75);
    assert.equal(result.composition.hourType, "HM");
  });

  it("5 — valor manual sobrescreve taxa calculada apenas na simulação", () => {
    const calculated = computeCostCenterHhHmSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        selectedCostCenterIds: ["cc-a"],
        baseMonthlyHours: "4000",
        quantityUsedInItem: "1",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 120_000 }],
    });
    assert.equal(calculated.composition.calculatedRatePerHour, 30);

    const manual = computeCostCenterHhHmSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        selectedCostCenterIds: ["cc-a"],
        baseMonthlyHours: "4000",
        quantityUsedInItem: "1",
        useManualRate: true,
        manualRatePerHour: "45",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 120_000 }],
    });
    assert.equal(manual.composition.calculatedRatePerHour, 30);
    assert.equal(manual.composition.effectiveRatePerHour, 45);
    assert.equal(manual.composition.simulatedItemCost, 45);
    assert.equal(manual.composition.useManualRate, true);
  });

  it("6 — meses sem dados geram aviso", () => {
    const result = computeCostCenterHhHmSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        selectedCostCenterIds: ["cc-a"],
        baseMonthlyHours: "1000",
      },
      monthlyBuckets: [
        { year: 2026, month: 1, totalAmount: 50_000 },
        { year: 2026, month: 2, totalAmount: 0 },
        { year: 2026, month: 3, totalAmount: 70_000 },
      ],
    });
    assert.equal(result.monthlyAverage.zeroMonthsWarning, true);
    assert.ok(result.warnings.includes(COST_CENTER_HH_HM_SIMULATION_ZERO_MONTHS_WARNING));
    assert.equal(result.monthlyAverage.monthlyAverageAmount, 40_000);
  });

  it("7 — custo oficial não é alterado (motor puro, sem efeitos colaterais)", () => {
    const form = {
      ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
      selectedCostCenterIds: ["cc-a"],
      baseMonthlyHours: "4000",
      quantityUsedInItem: "10",
    };
    const buckets = [{ year: 2026, month: 1, totalAmount: 120_000 }];
    const beforeForm = structuredClone(form);
    const beforeBuckets = structuredClone(buckets);

    const result = computeCostCenterHhHmSimulation({ form, monthlyBuckets: buckets });

    assert.deepEqual(form, beforeForm);
    assert.deepEqual(buckets, beforeBuckets);
    assert.equal(result.composition.simulatedItemCost, 300);
    assert.equal(typeof result.composition.simulatedItemCost, "number");
  });

  it("8 — simulação limpa não altera dados oficiais", () => {
    const empty = computeCostCenterHhHmSimulation({
      form: EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
      monthlyBuckets: [],
    });
    assert.equal(empty.composition.effectiveRatePerHour, null);
    assert.equal(empty.composition.simulatedItemCost, null);
    assert.ok(empty.errors.length > 0);

    const itemCost = computeCostCenterHhHmItemCost({
      ratePerHour: null,
      quantityUsedInItem: 10,
    });
    assert.equal(itemCost, null);
  });
});
