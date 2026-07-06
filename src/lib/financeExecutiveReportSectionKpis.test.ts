import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeExecutiveReportVariation } from "./financeExecutiveReportSectionKpis.js";

describe("financeExecutiveReportSectionKpis", () => {
  it("variação percentual não divide por zero", () => {
    const v = computeExecutiveReportVariation(1000, 0, true);
    assert.equal(v.hasBase, false);
    assert.equal(v.percent, null);
    assert.match(v.formattedPercent, /sem base comparativa/);
  });

  it("variação positiva em pedidos/faturamento usa tom verde", () => {
    const v = computeExecutiveReportVariation(1200, 1000, true);
    assert.equal(v.tone, "positive");
    assert.equal(v.absolute, 200);
  });

  it("variação negativa em pedidos/faturamento usa tom vermelho", () => {
    const v = computeExecutiveReportVariation(800, 1000, true);
    assert.equal(v.tone, "negative");
  });
});
