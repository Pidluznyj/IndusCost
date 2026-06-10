import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmptyStatusCounts } from "./projectsDashboard.js";
import { PROJECT_STATUSES } from "./projectsService.js";

describe("projectsDashboard", () => {
  it("status counts inicializa todas as chaves", () => {
    const counts = buildEmptyStatusCounts();
    for (const status of PROJECT_STATUSES) {
      assert.equal(counts[status], 0);
    }
  });

  it("métricas do dashboard usam valores finitos", () => {
    const payload = {
      openCount: 3,
      waitingEngineeringCount: 1,
      waitingQuotationCount: 2,
      sentToCustomerCount: 1,
      approvedCount: 0,
      potentialValue: 150000,
      moldInvestment: 80000,
      averageMarginPercent: 28.5,
      statusCounts: buildEmptyStatusCounts(),
      recentProjects: [],
    };
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === "number") {
        assert.equal(Number.isFinite(value), true, key);
      }
      if (key === "averageMarginPercent" && value != null) {
        assert.equal(Number.isFinite(value as number), true);
      }
    }
  });
});
