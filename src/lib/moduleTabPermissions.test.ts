import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import {
  FRONTEND_PERMISSION_RESOURCES,
  PORTFOLIO_RECONCILIATION_UI_TABS,
  ResourceKeys,
  createPermissionsApi,
} from "./permissionsClient.ts";
import {
  COMMISSIONS_LIVE_UI_TABS,
  CRM_UI_TABS,
  MATERIALS_UI_SECTIONS,
} from "./moduleTabResources.ts";
import {
  PERMISSION_RESOURCE_SEEDS,
  validatePermissionResourceCatalog,
} from "./permissionResourceSeedData.ts";

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
          "crm.customer_cockpit.view",
          "crm.reports.view",
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
        // Aba exige crm.seller.view; crm.seller.own é só escopo de dados.
        permissions: ["crm.seller.view", "crm.seller.own"],
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

  it("Planejamento de Matéria-Prima: materials.view libera (seed/contrato); sem ele não; só view", () => {
    const materials = createPermissionsApi(user({ role: "VIEWER", permissions: ["materials.view"] }));
    assert.deepEqual(materials.listAllowedMaterialsSections(), [
      "catalog",
      "stockConference",
      "marketIntelligence",
      "planning",
    ]);
    assert.ok(materials.canView(ResourceKeys.SUPRIMENTOS));
    assert.ok(materials.canView(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO));
    // Alias de view: não vira execute/manage nem abre Administração.
    assert.equal(materials.canExecute(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO), false);
    assert.equal(materials.canManage(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO), false);
    assert.equal(materials.canView(ResourceKeys.ADMIN), false);
    assert.equal(materials.canView(ResourceKeys.ADMIN_PERMISSOES), false);

    const crmOnly = createPermissionsApi(user({ role: "VIEWER", permissions: ["crm.view", "crm.reports.view"] }));
    assert.equal(crmOnly.canView(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO), false);
    assert.deepEqual(crmOnly.listAllowedMaterialsSections(), []);

    // Alias de outra área de Suprimentos (cotação de mercado) não abre o Planejamento.
    const quoteApprover = createPermissionsApi(
      user({ role: "VIEWER", permissions: ["materials.market_quote.approve"] })
    );
    assert.equal(quoteApprover.canView(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO), false);
    assert.ok(!quoteApprover.listAllowedMaterialsSections().includes("planning"));

    // Bag vazia não herda nada do papel (P07).
    assert.deepEqual(createPermissionsApi(user({ role: "ADMIN" })).listAllowedMaterialsSections(), []);
  });

  it("toda aba filtrada pela bag existe no catálogo browser-safe e no seed (chave ausente = negada em silêncio)", () => {
    const catalog = new Map(FRONTEND_PERMISSION_RESOURCES.map((r) => [r.key, r]));
    const seed = new Map(PERMISSION_RESOURCE_SEEDS.map((r) => [r.key, r]));
    const lists = { CRM_UI_TABS, COMMISSIONS_LIVE_UI_TABS, MATERIALS_UI_SECTIONS, PORTFOLIO_RECONCILIATION_UI_TABS };
    for (const [list, tabs] of Object.entries(lists)) {
      for (const tab of tabs) {
        assert.ok(catalog.has(tab.resourceKey), `${list}.${tab.id} → ${tab.resourceKey} ausente de FRONTEND_PERMISSION_RESOURCES`);
        assert.ok(seed.has(tab.resourceKey), `${list}.${tab.id} → ${tab.resourceKey} ausente do seed relacional`);
      }
    }
    // O catálogo browser-safe espelha o seed relacional do Planejamento.
    const fe = catalog.get(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO)!;
    const rel = seed.get(ResourceKeys.SUPRIMENTOS_TAB_PLANEJAMENTO)!;
    assert.deepEqual(
      { label: fe.label, type: fe.type, parentKey: fe.parentKey, legacyAliasKeys: [...fe.legacyAliasKeys] },
      { label: rel.label, type: rel.type, parentKey: rel.parentKey, legacyAliasKeys: [...rel.legacyAliasKeys] }
    );
  });

  it("Relatórios do CRM exige o próprio alias — Carteira não concede por tabela (sem multi-dono)", () => {
    const onlyPortfolio = createPermissionsApi(
      user({ role: "VIEWER", permissions: ["crm.view", "crm.customer_cockpit.view"] })
    );
    assert.equal(onlyPortfolio.canView(ResourceKeys.COMERCIAL_CRM_TAB_RELATORIOS), false);
    const withReports = createPermissionsApi(
      user({ role: "VIEWER", permissions: ["crm.view", "crm.reports.view"] })
    );
    assert.ok(withReports.canView(ResourceKeys.COMERCIAL_CRM_TAB_RELATORIOS));
    assert.ok(withReports.listAllowedCrmTabs().includes("reports"));
  });

  it("SUPER_ADMIN vê tudo", () => {
    const api = createPermissionsApi(user({ role: "SUPER_ADMIN" }));
    assert.equal(api.listAllowedCrmTabs().length, CRM_UI_TABS.length);
    assert.ok(api.listAllowedCrmTabs().includes("reports"));
    assert.equal(api.listAllowedCommissionsLiveTabs().length, COMMISSIONS_LIVE_UI_TABS.length);
    assert.equal(api.listAllowedPortfolioReconciliationTabs().length, 4);
  });
});
