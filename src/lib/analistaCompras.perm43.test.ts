/**
 * PERM-43 — aceite end-to-end (fixture) do Analista de Compras.
 * Cobre menu, submenu, abas, ações, APIs, URL negada, modal, redirect,
 * permissionsVersion e refresh sem logout/login.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  ANALISTA_COMPRAS_ALLOW_PATHS,
  ANALISTA_COMPRAS_DENIED_RESOURCES,
  ANALISTA_COMPRAS_DENY_MODULES,
  ANALISTA_COMPRAS_DENY_FINANCE_SECTIONS,
  ANALISTA_COMPRAS_DENY_PATHS,
  ANALISTA_COMPRAS_EXPECT_MODULES,
  ANALISTA_COMPRAS_GRANTS,
  ANALISTA_COMPRAS_LABEL,
  type AnalistaComprasGrantMap,
  analistaComprasAppAuth,
  analistaComprasNavContext,
  applyAnalistaComprasPermissionRevoke,
  buildAnalistaComprasDto,
} from "@/src/lib/security/fixtures/analistaComprasPersona.js";
import {
  canAccessPath,
  canPerformAction,
  canViewModule,
  getSafeFirstAllowedPath,
} from "@/src/lib/resourceNavigationAccess.js";
import { filterOfficialSidebarByEffectiveAccess } from "@/src/lib/sidebarEffectiveAccess.js";
import { resolveAuthorizedTabs } from "@/src/lib/authorizedTabs.js";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess.js";
import { INVENTORY_UI_TABS, MATERIALS_UI_SECTIONS } from "@/src/lib/moduleTabResources.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import {
  UNAUTHORIZED_ACCESS_MESSAGE,
  resolveDeniedTabAccessOutcome,
  resolveUnauthorizedAccessOutcome,
} from "@/src/lib/unauthorizedAccess.js";
import {
  canEditMaterials,
  canEditMarketQuotes,
  canApproveMarketQuote,
} from "@/src/lib/commercialEngineeringPermissions.js";
import {
  canCreatePurchases,
  canManageFleet,
  canManageMaintenance,
  canViewFleet,
  canViewInventory,
  canViewPurchases,
} from "@/src/lib/operationsAdminPermissions.js";
import {
  canManageFinanceSuppliers,
  canViewFinanceCostCenters,
  canViewFinanceSuppliers,
} from "@/src/lib/financeCostCentersPermissions.js";
import { canViewFinanceAccountsPayable } from "@/src/lib/financeAccountsPayablePermissions.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { PERMISSIONS_CHANGED_SESSION_MESSAGE } from "@/src/lib/actionPermissionCatalog.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function actionCheck(ctx = analistaComprasNavContext()) {
  return {
    hasPermission: () => false,
    hasAnyPermission: () => false,
    canPerformAction: (rk: string, a: string) =>
      canPerformAction(rk, a as "view", ctx),
  };
}

describe("PERM-43 — fixture Analista de Compras", () => {
  it("exporta label e grants sem perfil de produção", () => {
    assert.equal(ANALISTA_COMPRAS_LABEL, "Analista de Compras");
    assert.ok(ANALISTA_COMPRAS_GRANTS.dashboard?.includes("view"));
    assert.ok(
      ANALISTA_COMPRAS_GRANTS[ENGINEERING_RESOURCE_KEYS.materials]?.includes(
        "update"
      )
    );
    assert.ok(
      ANALISTA_COMPRAS_GRANTS[FINANCE_MODULE_RESOURCE_KEYS.suppliers]?.includes(
        "manage"
      )
    );
  });
});

describe("PERM-43 — menu / submenu", () => {
  it("sidebar: Engenharia→Suprimentos; Financeiro; Fornecedores; Operações (Estoque/Compras/Manutenção/Frota)", () => {
    const dto = buildAnalistaComprasDto();
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const ids = nav.flatAccessibleItems.map((i) => i.id);

    for (const mod of ANALISTA_COMPRAS_EXPECT_MODULES) {
      assert.ok(ids.includes(mod), `esperado menu ${mod}`);
    }
    for (const mod of ANALISTA_COMPRAS_DENY_MODULES) {
      assert.equal(ids.includes(mod), false, `oculto ${mod}`);
    }

    assert.equal(
      nav.groups.find((g) => g.id === "comercial"),
      undefined,
      "grupo Comercial oculto"
    );

    const eng = nav.groups.find((g) => g.id === "engenharia");
    assert.ok(eng);
    assert.deepEqual(
      eng!.items.map((i) => i.itemId),
      ["materials"]
    );

    const ops = nav.groups.find((g) => g.id === "operacoes");
    assert.ok(ops);
    assert.deepEqual(
      ops!.items.map((i) => i.itemId).sort(),
      ["fleet", "inventory", "maintenance", "purchases"].sort()
    );

    const fin = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(fin);
    assert.ok(ids.includes("finance"));
    assert.ok(ids.includes("suppliers"));
  });

  it("canViewModule alinhado à fixture", () => {
    const c = analistaComprasNavContext();
    for (const mod of ANALISTA_COMPRAS_EXPECT_MODULES) {
      assert.equal(canViewModule(mod, c), true, mod);
    }
    for (const mod of ANALISTA_COMPRAS_DENY_MODULES) {
      assert.equal(canViewModule(mod, c), false, mod);
    }
  });
});

describe("PERM-43 — abas", () => {
  it("Dashboard: módulo liberado; sem abrir módulos irmãos", () => {
    const c = analistaComprasNavContext();
    assert.equal(canViewModule("dashboard", c), true);
    assert.equal(canAccessPath("/dashboard", c), true);
    assert.equal(canViewModule("products", c), false);
  });

  it("Suprimentos: Matérias-primas + Inteligência de Mercado", () => {
    const c = analistaComprasNavContext();
    const tabs = resolveAuthorizedTabs(MATERIALS_UI_SECTIONS, c, {
      requestedId: "catalog",
    });
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id).sort(),
      ["catalog", "marketIntelligence"].sort()
    );
    assert.equal(tabs.isEmpty, false);
  });

  it("Financeiro: só Contas a Pagar + Centros de Custo", () => {
    const c = analistaComprasNavContext();
    const tabs = resolveAuthorizedTabs(FINANCE_UI_SECTIONS, c, {
      requestedId: "billing",
    });
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id).sort(),
      ["accounts-payable", "cost-centers"].sort()
    );
    assert.equal(tabs.requestedDenied, true);
  });

  it("Estoque: abas finas (incl. Almoxarifados) visíveis", () => {
    const c = analistaComprasNavContext();
    const tabs = resolveAuthorizedTabs(INVENTORY_UI_TABS, c, {
      parentResourceKey: OPERATIONS_RESOURCE_KEYS.inventory,
      requireParentView: true,
    });
    const ids = tabs.visibleTabs.map((t) => t.id);
    assert.ok(ids.includes("overview"));
    assert.ok(ids.includes("items"));
    assert.ok(ids.includes("warehouses"));
    assert.ok(ids.includes("movements"));
    assert.ok(ids.includes("counts"));
  });
});

describe("PERM-43 — ações CRUD", () => {
  it("Engenharia: materials/MI update/approve; produtos negados", () => {
    const check = actionCheck();
    assert.equal(canEditMaterials(check), true);
    assert.equal(canEditMarketQuotes(check), true);
    assert.equal(canApproveMarketQuote(check), true);
    assert.equal(
      canPerformAction(
        ENGINEERING_RESOURCE_KEYS.products,
        "create",
        analistaComprasNavContext()
      ),
      false
    );
  });

  it("Financeiro: AP/CC view; Fornecedores manage", () => {
    const check = actionCheck();
    assert.equal(canViewFinanceAccountsPayable(check), true);
    assert.equal(canViewFinanceCostCenters(check), true);
    assert.equal(canViewFinanceSuppliers(check), true);
    assert.equal(canManageFinanceSuppliers(check), true);
  });

  it("Operações: estoque/compras/manutenção/frota com mutações", () => {
    const check = actionCheck();
    assert.equal(canViewInventory(check), true);
    assert.equal(canViewPurchases(check), true);
    assert.equal(canCreatePurchases(check), true);
    assert.equal(canManageMaintenance(check), true);
    assert.equal(canViewFleet(check), true);
    assert.equal(canManageFleet(check), true);
  });
});

describe("PERM-43 — APIs", () => {
  it("requireResource: grants ok; denied 403; suppliers manage ok", () => {
    const a = analistaComprasAppAuth();
    const profileSnapshot = Object.fromEntries(
      Object.entries(ANALISTA_COMPRAS_GRANTS).map(([k, acts]) => [
        k,
        Object.fromEntries(acts.map((act) => [act, true as const])),
      ])
    );
    const opts = { legacyCompatMode: true as const, profileSnapshot };

    assert.equal(
      authorizeRequireResource(
        a,
        ENGINEERING_RESOURCE_KEYS.materials,
        "view",
        opts
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        a,
        ENGINEERING_RESOURCE_KEYS.materials,
        "update",
        opts
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, "finance.accounts_payable", "view", opts).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        a,
        FINANCE_MODULE_RESOURCE_KEYS.suppliers,
        "manage",
        opts
      ).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        a,
        OPERATIONS_RESOURCE_KEYS.purchases,
        "create",
        opts
      ).ok,
      true
    );

    for (const key of [
      ENGINEERING_RESOURCE_KEYS.products,
      "commercial.pricing",
      "finance.accounts_receivable",
      OPERATIONS_RESOURCE_KEYS.machines,
    ]) {
      const d = authorizeRequireResource(a, key, "view", opts);
      assert.equal(d.ok, false, key);
      if (!d.ok) assert.equal(d.status, 403);
    }
  });

  it("lista de recursos negados da fixture não está no DTO", () => {
    const dto = buildAnalistaComprasDto();
    for (const key of ANALISTA_COMPRAS_DENIED_RESOURCES) {
      assert.equal(
        dto.allowedResources.includes(key),
        false,
        key
      );
    }
  });
});

describe("PERM-43 — URL direta, modal e redirecionamento", () => {
  it("paths permitidos allowed; negados → modal com fallback", () => {
    const c = analistaComprasNavContext();
    for (const path of ANALISTA_COMPRAS_ALLOW_PATHS) {
      assert.equal(canAccessPath(path, c), true, path);
      assert.equal(
        resolveUnauthorizedAccessOutcome({ ctx: c, pathname: path }).kind,
        "allowed",
        path
      );
    }

    const fallback = getSafeFirstAllowedPath(c);
    assert.ok(fallback);
    assert.ok(canAccessPath(fallback!, c));

    for (const path of ANALISTA_COMPRAS_DENY_PATHS) {
      assert.equal(canAccessPath(path, c), false, path);
      const outcome = resolveUnauthorizedAccessOutcome({
        ctx: c,
        pathname: path,
      });
      assert.equal(outcome.kind, "show_modal", path);
      if (outcome.kind === "show_modal") {
        assert.equal(outcome.fallbackPath, fallback);
      }
    }
  });

  it("seções financeiras irmãs negadas → abas + modal", () => {
    const c = analistaComprasNavContext();
    const tabs = resolveAuthorizedTabs(FINANCE_UI_SECTIONS, c);
    const visible = new Set(tabs.visibleTabs.map((t) => t.id));
    assert.ok(visible.has("accounts-payable"));
    assert.ok(visible.has("cost-centers"));
    for (const id of ANALISTA_COMPRAS_DENY_FINANCE_SECTIONS) {
      assert.equal(visible.has(id), false, id);
      const denied = resolveAuthorizedTabs(FINANCE_UI_SECTIONS, c, {
        requestedId: id,
      });
      assert.equal(denied.requestedDenied, true, id);
      const outcome = resolveDeniedTabAccessOutcome(c, {
        requestedDenied: true,
        isEmpty: false,
        pathname: `/finance/${id}`,
      });
      assert.equal(outcome.kind, "show_modal", id);
    }
  });

  it("mensagem oficial do modal e wiring AuthContext/Layout", () => {
    assert.match(UNAUTHORIZED_ACCESS_MESSAGE, /não tem acesso/i);
    assert.match(PERMISSIONS_CHANGED_SESSION_MESSAGE, /permissões foram atualizadas/i);
    const auth = read("src/contexts/AuthContext.tsx");
    assert.match(auth, /pollPermissionsVersion/);
    assert.match(auth, /refreshPermissions/);
    assert.match(auth, /permissionsChangedNotice/);
    assert.match(auth, /\/api\/auth\/permissions-version/);
    assert.match(auth, /\/api\/auth\/sync-session-permissions/);
    assert.match(
      read("src/components/layout/Layout.tsx"),
      /permissions-changed-notice|permissionsChangedNotice/
    );
    assert.match(
      read("src/components/UnauthorizedAccessGate.tsx"),
      /UNAUTHORIZED_ACCESS_MESSAGE|resolveUnauthorizedAccessOutcome/
    );
  });
});

describe("PERM-43 — permissionsVersion sem logout/login", () => {
  it("bump de versão + revoke de frota atualiza menu/path/ações", () => {
    const before = buildAnalistaComprasDto({ permissionsVersion: 3 });
    assert.equal(before.permissionsVersion, 3);
    const ctxBefore = analistaComprasNavContext({ permissionsVersion: 3 });
    assert.equal(canViewModule("fleet", ctxBefore), true);
    assert.equal(canAccessPath("/fleet", ctxBefore), true);

    const after = applyAnalistaComprasPermissionRevoke(
      before,
      OPERATIONS_RESOURCE_KEYS.fleet
    );
    assert.equal(after.permissionsVersion, 4);
    assert.equal(
      after.allowedResources.includes(OPERATIONS_RESOURCE_KEYS.fleet),
      false
    );

    const grantsAfter: AnalistaComprasGrantMap = Object.fromEntries(
      after.allowedResources.map((k) => [
        k,
        after.actionsByResource[k] ?? ["view"],
      ])
    );
    const ctxAfter = analistaComprasNavContext({
      permissionsVersion: after.permissionsVersion,
      grants: grantsAfter,
    });
    assert.equal(canViewModule("fleet", ctxAfter), false);
    assert.equal(canAccessPath("/fleet", ctxAfter), false);
    assert.equal(canViewModule("purchases", ctxAfter), true);
    assert.equal(canViewModule("inventory", ctxAfter), true);

    const navAfter = filterOfficialSidebarByEffectiveAccess(after);
    assert.equal(
      navAfter.flatAccessibleItems.some((i) => i.id === "fleet"),
      false
    );
    assert.ok(navAfter.flatAccessibleItems.some((i) => i.id === "purchases"));
  });

  it("AuthContext reage a mudança de versão sem exigir login", () => {
    const src = read("src/contexts/AuthContext.tsx");
    assert.match(src, /data\.permissionsVersion !== current/);
    assert.match(src, /announceChange:\s*true/);
    assert.doesNotMatch(
      src.slice(src.indexOf("pollPermissionsVersion"), src.indexOf("pollPermissionsVersion") + 400),
      /login\(/
    );
  });
});
