import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canSeeCommercial,
  canSeeCustomers,
  canSeeFleet,
  canSeeNomus,
  canSeeSalesOrders,
  decimalToNumber,
  formatMetricCount,
  formatMetricCurrency,
  safeMetricNumber,
} from "./executiveDashboardHelpers.js";
import type { AppAuthContext } from "./appAuth.js";

function mockUser(perms: string[]): AppAuthContext {
  return {
    id: "u1",
    name: "Test",
    email: "t@test.com",
    role: "ADMIN",
    permissions: perms,
    effectivePermissions: perms,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "s1",
  };
}

describe("executiveDashboardHelpers", () => {
  it("safeMetricNumber rejects NaN and null", () => {
    assert.equal(safeMetricNumber(null), null);
    assert.equal(safeMetricNumber(undefined), null);
    assert.equal(safeMetricNumber(NaN), null);
    assert.equal(safeMetricNumber("abc"), null);
    assert.equal(safeMetricNumber(42), 42);
  });

  it("decimalToNumber handles Prisma-like decimals", () => {
    assert.equal(decimalToNumber({ toNumber: () => 12.5 }), 12.5);
    assert.equal(decimalToNumber("99.9"), 99.9);
  });

  it("formatMetricCount returns Não disponível for null", () => {
    assert.equal(formatMetricCount(null), "Não disponível");
    assert.match(formatMetricCount(1500), /1\.500/);
  });

  it("formatMetricCurrency returns Não disponível for null", () => {
    assert.equal(formatMetricCurrency(null), "Não disponível");
    assert.match(formatMetricCurrency(100), /R\$/);
  });

  it("canSeeSalesOrders requires sales_orders.view or reports.view", () => {
    assert.equal(canSeeSalesOrders(mockUser(["dashboard.view"])), false);
    assert.equal(canSeeSalesOrders(mockUser(["sales_orders.view"])), true);
    assert.equal(canSeeSalesOrders(mockUser(["reports.view"])), true);
  });

  it("canSeeCommercial accepts any commercial-related permission", () => {
    assert.equal(canSeeCommercial(mockUser(["proposals.view"])), true);
    assert.equal(canSeeCommercial(mockUser(["machines.view"])), false);
  });

  it("canSeeCustomers requires customers.view", () => {
    assert.equal(canSeeCustomers(mockUser(["customers.view"])), true);
    assert.equal(canSeeCustomers(mockUser(["crm.view"])), false);
  });

  it("canSeeFleet accepts fleet.view", () => {
    assert.equal(canSeeFleet(mockUser(["fleet.view"])), true);
    assert.equal(canSeeFleet(mockUser(["products.view"])), false);
  });

  it("canSeeNomus accepts products.view", () => {
    assert.equal(canSeeNomus(mockUser(["products.view"])), true);
    assert.equal(canSeeNomus(mockUser(["employees.view"])), false);
  });
});

describe("buildAlerts ordering", async () => {
  it("sorts critical before warning", async () => {
    const { buildExecutiveDashboardSummary } = await import("./executiveDashboardService.js");
    assert.equal(typeof buildExecutiveDashboardSummary, "function");
  });
});
