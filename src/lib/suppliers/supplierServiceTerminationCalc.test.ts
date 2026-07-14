import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateServiceTermination,
  countWorkedMonthsBetween,
  formatProportionalRestDaysLabel,
} from "./supplierServiceTerminationCalc.js";

describe("supplierServiceTerminationCalc", () => {
  it("4 meses → 6,67 dias de descanso proporcional", () => {
    const r = calculateServiceTermination({
      monthlyServiceAmount: 6000,
      monthlyHours: 160,
      restDaysPerYear: 20,
      calculationMode: "WORKED_MONTHS",
      workedMonths: 4,
    });
    assert.equal(r.proportionalRestDays, 6.6667);
    assert.equal(formatProportionalRestDaysLabel(r.proportionalRestDays), "6,67");
    assert.equal(r.dailyServiceAmount, 200);
    assert.equal(r.proportionalRestAmount, 1333.33);
    assert.equal(r.hourlyServiceAmount, 37.5);
  });

  it("período Mar–Jun 2026 conta 4 meses", () => {
    assert.equal(
      countWorkedMonthsBetween("2026-03-01", "2026-06-30"),
      4
    );
    const r = calculateServiceTermination({
      monthlyServiceAmount: 6000,
      monthlyHours: 160,
      calculationMode: "WORKED_MONTHS",
      contractStartDate: "2026-03-01",
      contractEndDate: "2026-06-30",
    });
    assert.equal(r.workedMonths, 4);
    assert.equal(r.proportionalRestAmount, 1333.33);
  });

  it("comissão e ajustes somam no total sem misturar com descanso", () => {
    const r = calculateServiceTermination({
      monthlyServiceAmount: 6000,
      monthlyHours: 160,
      calculationMode: "WORKED_MONTHS",
      workedMonths: 4,
      commissionReportTotal: 500,
      otherCredits: 100,
      otherDiscounts: 50,
    });
    assert.equal(r.proportionalRestAmount, 1333.33);
    assert.equal(r.commissionReportTotal, 500);
    assert.equal(r.otherAdjustments, 50);
    assert.equal(r.totalTerminationAmount, 1333.33 + 500 + 50);
  });

  it("modo por dias corridos usa /365", () => {
    const r = calculateServiceTermination({
      monthlyServiceAmount: 6000,
      monthlyHours: 160,
      restDaysPerYear: 20,
      calculationMode: "WORKED_DAYS",
      workedDays: 365,
    });
    assert.equal(r.proportionalRestDays, 20);
    assert.equal(r.proportionalRestAmount, 4000);
  });
});
