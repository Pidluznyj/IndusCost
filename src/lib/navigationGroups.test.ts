import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildGroupedNavigationStructure,
  flattenGroupedNavigationItems,
  getModulePath,
  MODULE_MENU_PERMISSION_KEYS,
  NAVIGATION_GROUP_DEFINITIONS,
  resolveNavigationGroupIdForModule,
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

const EXPECTED_GROUP_BY_MODULE: Record<AppModuleId, string> = {
  dashboard: "dashboard",
  products: "engenharia",
  "transformation-simulator": "engenharia",
  materials: "cadeia_suprimentos",
  simulations: "engenharia",
  projects: "engenharia",
  "crm-commercial": "comercial",
  customers: "comercial",
  proposals: "comercial",
  "commercial-price-table": "comercial",
  "sales-orders": "comercial",
  "sales-order-flow": "comercial",
  "output-documents": "comercial",
  pricing: "comercial",
  commissions: "comercial",
  satisfaction: "comercial",
  finance: "financeiro",
  treasury: "financeiro",
  "invested-capital-recovery": "financeiro",
  suppliers: "financeiro",
  "portfolio-reconciliation": "financeiro",
  opex: "financeiro",
  taxes: "financeiro",
  inventory: "cadeia_suprimentos",
  purchases: "cadeia_suprimentos",
  "sc-purchases": "cadeia_suprimentos",
  "sc-inventory": "cadeia_suprimentos",
  "sc-receiving": "cadeia_suprimentos",
  machines: "operacoes",
  "operations-performance": "operacoes",
  "production-orders": "operacoes",
  maintenance: "operacoes",
  fleet: "operacoes",
  employees: "gestao_pessoas",
  "employees-dashboard": "gestao_pessoas",
  "org-chart": "gestao_pessoas",
  // P1 (OKR): "Objetivos e Metas" é gestão do negócio — item direto ao lado
  // do Dashboard, fora de Administração. Permissões inalteradas.
  goals: "dashboard",
  settings: "administracao",
  guide: "administracao",
};

/** Paths canônicos que diferem de `/${moduleId}` — espelho de getModulePath. */
const CANONICAL_PATH_OVERRIDES: Partial<Record<AppModuleId, string>> = {
  suppliers: "/finance/suppliers",
  treasury: "/finance/treasury",
  "invested-capital-recovery": "/finance/invested-capital-recovery",
  "portfolio-reconciliation": "/finance/portfolio-reconciliation",
  "sales-order-flow": "/commercial/sales-order-flow",
  "commercial-price-table": "/commercial/price-table",
  satisfaction: "/commercial/satisfaction",
  "sc-purchases": "/supply-chain/purchases",
  "sc-inventory": "/supply-chain/inventory",
  "sc-receiving": "/supply-chain/receiving",
};

