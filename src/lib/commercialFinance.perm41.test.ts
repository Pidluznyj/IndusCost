/**
 * PERM-41 — árvore oficial Comercial + Financeiro.
 *
 * Cenários:
 * - Comercial totalmente negado (menu + rotas)
 * - Financeiro parcial: AP + Centros de Custo + Fornecedores (CRUD configurável)
 * - Sem misturar page access com escopo de dados
 * - Regras oficiais de AP por dueDate preservadas
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { FINANCE_UI_SECTIONS } from "@/src/lib/internalSurfaceAccess.js";
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
  canManageFinanceSuppliers,
  canViewFinanceCostCenters,
  canViewFinanceSuppliers,
} from "@/src/lib/financeCostCentersPermissions.js";
import { canViewFinanceAccountsPayable } from "@/src/lib/financeAccountsPayablePermissions.js";
import { FINANCE_AP_DUE_DATE_AXIS_NOTE } from "@/src/lib/financeAccountsPayableAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import { ACTION_PERMISSION_SURFACES } from "@/src/lib/actionPermissionCatalog.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function user(role: AuthUser["role"] = "VIEWER"): AuthUser {
  return {
    id: "u-perm41",
    name: "P41",
    email: "p41@example.com",
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

/** Persona Financeiro parcial (sem Comercial). */
const FINANCE_PARTIAL_SLICE = [
  "finance.accounts_payable",
  FINANCE_MODULE_RESOURCE_KEYS.costCenters,
  FINANCE_MODULE_RESOURCE_KEYS.suppliers,
] as const;

const COMMERCIAL_MODULES = [
  "pricing",
  "proposals",
  "sales-orders",
  "customers",
  "crm-commercial",
  "commissions",
] as const;

const COMMERCIAL_PATHS = [
  "/pricing",
  "/proposals",
  "/sales-orders",
  "/customers",
  "/crm",
  "/commissions",
] as const;

const DENIED_FINANCE_KEYS = [
  "finance.cash_flow",
  "finance.accounts_receivable",
  "finance.billing",
  "finance.sales_orders",
  "finance.executive_report",
  "finance.portfolio_reconciliation",
  "finance.opex",
  "finance.taxes",
  "finance.reports",
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

function ctx(
  keys: readonly string[],
  actions?: EffectiveAccessMeDto["actionsByResource"]
): NavigationAccessContext {
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
    id: "u-perm41",
    name: "P41",
    email: "p41@example.com",
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
    sessionId: "s-perm41",
  };
}

