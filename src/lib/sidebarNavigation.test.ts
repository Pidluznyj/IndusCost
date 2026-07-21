import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAccessibleSidebarNavigation,
  getSidebarGroupButtonId,
  getSidebarGroupPanelId,
  isNavigationGroupExpanded,
  mergeExpandedNavigationGroups,
  parseStoredExpandedGroups,
  resolveActiveNavigationGroupId,
  resolveExpandedGroupsForPath,
  resolveInitialExpandedGroups,
  serializeExpandedGroups,
  SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY,
  toggleExpandedGroupInSet,
  SIDEBAR_GROUP_UI_LABELS,
} from "./sidebarNavigation.js";
import {
  buildGroupedNavigationStructure,
  getModulePath,
} from "./navigationGroups.js";
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
      ["products", "transformation-simulator"]
    );
  });

  it("não expõe item que usuário não tinha acesso antes", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["dashboard.view"]));
    const ids = nav.flatAccessibleItems.map((item) => item.id);
    assert.deepEqual(ids, ["dashboard", "reports"]);
    assert.equal(canAccessModule("products", checker(["dashboard.view"])), false);
    assert.ok(!ids.includes("products"));
    assert.ok(!ids.includes("guide"));
  });

  it("preserva paths canônicos nos links acessíveis", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    for (const item of nav.flatAccessibleItems) {
      assert.equal(item.path, getModulePath(item.id));
    }
    for (const group of nav.groups) {
      for (const item of group.items) {
        assert.equal(item.path, getModulePath(item.itemId));
      }
    }
  });
});

