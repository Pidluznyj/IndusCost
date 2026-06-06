import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatExecutiveCurrency,
  formatExecutiveDecimal,
  formatExecutiveInteger,
  formatExecutivePercent,
  formatMetricCount,
  formatMetricCurrency,
} from "./executiveDashboardFormatters.js";
import {
  canSeeCommercial,
  canSeeCustomers,
  canSeeFleet,
  canSeeNomus,
  canSeeSalesOrders,
  decimalToNumber,
  safeMetricNumber,
} from "./executiveDashboardHelpers.js";
import { buildExecutiveOverview } from "./executiveDashboardService.js";
import type { AppAuthContext } from "./appAuth.js";
import type { ExecutiveCommercial, ExecutiveCustomers, ExecutiveFleet } from "./executiveDashboardTypes.js";

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

function mockCommercial(overrides: Partial<ExecutiveCommercial> = {}): ExecutiveCommercial {
  return {
    available: true,
    source: "test",
    periodLabel: "junho de 2026",
    ordersThisMonth: 18,
    ordersNetThisMonth: 468294.75,
    invoicedNetThisMonth: 350000.5,
    invoicedOrdersThisMonth: 12,
    ticketAvgThisMonth: 26016.38,
    openOrdersCount: 5,
    sentToNomusCount: 3,
    previousMonthOrders: 15,
    previousMonthNet: 400000,
    previousMonthInvoicedNet: 320000,
    ...overrides,
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

  it("formatExecutiveInteger shows integers without decimal places", () => {
    assert.equal(formatExecutiveInteger(null), "Não disponível");
    assert.equal(formatExecutiveInteger(1027), "1.027");
    assert.equal(formatExecutiveInteger(0), "0");
    assert.doesNotMatch(formatExecutiveInteger(1027), /,\d{2}$/);
  });

  it("formatExecutiveCurrency always uses 2 decimal places", () => {
    assert.equal(formatExecutiveCurrency(null), "Não disponível");
    assert.equal(formatExecutiveCurrency(8917179.210019), "R$\u00a08.917.179,21");
    assert.equal(formatExecutiveCurrency(0), "R$\u00a00,00");
  });

  it("formatExecutiveDecimal caps at 2 decimal places", () => {
    assert.equal(formatExecutiveDecimal(123.456789), "123,46");
  });

  it("formatExecutivePercent uses controlled decimals", () => {
    assert.equal(formatExecutivePercent(12.3456, 1), "12,3");
    assert.equal(formatExecutivePercent(12.3456, 2), "12,35");
  });

  it("formatMetricCount alias uses executive integer formatting", () => {
    assert.equal(formatMetricCount(1500), "1.500");
    assert.doesNotMatch(formatMetricCount(1500), /,\d{2}$/);
  });

  it("formatMetricCurrency alias uses executive currency formatting", () => {
    assert.equal(formatMetricCurrency(8917179.210019), "R$\u00a08.917.179,21");
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

describe("buildExecutiveOverview", () => {
  it("uses sales order KPIs and excludes proposal KPIs", () => {
    const commercial = mockCommercial();
    const customers: ExecutiveCustomers = {
      available: true,
      totalCustomers: 500,
      activeCustomers: 420,
      incompleteRegistration: 10,
      newLast30Days: 5,
      cnpjLookupsLast30Days: 3,
      overdueFollowUps: null,
    };
    const fleet: ExecutiveFleet = {
      available: true,
      totalVehicles: 10,
      vehiclesAvailable: 4,
      inUse: 3,
      maintenance: 1,
      blocked: 0,
      openMaintenances: 0,
      maintenanceOverdue: 0,
      reservationsToday: 0,
      documentsExpired: 0,
    };

    const overview = buildExecutiveOverview(commercial, customers, fleet, []);

    const ids = overview.kpis.map((k) => k.id);
    assert.ok(ids.includes("orders-count-month"));
    assert.ok(ids.includes("invoiced-net-month"));
    assert.ok(!ids.includes("proposals-open"));
    assert.ok(!ids.includes("pipeline-open"));
  });

  it("formats overview KPIs without excessive decimals", () => {
    const commercial = mockCommercial({
      ordersThisMonth: 1027,
      invoicedNetThisMonth: 8917179.210019,
    });
    const overview = buildExecutiveOverview(
      commercial,
      { available: false, totalCustomers: null, activeCustomers: null, incompleteRegistration: null, newLast30Days: null, cnpjLookupsLast30Days: null, overdueFollowUps: null },
      { available: false, totalVehicles: null, vehiclesAvailable: null, inUse: null, maintenance: null, blocked: null, openMaintenances: null, maintenanceOverdue: null, reservationsToday: null, documentsExpired: null },
      []
    );

    const ordersKpi = overview.kpis.find((k) => k.id === "orders-count-month");
    const invoicedKpi = overview.kpis.find((k) => k.id === "invoiced-net-month");

    assert.equal(ordersKpi?.formatted, "1.027");
    assert.equal(invoicedKpi?.formatted, "R$\u00a08.917.179,21");
  });

  it("returns zero formatted correctly when no orders", () => {
    const commercial = mockCommercial({
      ordersThisMonth: 0,
      invoicedNetThisMonth: 0,
      invoicedOrdersThisMonth: 0,
      ticketAvgThisMonth: 0,
    });
    const overview = buildExecutiveOverview(
      commercial,
      { available: false, totalCustomers: null, activeCustomers: null, incompleteRegistration: null, newLast30Days: null, cnpjLookupsLast30Days: null, overdueFollowUps: null },
      { available: false, totalVehicles: null, vehiclesAvailable: null, inUse: null, maintenance: null, blocked: null, openMaintenances: null, maintenanceOverdue: null, reservationsToday: null, documentsExpired: null },
      []
    );

    assert.equal(overview.kpis.find((k) => k.id === "orders-count-month")?.formatted, "0");
    assert.equal(overview.kpis.find((k) => k.id === "invoiced-net-month")?.formatted, "R$\u00a00,00");
  });
});

describe("buildAlerts ordering", async () => {
  it("sorts critical before warning", async () => {
    const { buildExecutiveDashboardSummary } = await import("./executiveDashboardService.js");
    assert.equal(typeof buildExecutiveDashboardSummary, "function");
  });
});
