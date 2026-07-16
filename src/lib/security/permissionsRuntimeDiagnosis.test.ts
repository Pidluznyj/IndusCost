/**
 * P09 — diagnóstico Leticia / Contas a Pagar (comportamento desejado pós-hotfix).
 * Guardrails: reintroduzir bleed AP→Conciliação ou costs→RH deve falhar estes testes.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import { getEffectivePermissions } from "@/src/lib/appAuth.js";
import {
  ResourceKeys,
  canAccessResourceClient,
  createPermissionsApi,
  createSidebarCanViewResource,
} from "@/src/lib/permissionsClient.js";
import {
  canAccessPath,
  canViewModule,
  evaluatePathViewAccess,
} from "@/src/lib/resourceNavigationAccess.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { buildEffectiveFlagsMap } from "@/src/lib/security/permissionRolePresets.js";
import { materializeLegacyPermissionsFromFlags } from "@/src/lib/security/permissionRolePresets.js";
import { EMPLOYEES_VIEW_PERMISSIONS } from "@/src/lib/employeesPermissions.js";
import {
  assertNoResidualP09Bleeds,
  runMegaKeyMigrationDryRun,
} from "@/src/lib/security/permissionMegaKeyMigration.js";

function authUser(partial: {
  role?: AuthUser["role"];
  permissions?: string[];
  id?: string;
}): AuthUser {
  const role = partial.role ?? "VIEWER";
  const permissions = partial.permissions ?? [];
  return {
    id: partial.id ?? "diag-user",
    name: "Leticia Diagnostico",
    email: "leticia.diag@example.com",
    role,
    permissions,
    effectivePermissions: getEffectivePermissions({ role, permissions }),
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

function checkerFromUser(user: AuthUser): PermissionChecker {
  const set = new Set(user.effectivePermissions);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
    authUser: { effectivePermissions: user.effectivePermissions },
  };
}

function navCtx(user: AuthUser) {
  return { user, checker: checkerFromUser(user) };
}

describe("P09 Leticia — Contas a Pagar only (comportamento desejado)", () => {
  const onlyAp = authUser({
    role: "VIEWER",
    permissions: ["finance.accountsPayable.view"],
  });

  it("getEffectivePermissions NÃO amplia VIEWER — só filtra a bag", () => {
    const eff = getEffectivePermissions({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view"],
    });
    assert.deepEqual(eff, ["finance.accountsPayable.view"]);
  });

  it("AP 1:1 abre Contas a Pagar; MENU Financeiro (sidebar) NÃO eleva só por filho", () => {
    assert.equal(
      canAccessResourceClient(onlyAp, ResourceKeys.FINANCEIRO_CONTAS_PAGAR, "view"),
      true
    );
    const sidebarView = createSidebarCanViewResource(onlyAp);
    assert.equal(
      sidebarView(ResourceKeys.FINANCEIRO),
      false,
      "MENU Financeiro não deve abrir só porque AP existe (sem alias amplo)"
    );
  });

  it("AP NÃO libera Conciliação de Carteira", () => {
    assert.equal(
      canAccessResourceClient(onlyAp, ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA, "view"),
      false
    );
    assert.equal(canViewModule("portfolio-reconciliation", navCtx(onlyAp)), false);
    assert.equal(
      canAccessPath("/finance/portfolio-reconciliation", navCtx(onlyAp)),
      false
    );
    assert.equal(createPermissionsApi(onlyAp).canViewPortfolioModule(), false);
  });

  it("AP abre shell /finance (filho 1:1) sem abrir Conciliação", () => {
    assert.equal(canViewModule("finance", navCtx(onlyAp)), true);
    assert.equal(canAccessPath("/finance", navCtx(onlyAp)), true);
    assert.equal(canViewModule("portfolio-reconciliation", navCtx(onlyAp)), false);
  });

  it("bag só AP NÃO abre Pessoas/RH nem Máquinas", () => {
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.ADMIN_PESSOAS, "view"), false);
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.OPERACOES_MAQUINAS, "view"), false);
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.ENGENHARIA, "view"), false);
  });

  it("costs.view NÃO abre RH/Máquinas; ausência não é compensada", () => {
    const withCosts = authUser({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view", "costs.view"],
    });
    assert.equal(canAccessResourceClient(withCosts, ResourceKeys.ADMIN_PESSOAS, "view"), false);
    assert.equal(canAccessResourceClient(withCosts, ResourceKeys.OPERACOES_MAQUINAS, "view"), false);
    assert.equal(canViewModule("employees", navCtx(withCosts)), false);
    assert.equal(canViewModule("machines", navCtx(withCosts)), false);
    assert.equal(canAccessPath("/employees", navCtx(withCosts)), false);
    assert.equal(canAccessPath("/machines", navCtx(withCosts)), false);
    assert.equal(EMPLOYEES_VIEW_PERMISSIONS.includes("costs.view" as never), false);
  });

  it("costs.view ainda abre Custos Indiretos (camada legado opex)", () => {
    const withCosts = authUser({ role: "VIEWER", permissions: ["costs.view"] });
    assert.equal(canAccessModule("opex", checkerFromUser(withCosts)), true);
    assert.equal(
      canAccessResourceClient(withCosts, ResourceKeys.FINANCE_OPEX, "view"),
      true
    );
  });

  it("products.view ainda abre Engenharia (não é hotfix P09)", () => {
    const withProducts = authUser({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view", "products.view"],
    });
    assert.equal(canAccessResourceClient(withProducts, ResourceKeys.ENGENHARIA_PRODUTOS, "view"), true);
    assert.equal(canViewModule("products", navCtx(withProducts)), true);
  });

  it("P07: bag vazia + VIEWER NÃO libera Engenharia", () => {
    const empty = authUser({ role: "VIEWER", permissions: [] });
    assert.equal(canAccessResourceClient(empty, ResourceKeys.ENGENHARIA, "view"), false);
    assert.equal(canViewModule("products", navCtx(empty)), false);
  });

  it("dry-run migração sem residual bleed AP/costs cross-module", () => {
    const report = runMegaKeyMigrationDryRun();
    assert.equal(report.residualBleeds.length, 0, JSON.stringify(report.residualBleeds));
    assertNoResidualP09Bleeds(report);
  });

  it("dual-write — mega-keys mapeadas caem; unmapped preserva; baseline VIEWER", () => {
    const effective = buildEffectiveFlagsMap("VIEWER", [
      {
        resourceKey: "financeiro.contas_pagar",
        canView: true,
        canExecute: null,
        canManage: null,
        userId: "diag",
      },
    ]);
    const bag = materializeLegacyPermissionsFromFlags(effective, [
      "costs.view",
      "products.view",
      "pricing.view",
      "reports.material_demand.view",
      "finance.accountsPayable.view",
    ]);
    assert.equal(bag.includes("costs.view"), false);
    assert.equal(bag.includes("products.view"), false);
    assert.equal(bag.includes("pricing.view"), false, "P08: pricing.view mapeia commercial.pricing");
    assert.ok(
      bag.includes("reports.material_demand.view"),
      "preserve no_structural_alias"
    );
    assert.ok(bag.includes("finance.accountsPayable.view"));
    assert.equal(bag.includes("crm.view"), false, "1:1 não emite crm.view do âncora comercial");
    assert.ok(bag.includes("sales_orders.view"), "baseline VIEWER pedidos");
    assert.ok(bag.includes("dashboard.view"), "baseline VIEWER dashboard");
  });

  it("path /employees protegido por resource quando bag limpa", () => {
    const d = evaluatePathViewAccess("/employees", navCtx(onlyAp));
    assert.equal(d.allowed, false);
    assert.equal(d.source, "resource");
  });

  it("createPermissionsApi.canView: AP não abre Conciliação", () => {
    const api = createPermissionsApi(onlyAp);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO_CONTAS_PAGAR), true);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA), false);
  });
});
