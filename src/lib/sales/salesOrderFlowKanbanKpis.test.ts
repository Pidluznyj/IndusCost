import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeSalesOrderFlowAvgCycleDaysTrimmed,
  formatSalesOrderFlowSlaDaysLabel,
  salesOrderFlowCycleDays,
  sumSalesOrderFlowFilteredOrderValue,
  trimmedMean,
} from "./salesOrderFlowKanbanKpis.js";

describe("salesOrderFlowKanbanKpis", () => {
  it("soma valor filtrado ignorando cancelados e nulos", () => {
    assert.equal(
      sumSalesOrderFlowFilteredOrderValue([
        { orderValue: 100 },
        { orderValue: 50.5 },
        { orderValue: 999, isCanceledColumn: true },
        { orderValue: null },
      ]),
      150.5
    );
    assert.equal(sumSalesOrderFlowFilteredOrderValue([]), null);
  });

  it("calcula dias de ciclo e rejeita negativos", () => {
    assert.equal(
      salesOrderFlowCycleDays("2026-01-01T00:00:00.000Z", "2026-01-11T00:00:00.000Z"),
      10
    );
    assert.equal(
      salesOrderFlowCycleDays("2026-01-11T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
      null
    );
  });

  it("média aparada remove extremos altos e baixos", () => {
    // 1..10 → remove 1 de cada ponta → média de 2..9 = 5.5
    assert.equal(trimmedMean([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), 5.5);
    // outlier 1000 removido com n>=3 (min/max)
    assert.equal(trimmedMean([5, 6, 1000]), 6);
    assert.equal(trimmedMean([2, 4]), 3);
  });

  it("SLA médio aparado a partir de emissão/conclusão", () => {
    const result = computeSalesOrderFlowAvgCycleDaysTrimmed([
      { issueDate: "2026-01-01", completedAt: "2026-01-02" }, // 1
      { issueDate: "2026-01-01", completedAt: "2026-01-06" }, // 5
      { issueDate: "2026-01-01", completedAt: "2026-01-07" }, // 6
      { issueDate: "2026-01-01", completedAt: "2026-02-01" }, // 31 outlier
      { issueDate: null, completedAt: "2026-01-10" },
    ]);
    assert.equal(result.sampleSize, 4);
    assert.equal(result.usedSize, 2);
    assert.equal(result.avgDays, 5.5);
    assert.match(formatSalesOrderFlowSlaDaysLabel(5.5), /5,5 dias/);
  });
});
