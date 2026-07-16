import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import {
  ResourceKeys,
  createPermissionsApi,
} from "./permissionsClient.ts";
import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  MATERIALS_UI_SECTIONS,
} from "./moduleTabResources.ts";
import { validatePermissionResourceCatalog } from "./permissionResourceSeedData.ts";

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
}): AuthUser {
  const permissions = partial.permissions ?? [];
  return {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    role: partial.role,
    permissions,
    effectivePermissions: permissions,
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

describe("module tab permissions", () => {
  it("catálogo seed sem gaps após novas abas", () => {
    assert.deepEqual(validatePermissionResourceCatalog(), []);
  });

  it("ADMIN vê abas CRM / comissões live / materiais com bag explícita (P07/P12)", () => {
    const api = createPermissionsApi(
      user({
        role: "ADMIN",
        permissions: [
          "crm.view",
          "crm.general.view",
          "crm.seller.view",
          "commissions.view",
          "materials.view",
        ],
      })
    );
    assert.equal(api.listAllowedCrmTabs().length, CRM_UI_TABS.length);
    assert.equal(api.listAllowedCommissionsLiveTabs().length, COMMISSIONS_LIVE_UI_TABS.length);
    assert.equal(api.listAllowedMaterialsSections().length, MATERIALS_UI_SECTIONS.length);
  });

  it("SELLER não vê Gestão Geral CRM", () => {
    const api = createPermissionsApi(
      user({
        role: "SELLER",
        permissions: ["crm.view", "crm.seller.view", "crm.seller.own"],
      })
    );
    const tabs = api.listAllowedCrmTabs();
    assert.ok(!tabs.includes("general"));
    assert.ok(tabs.includes("seller"));
  });

  it("usuário SELLER não vê Gestão Geral mesmo com alias de seller", () => {
    const api = createPermissionsApi(
      user({
        role: "SELLER",
        permissions: ["crm.seller.own"],
      })
    );
    assert.ok(api.canView(ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_VENDEDOR));
    assert.equal(api.canView(ResourceKeys.COMERCIAL_CRM_TAB_GESTAO_GERAL), false);
  });

  it("usuário sem comissões não vê abas live", () => {
    const api = createPermissionsApi(user({ role: "VIEWER", permissions: ["crm.view"] }));
    assert.deepEqual(api.listAllowedCommissionsLiveTabs(), []);
  });

  it("usuário só materials.view vê home MI e catálogo", () => {
    const api = createPermissionsApi(
      user({ role: "VIEWER", permissions: ["materials.view"] })
    );
    assert.ok(api.canView(ResourceKeys.SUPRIMENTOS_MI_TAB_HOME));
    assert.ok(api.canView(ResourceKeys.SUPRIMENTOS_TAB_CATALOGO));
    assert.ok(api.listAllowedMaterialsSections().includes("marketIntelligence"));
  });

  it("SUPER_ADMIN vê tudo", () => {
    const api = createPermissionsApi(user({ role: "SUPER_ADMIN" }));
    assert.equal(api.listAllowedCrmTabs().length, 3);
    assert.equal(api.listAllowedCommissionsLiveTabs().length, COMMISSIONS_LIVE_UI_TABS.length);
    assert.equal(api.listAllowedPortfolioReconciliationTabs().length, 4);
  });
});