describe("PERM-41 — Comercial totalmente negado", () => {
  it("sidebar: sem grupo Comercial; sem itens pricing/proposals/clientes/CRM/comissões", () => {
    const dto = effectiveAccessDtoFromAllowedResources([...FINANCE_PARTIAL_SLICE]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.equal(
      nav.groups.find((g) => g.id === "comercial"),
      undefined,
      "grupo Comercial não deve aparecer"
    );
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    for (const id of COMMERCIAL_MODULES) {
      assert.equal(ids.includes(id), false, `item ${id} oculto`);
    }
  });

  it("paths comerciais negados; canViewModule comercial false", () => {
    const c = ctx(FINANCE_PARTIAL_SLICE);
    for (const mod of COMMERCIAL_MODULES) {
      assert.equal(canViewModule(mod, c), false, `module ${mod}`);
    }
    for (const path of COMMERCIAL_PATHS) {
      assert.equal(canAccessPath(path, c), false, `path ${path}`);
    }
  });

  it("API: commercial.* view negado (perfil sem ROLE_MATRIX comercial)", () => {
    const a = authBag([
      "finance.accountsPayable.view",
      "finance.cost_centers.view",
      "finance.suppliers.view",
    ]);
    // profileSnapshot=null: baseline vazio — só bag legada 1:1 (sem preset VIEWER).
    const opts = { legacyCompatMode: true as const, profileSnapshot: null };
    for (const key of [
      "commercial.pricing",
      "commercial.proposals",
      "commercial.sales_orders",
      "commercial.customers",
      "commercial.crm",
      "commercial.commissions",
    ]) {
      assert.equal(
        authorizeRequireResource(a, key, "view", opts).ok,
        false,
        key
      );
    }
  });
});

describe("PERM-41 — Financeiro parcial (AP + CC + Fornecedores)", () => {
  it("sidebar: Financeiro + Fornecedores; sem opex/taxes/reports/portfolio/comercial", () => {
    const dto = effectiveAccessDtoFromAllowedResources([...FINANCE_PARTIAL_SLICE]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const fin = nav.groups.find((g) => g.id === "financeiro");
    assert.ok(fin, "grupo Financeiro via filho");
    const ids = nav.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("finance"));
    assert.ok(ids.includes("suppliers"));
    assert.equal(ids.includes("opex"), false);
    assert.equal(ids.includes("taxes"), false);
    assert.equal(ids.includes("reports"), false);
    assert.equal(ids.includes("portfolio-reconciliation"), false);
  });

  it("paths: módulo finance + suppliers ok; portfolio/comercial negados (seções via abas)", () => {
    const c = ctx(FINANCE_PARTIAL_SLICE);
    assert.equal(canViewModule("finance", c), true);
    assert.equal(canViewModule("suppliers", c), true);
    assert.equal(canAccessPath("/finance", c), true);
    assert.equal(canAccessPath("/finance/accounts-payable", c), true);
    assert.equal(canAccessPath("/finance/cost-centers", c), true);
    // Menu Fornecedores: /finance/suppliers (standalone) ou alias /suppliers conforme mapa.
    assert.equal(
      canAccessPath("/finance/suppliers", c) || canAccessPath("/suppliers", c),
      true
    );
    // Shell /finance/* resolve ao módulo finance (abas/API negam seções irmãs).
    assert.equal(canAccessPath("/portfolio-reconciliation", c), false);
    assert.equal(canViewModule("pricing", c), false);
    assert.equal(canViewModule("sales-orders", c), false);
  });

  it("abas Financeiro: só Contas a Pagar + Centros de Custo", () => {
    const c = ctx(FINANCE_PARTIAL_SLICE);
    const tabs = resolveAuthorizedTabs(FINANCE_UI_SECTIONS, c, {
      requestedId: "billing",
    });
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id).sort(),
      ["accounts-payable", "cost-centers"].sort()
    );
    assert.equal(tabs.requestedDenied, true);
    assert.equal(tabs.isEmpty, false);
  });

  it("Fornecedores liberável sem Centros de Custo; CC sem Fornecedores", () => {
    const suppliersOnly = ctx([FINANCE_MODULE_RESOURCE_KEYS.suppliers]);
    assert.equal(canViewModule("suppliers", suppliersOnly), true);
    assert.equal(canViewModule("finance", suppliersOnly), false);
    assert.equal(
      canViewFinanceCostCenters({
        hasPermission: () => false,
        canPerformAction: (rk, a) =>
          canPerformAction(rk, a as "view", suppliersOnly),
      }),
      false
    );
    assert.equal(
      canViewFinanceSuppliers({
        hasPermission: () => false,
        canPerformAction: (rk, a) =>
          canPerformAction(rk, a as "view", suppliersOnly),
      }),
      true
    );

    const ccOnly = ctx([FINANCE_MODULE_RESOURCE_KEYS.costCenters]);
    assert.equal(canViewModule("finance", ccOnly), true);
    assert.equal(canViewModule("suppliers", ccOnly), false);
    assert.equal(
      canViewFinanceSuppliers({
        hasPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "view", ccOnly),
      }),
      false
    );
  });

  it("CRUD Fornecedores: view ≠ manage", () => {
    const viewOnly = ctx(FINANCE_PARTIAL_SLICE);
    const viewCheck = {
      hasPermission: () => false,
      canPerformAction: (rk: string, a: string) =>
        canPerformAction(rk, a as "view", viewOnly),
    };
    assert.equal(canViewFinanceSuppliers(viewCheck), true);
    assert.equal(canManageFinanceSuppliers(viewCheck), false);

    const withManage = ctx(FINANCE_PARTIAL_SLICE, {
      [FINANCE_MODULE_RESOURCE_KEYS.suppliers]: ["view", "manage"],
    });
    const manageCheck = {
      hasPermission: () => false,
      canPerformAction: (rk: string, a: string) =>
        canPerformAction(rk, a as "manage", withManage),
    };
    assert.equal(canManageFinanceSuppliers(manageCheck), true);
  });

  it("AP view dedicado; sem bleed para irmãos financeiros", () => {
    const c = ctx(["finance.accounts_payable"]);
    assert.equal(
      canViewFinanceAccountsPayable({
        hasPermission: () => false,
        canPerformAction: (rk, a) => canPerformAction(rk, a as "view", c),
      }),
      true
    );
    const tabs = resolveAuthorizedTabs(FINANCE_UI_SECTIONS, c);
    assert.deepEqual(
      tabs.visibleTabs.map((t) => t.id),
      ["accounts-payable"]
    );
    for (const key of DENIED_FINANCE_KEYS) {
      assert.equal(
        authorizeRequireResource(
          authBag(["finance.accountsPayable.view"]),
          key,
          "view",
          { legacyCompatMode: true }
        ).ok,
        false,
        key
      );
    }
  });

  it("API: AP/CC/suppliers view ok; manage suppliers view-only → 403", () => {
    const a = authBag([
      "finance.accountsPayable.view",
      "finance.cost_centers.view",
      "finance.suppliers.view",
    ]);
    assert.equal(
      authorizeRequireResource(a, "finance.accounts_payable", "view", {
        legacyCompatMode: true,
      }).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, FINANCE_MODULE_RESOURCE_KEYS.costCenters, "view", {
        legacyCompatMode: true,
      }).ok,
      true
    );
    assert.equal(
      authorizeRequireResource(a, FINANCE_MODULE_RESOURCE_KEYS.suppliers, "view", {
        legacyCompatMode: true,
      }).ok,
      true
    );
    const deniedManage = authorizeRequireResource(
      a,
      FINANCE_MODULE_RESOURCE_KEYS.suppliers,
      "manage",
      { legacyCompatMode: true }
    );
    assert.equal(deniedManage.ok, false);
    if (!deniedManage.ok) assert.equal(deniedManage.status, 403);

    const withManage = authBag([
      "finance.suppliers.view",
      "finance.suppliers.manage",
    ]);
    assert.equal(
      authorizeRequireResource(
        withManage,
        FINANCE_MODULE_RESOURCE_KEYS.suppliers,
        "manage",
        { legacyCompatMode: true }
      ).ok,
      true
    );
  });

  it("eixo oficial AP por dueDate preservado", () => {
    assert.match(FINANCE_AP_DUE_DATE_AXIS_NOTE, /dueDate/);
    assert.match(
      read("src/lib/financeAccountsPayableAccess.ts"),
      /FINANCE_AP_DUE_DATE_AXIS_NOTE/
    );
    assert.match(
      read("src/lib/financeAccountsPayablePermissions.ts"),
      /regras de vencimento intactas|PERM-41/
    );
  });
});