describe("sidebarNavigation — grupos oficiais", () => {
  it("estrutura completa contém os seis grupos principais", () => {
    const structure = buildGroupedNavigationStructure();
    const labels = structure.groups.map((group) => group.label);
    assert.deepEqual(labels, [...SIDEBAR_GROUP_UI_LABELS]);
  });

  it("Engenharia contém Produtos, Simulador, Simulações e Projetos", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const eng = nav.groups.find((g) => g.id === "engenharia");
    assert.deepEqual(eng?.items.map((i) => i.label), [
      MODULE_LABELS.products,
      MODULE_LABELS["transformation-simulator"],
      MODULE_LABELS.simulations,
      MODULE_LABELS.projects,
    ]);
  });

  it("Cadeia de Suprimentos contém Suprimentos, Compras e Estoque / Almoxarifado", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "cadeia_suprimentos");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "materials",
      "purchases",
      "inventory",
    ]);
    assert.deepEqual(group?.items.map((i) => i.label), [
      MODULE_LABELS.materials,
      MODULE_LABELS.purchases,
      MODULE_LABELS.inventory,
    ]);
    assert.deepEqual(group?.items.map((i) => i.path), [
      "/materials",
      "/purchases",
      "/inventory",
    ]);
  });

  it("Cadeia de Suprimentos oculta-se sem filhos e mostra só o item autorizado", () => {
    const onlyPurchases = buildAccessibleSidebarNavigation(checker(["purchases.view"]));
    assert.equal(onlyPurchases.groups.some((g) => g.id === "engenharia"), false);
    assert.equal(onlyPurchases.groups.some((g) => g.id === "operacoes"), false);
    const purchasesGroup = onlyPurchases.groups.find((g) => g.id === "cadeia_suprimentos");
    assert.deepEqual(purchasesGroup?.items.map((i) => i.itemId), ["purchases"]);

    const onlyInventory = buildAccessibleSidebarNavigation(checker(["inventory.view"]));
    assert.deepEqual(
      onlyInventory.groups.find((g) => g.id === "cadeia_suprimentos")?.items.map((i) => i.itemId),
      ["inventory"]
    );

    const onlyMaterials = buildAccessibleSidebarNavigation(checker(["materials.view"]));
    assert.deepEqual(
      onlyMaterials.groups.find((g) => g.id === "cadeia_suprimentos")?.items.map((i) => i.itemId),
      ["materials"]
    );

    const none = buildAccessibleSidebarNavigation(checker(["machines.view"]));
    assert.equal(none.groups.some((g) => g.id === "cadeia_suprimentos"), false);
  });

  it("Comercial contém CRM, Clientes, Propostas, Pedidos, Fluxo, Documentos de Saída, Formação de Preço e Comissões", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "comercial");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "crm-commercial",
      "customers",
      "proposals",
      "sales-orders",
      "sales-order-flow",
      "output-documents",
      "pricing",
      "commissions",
    ]);
  });

  it("Financeiro contém Financeiro, Fornecedores, Conciliação, Custos Indiretos, Tributos e Relatórios", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "financeiro");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "finance",
      "suppliers",
      "portfolio-reconciliation",
      "opex",
      "taxes",
      "reports",
    ]);
  });

  it("Operações contém Máquinas, Performance, Ordens de Produção, Manutenção e Frota", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const group = nav.groups.find((g) => g.id === "operacoes");
    assert.deepEqual(group?.items.map((i) => i.itemId), [
      "machines",
      "operations-performance",
      "production-orders",
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

  it("rota /commercial/sales-order-flow abre grupo Comercial", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    assert.deepEqual(
      resolveExpandedGroupsForPath("/commercial/sales-order-flow", nav),
      ["comercial"]
    );
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

describe("sidebarNavigation — persistência localStorage", () => {
  it("localStorage vazio inicia só com grupo da rota ativa", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const initial = resolveInitialExpandedGroups("/products", nav, parseStoredExpandedGroups(null));
    assert.deepEqual([...initial], ["engenharia"]);
  });

  it("localStorage vazio em /dashboard não abre grupos", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const initial = resolveInitialExpandedGroups("/dashboard", nav, parseStoredExpandedGroups(""));
    assert.equal(initial.size, 0);
  });

  it("preferência salva persiste Engenharia após refresh simulado", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const stored = parseStoredExpandedGroups(serializeExpandedGroups(new Set(["engenharia"])));
    const initial = resolveInitialExpandedGroups("/dashboard", nav, stored);
    assert.ok(initial.has("engenharia"));
  });

  it("rota ativa em Comercial abre grupo mesmo sem preferência salva", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    const initial = resolveInitialExpandedGroups("/customers", nav, new Set());
    assert.ok(initial.has("comercial"));
  });

  it("localStorage inválido usa fallback seguro (Set vazio)", () => {
    assert.equal(parseStoredExpandedGroups("{invalid").size, 0);
    assert.equal(parseStoredExpandedGroups('{"not":"array"}').size, 0);
    assert.equal(parseStoredExpandedGroups('["unknown-group"]').size, 0);
  });

  it("serializeExpandedGroups gera JSON estável", () => {
    assert.equal(
      serializeExpandedGroups(new Set(["comercial", "engenharia"])),
      '["comercial","engenharia"]'
    );
  });

  it("toggleExpandedGroupInSet não recolhe grupo da rota ativa", () => {
    const next = toggleExpandedGroupInSet(new Set(["financeiro"]), "financeiro", "financeiro");
    assert.ok(next.has("financeiro"));
  });

  it("isNavigationGroupExpanded combina preferência e rota ativa", () => {
    assert.equal(isNavigationGroupExpanded("engenharia", new Set(), "engenharia"), true);
    assert.equal(isNavigationGroupExpanded("engenharia", new Set(["engenharia"]), null), true);
    assert.equal(isNavigationGroupExpanded("comercial", new Set(), null), false);
  });
});

describe("sidebarNavigation — ids de acessibilidade", () => {
  it("expõe ids estáveis para aria-controls", () => {
    assert.equal(getSidebarGroupButtonId("financeiro"), "sidebar-group-button-financeiro");
    assert.equal(getSidebarGroupPanelId("financeiro"), "sidebar-group-panel-financeiro");
  });
});

