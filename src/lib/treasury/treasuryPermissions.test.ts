import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { PERMISSION_CATALOG } from "@/src/lib/permissionCatalog.js";
import {
  getPermissionContractResource,
  supportsPermissionAction,
} from "@/src/lib/security/permissionContract/index.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import {
  TREASURY_LEGACY_BAG_KEYS,
  TREASURY_RESOURCE_KEYS,
} from "./treasuryAccess.js";
import {
  canTreasuryCapability,
  resolveTreasuryCapabilities,
  TREASURY_CAPABILITY_MATRIX,
} from "./treasuryPermissions.js";

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: `treasury-${partial.role}`,
    name: partial.role,
    email: `${partial.role.toLowerCase()}@test.local`,
    role: partial.role,
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.permissions ?? [],
    permissionsVersion: 1,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-treasury",
    sessionPermissionsVersionAtIssue: 1,
  };
}

function allowOverride(resourceKey: string, action: string) {
  return {
    overrides: { [resourceKey]: { [action]: "allow" as const } },
    legacyCompatMode: false,
  };
}

function denyOverride(resourceKey: string, action: string) {
  return {
    overrides: { [resourceKey]: { [action]: "deny" as const } },
    legacyCompatMode: false,
  };
}

describe("treasuryPermissions — contrato e bags", () => {
  it("todos os recursos Tesouraria existem no contrato", () => {
    for (const key of Object.values(TREASURY_RESOURCE_KEYS)) {
      assert.ok(getPermissionContractResource(key), `missing resource ${key}`);
    }
    assert.equal(FINANCE_MODULE_RESOURCE_KEYS.treasury, "finance.treasury");
  });

  it("bags mínimas estão no permissionCatalog", () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((e) => e.key));
    for (const bag of TREASURY_LEGACY_BAG_KEYS) {
      assert.ok(catalogKeys.has(bag), `missing bag ${bag}`);
    }
  });

  it("ações específicas suportadas (close/reopen/execute)", () => {
    assert.equal(supportsPermissionAction("finance.treasury.closing", "close"), true);
    assert.equal(supportsPermissionAction("finance.treasury.closing", "reopen"), true);
    assert.equal(
      supportsPermissionAction("finance.treasury.receivables.promise", "execute"),
      true
    );
    assert.equal(supportsPermissionAction("finance.treasury", "export"), true);
  });
});

describe("treasuryPermissions — deny > allow > default", () => {
  it("chave desconhecida é negada (inclusive SUPER_ADMIN)", () => {
    const decision = authorizeRequireResource(
      auth({ role: "SUPER_ADMIN" }),
      "finance.treasury.unknown_capability",
      "view"
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.status, 403);
      assert.equal(decision.body.error, "FORBIDDEN");
      assert.equal(decision.body.code, "UNKNOWN_RESOURCE");
    }
  });

  it("ação não suportada no recurso é negada", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN" }),
      "finance.treasury.dashboard",
      "manage",
      allowOverride("finance.treasury.dashboard", "view")
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.body.error, "FORBIDDEN");
      assert.equal(decision.body.code, "UNSUPPORTED_ACTION");
    }
  });

  it("default deny sem override/baseline", () => {
    assert.equal(
      canTreasuryCapability(auth({ role: "VIEWER", permissions: [] }), "viewModule"),
      false
    );
    assert.equal(
      canTreasuryCapability(auth({ role: "VIEWER", permissions: ["finance.view"] }), "viewModule"),
      false
    );
  });

  it("override allow concede capacidade", () => {
    assert.equal(
      canTreasuryCapability(
        auth({ role: "VIEWER" }),
        "viewModule",
        allowOverride("finance.treasury", "view")
      ),
      true
    );
  });

  it("override deny vence allow no mesmo recurso/ação", () => {
    const user = auth({ role: "ADMIN" });
    assert.equal(
      canTreasuryCapability(user, "manageAccounts", {
        overrides: {
          "finance.treasury.accounts": { manage: "deny" },
        },
        profileSnapshot: {
          "finance.treasury": { view: true },
          "finance.treasury.accounts": { view: true, manage: true },
        },
      }),
      false
    );
  });

  it("ancestor view deny bloqueia filho mesmo com allow local", () => {
    const decision = authorizeRequireResource(
      auth({ role: "ADMIN" }),
      "finance.treasury.accounts",
      "view",
      {
        overrides: {
          "finance.treasury": { view: "deny" },
          "finance.treasury.accounts": { view: "allow" },
        },
      }
    );
    assert.equal(decision.ok, false);
    if (!decision.ok) {
      assert.equal(decision.source, "ANCESTOR_VIEW_DENY");
    }
  });

  it("view de receivables não concede manage/promise irmãos", () => {
    const caps = resolveTreasuryCapabilities(auth({ role: "VIEWER" }), {
      profileSnapshot: {
        "finance.treasury": { view: true },
        "finance.treasury.receivables": { view: true },
      },
    });
    assert.equal(caps.viewReceivables, true);
    assert.equal(caps.manageReceivables, false);
    assert.equal(caps.promiseReceivables, false);
    assert.equal(caps.collectReceivables, false);
    assert.equal(caps.viewPayables, false);
  });

  it("matriz de capacidades cobre todas as bags mínimas via recursos", () => {
    assert.ok(Object.keys(TREASURY_CAPABILITY_MATRIX).length >= 20);
    assert.equal(
      canTreasuryCapability(auth({ role: "VIEWER" }), "closeDay", denyOverride("finance.treasury.closing", "close")),
      false
    );
    assert.equal(
      canTreasuryCapability(
        auth({ role: "VIEWER" }),
        "closeDay",
        allowOverride("finance.treasury.closing", "close")
      ),
      true
    );
  });

  it("legacyCompat: bag 1:1 projeta baseline; bag desconhecida não libera", () => {
    const withBag = authorizeRequireResource(
      auth({ role: "VIEWER", permissions: ["finance.treasury.view"] }),
      "finance.treasury",
      "view",
      { legacyCompatMode: true }
    );
    assert.equal(withBag.ok, true);

    const unknownBag = authorizeRequireResource(
      auth({ role: "VIEWER", permissions: ["finance.treasury.ghost.view"] }),
      "finance.treasury",
      "view",
      { legacyCompatMode: true }
    );
    assert.equal(unknownBag.ok, false);
  });
});
