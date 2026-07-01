import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAccessibleSidebarNavigation,
  mergeExpandedNavigationGroups,
  resolveActiveNavigationGroupId,
  resolveExpandedGroupsForPath,
  SIDEBAR_GROUP_UI_LABELS,
} from "./sidebarNavigation.js";
import { buildGroupedNavigationStructure } from "./navigationGroups.js";
import {
  canAccessModule,
  MODULE_LABELS,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
  type PermissionChecker,
} from "./modulePermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

const FULL_ACCESS_CHECKER = {
  hasPermission: () => true,
  hasAnyPermission: () => true,
} satisfies PermissionChecker;

function fullAccessChecker(): PermissionChecker {
  return FULL_ACCESS_CHECKER;
}

describe("sidebarNavigation — filtro por permissão", () => {
  it("oculta grupos sem nenhum item acessível", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["products.view"]));
    assert.equal(nav.directItems.length, 0);
    assert.equal(nav.groups.length, 1);
    assert.equal(nav.groups[0]?.id, "engenharia");
    assert.deepEqual(
      nav.groups[0]?.items.map((item) => item.itemId),
      ["products"]
    );
  });

  it("não expõe item que usuário não tinha acesso antes", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["dashboard.view"]));
    const ids = nav.flatAccessibleItems.map((item) => item.id);
    assert.deepEqual(ids, ["dashboard", "reports", "guide"]);
    assert.equal(canAccessModule("products", checker(["dashboard.view"])), false);
    assert.ok(!ids.includes("products"));
  });

  it("preserva paths /{moduleId} nos links acessíveis", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    for (const item of nav.flatAccessibleItems) {
      assert.equal(item.path, `/${item.id}`);
    }
    for (const group of nav.groups) {
      for (const item of group.items) {
        assert.equal(item.path, `/${item.itemId}`);
      }
    }
  });
});

describe("sidebarNavigation — grupos oficiais", () => {
  it("estrutura completa contém os cinco grupos principais", () => {
    const structure = buildGroupedNavigationStructure();
    const labels = structure.groups.map((group) => group.label);
    assert.deepEqual(labels, [...SIDEBAR_GROUP_UI_LABELS]);
  });

  it("Engenharia contém Produtos, Suprimentos, Simulações e Projetos", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const eng = nav.groups.find((g) => g.id === "engenharia");
    assert.deepEqual(eng?.items.map((i) => i.label), [
      MODULE_LABELS.products,
      MODULE_LABELS.materials,
      MODULE_LABELS.simulations,
      MODULE_LABELS.projects,
    ]);
  });

  it("Comercial contém CRM, Clientes, Propostas, Pedidos, Formação de Preço e Comissões", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "comercial");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "crm-commercial",
      "customers",
      "proposals",
      "sales-orders",
      "pricing",
      "commissions",
    ]);
  });

  it("Financeiro contém Financeiro, Custos Indiretos, Tributos e Relatórios", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "financeiro");
    assert.deepEqual(group?.items.map((i) => i.itemId), ["finance", "opex", "taxes", "reports"]);
  });

  it("Operações contém Estoque, Compras, Máquinas, Manutenção e Frota", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "operacoes");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "inventory",
      "purchases",
      "machines",
      "maintenance",
      "fleet",
    ]);
  });

  it("Administração contém Pessoas/RH, Configurações e Guia", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "administracao");
    assert.deepEqual(group?.items.map((i) => i.itemId), ["employees", "settings", "guide"]);
  });
});

describe("sidebarNavigation — expansão do grupo ativo", () => {
  it("rota /products abre grupo Engenharia", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    assert.deepEqual(resolveExpandedGroupsForPath("/products", nav), ["engenharia"]);
    assert.equal(resolveActiveNavigationGroupId("/products", nav), "engenharia");
  });

  it("rota /sales-orders abre grupo Comercial", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    assert.deepEqual(resolveExpandedGroupsForPath("/sales-orders", nav), ["comercial"]);
  });

  it("rota /dashboard não exige grupo expandido", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    assert.deepEqual(resolveExpandedGroupsForPath("/dashboard", nav), []);
    assert.equal(resolveActiveNavigationGroupId("/dashboard", nav), null);
  });

  it("mergeExpandedNavigationGroups preserva abertura do grupo ativo", () => {
    const merged = mergeExpandedNavigationGroups(new Set(), ["financeiro"]);
    assert.ok(merged.has("financeiro"));
  });
});

describe("Sidebar.tsx — renderização agrupada", () => {
  it("renderiza Dashboard como item direto e importa navigationGroups", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("buildAccessibleSidebarNavigation"));
    assert.ok(sidebar.includes("navigation.directItems"));
    assert.ok(!sidebar.includes("ALL_MENU_ITEMS"));
  });

  it("renderiza rótulos dos grupos oficiais via estrutura de navegação", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("group.label"));
    assert.ok(sidebar.includes("SidebarNavGroup"));
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    for (const group of nav.groups) {
      assert.ok(SIDEBAR_GROUP_UI_LABELS.includes(group.label as (typeof SIDEBAR_GROUP_UI_LABELS)[number]));
    }
  });

  it("paths dos NavLink permanecem item.path (/{moduleId})", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /to=\{path\}/);
    assert.doesNotMatch(sidebar, /to=\{`\/\$\{/);
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
      const flat = nav.flatAccessibleItems.find((item) => item.id === moduleId);
      assert.equal(flat?.path, `/${moduleId}`);
    }
  });

  it("modo colapsado mantém lista flat de itens acessíveis", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /collapsed \?/);
    assert.match(sidebar, /flatAccessibleItems/);
  });

  it("grupo ativo usa expandedGroups e resolveExpandedGroupsForPath", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("resolveExpandedGroupsForPath"));
    assert.ok(sidebar.includes("expandedGroups.has"));
    assert.ok(sidebar.includes("isActiveGroup"));
  });
});