describe("Sidebar.tsx — renderização agrupada", () => {
  it("renderiza Dashboard como item direto e importa navigationGroups", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(
      sidebar.includes("buildResourceAwareSidebarNavigation") ||
        sidebar.includes("buildAccessibleSidebarNavigation")
    );
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

  it("paths dos NavLink usam item.path (suppliers → /finance/suppliers)", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /to=\{path\}/);
    assert.doesNotMatch(sidebar, /to=\{`\/\$\{/);
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
      const flat = nav.flatAccessibleItems.find((item) => item.id === moduleId);
      assert.equal(flat?.path, getModulePath(moduleId));
    }
  });

  it("MENU_ITEM_ICONS cobre todos os AppModuleId (evita React error #130)", async () => {
    const { SIDEBAR_MENU_ITEM_ICONS } = await import("../components/layout/Sidebar.tsx");
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const Icon = SIDEBAR_MENU_ITEM_ICONS[moduleId];
      assert.ok(
        typeof Icon === "function" || (typeof Icon === "object" && Icon != null),
        `missing sidebar icon for ${moduleId}`
      );
    }
  });

  it("modo colapsado usa rail com rótulos curtos visíveis e flyout por clique", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /data-sidebar-collapsed-rail/);
    assert.match(sidebar, /sidebar-collapsed-short-label/);
    assert.match(sidebar, /SidebarCollapsedFlyout/);
    assert.match(sidebar, /min-h-11/);
    assert.match(
      sidebar,
      /\{collapsed \? \([\s\S]*SidebarCollapsedGroupButton[\s\S]*\) : \([\s\S]*SidebarNavGroup/s
    );
  });

  it("persiste expansão via localStorage", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("SIDEBAR_EXPANDED_GROUPS_STORAGE_KEY"));
    assert.ok(sidebar.includes("readStoredExpandedGroups"));
    assert.ok(sidebar.includes("persistExpandedGroups"));
    assert.ok(sidebar.includes("serializeExpandedGroups"));
  });

  it("aria-expanded e aria-controls nos grupos", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("aria-expanded={expanded}"));
    assert.ok(sidebar.includes("aria-controls={panelId}"));
    assert.ok(sidebar.includes("getSidebarGroupPanelId"));
    assert.ok(sidebar.includes('role="group"'));
  });

  it("grupo ativo usa isActiveGroup e isNavigationGroupExpanded", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("resolveActiveNavigationGroupId"));
    assert.ok(sidebar.includes("isNavigationGroupExpanded"));
    assert.ok(sidebar.includes("isActiveGroup"));
    assert.ok(sidebar.includes("data-sidebar-group-active"));
    assert.ok(sidebar.includes("sidebar-group-active"));
  });
});

describe("Sidebar.tsx — acabamento visual e responsividade", () => {
  it("grupos renderizam na ordem oficial Engenharia → Administração", () => {
    const nav = buildAccessibleSidebarNavigation(fullAccessChecker());
    assert.deepEqual(
      nav.groups.map((g) => g.label),
      [...SIDEBAR_GROUP_UI_LABELS]
    );
  });

  it("marcadores de layout para scroll, footer e links ativos", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("sidebar-nav-scroll"));
    assert.ok(sidebar.includes("sidebar-footer"));
    assert.ok(sidebar.includes("sidebar-nav-link-active"));
    assert.ok(sidebar.includes("min-h-0"));
    assert.ok(sidebar.includes("data-sidebar-collapsed"));
  });

  it("sidebar colapsada abre submenus via flyout, não accordion inline", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /data-sidebar-collapsed=\{collapsed \? "true" : "false"\}/);
    assert.match(sidebar, /SidebarCollapsedFlyout/);
    assert.match(sidebar, /toggleFlyout/);
    assert.doesNotMatch(
      sidebar,
      /\{collapsed \? \([\s\S]*flatAccessibleItems[\s\S]*\) : \([\s\S]*SidebarNavGroup/s
    );
  });

  it("grupos vazios não aparecem para usuário sem permissões", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["products.view"]));
    assert.equal(nav.groups.length, 1);
    assert.equal(nav.groups[0]?.id, "engenharia");
    assert.equal(nav.directItems.length, 0);
  });

  it("usuário com permissão parcial vê somente itens permitidos", () => {
    const nav = buildAccessibleSidebarNavigation(checker(["dashboard.view"]));
    const ids = nav.flatAccessibleItems.map((item) => item.id);
    assert.deepEqual(ids, ["dashboard", "reports"]);
    assert.equal(nav.groups.length, 1);
    assert.ok(!ids.includes("products"));
    assert.ok(!ids.includes("guide"));
  });

  it("tooltip no modo colapsado é complemento, não única identificação", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /sidebar-collapsed-short-label/);
    assert.match(sidebar, /resolveModuleShortLabel/);
    assert.match(sidebar, /title=\{collapsed \? label : undefined\}/);
  });

  it("rótulos oficiais dos grupos permanecem inalterados", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("SIDEBAR_GROUP_UI_LABELS"));
    assert.deepEqual([...SIDEBAR_GROUP_UI_LABELS], [
      "Engenharia",
      "Cadeia de Suprimentos",
      "Comercial",
      "Financeiro",
      "Operações",
      "Administração",
    ]);
  });
});
