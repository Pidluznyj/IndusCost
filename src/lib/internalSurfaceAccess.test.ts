/**
 * P12 — seções/abas internas via DTO (Leticia e módulo parcial).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import {
  canViewInternalSurfaceFromDto,
  FINANCE_UI_SECTIONS,
  INTERNAL_SURFACE_INHERITANCE,
  projectInternalContractKeysFromLegacyBag,
} from "@/src/lib/internalSurfaceAccess.js";
import {
  canViewTabResource,
  filterTabsByViewDto,
  listVisibleFinanceSections,
  pickAllowedTabId,
  resolveActiveTabFromRequest,
  type NavigationAccessContext,
} from "@/src/lib/resourceNavigationAccess.js";
import { resolveSidebarEffectiveAccessDto } from "@/src/lib/sidebarEffectiveAccess.js";
import { ResourceKeys } from "@/src/lib/permissionsClient.js";
import { CRM_UI_TABS, PRODUCT_UI_TABS } from "@/src/lib/moduleTabResources.js";
import { PORTFOLIO_RECONCILIATION_UI_TABS } from "@/src/lib/permissionsClient.js";

function user(role: AuthUser["role"], permissions: string[]): AuthUser {
  return {
    id: "p12",
    name: "P12",
    email: "p12@example.com",
    role,
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

function ctx(permissions: string[]): NavigationAccessContext {
  const u = user("VIEWER", permissions);
  return {
    user: u,
    checker: {
      hasPermission: (p) => permissions.includes(p),
      hasAnyPermission: (list) => list.some((p) => permissions.includes(p)),
      authUser: { effectivePermissions: permissions },
    },
  };
}

describe("internalSurfaceAccess — heranças documentadas", () => {
  it("lista heranças explícitas (Auditoria 360, CI, projetos, RH, …)", () => {
    assert.ok(INTERNAL_SURFACE_INHERITANCE.length >= 6);
    assert.ok(
      INTERNAL_SURFACE_INHERITANCE.some((h) =>
        h.surface.includes("OrderFullAuditDialog")
      )
    );
  });
});

describe("P12 — FinanceModule seções via DTO", () => {
  it("Leticia só AP: vê Contas a Pagar; não AR/billing/portfolio tabs", () => {
    const c = ctx(["finance.accountsPayable.view"]);
    const sections = listVisibleFinanceSections(c);
    assert.deepEqual(
      sections.map((s) => s.id),
      ["accounts-payable"]
    );
    assert.equal(
      canViewTabResource(ResourceKeys.FINANCEIRO_CONTAS_PAGAR, c),
      true
    );
    assert.equal(
      canViewTabResource(ResourceKeys.FINANCEIRO_CONTAS_RECEBER, c),
      false
    );
    const portfolioTabs = filterTabsByViewDto(
      PORTFOLIO_RECONCILIATION_UI_TABS,
      c,
      { parentResourceKey: ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA }
    );
    assert.deepEqual(portfolioTabs, []);
  });

  it("módulo finance amplo: seções com grant explícito", () => {
    const c = ctx([
      "finance.view",
      "finance.accountsPayable.view",
      "finance.accountsReceivable.view",
    ]);
    const ids = listVisibleFinanceSections(c).map((s) => s.id);
    assert.ok(ids.includes("accounts-payable"));
    assert.ok(ids.includes("accounts-receivable"));
    // cash-flow: finance.view é primary
    assert.ok(ids.includes("cash-flow"));
  });

  it("URL/query tab não autorizada cai na primeira permitida", () => {
    const c = ctx(["finance.accountsPayable.view"]);
    const { activeId, allowedIds } = resolveActiveTabFromRequest({
      requested: "billing" as const,
      allowedTabs: FINANCE_UI_SECTIONS.map((s) => ({
        id: s.id,
        resourceKey: s.resourceKey,
      })),
      ctx: c,
    });
    assert.deepEqual(allowedIds, ["accounts-payable"]);
    assert.equal(activeId, "accounts-payable");
    assert.equal(pickAllowedTabId("billing", allowedIds), "accounts-payable");
  });
});

describe("P12 — CRM / produto tabs via DTO", () => {
  it("seller: gestão geral negada; seller permitida se grant", () => {
    const c = ctx(["crm.seller.view", "crm.seller.own"]);
    const tabs = filterTabsByViewDto(CRM_UI_TABS, c);
    assert.equal(
      tabs.some((t) => t.id === "general"),
      false
    );
    assert.ok(tabs.some((t) => t.id === "seller"));
  });

  it("produto: cost tab só com grant de cost", () => {
    const c = ctx(["products.view", "products.tab.info"]);
    const dto = resolveSidebarEffectiveAccessDto({ user: c.user });
    assert.ok(dto);
    // info tab contract
    assert.equal(
      canViewInternalSurfaceFromDto(dto, "engineering.products.tab.info"),
      true
    );
    const tabs = filterTabsByViewDto(PRODUCT_UI_TABS, c);
    assert.ok(tabs.some((t) => t.id === "info"));
    assert.equal(
      tabs.some((t) => t.id === "cost"),
      false
    );
  });
});

describe("projectInternalContractKeysFromLegacyBag", () => {
  it("AP projeta finance.accounts_payable", () => {
    const keys = projectInternalContractKeysFromLegacyBag([
      "finance.accountsPayable.view",
    ]);
    assert.ok(keys.includes("finance.accounts_payable"));
    assert.equal(keys.includes("finance.portfolio_reconciliation"), false);
  });
});