describe("PERM-41 — wiring FE/BE", () => {
  it("catálogo inclui finance-suppliers", () => {
    const ids = ACTION_PERMISSION_SURFACES.map((s) => s.id);
    assert.ok(ids.includes("finance-suppliers"));
  });

  it("FinanceSuppliersPage não chama dashboard de Centros de Custo", () => {
    const src = read("src/components/finance/FinanceSuppliersPage.tsx");
    assert.doesNotMatch(src, /cost-centers\/dashboard/);
    assert.match(src, /canPerformAction/);
    assert.match(src, /dashboard=\{null\}/);
  });

  it("SuppliersManagementView: finance-menu não busca supplier-cost-center-rules", () => {
    const src = read(
      "src/components/finance/cost-centers/SuppliersManagementView.tsx"
    );
    assert.match(src, /needsCostCenterRules/);
    assert.match(src, /context === "cost-center-tab"/);
  });

  it("FinanceCostCentersPage usa canPerformAction (DTO-first)", () => {
    const src = read(
      "src/components/finance/cost-centers/FinanceCostCentersPage.tsx"
    );
    assert.match(src, /usePermissions/);
    assert.match(src, /canPerformAction/);
  });

  it("helpers: canViewFinanceSuppliers sem OR de cost_centers/finance.view", () => {
    const src = read("src/lib/financeCostCentersPermissions.ts");
    const fn = src.slice(src.indexOf("export function canViewFinanceSuppliers"));
    const body = fn.slice(0, fn.indexOf("export function", 1));
    assert.doesNotMatch(body, /cost_centers\.view/);
    assert.doesNotMatch(body, /finance\.view/);
    assert.match(body, /finance\.suppliers\.view/);
  });

  it("FinanceModule usa FINANCE_UI_SECTIONS + useAuthorizedTabs", () => {
    const mod = read("src/components/FinanceModule.tsx");
    assert.match(mod, /FINANCE_UI_SECTIONS/);
    assert.match(mod, /useAuthorizedTabs/);
  });
});
