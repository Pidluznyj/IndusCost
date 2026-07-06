import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseFinanceBillingNfeFilters } from "./financeBillingNfeList.js";
import {
  buildFinanceBillingNfeQuery,
  hasPendingFinanceBillingNfeFilterChanges,
} from "./financeBillingNfeFiltersTypes.js";
import { interpretFinanceBillingNfeSyncRunResponse } from "./financeBillingNfeSyncRun.js";
import { canRunFinanceBillingNfeSync } from "./financeBillingPermissions.js";

describe("financeBillingNfeList filters", () => {
  it("parseFinanceBillingNfeFilters normalizes query", () => {
    const filters = parseFinanceBillingNfeFilters({
      year: "2025",
      month: "3",
      customerCnpj: "12.345.678/0001-99",
      documentNumber: "999",
      classification: "market",
      status: "authorized",
    });
    assert.equal(filters.year, 2025);
    assert.equal(filters.month, 3);
    assert.equal(filters.customerCnpj, "12345678000199");
    assert.equal(filters.classification, "market");
    assert.equal(filters.status, "authorized");
  });

  it("buildFinanceBillingNfeQuery serializes filters", () => {
    const qs = buildFinanceBillingNfeQuery({
      year: "2025",
      month: "2",
      customerCnpj: "",
      documentNumber: "10",
      classification: "group",
      status: "all",
    });
    assert.match(qs, /year=2025/);
    assert.match(qs, /month=2/);
    assert.match(qs, /classification=group/);
    assert.match(qs, /documentNumber=10/);
  });

  it("hasPendingFinanceBillingNfeFilterChanges detects draft drift", () => {
    const applied = {
      year: "2025",
      month: "",
      customerCnpj: "",
      documentNumber: "",
      classification: "all" as const,
      status: "all" as const,
    };
    assert.equal(
      hasPendingFinanceBillingNfeFilterChanges({ ...applied, month: "1" }, applied),
      true
    );
  });
});

describe("financeBillingNfeSyncRun", () => {
  it("interpretFinanceBillingNfeSyncRunResponse handles 409 conflict", () => {
    const result = interpretFinanceBillingNfeSyncRunResponse(409, { message: "busy" });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.conflict, true);
  });

  it("interpretFinanceBillingNfeSyncRunResponse handles 202", () => {
    const result = interpretFinanceBillingNfeSyncRunResponse(202, { message: "ok" });
    assert.equal(result.ok, true);
  });
});

describe("financeBillingPermissions nfes sync", () => {
  it("canRunFinanceBillingNfeSync requires settings.nomus.sync", () => {
    assert.equal(
      canRunFinanceBillingNfeSync({ hasPermission: (k) => k === "settings.nomus.sync" }),
      true
    );
    assert.equal(
      canRunFinanceBillingNfeSync({ hasPermission: (k) => k === "settings.view" }),
      false
    );
  });
});