describe("navigationGroups — cobertura completa do menu atual", () => {
  it("todos os módulos do SIDEBAR_MODULE_ORDER continuam existindo", () => {
    const structure = buildGroupedNavigationStructure();
    const flat = flattenGroupedNavigationItems(structure);
    const groupedIds = flat.map((item) => item.itemId).sort();
    const sidebarIds = [...SIDEBAR_MODULE_ORDER].sort();
    assert.deepEqual(groupedIds, sidebarIds);
  });

  it("nenhum item duplicado na estrutura agrupada", () => {
    const flat = flattenGroupedNavigationItems();
    const ids = flat.map((item) => item.itemId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("todos os paths usam getModulePath (fonte canônica)", () => {
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const expected = CANONICAL_PATH_OVERRIDES[moduleId] ?? `/${moduleId}`;
      assert.equal(getModulePath(moduleId), expected, moduleId);
    }
    for (const item of flattenGroupedNavigationItems()) {
      assert.equal(item.path, getModulePath(item.itemId));
      assert.equal(item.originalItem.path, item.path);
    }
  });

  it("labels herdados de MODULE_LABELS sem alteração", () => {
    for (const item of flattenGroupedNavigationItems()) {
      assert.equal(item.label, MODULE_LABELS[item.itemId]);
      assert.equal(item.originalItem.label, MODULE_LABELS[item.itemId]);
    }
  });

  it("Dashboard e Objetivos e Metas são itens diretos (sem accordion)", () => {
    const structure = buildGroupedNavigationStructure();
    assert.equal(structure.directItems.length, 2);
    assert.equal(structure.directItems[0]?.itemId, "dashboard");
    // P1 (OKR): gestão do negócio ao lado do Dashboard, permissões intactas.
    assert.equal(structure.directItems[1]?.itemId, "goals");
    assert.equal(structure.directItems[0]?.groupId, "dashboard");
    const dashboardDef = NAVIGATION_GROUP_DEFINITIONS.find((g) => g.id === "dashboard");
    assert.equal(dashboardDef?.isDirect, true);
  });

  it("cada item foi agrupado no grupo oficial esperado", () => {
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      assert.equal(
        resolveNavigationGroupIdForModule(moduleId),
        EXPECTED_GROUP_BY_MODULE[moduleId],
        `moduleId ${moduleId}`
      );
    }
  });

  it("nenhum item caiu em Outros (mapeamento completo)", () => {
    const structure = buildGroupedNavigationStructure();
    assert.deepEqual(structure.unmappedItemIds, []);
    assert.equal(structure.fallbackGroup, null);
  });

  it("grupos sem itens não aparecem na estrutura final", () => {
    const structure = buildGroupedNavigationStructure();
    for (const group of structure.groups) {
      assert.ok(group.items.length > 0, `grupo vazio: ${group.id}`);
    }
  });

  it("contagens de grupos coincidem com NAVIGATION_GROUP_DEFINITIONS (membership)", () => {
    const structure = buildGroupedNavigationStructure();
    const counts = Object.fromEntries(structure.groups.map((g) => [g.id, g.items.length]));
    const expected = Object.fromEntries(
      NAVIGATION_GROUP_DEFINITIONS.filter((g) => !g.isDirect).map((g) => [
        g.id,
        g.itemIds.length,
      ])
    );
    assert.deepEqual(counts, expected);

    // Membership explícito: cada moduleId do mapa está no grupo declarado.
    for (const [moduleId, groupId] of Object.entries(EXPECTED_GROUP_BY_MODULE) as Array<
      [AppModuleId, string]
    >) {
      if (groupId === "dashboard") continue;
      const def = NAVIGATION_GROUP_DEFINITIONS.find((g) => g.id === groupId);
      assert.ok(def, `grupo ${groupId}`);
      assert.ok(
        def!.itemIds.includes(moduleId),
        `${moduleId} deve estar em ${groupId}.itemIds`
      );
    }
  });
});

describe("navigationGroups — permissões preservadas", () => {
  it("MODULE_MENU_PERMISSION_KEYS cobre todos os módulos do menu", () => {
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const keys = MODULE_MENU_PERMISSION_KEYS[moduleId];
      assert.ok(keys.length > 0, moduleId);
    }
  });

  it("acesso por permissão primária continua alinhado a canAccessModule", () => {
    // samples = módulos do menu atual (AppModuleId). `reports` NÃO é mais
    // AppModuleId/sidebar — rota legada /reports existe, mas menu usa finance
    // + resourceKey finance.reports. Não reintroduzir canAccessModule("reports").
    const samples: Array<[AppModuleId, string]> = [
      ["dashboard", "dashboard.view"],
      ["products", "products.view"],
      ["finance", "finance.view"],
      ["inventory", "inventory.view"],
      ["commissions", "commissions.view"],
      ["customers", "customers.view"],
      ["employees", "employees.view"],
      ["employees-dashboard", "employees.dashboard.view"],
      ["satisfaction", "commercial.satisfaction.view"],
      ["goals", "goals.view"],
    ];
    for (const [moduleId, perm] of samples) {
      assert.equal(canAccessModule(moduleId, checker([perm])), true, moduleId);
      assert.ok(
        MODULE_MENU_PERMISSION_KEYS[moduleId].includes(perm),
        `${moduleId} deve listar ${perm}`
      );
    }
  });

  it("P09: costs.view só em opex; não em RH/máquinas/suprimentos/simulações", () => {
    assert.ok(MODULE_MENU_PERMISSION_KEYS.opex.includes("costs.view"));
    assert.equal(canAccessModule("opex", checker(["costs.view"])), true);
    for (const moduleId of ["employees", "machines", "materials", "simulations"] as const) {
      assert.equal(
        MODULE_MENU_PERMISSION_KEYS[moduleId].includes("costs.view"),
        false,
        moduleId
      );
      assert.equal(canAccessModule(moduleId, checker(["costs.view"])), false, moduleId);
    }
  });
});

describe("navigationGroups — integração com sidebar agrupada", () => {
  it("Sidebar.tsx consome navegação agrupada com resource awareness", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("buildResourceAwareSidebarNavigation"));
    assert.ok(sidebar.includes("@/src/lib/navigationGroups"));
  });
});
