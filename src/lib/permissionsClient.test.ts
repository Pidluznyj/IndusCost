import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import {
  PERMISSION_EMPTY_TABS_MESSAGE,
  ResourceKeys,
  createPermissionsApi,
} from "./permissionsClient.ts";

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
  id?: string;
}): AuthUser {
  const permissions = partial.permissions ?? [];
  return {
    id: partial.id ?? "u1",
    name: "Test",
    email: "t@example.com",
    role: partial.role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    isActive: true,
    externalSellerId: null,
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("permissionsClient UI", () => {
  it("usuário com 4 abas (ADMIN) vê 4", () => {
    const api = createPermissionsApi(user({ role: "ADMIN", permissions: [] }));
    assert.deepEqual(api.listAllowedPortfolioReconciliationTabs(), [
      "conciliation",
      "intelligence",
      "order-status-pedidos",
      "order-to-cash-audit",
    ]);
    assert.equal(
      api.getAllowedTabs(ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA).length,
      4
    );
  });

  it("usuário só com Conciliação vê só Conciliação", () => {
    const api = createPermissionsApi(
      user({
        role: "VIEWER",
        permissions: [
          "finance.view",
          "finance.portfolioReconciliation.view",
          "finance.portfolioReconciliation.conciliation.view",
        ],
      })
    );
    assert.deepEqual(api.listAllowedPortfolioReconciliationTabs(), ["conciliation"]);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO), true);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_INTELIGENCIA), false);
    assert.equal(
      api.canView(ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_AUDITORIA_PEDIDO_CAIXA),
      false
    );
  });

  it("usuário sem Auditoria não vê Auditoria", () => {
    const api = createPermissionsApi(
      user({
        role: "VIEWER",
        permissions: [
          "finance.portfolioReconciliation.conciliation.view",
          "finance.portfolioReconciliation.intelligence.view",
        ],
      })
    );
    const tabs = api.listAllowedPortfolioReconciliationTabs();
    assert.ok(tabs.includes("conciliation"));
    assert.ok(tabs.includes("intelligence"));
    assert.ok(!tabs.includes("order-to-cash-audit"));
  });

  it("troca de permissões reflete em nova instância da API (refetch)", () => {
    const before = createPermissionsApi(
      user({ role: "VIEWER", permissions: ["crm.view"], id: "same" })
    );
    assert.equal(before.listAllowedPortfolioReconciliationTabs().length, 0);

    const after = createPermissionsApi(
      user({
        role: "VIEWER",
        id: "same",
        permissions: ["finance.portfolioReconciliation.conciliation.view"],
      })
    );
    assert.deepEqual(after.listAllowedPortfolioReconciliationTabs(), ["conciliation"]);
  });

  it("nenhuma aba permitida → empty permission", () => {
    const api = createPermissionsApi(user({ role: "SELLER", permissions: ["crm.view"] }));
    assert.deepEqual(api.listAllowedPortfolioReconciliationTabs(), []);
    assert.equal(api.canViewPortfolioModule(), false);
    assert.match(PERMISSION_EMPTY_TABS_MESSAGE, /Nenhuma aba/i);
  });

  it("SUPER_ADMIN canView/canExecute/canManage", () => {
    const api = createPermissionsApi(user({ role: "SUPER_ADMIN", permissions: [] }));
    assert.equal(api.canView(ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE), true);
    assert.equal(api.canManage(ResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE), true);
    assert.equal(api.canExecute(ResourceKeys.FINANCEIRO_CONCILIACAO_TAB_CONCILIACAO), true);
  });
});
