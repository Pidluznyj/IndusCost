import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FinanceBillingComparisonPayload } from "./financeBillingNfeComparison.js";

describe("financeBillingNfeComparison payload shape", () => {
  it("comparison documents dual sources without switching dashboard", () => {
    const sample: FinanceBillingComparisonPayload = {
      year: 2025,
      generatedAt: new Date().toISOString(),
      note: "diagnostic",
      dashboardSource: "SalesOrder.nomusRawResponse.nfes",
      nfeSource: "NomusNfe",
      months: [
        {
          month: 1,
          salesOrderTotal: 100,
          nomusNfeTotal: 95,
          difference: -5,
          differencePercent: -5,
        },
      ],
      yearTotalSalesOrder: 100,
      yearTotalNomusNfe: 95,
      yearDifference: -5,
    };
    assert.equal(sample.dashboardSource, "SalesOrder.nomusRawResponse.nfes");
    assert.equal(sample.nfeSource, "NomusNfe");
    assert.equal(sample.months[0].difference, sample.months[0].nomusNfeTotal - sample.months[0].salesOrderTotal);
    assert.ok(Number.isFinite(sample.yearTotalSalesOrder));
    assert.ok(!Number.isNaN(sample.yearDifference));
  });
});
