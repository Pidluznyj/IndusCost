import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOfficialRolePermissionFlags } from "@/src/lib/permissionResourceSeedData.js";
import { TREASURY_RESOURCE_KEYS } from "./treasuryAccess.js";

const TREASURY_KEYS = Object.values(TREASURY_RESOURCE_KEYS);

describe("treasuryActivationRoles — ROLE_MATRIX", () => {
  it("ADMIN recebe finance.treasury view (e filhos operacionais)", () => {
    const root = getOfficialRolePermissionFlags("ADMIN", "finance.treasury");
    assert.equal(root.canView, true);
    assert.equal(root.canManage, true);

    const accounts = getOfficialRolePermissionFlags(
      "ADMIN",
      "finance.treasury.accounts"
    );
    assert.equal(accounts.canView, true);

    const closing = getOfficialRolePermissionFlags(
      "ADMIN",
      "finance.treasury.closing"
    );
    assert.equal(closing.canView, true);
    assert.equal(closing.canManage, true);
    assert.equal(closing.canExecute, true);
  });

  it("SUPER_ADMIN recebe flags plenas no preset oficial", () => {
    const root = getOfficialRolePermissionFlags("SUPER_ADMIN", "finance.treasury");
    assert.equal(root.canView, true);
    assert.equal(root.canManage, true);
  });

  it("COMMERCIAL_MANAGER / SELLER / VIEWER não recebem finance.treasury* por default", () => {
    for (const role of ["COMMERCIAL_MANAGER", "SELLER", "VIEWER"] as const) {
      for (const key of TREASURY_KEYS) {
        const flags = getOfficialRolePermissionFlags(role, key);
        assert.equal(
          flags.canView,
          false,
          `${role} não deve ter view em ${key}`
        );
        assert.equal(flags.canManage, false, `${role} manage ${key}`);
      }
    }
  });

  it("mesma permission key no menu e no contrato raiz", () => {
    assert.equal(TREASURY_RESOURCE_KEYS.root, "finance.treasury");
  });
});
