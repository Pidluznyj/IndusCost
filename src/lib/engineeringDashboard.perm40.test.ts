/**
 * PERM-40 — árvore oficial Dashboard + Engenharia.
 * Persona: só Suprimentos → Matérias-primas → Inteligência de Mercado.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { ENGINEERING_RESOURCE_KEYS } from "@/src/lib/engineeringAccess.js";
import { MATERIALS_UI_SECTIONS } from "@/src/lib/moduleTabResources.js";
import { resolveAuthorizedTabs } from "@/src/lib/authorizedTabs.js";
import {
  canAccessPath,
  canPerformAction,
  canViewModule,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  effectiveAccessDtoFromAllowedResources,
  filterOfficialSidebarByEffectiveAccess,
} from "@/src/lib/sidebarEffectiveAccess.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  canApproveMarketQuote,
  canEditMarketQuotes,
  canEditMaterials,
} from "@/src/lib/commercialEngineeringPermissions.js";
import { ACTION_PERMISSION_SURFACES } from "@/src/lib/actionPermissionCatalog.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function user(role: AuthUser["role"] = "VIEWER"): AuthUser {
  return {
    id: "u-perm40",
    name: "P40",
    email: "p40@example.com",
    role,
    permissions: [],
    effectivePermissions: [],
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

/** Grants oficiais da fatia Engineering → Suprimentos → MP → MI. */
const SUPPLIES_MI_SLICE = [
  ENGINEERING_RESOURCE_KEYS.materials,
  ENGINEERING_RESOURCE_KEYS.marketIntelligence,
  ENGINEERING_RESOURCE_KEYS.marketIntelligenceHome,
  ENGINEERING_RESOURCE_KEYS.marketIntelligenceMaterial360,
  ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes,
] as const;

function dtoFromKeys(
  keys: readonly string[],
  actions?: EffectiveAccessMeDto["actionsByResource"]
): EffectiveAccessMeDto {
  const base = effectiveAccessDtoFromAllowedResources(keys);
  if (!actions) return base;
  return {
    ...base,
    actionsByResource: { ...base.actionsByResource, ...actions },
    capabilities: {
      ...base.capabilities,
      ...Object.fromEntries(
        Object.entries(actions).map(([k, acts]) => [
          k,
          {
            canView: acts.includes("view"),
            canExecute: acts.some((a) =>
              ["execute", "create", "update", "manage", "approve"].includes(a)
            ),
            canManage: acts.includes("manage"),
          },
        ])
      ),
    },
  };
}

function ctx(keys: readonly string[], actions?: EffectiveAccessMeDto["actionsByResource"]): NavigationAccessContext {
  return {
    user: user("VIEWER"),
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: dtoFromKeys(keys, actions),
    authLoading: false,
    authError: null,
  };
}

function authBag(permissions: string[]): AppAuthContext {
  return {
    id: "u-perm40",
    name: "P40",
    email: "p40@example.com",
    role: "VIEWER",
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
    sessionId: "s-perm40",
  };
}

