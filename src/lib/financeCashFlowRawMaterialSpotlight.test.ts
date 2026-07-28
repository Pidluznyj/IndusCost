import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addCashFlowCalendarMonths,
  aggregateRawMaterialMonthlySpend,
  buildRawMaterialCostCenterSpotlight,
  cashFlowMonthLabel,
  resolveRawMaterialYtdThroughMonth,
} from "./financeCashFlowRawMaterialSpotlight.js";

describe("financeCashFlowRawMaterialSpotlight", () => {
  it("rotula meses em português completo", () => {
    assert.equal(cashFlowMonthLabel(7), "Julho");
    assert.equal(cashFlowMonthLabel(12), "Dezembro");
  });

  it("avança meses com virada de ano", () => {
    assert.deepEqual(addCashFlowCalendarMonths({ year: 2026, month: 11 }, 1), {
      year: 2026,
      month: 12,
    });
    assert.deepEqual(addCashFlowCalendarMonths({ year: 2026, month: 11 }, 2), {
      year: 2027,
      month: 1,
    });
  });

  it("YTD fecha no mês âncora do mesmo ano", () => {
    assert.equal(resolveRawMaterialYtdThroughMonth(2026, { year: 2026, month: 7 }), 7);
    assert.equal(resolveRawMaterialYtdThroughMonth(2025, { year: 2026, month: 7 }), 12);
    assert.equal(resolveRawMaterialYtdThroughMonth(2027, { year: 2026, month: 7 }), 0);
  });

  it("agrega somente CCs de matéria-prima", () => {
    const totals = aggregateRawMaterialMonthlySpend([
      {
        year: 2026,
        month: 7,
        costCenterId: "cc-mp",
        code: "CC_FABRICACAO_MATERIA_PRIMA",
        name: "Fabricaçao Materia Prima",
        amount: 1000,
      },
      {
        year: 2026,
        month: 7,
        costCenterId: "cc-admin",
        code: "CC_ADMINISTRATIVO",
        name: "Administrativo",
        amount: 500,
      },
    ]);
    assert.equal(totals.get("2026-7"), 1000);
    assert.equal(totals.has("2026-7-admin"), false);
  });

  it("monta YTD, mês corrente e dois próximos previstos", () => {
    const spotlight = buildRawMaterialCostCenterSpotlight({
      referenceDate: new Date(2026, 6, 15), // Julho/2026
      ytdYear: 2026,
      byCostCenter: [
        {
          year: 2026,
          month: 1,
          code: "MP",
          name: "Matéria prima",
          amount: 100,
        },
        {
          year: 2026,
          month: 7,
          code: "MP",
          name: "Matéria prima",
          amount: 200,
        },
        {
          year: 2026,
          month: 8,
          code: "MP",
          name: "Matéria prima",
          amount: 300,
        },
        {
          year: 2026,
          month: 9,
          code: "MP",
          name: "Matéria prima",
          amount: 400,
        },
        {
          year: 2026,
          month: 7,
          code: "ADMIN",
          name: "Administrativo",
          amount: 9999,
        },
      ],
    });

    assert.equal(spotlight.label, "Matéria-prima");
    assert.equal(spotlight.ytdAmount, 300); // jan 100 + jul 200
    assert.equal(spotlight.ytdThroughMonth, 7);
    assert.equal(spotlight.currentMonth.monthLabel, "Julho");
    assert.equal(spotlight.currentMonth.amount, 200);
    assert.equal(spotlight.nextMonths[0].monthLabel, "Agosto");
    assert.equal(spotlight.nextMonths[0].amount, 300);
    assert.equal(spotlight.nextMonths[0].kind, "forecast");
    assert.equal(spotlight.nextMonths[1].monthLabel, "Setembro");
    assert.equal(spotlight.nextMonths[1].amount, 400);
  });

  it("respeita override de papel persistido", () => {
    const mapping = new Map([["cc-x", "raw_material" as const]]);
    const spotlight = buildRawMaterialCostCenterSpotlight({
      referenceDate: new Date(2026, 0, 10),
      ytdYear: 2026,
      mappingByCcId: mapping,
      byCostCenter: [
        {
          year: 2026,
          month: 1,
          costCenterId: "cc-x",
          code: "CC_OUTRO",
          name: "Outro nome",
          amount: 50,
        },
      ],
    });
    assert.equal(spotlight.currentMonth.amount, 50);
    assert.equal(spotlight.ytdAmount, 50);
  });
});
