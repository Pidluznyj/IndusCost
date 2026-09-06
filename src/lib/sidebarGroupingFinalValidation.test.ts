/**
 * Validação final integrada — sidebar agrupada + gestão visual de acessos.
 * Não altera rotas, permissões reais nem telas; apenas detecta regressões.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getEffectivePermissions } from "./appAuth.js";
import { SYSTEM_ACCESS_PROFILE_SEEDS } from "./accessProfilesSeedData.js";
import { ALL_PERMISSION_KEYS } from "./permissionCatalog.js";
import {
  buildGroupedNavigationStructure,
  NAVIGATION_GROUP_DEFINITIONS,
} from "./navigationGroups.js";
import {
  buildAccessibleSidebarNavigation,
  SIDEBAR_GROUP_UI_LABELS,
} from "./sidebarNavigation.js";
import {
  canAccessModule,
  MODULE_LABELS,
  SIDEBAR_MODULE_ORDER,
  type AppModuleId,
  type PermissionChecker,
} from "./modulePermissions.js";
import {
  auditPermissionAccessGroupCoverage,
  buildPermissionAccessGroupSections,
} from "./permissionGroups.js";
import { runNavigationGroupingAudit } from "./navigationGroupingAudit.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function authChecker(role: string, permissions: string[]): PermissionChecker {
  const effective = getEffectivePermissions({
    role: role as Parameters<typeof getEffectivePermissions>[0]["role"],
    permissions,
  });
  const set = new Set(effective);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (ps) => ps.some((p) => set.has(p)),
    authUser: { effectivePermissions: effective },
  };
}

function profileChecker(systemKey: string): PermissionChecker {
  const profile = SYSTEM_ACCESS_PROFILE_SEEDS.find((s) => s.systemKey === systemKey);
  assert.ok(profile, `perfil ${systemKey}`);
  return authChecker(profile!.roleBase ?? "VIEWER", profile!.permissions);
}

function accessibleModuleIds(check: PermissionChecker): AppModuleId[] {
  return buildAccessibleSidebarNavigation(check).flatAccessibleItems.map((item) => item.id);
}

const EXPECTED_MENU: Record<
  (typeof SIDEBAR_GROUP_UI_LABELS)[number] | "Dashboard",
  readonly string[]
> = {
  Dashboard: [MODULE_LABELS.dashboard],
  Engenharia: [
    MODULE_LABELS.products,
    MODULE_LABELS["transformation-simulator"],
    MODULE_LABELS.simulations,
    MODULE_LABELS.projects,
  ],
  "Cadeia de Suprimentos": [
    MODULE_LABELS.materials,
    MODULE_LABELS.purchases,
    MODULE_LABELS["sc-purchases"],
    MODULE_LABELS.inventory,
    MODULE_LABELS["sc-inventory"],
    MODULE_LABELS["sc-receiving"],
  ],
  Comercial: [
    MODULE_LABELS["crm-commercial"],
    MODULE_LABELS.customers,
    MODULE_LABELS.proposals,
    MODULE_LABELS["commercial-price-table"],
    MODULE_LABELS["sales-orders"],
    MODULE_LABELS["sales-order-flow"],
    MODULE_LABELS["output-documents"],
    MODULE_LABELS.pricing,
    MODULE_LABELS.commissions,
    MODULE_LABELS.satisfaction,
  ],
  Financeiro: [
    MODULE_LABELS.finance,
    MODULE_LABELS.treasury,
    MODULE_LABELS["invested-capital-recovery"],
    MODULE_LABELS.suppliers,
    MODULE_LABELS["portfolio-reconciliation"],
    MODULE_LABELS.opex,
    MODULE_LABELS.taxes,
  ],
  Operações: [
    MODULE_LABELS.machines,
    MODULE_LABELS["operations-performance"],
    MODULE_LABELS["production-orders"],
    MODULE_LABELS.maintenance,
    MODULE_LABELS.fleet,
  ],
  "Gestão de pessoas": [
    MODULE_LABELS["employees-dashboard"],
    MODULE_LABELS.employees,
    MODULE_LABELS["org-chart"],
  ],
  // P1 (OKR): "Objetivos e Metas" saiu de Administração e virou item direto
  // ao lado do Dashboard — gestão do negócio, não configuração do sistema.
  Administração: [MODULE_LABELS.settings, MODULE_LABELS.guide],
};

describe("validação final — estrutura de menu agrupado", () => {
  it("grupos e itens batem com o mapa oficial de negócio", () => {
    const structure = buildGroupedNavigationStructure();
    assert.equal(structure.directItems[0]?.label, "Dashboard");
    // OKR como item direto logo após o Dashboard (permissões inalteradas).
    assert.equal(structure.directItems[1]?.label, "Objetivos e Metas");
    assert.deepEqual(
      structure.groups.map((g) => g.label),
      [...SIDEBAR_GROUP_UI_LABELS]
    );

    for (const group of structure.groups) {
      const expected = EXPECTED_MENU[group.label as keyof typeof EXPECTED_MENU];
      assert.ok(expected, `grupo inesperado: ${group.label}`);
      assert.deepEqual(
        group.items.map((item) => item.label),
        [...expected],
        `itens do grupo ${group.label}`
      );
    }
  });

  it("ordem interna dos grupos segue NAVIGATION_GROUP_DEFINITIONS", () => {
    const structure = buildGroupedNavigationStructure();
    for (const group of structure.groups) {
      const def = NAVIGATION_GROUP_DEFINITIONS.find((g) => g.id === group.id);
      assert.ok(def);
      assert.deepEqual(
        group.items.map((i) => i.itemId),
        [...def!.itemIds]
      );
    }
  });
});

describe("validação final — rotas preservadas", () => {
  it("cada módulo mantém path canônico e rota em App.tsx", () => {
    const appTsx = read("src/App.tsx");
    const structure = buildGroupedNavigationStructure();
    const allItems = [
      ...structure.directItems,
      ...structure.groups.flatMap((g) => g.items),
      ...(structure.fallbackGroup?.items ?? []),
    ];
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      const item = allItems.find((i) => i.itemId === moduleId);
      const expectedPath =
        moduleId === "suppliers"
          ? "/finance/suppliers"
          : moduleId === "portfolio-reconciliation"
            ? "/finance/portfolio-reconciliation"
            : moduleId === "sales-order-flow"
              ? "/commercial/sales-order-flow"
              : moduleId === "commercial-price-table"
                ? "/commercial/price-table"
                : moduleId === "treasury"
                  ? "/finance/treasury"
                  : moduleId === "invested-capital-recovery"
                    ? "/finance/invested-capital-recovery"
                    : moduleId === "purchases"
                      ? "/purchases/nomus-orders"
                      : moduleId === "sc-purchases"
                      ? "/supply-chain/purchases"
                      : moduleId === "sc-inventory"
                        ? "/supply-chain/inventory"
                        : moduleId === "sc-receiving"
                          ? "/supply-chain/receiving"
                          : moduleId === "satisfaction"
                            ? "/commercial/satisfaction"
              : `/${moduleId}`;
      assert.equal(item?.path, expectedPath);
      if (moduleId === "suppliers") {
        assert.match(appTsx, /path=["']finance\/suppliers["']/);
        assert.match(appTsx, /FinanceSuppliersPage/);
        assert.doesNotMatch(read("src/components/FinanceModule.tsx"), /path="suppliers"/);
        continue;
      }
      if (moduleId === "portfolio-reconciliation") {
        assert.match(appTsx, /path=["']finance\/portfolio-reconciliation["']/);
        continue;
      }
      if (moduleId === "sales-order-flow") {
        assert.match(appTsx, /path=["']commercial\/sales-order-flow["']/);
        assert.match(appTsx, /SalesOrderFlowModule/);
        continue;
      }
      if (moduleId === "commercial-price-table") {
        assert.match(appTsx, /path=["']commercial\/price-table["']/);
        assert.match(appTsx, /CommercialPriceTableModule/);
        continue;
      }
      if (moduleId === "satisfaction") {
        assert.match(appTsx, /path=["']commercial\/satisfaction["']/);
        assert.match(appTsx, /SatisfactionModule/);
        continue;
      }
      if (moduleId === "treasury") {
        assert.match(appTsx, /path=["']finance\/treasury(?:\/\*)?["']/);
        continue;
      }
      if (moduleId === "invested-capital-recovery") {
        assert.match(appTsx, /path=["']finance\/invested-capital-recovery["']/);
        continue;
      }
      if (moduleId === "sc-purchases") {
        assert.match(appTsx, /path=["']supply-chain\/purchases["']/);
        continue;
      }
      if (moduleId === "sc-inventory") {
        assert.match(appTsx, /path=["']supply-chain\/inventory["']/);
        continue;
      }
      if (moduleId === "sc-receiving") {
        assert.match(appTsx, /path=["']supply-chain\/receiving["']/);
        continue;
      }
      const escaped = moduleId.replace(/-/g, "\\-");
      assert.match(
        appTsx,
        new RegExp(`path=["']${escaped}(?:\\/\\*)?["']`),
        `App.tsx deve declarar rota para ${moduleId}`
      );
    }
  });

  it("auditoria automatizada confirma baseline de paths e labels", () => {
    const result = runNavigationGroupingAudit();
    assert.equal(result.status, "OK", JSON.stringify(result.findings, null, 2));
  });
});

describe("validação final — permissões por perfil de role", () => {
  it("SUPER_ADMIN vê todos os módulos do menu", () => {
    const check = authChecker("SUPER_ADMIN", []);
    assert.equal(accessibleModuleIds(check).length, SIDEBAR_MODULE_ORDER.length);
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      assert.equal(canAccessModule(moduleId, check), true, moduleId);
    }
  });

  it("ADMIN (perfil sistema) não ganha módulos além das permissões efetivas", () => {
    const check = profileChecker("role_admin");
    const ids = accessibleModuleIds(check);
    for (const moduleId of ids) {
      assert.equal(canAccessModule(moduleId, check), true, moduleId);
    }
    assert.ok(ids.includes("dashboard"));
    assert.ok(ids.includes("settings"));
    assert.equal(canAccessModule("commissions", check), false);
  });

  it("COMMERCIAL_MANAGER vê Comercial permitido e não ganha Comissões/Formação de Preço indevidos", () => {
    const check = profileChecker("role_commercial_manager");
    const ids = accessibleModuleIds(check);
    assert.ok(ids.includes("crm-commercial"));
    assert.ok(ids.includes("customers"));
    assert.ok(ids.includes("proposals"));
    assert.ok(ids.includes("sales-orders"));
    assert.ok(ids.includes("output-documents"));
    // Seed role_commercial_manager inclui commissions.view — menu de comissões é esperado.
    assert.equal(canAccessModule("commissions", check), true);
    assert.equal(canAccessModule("pricing", check), false);
    assert.ok(ids.includes("commissions"));
    assert.ok(!ids.includes("pricing"));
    assert.ok(!ids.includes("settings"));
  });

  it("SELLER não ganha acesso indevido a Configurações, Financeiro ou RH", () => {
    const check = profileChecker("role_seller");
    const ids = accessibleModuleIds(check);
    const forbidden: AppModuleId[] = [
      "settings",
      "finance",
      "employees",
      "employees-dashboard",
      "pricing",
      "inventory",
      "purchases",
    ];
    for (const moduleId of forbidden) {
      assert.equal(canAccessModule(moduleId, check), false, moduleId);
      assert.ok(!ids.includes(moduleId), moduleId);
    }
    assert.ok(ids.includes("crm-commercial"));
    assert.ok(ids.includes("customers"));
    assert.ok(ids.includes("proposals"));
    assert.ok(ids.includes("sales-orders"));
    assert.ok(ids.includes("output-documents"));
  });

  it("VIEWER (perfil Visualizador) não ganha Configurações, Comissões ou Compras", () => {
    const check = profileChecker("role_viewer");
    const ids = accessibleModuleIds(check);
    assert.equal(canAccessModule("settings", check), false);
    assert.equal(canAccessModule("commissions", check), false);
    assert.equal(canAccessModule("purchases", check), false);
    assert.ok(!ids.includes("settings"));
    assert.ok(!ids.includes("commissions"));
    assert.ok(!ids.includes("purchases"));
    assert.ok(ids.includes("dashboard"));
    assert.ok(ids.includes("products"));
  });

  it("grupos vazios não aparecem; itens legados via dashboard.view permanecem corretos", () => {
    const check = profileChecker("role_seller");
    const nav = buildAccessibleSidebarNavigation(check);
    for (const group of nav.groups) {
      assert.ok(group.items.length > 0, group.id);
    }
    const financeiro = nav.groups.find((g) => g.id === "financeiro");
    if (financeiro) {
      assert.deepEqual(
        financeiro.items.map((i) => i.itemId),
        ["reports"],
        "SELLER só entra em Financeiro via reports.view/dashboard.view legado"
      );
      assert.equal(canAccessModule("finance", check), false);
    }
    const admin = nav.groups.find((g) => g.id === "administracao");
    assert.equal(
      admin,
      undefined,
      "SELLER sem guide.view não entra em Administração (PERM-42)"
    );
    assert.equal(canAccessModule("settings", check), false);
    assert.equal(canAccessModule("guide", check), false);
  });
});

describe("validação final — gestão visual de acessos", () => {
  it("catálogo completo mapeado em grupos visuais sem novas keys", () => {
    const audit = auditPermissionAccessGroupCoverage();
    assert.equal(audit.groupedKeys.length, audit.catalogKeys.length);
    assert.deepEqual([...ALL_PERMISSION_KEYS].sort(), audit.catalogKeys.sort());
  });

  it("PermissionEditor usa agrupamento visual e salva keys individuais", () => {
    const editor = read("src/components/admin/PermissionEditor.tsx");
    assert.ok(editor.includes("buildPermissionAccessGroupSections"));
    assert.ok(editor.includes("togglePermissionSelected"));
    assert.doesNotMatch(editor, /permissionGroupKey/);
  });

  it("bulk actions por grupo preservam keys do catálogo", () => {
    const sections = buildPermissionAccessGroupSections(["dashboard.view"]);
    const comercial = sections.find((s) => s.id === "comercial");
    assert.ok(comercial);
    for (const key of comercial!.permissionKeys) {
      assert.ok(ALL_PERMISSION_KEYS.includes(key), key);
    }
  });
});

describe("validação final — UI sidebar", () => {
  it("Sidebar.tsx mantém marcadores de layout e modo colapsado", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.ok(sidebar.includes("sidebar-nav-scroll"));
    assert.ok(sidebar.includes("sidebar-footer"));
    assert.ok(sidebar.includes("data-sidebar-collapsed"));
    assert.ok(sidebar.includes("buildResourceAwareSidebarNavigation"));
  });
});
