import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateCostCenterMonthlyTotals,
  applyCostCenterHhHmCapacityFieldPatch,
  combineCostCenterHhHmRates,
  computeCostCenterHhHmDualRateSimulation,
  computeCostCenterHhHmItemCost,
  computeCostCenterHhHmOptionalItemImpact,
  computeCostCenterHhHmRate,
  computeCostCenterHhHmSideSimulation,
  computeCostCenterHhHmSimulation,
  computeCostCenterMonthlyAverage,
  COST_CENTER_HH_HM_SIMULATION_INSUFFICIENT_DATA,
  COST_CENTER_HH_HM_SIMULATION_ZERO_MONTHS_WARNING,
  EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
  EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
  filterCostCenterHhHmSimulationCostCenters,
  normalizeCostCenterHhHmSimulationStoredForm,
  parseCostCenterHhHmSimulationCostCentersResponse,
  parseCostCenterHhHmSimulationMonthlyDataResponse,
  pruneCostCenterHhHmSimulationSelectedIds,
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

const SIX_MONTH_BUCKETS = Array.from({ length: 6 }, () => ({
  year: 2026,
  month: 1,
  totalAmount: 120_000,
}));

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

  it("3b — capacidade 60×180×80% gera 8640 e taxa HH", () => {
    const hh = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "60",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
      },
      monthlyBuckets: [
        { year: 2026, month: 1, totalAmount: 337_536.26 },
      ],
      hourType: "HH",
    });
    assert.equal(hh.composition.theoreticalHours, 10_800);
    assert.equal(hh.composition.adjustedHours, 8_640);
    assert.equal(hh.composition.baseMonthlyHours, 8_640);
    assert.equal(hh.composition.calculatedRatePerHour, 39.07);
    assert.equal(hh.composition.effectiveRatePerHour, 39.07);
  });

  it("3c — capacidade 13×180×80% gera 1872 e taxa HM", () => {
    const hm = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "13",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 62_396.89 }],
      hourType: "HM",
    });
    assert.equal(hm.composition.theoreticalHours, 2_340);
    assert.equal(hm.composition.adjustedHours, 1_872);
    assert.equal(hm.composition.baseMonthlyHours, 1_872);
    assert.equal(hm.composition.calculatedRatePerHour, 33.33);
    assert.equal(hm.composition.effectiveRatePerHour, 33.33);
  });

  it("3c2 — HM com eficiência 100% usa 2340 h e taxa R$ 26,67", () => {
    const hm = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "13",
        hoursPerUnit: "180",
        efficiencyPercent: "100",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 62_396.89 }],
      hourType: "HM",
    });
    assert.equal(hm.composition.theoreticalHours, 2_340);
    assert.equal(hm.composition.adjustedHours, 2_340);
    assert.equal(hm.composition.baseMonthlyHours, 2_340);
    assert.equal(hm.composition.calculatedRatePerHour, 26.67);
    assert.equal(hm.composition.effectiveRatePerHour, 26.67);
  });

  it("3c3 — horas base manuais antigas não vazam com avançado desmarcado", () => {
    const hm = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "13",
        hoursPerUnit: "180",
        efficiencyPercent: "100",
        useManualBaseHours: false,
        baseMonthlyHours: "1872",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 62_396.89 }],
      hourType: "HM",
    });
    assert.equal(hm.composition.baseMonthlyHours, 2_340);
    assert.equal(hm.composition.effectiveRatePerHour, 26.67);
  });

  it("3c4 — editar eficiência desliga horas base manuais (patch)", () => {
    const before = {
      ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
      productiveCount: "13",
      hoursPerUnit: "180",
      efficiencyPercent: "80",
      useManualBaseHours: true,
      baseMonthlyHours: "1872",
    };
    const after = applyCostCenterHhHmCapacityFieldPatch(before, "efficiencyPercent", "100");
    assert.equal(after.efficiencyPercent, "100");
    assert.equal(after.useManualBaseHours, false);
    assert.equal(after.baseMonthlyHours, "");

    const hm = computeCostCenterHhHmSideSimulation({
      form: {
        ...after,
        selectedCostCenterIds: ["cc-a"],
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 62_396.89 }],
      hourType: "HM",
    });
    assert.equal(hm.composition.baseMonthlyHours, 2_340);
    assert.equal(hm.composition.effectiveRatePerHour, 26.67);
  });

  it("3c5 — HH do print permanece 39,07 e HM 100% atualiza taxa final", () => {
    const dual = computeCostCenterHhHmDualRateSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-hh"],
          productiveCount: "60",
          hoursPerUnit: "180",
          efficiencyPercent: "80",
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-hm"],
          productiveCount: "13",
          hoursPerUnit: "180",
          efficiencyPercent: "100",
        },
      },
      monthlyBucketsHh: [{ year: 2026, month: 1, totalAmount: 337_536.26 }],
      monthlyBucketsHm: [{ year: 2026, month: 1, totalAmount: 62_396.89 }],
    });
    assert.equal(dual.hh.composition.effectiveRatePerHour, 39.07);
    assert.equal(dual.hm.composition.effectiveRatePerHour, 26.67);
    assert.equal(dual.combinedRatePerHour, 65.74);
  });

  it("3d — HH + HM com capacidade automática", () => {
    const dual = computeCostCenterHhHmDualRateSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-hh"],
          productiveCount: "60",
          hoursPerUnit: "180",
          efficiencyPercent: "80",
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-hm"],
          productiveCount: "13",
          hoursPerUnit: "180",
          efficiencyPercent: "80",
        },
      },
      monthlyBucketsHh: [{ year: 2026, month: 1, totalAmount: 337_536.26 }],
      monthlyBucketsHm: [{ year: 2026, month: 1, totalAmount: 23_310.3 }],
    });
    assert.equal(dual.hh.composition.effectiveRatePerHour, 39.07);
    assert.equal(dual.hm.composition.effectiveRatePerHour, 12.45);
    assert.equal(dual.combinedRatePerHour, 51.52);
  });

  it("3e — eficiência inválida e divisão por zero bloqueadas", () => {
    const invalid = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "60",
        hoursPerUnit: "180",
        efficiencyPercent: "0",
      },
      monthlyBuckets: SIX_MONTH_BUCKETS,
      hourType: "HH",
    });
    assert.equal(invalid.composition.effectiveRatePerHour, null);
    assert.ok(invalid.errors.some((message) => /eficiência|pessoas\/horas/i.test(message)));

    const empty = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
      },
      monthlyBuckets: SIX_MONTH_BUCKETS,
      hourType: "HM",
    });
    assert.equal(empty.composition.effectiveRatePerHour, null);
    assert.ok(empty.errors.some((message) => /máquinas\/horas\/eficiência/i.test(message)));
  });

  it("4 — taxa HM por lado (HH/HM separados)", () => {
    const hm = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        useManualBaseHours: true,
        baseMonthlyHours: "4000",
      },
      monthlyBuckets: SIX_MONTH_BUCKETS,
    });
    assert.equal(hm.composition.calculatedRatePerHour, 30);
    assert.equal(hm.composition.effectiveRatePerHour, 30);
  });

  it("5 — valor manual sobrescreve taxa calculada apenas na simulação", () => {
    const calculated = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "60",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 120_000 }],
    });
    assert.equal(calculated.composition.baseMonthlyHours, 8_640);
    assert.ok(calculated.composition.calculatedRatePerHour != null);

    const manual = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        productiveCount: "60",
        hoursPerUnit: "180",
        efficiencyPercent: "80",
        useManualRate: true,
        manualRatePerHour: "45",
      },
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 120_000 }],
    });
    assert.equal(manual.composition.effectiveRatePerHour, 45);
    assert.equal(manual.composition.useManualRate, true);
  });

  it("6 — meses sem dados geram aviso", () => {
    const result = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        selectedCostCenterIds: ["cc-a"],
        useManualBaseHours: true,
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
      hourType: "HM" as const,
      ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
      selectedCostCenterIds: ["cc-a"],
      useManualBaseHours: true,
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
  });

  it("8 — simulação limpa não altera dados oficiais", () => {
    const empty = computeCostCenterHhHmDualRateSimulation({
      form: EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
      monthlyBucketsHh: [],
      monthlyBucketsHm: [],
    });
    assert.equal(empty.hh.composition.effectiveRatePerHour, null);
    assert.equal(empty.hm.composition.effectiveRatePerHour, null);
    assert.equal(empty.combinedRatePerHour, null);
    assert.ok(empty.hh.errors.length > 0);

    const itemCost = computeCostCenterHhHmItemCost({
      ratePerHour: null,
      quantityUsedInItem: 10,
    });
    assert.equal(itemCost, null);
  });

  it("9 — envelope { items } de centros de custo é normalizado para array", () => {
    const parsed = parseCostCenterHhHmSimulationCostCentersResponse({
      items: [{ id: "cc-1", code: "100", name: "Produção" }],
    });
    assert.equal(parsed.invalidShape, false);
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0]?.code, "100");
  });

  it("10 — payload inválido de centros de custo não vira objeto mapeável", () => {
    assert.deepEqual(parseCostCenterHhHmSimulationCostCentersResponse(null).items, []);
    assert.equal(parseCostCenterHhHmSimulationCostCentersResponse(null).invalidShape, true);
    assert.deepEqual(parseCostCenterHhHmSimulationCostCentersResponse(undefined).items, []);
    assert.equal(parseCostCenterHhHmSimulationCostCentersResponse({ foo: [] }).invalidShape, true);
  });

  it("11 — localStorage legado v1 migra para HH ou HM", () => {
    const hhForm = normalizeCostCenterHhHmSimulationStoredForm({
      selectedCostCenterIds: { a: "cc-1" },
      hourType: "HH",
      baseMonthlyHours: "100",
    });
    assert.deepEqual(hhForm.hh.selectedCostCenterIds, []);
    assert.deepEqual(hhForm.hm.selectedCostCenterIds, []);
    assert.equal(hhForm.hh.baseMonthlyHours, "100");
    assert.equal(hhForm.hh.useManualBaseHours, true);

    const hmForm = normalizeCostCenterHhHmSimulationStoredForm({
      hourType: "HM",
      selectedCostCenterIds: ["cc-2"],
      manualRatePerHour: "72",
    });
    assert.deepEqual(hmForm.hm.selectedCostCenterIds, ["cc-2"]);
    assert.equal(hmForm.hm.manualRatePerHour, "72");
    assert.deepEqual(hmForm.hh.selectedCostCenterIds, []);
  });

  it("12 — monthly-data com monthlyBuckets inválido retorna erro amigável", () => {
    const parsed = parseCostCenterHhHmSimulationMonthlyDataResponse({
      periodLabel: "Jan/2026",
      metricsScope: "teste",
      monthlyBuckets: null,
    });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.match(parsed.message, /monthlyBuckets/i);
  });

  it("13 — monthly-data válido normaliza buckets", () => {
    const parsed = parseCostCenterHhHmSimulationMonthlyDataResponse({
      periodLabel: "01/2026 — 06/2026",
      metricsScope: "AP",
      monthlyBuckets: [{ year: 2026, month: 1, totalAmount: 1000 }],
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.monthlyBuckets.length, 1);
    assert.equal(parsed.monthlyBuckets[0]?.totalAmount, 1000);
  });

  it("14 — envelope { data: [...] } é normalizado", () => {
    const parsed = parseCostCenterHhHmSimulationCostCentersResponse({
      data: [{ id: "cc-2", code: "200", name: "Energia" }],
    });
    assert.equal(parsed.invalidShape, false);
    assert.equal(parsed.items[0]?.name, "Energia");
    assert.equal(parsed.items[0]?.category, "machine");
  });

  it("15 — filtro de busca por código e nome", () => {
    const items = [
      { id: "1", code: "100", name: "Folha de pagamento", category: "administrative" as const },
      { id: "2", code: "200", name: "Energia elétrica", category: "machine" as const },
    ];
    const filtered = filterCostCenterHhHmSimulationCostCenters(items, "energia");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "2");
  });

  it("16 — valor manual HH funciona sem centros selecionados", () => {
    const result = computeCostCenterHhHmSideSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
        useManualRate: true,
        manualRatePerHour: "38",
        selectedCostCenterIds: [],
      },
      monthlyBuckets: [],
    });
    assert.equal(result.composition.effectiveRatePerHour, 38);
    assert.equal(result.composition.useManualRate, true);
    assert.ok(!result.errors.some((message) => /Selecione ao menos um centro/i.test(message)));
  });

  it("17 — prune remove ids inexistentes após reload", () => {
    assert.deepEqual(
      pruneCostCenterHhHmSimulationSelectedIds(["cc-a", "cc-z"], ["cc-a", "cc-b"]),
      ["cc-a"]
    );
  });

  it("18 — taxa final HH + HM soma taxas efetivas", () => {
    const dual = computeCostCenterHhHmDualRateSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          useManualRate: true,
          manualRatePerHour: "38",
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          useManualRate: true,
          manualRatePerHour: "72",
        },
      },
      monthlyBucketsHh: [],
      monthlyBucketsHm: [],
    });
    assert.equal(dual.hh.composition.effectiveRatePerHour, 38);
    assert.equal(dual.hm.composition.effectiveRatePerHour, 72);
    assert.equal(dual.combinedRatePerHour, 110);
    assert.equal(combineCostCenterHhHmRates(38, 72), 110);
  });

  it("19 — seleção múltipla HH e HM independentes", () => {
    const dual = computeCostCenterHhHmDualRateSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-a", "cc-b"],
          useManualBaseHours: true,
          baseMonthlyHours: "4000",
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-c"],
          useManualBaseHours: true,
          baseMonthlyHours: "2000",
        },
      },
      monthlyBucketsHh: SIX_MONTH_BUCKETS,
      monthlyBucketsHm: [
        { year: 2026, month: 1, totalAmount: 144_000 },
        { year: 2026, month: 2, totalAmount: 144_000 },
      ],
    });
    assert.equal(dual.hh.composition.effectiveRatePerHour, 30);
    assert.equal(dual.hm.composition.effectiveRatePerHour, 72);
    assert.equal(dual.combinedRatePerHour, 102);
  });

  it("20 — impacto opcional na peça não é resultado principal", () => {
    const impact = computeCostCenterHhHmOptionalItemImpact({
      hhRate: 38,
      hmRate: 72,
      quantityHhInItem: "0.5",
      quantityHmInItem: "0.25",
    });
    assert.equal(impact, 37);
  });

  it("21 — aviso de dados insuficientes referencia taxa", () => {
    assert.match(COST_CENTER_HH_HM_SIMULATION_INSUFFICIENT_DATA, /calcular a taxa/i);
  });

  it("22 — valor manual HM entra no total combinado", () => {
    const dual = computeCostCenterHhHmDualRateSimulation({
      form: {
        ...EMPTY_COST_CENTER_HH_HM_SIMULATION_FORM,
        hh: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          selectedCostCenterIds: ["cc-a"],
          useManualBaseHours: true,
          baseMonthlyHours: "4000",
        },
        hm: {
          ...EMPTY_COST_CENTER_HH_HM_SIMULATION_SIDE,
          useManualRate: true,
          manualRatePerHour: "72",
        },
      },
      monthlyBucketsHh: SIX_MONTH_BUCKETS,
      monthlyBucketsHm: [],
    });
    assert.equal(dual.combinedRatePerHour, 102);
  });
});
