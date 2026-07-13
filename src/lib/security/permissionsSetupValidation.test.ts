import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS,
  validatePermissionsCatalogSetup,
  validatePermissionsDbSnapshot,
} from "./permissionsSetupValidation.ts";

describe("permissionsSetupValidation", () => {
  it("catálogo em código passa e inclui abas da Conciliação", () => {
    const report = validatePermissionsCatalogSetup();
    assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.severity === "error")));
    assert.ok(report.catalogResourceCount > 0);
    for (const key of REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS) {
      assert.ok(
        report.checks.some((c) => c.code === "PR_TAB_PRESENT" && c.message.includes(key)),
        key
      );
    }
    assert.ok(report.checks.some((c) => c.code === "SUPER_ADMIN_FULL"));
  });

  it("snapshot DB sem SUPER_ADMIN ativo falha", () => {
    const checks = validatePermissionsDbSnapshot({
      resourceKeys: [...REQUIRED_PORTFOLIO_RECONCILIATION_TAB_KEYS],
      rolePermissions: [],
      overrides: [],
      activeSuperAdminCount: 0,
    });
    assert.ok(checks.some((c) => c.code === "NO_ACTIVE_SUPER_ADMIN" && c.severity === "error"));
  });

  it("override com resourceKey inexistente falha", () => {
    const checks = validatePermissionsDbSnapshot({
      resourceKeys: ["dashboard"],
      rolePermissions: [{ role: "SELLER", resourceKey: "nao.existe" }],
      overrides: [{ resourceKey: "fantasma" }],
      activeSuperAdminCount: 1,
    });
    assert.ok(checks.some((c) => c.code === "ROLE_PERM_UNKNOWN_RESOURCE"));
    assert.ok(checks.some((c) => c.code === "OVERRIDE_UNKNOWN_RESOURCE"));
  });
});
