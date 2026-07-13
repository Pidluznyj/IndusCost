import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRolePermissionSeeds,
  listPermissionResourceKeys,
  shouldUpdateExistingRolePermission,
  sortPermissionResourcesForInsert,
  validatePermissionResourceCatalog,
  PERMISSION_RESOURCE_SEEDS,
} from "./permissionResourceSeedData.ts";

describe("permissionResourceSeedData", () => {
  it("catálogo mínimo cobre hierarquia MENU/SUBMENU/TAB e recursos oficiais", () => {
    const keys = listPermissionResourceKeys();
    for (const required of [
      "dashboard",
      "financeiro",
      "financeiro.conciliacao_carteira",
      "financeiro.conciliacao_carteira.tab.conciliacao",
      "financeiro.conciliacao_carteira.tab.inteligencia",
      "financeiro.conciliacao_carteira.tab.auditoria_pedido_caixa",
      "financeiro.contas_receber",
      "financeiro.contas_pagar",
      "financeiro.fluxo_caixa",
      "financeiro.relatorio_presidencial",
      "comercial",
      "comercial.pedidos_venda",
      "comercial.crm",
      "comissoes",
      "suprimentos",
      "suprimentos.inteligencia_mercado",
      "admin",
      "admin.usuarios",
      "admin.permissoes",
      "admin.permissoes.action.manage",
    ]) {
      assert.ok(keys.includes(required), required);
    }

    const types = new Set(PERMISSION_RESOURCE_SEEDS.map((r) => r.type));
    assert.ok(types.has("MENU"));
    assert.ok(types.has("SUBMENU"));
    assert.ok(types.has("TAB"));
    assert.ok(types.has("ACTION"));
  });

  it("validatePermissionResourceCatalog não reporta issues", () => {
    assert.deepEqual(validatePermissionResourceCatalog(), []);
  });

  it("sortPermissionResourcesForInsert coloca pais antes dos filhos", () => {
    const sorted = sortPermissionResourcesForInsert();
    const index = new Map(sorted.map((r, i) => [r.key, i]));
    for (const row of sorted) {
      if (!row.parentKey) continue;
      assert.ok(
        (index.get(row.parentKey) ?? Infinity) < (index.get(row.key) ?? -1),
        `${row.parentKey} before ${row.key}`
      );
    }
  });

  it("buildRolePermissionSeeds dá SUPER_ADMIN full em todos os recursos", () => {
    const rows = buildRolePermissionSeeds();
    const sa = rows.filter((r) => r.role === "SUPER_ADMIN");
    assert.equal(sa.length, listPermissionResourceKeys().length);
    for (const row of sa) {
      assert.equal(row.canView, true);
      assert.equal(row.canExecute, true);
      assert.equal(row.canManage, true);
    }
  });

  it("ADMIN não recebe manage de admin.permissoes.action.manage por padrão", () => {
    const row = buildRolePermissionSeeds().find(
      (r) => r.role === "ADMIN" && r.resourceKey === "admin.permissoes.action.manage"
    );
    assert.ok(row);
    assert.equal(row!.canView, false);
    assert.equal(row!.canManage, false);
  });

  it("shouldUpdateExistingRolePermission protege customizações (exceto SUPER_ADMIN)", () => {
    assert.equal(
      shouldUpdateExistingRolePermission({ role: "SUPER_ADMIN", syncRoleDefaults: false }),
      true
    );
    assert.equal(
      shouldUpdateExistingRolePermission({ role: "ADMIN", syncRoleDefaults: false }),
      false
    );
    assert.equal(
      shouldUpdateExistingRolePermission({ role: "ADMIN", syncRoleDefaults: true }),
      true
    );
  });
});
