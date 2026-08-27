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
      "financeiro.conciliacao_carteira.tab.status_pedidos",
      "financeiro.contas_receber",
      "financeiro.contas_pagar",
      "financeiro.fluxo_caixa",
      "financeiro.one_page",
      "financeiro.relatorio_presidencial",
      "comercial",
      "comercial.pedidos_venda",
      "comercial.crm",
      "comercial.crm.tab.gestao_geral",
      "comercial.crm.tab.gestao_vendedor",
      "comercial.crm.tab.carteira_clientes",
      "comercial.crm.tab.cliente_360",
      "comissoes",
      "comissoes.tab.fechamento_mes",
      "comissoes.tab.dashboard",
      "operations",
      "operations.inventory",
      "operations.purchases",
      "operations.machines",
      "operations.performance",
      "operations.maintenance",
      "operations.fleet",
      "suprimentos",
      "suprimentos.tab.catalogo",
      "suprimentos.inteligencia_mercado",
      "suprimentos.inteligencia_mercado.tab.home",
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

  it("Comissões fica sob Comercial e Operações é MENU raiz (espelha o menu)", () => {
    const comissoes = PERMISSION_RESOURCE_SEEDS.find((r) => r.key === "comissoes");
    assert.ok(comissoes);
    assert.equal(comissoes!.type, "SUBMENU");
    assert.equal(comissoes!.parentKey, "comercial");

    const operations = PERMISSION_RESOURCE_SEEDS.find((r) => r.key === "operations");
    assert.ok(operations);
    assert.equal(operations!.type, "MENU");
    assert.equal(operations!.parentKey, null);

    const children = PERMISSION_RESOURCE_SEEDS.filter((r) => r.parentKey === "operations");
    assert.ok(children.some((c) => c.key === "operations.inventory"));
    assert.ok(children.some((c) => c.key === "operations.purchases"));
    assert.ok(children.some((c) => c.key === "operations.fleet"));
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