describe("PERM-40 — matriz Dashboard + Engenharia", () => {
  it("sidebar: só Suprimentos no grupo Cadeia de Suprimentos; sem Produtos/Simulações/Projetos/Simulador", () => {
    const dto = effectiveAccessDtoFromAllowedResources([...SUPPLIES_MI_SLICE]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const eng = nav.groups.find((g) => g.id === "engenharia");
    assert.equal(eng, undefined, "grupo Engenharia oculto sem filhos");
    const cadeia = nav.groups.find((g) => g.id === "cadeia_suprimentos");
    assert.ok(cadeia, "grupo Cadeia de Suprimentos deve aparecer via filho");
    assert.deepEqual(
      cadeia!.items.map((i) => i.itemId),
      ["materials"]
    );
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("materials"));
    assert.equal(ids.includes("products"), false);
    assert.equal(ids.includes("simulations"), false);
    assert.equal(ids.includes("projects"), false);
    assert.equal(ids.includes("transformation-simulator"), false);
    assert.equal(ids.includes("dashboard"), false);
  });

  it("paths: /materials ok; produtos/simulações/projetos/simulador/dashboard negados", () => {
    const c = ctx(SUPPLIES_MI_SLICE);
    assert.equal(canAccessPath("/materials", c), true);
    assert.equal(canAccessPath("/materials/market-intelligence", c), true);
    assert.equal(canViewModule("materials", c), true);
    assert.equal(canViewModule("products", c), false);
    assert.equal(canViewModule("simulations", c), false);
    assert.equal(canViewModule("projects", c), false);
    assert.equal(canViewModule("transformation-simulator", c), false);
    assert.equal(canViewModule("dashboard", c), false);
    assert.equal(canAccessPath("/products", c), false);
    assert.equal(canAccessPath("/simulations", c), false);
    assert.equal(canAccessPath("/projects", c), false);
    assert.equal(canAccessPath("/transformation-simulator", c), false);
    assert.equal(canAccessPath("/dashboard", c), false);
  });

  it("abas Suprimentos: Matérias-primas + Inteligência; sem gaps", () => {
    const c = ctx(SUPPLIES_MI_SLICE);
    const tabs = resolveAuthorizedTabs(MATERIALS_UI_SECTIONS, c, {
      requestedId: "marketIntelligence",
    });
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id),
      ["catalog", "marketIntelligence"]
    );
    assert.equal(tabs.requestedDenied, false);
    assert.equal(tabs.isEmpty, false);
  });

  it("aba catálogo sem MI home → só Matérias-primas", () => {
    const c = ctx([ENGINEERING_RESOURCE_KEYS.materials]);
    const tabs = resolveAuthorizedTabs(MATERIALS_UI_SECTIONS, c);
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id),
      ["catalog"]
    );
  });

  it("CRUD: view materials ≠ update; quotes update/approve separados", () => {
    const viewOnly = ctx(SUPPLIES_MI_SLICE);
    assert.equal(
      canPerformAction(ENGINEERING_RESOURCE_KEYS.materials, "update", viewOnly),
      false
    );
    assert.equal(
      canEditMaterials({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "update", viewOnly),
      }),
      false
    );

    const withCrud = ctx(SUPPLIES_MI_SLICE, {
      [ENGINEERING_RESOURCE_KEYS.materials]: ["view", "update"],
      [ENGINEERING_RESOURCE_KEYS.marketIntelligenceQuotes]: [
        "view",
        "update",
        "approve",
      ],
    });
    const can = (rk: string, a: string) =>
      canPerformAction(rk, a as "update", withCrud);
    assert.equal(
      canEditMaterials({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      true
    );
    assert.equal(
      canEditMarketQuotes({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      true
    );
    assert.equal(
      canApproveMarketQuote({
        hasPermission: () => false,
        hasAnyPermission: () => false,
        canPerformAction: can,
      }),
      true
    );
  });

  it("API: products/simulations/projects negados; materials/MI leaf ok", () => {
    const bag = [
      "materials.view",
      "materials.market_intelligence.home.view",
      "materials.market_intelligence.material_360.view",
      "materials.market_intelligence.quotes.view",
    ];
    const a = authBag(bag);
    assert.equal(
      authorizeRequireResource(a, ENGINEERING_RESOURCE_KEYS.products, "view", {
        legacyCompatMode: true,
      }).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(a, ENGINEERING_RESOURCE_KEYS.simulations, "view", {
        legacyCompatMode: true,
      }).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(a, ENGINEERING_RESOURCE_KEYS.projects, "view", {
        legacyCompatMode: true,
      }).ok,
      false
    );
    assert.equal(
      authorizeRequireResource(a, ENGINEERING_RESOURCE_KEYS.materials, "view", {
        legacyCompatMode: true,
      }).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(
        a,
        ENGINEERING_RESOURCE_KEYS.marketIntelligenceHome,
        "view",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("Dashboard com grant dedicado; sem bleed de materials", () => {
    const dash = ctx(["dashboard"]);
    assert.equal(canAccessPath("/dashboard", dash), true);
    assert.equal(canViewModule("materials", dash), false);

    const materialsOnly = ctx(SUPPLIES_MI_SLICE);
    assert.equal(canAccessPath("/dashboard", materialsOnly), false);
  });

  it("SUPER_ADMIN vê Dashboard + Engenharia completa", () => {
    const dto = effectiveAccessDtoFromAllowedResources([], {
      isSuperAdmin: true,
      role: "SUPER_ADMIN",
    });
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("dashboard"));
    assert.ok(ids.includes("products"));
    assert.ok(ids.includes("materials"));
    assert.ok(ids.includes("simulations"));
    assert.ok(ids.includes("projects"));
    assert.ok(ids.includes("transformation-simulator"));
  });
});

describe("PERM-40 — wiring FE/BE", () => {
  it("catálogo de ações inclui materials + MI quotes + simulations", () => {
    const ids = ACTION_PERMISSION_SURFACES.map((s) => s.id);
    assert.ok(ids.includes("materials"));
    assert.ok(ids.includes("materials-mi-quotes"));
    assert.ok(ids.includes("simulations"));
    assert.ok(ids.includes("products"));
  });

  it("MaterialsModule usa canViewModule DTO; sem canAccessModule bag", () => {
    const mod = read("src/components/MaterialsModule.tsx");
    assert.match(mod, /canViewModule\("materials"\)/);
    assert.doesNotMatch(mod, /canAccessModule\("materials"/);
  });

  it("MaterialModule / MI detail / quotes usam canPerformAction", () => {
    assert.match(read("src/components/MaterialModule.tsx"), /canPerformAction/);
    assert.match(
      read("src/components/materials/MaterialsMarketIntelligenceDetailPage.tsx"),
      /canEditMarketQuotes/
    );
    assert.match(
      read("src/components/materials/MaterialIntelligenceRecentQuotesSection.tsx"),
      /canEditMarketQuotes|canApproveMarketQuote/
    );
  });

  it("rotas satélite MI usam requireResource (não bag materials.view)", () => {
    for (const file of [
      "src/lib/brentCommodityRoutes.ts",
      "src/lib/ptaxSnapshotRoutes.ts",
      "src/lib/materialMarketIntelligenceExportRoutes.ts",
      "src/lib/materialMarketAuditRoutes.ts",
      "src/lib/materialMarketQuoteAttachmentRoutes.ts",
      "src/lib/materialMarketQuoteGovernanceRoutes.ts",
      "src/lib/marketGlobalIndicatorsRoutes.ts",
    ]) {
      const src = read(file);
      assert.match(src, /requireResource/);
      assert.doesNotMatch(src, /requirePermission\("materials\.(view|edit)"\)/);
    }
  });

  it("server.ts: detail/quotes MI em folhas oficiais", () => {
    const server = read("server.ts");
    const detailIdx = server.indexOf(
      '"/api/materials/market-intelligence/:materialId"'
    );
    assert.ok(detailIdx > 0);
    const detailBlock = server.slice(detailIdx, detailIdx + 280);
    assert.match(
      detailBlock,
      /requireResource\("engineering\.materials\.market_intelligence\.material_360", "view"\)/
    );

    const quotesIdx = server.indexOf(
      '"/api/materials/market-intelligence/:materialId/quotes"'
    );
    assert.ok(quotesIdx > 0);
    const quotesBlock = server.slice(quotesIdx, quotesIdx + 280);
    assert.match(
      quotesBlock,
      /requireResource\("engineering\.materials\.market_intelligence\.quotes", "view"\)/
    );
  });
});
