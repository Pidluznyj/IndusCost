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
  it("contrato: billing.view | sales_orders.view | finance.view — sem AR/AP/reports", () => {
    assert.equal(canViewFinanceBilling(mockAuth(["finance.billing.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["sales_orders.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["finance.view"])), true);
    assert.equal(canViewFinanceBilling(mockAuth(["reports.view"])), false);
    assert.equal(canViewFinanceBilling(mockAuth(["finance.accountsReceivable.view"])), false);
    assert.equal(canViewFinanceBilling(mockAuth(["finance.accountsPayable.view"])), false);
    assert.equal(canViewFinanceBilling(mockAuth(["dashboard.view"])), false);
  });

  it("expõe bag documental sem AP", () => {
    assert.ok(FINANCE_BILLING_VIEW_PERMISSIONS.includes("finance.billing.view"));
    assert.ok(FINANCE_BILLING_VIEW_PERMISSIONS.includes("sales_orders.view"));
    assert.ok(FINANCE_BILLING_VIEW_PERMISSIONS.includes("finance.view"));
    assert.equal(
      (FINANCE_BILLING_VIEW_PERMISSIONS as readonly string[]).includes(
        "finance.accountsPayable.view"
      ),
      false
    );
  });
});
