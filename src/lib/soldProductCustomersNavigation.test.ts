import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  SOLD_PRODUCT_CUSTOMERS_ROUTE,
  buildCustomerRegistrationPath,
  buildSoldProductCustomersApiPath,
  buildSoldProductCustomersPath,
} from "./soldProductCustomersNavigation.js";
import { buildSoldProductsDashboardQuery, createDefaultSoldProductsUiFilters } from "./salesProductRankingFilters.js";

describe("soldProductCustomersNavigation", () => {
  it("rota de clientes compradores existe no App", () => {
    const appSrc = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    assert.ok(appSrc.includes("sales-orders/sold-products/:productId/customers"));
    assert.ok(appSrc.includes("SoldProductCustomersPage"));
    assert.equal(
      SOLD_PRODUCT_CUSTOMERS_ROUTE,
      "/sales-orders/sold-products/:productId/customers"
    );
  });

  it("buildSoldProductCustomersPath preserva filtros de produtos vendidos", () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    const filters = {
      ...createDefaultSoldProductsUiFilters(new Date(2026, 5, 17)),
      startDate: "2026-01-01",
      endDate: "2026-06-17",
      company: "koppetel" as const,
    };
    const path = buildSoldProductCustomersPath(productId, filters);
    assert.ok(path.startsWith(`/sales-orders/sold-products/${productId}/customers?`));
    assert.ok(path.includes("startDate=2026-01-01"));
    assert.ok(path.includes("company=koppetel"));
  });

  it("buildSoldProductCustomersApiPath aponta para endpoint", () => {
    const productId = "11111111-1111-4111-8111-111111111111";
    const qs = buildSoldProductsDashboardQuery(createDefaultSoldProductsUiFilters());
    assert.equal(
      buildSoldProductCustomersApiPath(productId, qs),
      `/api/commercial/sold-products/${productId}/customers?${qs}`
    );
  });

  it("buildCustomerRegistrationPath abre cadastro via query edit", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    assert.equal(buildCustomerRegistrationPath(id), `/customers?edit=${id}`);
  });

  it("SoldProductsReportPage possui ação Ver clientes", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/components/commercial/SoldProductsReportPage.tsx"),
      "utf8"
    );
    assert.ok(pageSrc.includes("Ver clientes"));
    assert.ok(pageSrc.includes("buildSoldProductCustomersPath"));
  });

  it("endpoint registrado em salesProductRankingRoutes", () => {
    const routesSrc = readFileSync(
      join(process.cwd(), "src/lib/salesProductRankingRoutes.ts"),
      "utf8"
    );
    assert.ok(routesSrc.includes("/api/commercial/sold-products/:productId/customers"));
    assert.ok(routesSrc.includes("buildSoldProductCustomers"));
  });

  it("frontend não importa Prisma", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "src/components/commercial/SoldProductCustomersPage.tsx"),
      "utf8"
    );
    assert.ok(!pageSrc.includes("@prisma/client"));
    assert.ok(!pageSrc.includes("from \"@/src/lib/prisma"));
  });
});
