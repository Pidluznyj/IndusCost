import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canViewFinanceBilling,
  FINANCE_BILLING_VIEW_PERMISSIONS,
} from "./financeBillingPermissions.js";

function mockAuth(permissions: string[]) {
  return {
    hasPermission: (key: string) => permissions.includes(key),
  };
}

describe("financeBillingPermissions", () => {
  it("permite faturamento para sales_orders, reports ou finance.view", () => {
    assert.equal(canViewFinanceBilling(mockAuth(["sales_orders.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["reports.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["finance.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["finance.accountsReceivable.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["dashboard.view"])), false);
  });

  it("expõe permissões de guarda do endpoint", () => {
    assert.ok(FINANCE_BILLING_VIEW_PERMISSIONS.includes("sales_orders.view"));
    assert.ok(FINANCE_BILLING_VIEW_PERMISSIONS.includes("finance.view"));
  });
});
