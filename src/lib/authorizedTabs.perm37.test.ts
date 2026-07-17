/**
 * PERM-37 — uma, duas, várias e nenhuma aba permitida.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { resolveAuthorizedTabs } from "@/src/lib/authorizedTabs.js";
import type { NavigationAccessContext } from "@/src/lib/resourceNavigationAccess.js";
import { CRM_UI_TABS } from "@/src/lib/moduleTabResources.js";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess.js";

/** Catálogo de teste com resourceKeys de contrato (EN). */
const CATALOG = [
  { id: "a", resourceKey: "commercial.crm.general", label: "A" },
  { id: "b", resourceKey: "commercial.crm.seller", label: "B" },
  { id: "c", resourceKey: "commercial.crm.portfolio", label: "C" },
  { id: "d", resourceKey: "commercial.crm.customer_360", label: "D" },
] as const;

function user(role: AuthUser["role"] = "VIEWER"): AuthUser {
  return {
    id: "u-perm37",
    name: "P37",
    email: "p37@example.com",
    role,
    permissions: [],
    effectivePermissions: [],
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function dto(allowed: string[], isSuperAdmin = false): EffectiveAccessMeDto {
  const actionsByResource: EffectiveAccessMeDto["actionsByResource"] = {};
  const capabilities: EffectiveAccessMeDto["capabilities"] = {};
  for (const k of allowed) {
    actionsByResource[k] = ["view"];
    capabilities[k] = { canView: true, canExecute: false, canManage: false };
  }
  return {
    permissionsVersion: 1,
    role: isSuperAdmin ? "SUPER_ADMIN" : "VIEWER",
    isSuperAdmin,
    allowedResources: allowed,
    actionsByResource,
    navigationReveal: [...allowed],
    capabilities,
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: false,
      legacyPermissionsPresent: false,
      legacyCompatApplied: false,
    },
  };
}

function ctx(
  allowed: string[],
  opts?: { isSuperAdmin?: boolean }
): NavigationAccessContext {
  const isSuperAdmin = opts?.isSuperAdmin === true;
  return {
    user: user(isSuperAdmin ? "SUPER_ADMIN" : "VIEWER"),
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: dto(allowed, isSuperAdmin),
    authLoading: false,
    authError: null,
  };
}

describe("PERM-37 — resolveAuthorizedTabs", () => {
  it("nenhuma aba permitida → isEmpty + activeId null", () => {
    const r = resolveAuthorizedTabs(CATALOG, ctx([]), { requestedId: "a" });
    assert.equal(r.isEmpty, true);
    assert.equal(r.activeId, null);
    assert.equal(r.visibleTabs.length, 0);
    assert.equal(r.requestedDenied, true);
  });

  it("uma aba permitida → só ela; URL negada corrige para ela", () => {
    const r = resolveAuthorizedTabs(
      CATALOG,
      ctx(["commercial.crm.seller"]),
      { requestedId: "a" }
    );
    assert.equal(r.isEmpty, false);
    assert.deepEqual(
      r.visibleTabs.map((t) => t.id),
      ["b"]
    );
    assert.equal(r.activeId, "b");
    assert.equal(r.requestedDenied, true);
  });

  it("duas abas permitidas → ordem do catálogo; pedida válida preservada", () => {
    const r = resolveAuthorizedTabs(
      CATALOG,
      ctx(["commercial.crm.portfolio", "commercial.crm.general"]),
      { requestedId: "c" }
    );
    assert.deepEqual(
      r.visibleTabs.map((t) => t.id),
      ["a", "c"]
    );
    assert.equal(r.activeId, "c");
    assert.equal(r.requestedDenied, false);
  });

  it("várias abas → primeira permitida quando requested ausente", () => {
    const r = resolveAuthorizedTabs(
      CATALOG,
      ctx([
        "commercial.crm.general",
        "commercial.crm.seller",
        "commercial.crm.portfolio",
        "commercial.crm.customer_360",
      ]),
      { requestedId: null }
    );
    assert.equal(r.visibleTabs.length, 4);
    assert.equal(r.activeId, "a");
  });

  it("SUPER_ADMIN mantém todas as abas do catálogo CRM", () => {
    const r = resolveAuthorizedTabs(CRM_UI_TABS, ctx([], { isSuperAdmin: true }), {
      requestedId: "portfolio",
    });
    assert.equal(r.isEmpty, false);
    assert.equal(r.visibleTabs.length, CRM_UI_TABS.length);
    assert.equal(r.activeId, "portfolio");
  });

  it("recurso desconhecido não libera aba", () => {
    const r = resolveAuthorizedTabs(CATALOG, ctx(["unknown.tab"]), {
      requestedId: "a",
    });
    assert.equal(r.isEmpty, true);
  });

  it("finance sections: só AP → uma seção; sem vazios", () => {
    const r = resolveAuthorizedTabs(
      FINANCE_UI_SECTIONS,
      ctx(["finance.accounts_payable"]),
      { requestedId: "cash-flow" }
    );
    assert.equal(r.visibleTabs.length, 1);
    assert.equal(r.visibleTabs[0]!.id, "accounts-payable");
    assert.equal(r.activeId, "accounts-payable");
    assert.equal(r.requestedDenied, true);
  });

  it("parent sem view → nenhuma aba (requireParentView)", () => {
    const r = resolveAuthorizedTabs(
      CATALOG,
      ctx(["commercial.crm.general"]),
      {
        requestedId: "a",
        parentResourceKey: "commercial.crm",
        requireParentView: true,
      }
    );
    assert.equal(r.isEmpty, true);
  });
});
