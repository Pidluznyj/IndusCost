import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEmployeeCostComponentLines,
  buildEmployeeCosts,
  computePayrollComponentAmount,
} from "./employeeCostEngine.ts";

describe("employeeCostEngine", () => {
  it("PERCENTAGE e FIXED alimentam buckets corretos", () => {
    const costs = buildEmployeeCosts({
      salary: 10000,
      monthlyHours: 220,
      productivity: 100,
      components: [
        { type: "BENEFIT", calculationType: "FIXED", value: 500, name: "VR" },
        { type: "CHARGE", calculationType: "PERCENTAGE", value: 8, name: "INSS" },
        { type: "PROVISION", calculationType: "PERCENTAGE", value: 10, name: "Férias" },
      ],
    });

    assert.equal(costs.salary, 10000);
    assert.equal(costs.totalBenefits, 500);
    assert.equal(costs.totalCharges, 800);
    assert.equal(costs.totalProvisions, 1000);
    assert.equal(costs.totalMonthlyCost, 12300);
    assert.equal(costs.productiveHours, 220);
    assert.ok(Math.abs(costs.costPerContractedHour - 12300 / 220) < 1e-9);
    assert.ok(Math.abs(costs.costPerProductiveHour - 12300 / 220) < 1e-9);
  });

  it("produtividade reduz horas produtivas e eleva custo/h", () => {
    const costs = buildEmployeeCosts({
      salary: 5000,
      monthlyHours: 200,
      productivity: 50,
      components: [],
    });
    assert.equal(costs.productiveHours, 100);
    assert.equal(costs.costPerProductiveHour, 50);
  });

  it("computePayrollComponentAmount cobre FIXED e %", () => {
    assert.equal(
      computePayrollComponentAmount(2000, { calculationType: "FIXED", value: 100 }),
      100
    );
    assert.equal(
      computePayrollComponentAmount(2000, { calculationType: "PERCENTAGE", value: 10 }),
      200
    );
  });

  it("buildEmployeeCostComponentLines preserva id/nome/amount", () => {
    const lines = buildEmployeeCostComponentLines({
      salary: 1000,
      components: [
        {
          id: "c1",
          name: "VT",
          type: "BENEFIT",
          calculationType: "FIXED",
          value: 200,
        },
      ],
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].componentId, "c1");
    assert.equal(lines[0].amount, 200);
  });
});
