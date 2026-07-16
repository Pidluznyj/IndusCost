/**
 * DIAGNÓSTICO (somente leitura de comportamento atual) — Prompt permissions-runtime.
 *
 * Estes testes documentam o comportamento EFETIVO do código hoje.
 * NÃO representam o comportamento desejado pós-correção.
 * Não alteram runtime; servem como evidência reprodutível.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import { getEffectivePermissions } from "@/src/lib/appAuth.js";
import {
  ResourceKeys,
  canAccessResourceClient,
  createPermissionsApi,
} from "@/src/lib/permissionsClient.js";
import {
  canAccessPath,
  canViewModule,
  evaluatePathViewAccess,
} from "@/src/lib/resourceNavigationAccess.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";
import { canAccessModule } from "@/src/lib/modulePermissions.js";
import { overridesPayloadFromDraft } from "@/src/lib/userPermissionsAdminUi.js";
import { buildEffectiveFlagsMap } from "@/src/lib/security/permissionRolePresets.js";
import { materializeLegacyPermissionsFromFlags } from "@/src/lib/security/permissionRolePresets.js";
import { EMPLOYEES_VIEW_PERMISSIONS } from "@/src/lib/employeesPermissions.js";

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

describe("permissions-runtime-diagnosis — cenário Contas a Pagar only (comportamento atual)", () => {
  const onlyAp = authUser({
    role: "VIEWER",
    permissions: ["finance.accountsPayable.view"],
  });

  it("DIAG: getEffectivePermissions NÃO amplia VIEWER — só filtra a bag", () => {
    const eff = getEffectivePermissions({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view"],
    });
    assert.deepEqual(eff, ["finance.accountsPayable.view"]);
  });

  it("DIAG: finance.accountsPayable.view abre o MENU Financeiro (alias amplo)", () => {
    assert.equal(
      canAccessResourceClient(onlyAp, ResourceKeys.FINANCEIRO, "view"),
      true,
      "Bleed confirmado: Contas a Pagar libera o parent Financeiro"
    );
  });

  it("DIAG: finance.accountsPayable.view abre Conciliação de Carteira (alias cruzado)", () => {
    assert.equal(
      canAccessResourceClient(onlyAp, ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA, "view"),
      true,
      "Bleed confirmado: mesma chave legada em legacyAliasKeys da Conciliação"
    );
  });

  it("DIAG: bag só com Contas a Pagar NÃO abre Pessoas/RH nem Máquinas via resource API", () => {
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.ADMIN_PESSOAS, "view"), false);
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.OPERACOES_MAQUINAS, "view"), false);
    assert.equal(canAccessResourceClient(onlyAp, ResourceKeys.ENGENHARIA, "view"), false);
  });

  it("DIAG: costs.view legado abre Pessoas/RH e Máquinas na sidebar resource API", () => {
    const withCosts = authUser({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view", "costs.view"],
    });
    assert.equal(canAccessResourceClient(withCosts, ResourceKeys.ADMIN_PESSOAS, "view"), true);
    assert.equal(canAccessResourceClient(withCosts, ResourceKeys.OPERACOES_MAQUINAS, "view"), true);
    assert.equal(canViewModule("employees", navCtx(withCosts)), true);
    assert.equal(canViewModule("machines", navCtx(withCosts)), true);
    assert.equal(canAccessPath("/employees", navCtx(withCosts)), true);
    assert.equal(canAccessPath("/machines", navCtx(withCosts)), true);
  });

  it("DIAG: products.view legado abre Engenharia", () => {
    const withProducts = authUser({
      role: "VIEWER",
      permissions: ["finance.accountsPayable.view", "products.view"],
    });
    assert.equal(canAccessResourceClient(withProducts, ResourceKeys.ENGENHARIA, "view"), true);
    assert.equal(canAccessResourceClient(withProducts, ResourceKeys.ENGENHARIA_PRODUTOS, "view"), true);
    assert.equal(canViewModule("products", navCtx(withProducts)), true);
  });

  it("DIAG: costs.view abre Custos Indiretos via canAccessModule legado", () => {
    const withCosts = authUser({ role: "VIEWER", permissions: ["costs.view"] });
    assert.equal(canAccessModule("opex", checkerFromUser(withCosts)), true);
  });

  it("DIAG: API Pessoas/RH aceita costs.view como view (EMPLOYEES_VIEW_PERMISSIONS)", () => {
    assert.ok(EMPLOYEES_VIEW_PERMISSIONS.includes("costs.view"));
  });

  it("P07: bag vazia + VIEWER NÃO libera Engenharia (sem ROLE_MATRIX)", () => {
    const emptyBag = authUser({ role: "VIEWER", permissions: [] });
    assert.equal(emptyBag.effectivePermissions.length, 0);
    assert.equal(
      canAccessResourceClient(emptyBag, ResourceKeys.ENGENHARIA, "view"),
      false,
      "bag vazia ⇒ deny; sem overlay ROLE_MATRIX.VIEWER"
    );
    assert.equal(
      canAccessResourceClient(emptyBag, ResourceKeys.COMERCIAL_PEDIDOS_VENDA, "view"),
      false
    );
    assert.equal(
      canAccessResourceClient(emptyBag, ResourceKeys.DASHBOARD, "view"),
      false
    );
  });

  it("DIAG: desmarcar checkbox só gera override se diferir do baseline da role", () => {
    const payload = overridesPayloadFromDraft(
      {
        "financeiro.contas_pagar": {
          canView: true,
          canExecute: false,
          canManage: false,
        },
        comercial: { canView: false, canExecute: false, canManage: false },
      },
      [
        {
          resourceKey: "financeiro.contas_pagar",
          flags: { canView: false, canExecute: false, canManage: false },
        },
        {
          resourceKey: "comercial",
          flags: { canView: true, canExecute: false, canManage: false },
        },
      ]
    );
    const byKey = Object.fromEntries(payload.map((r) => [r.resourceKey, r]));
    assert.equal(byKey["financeiro.contas_pagar"]?.canView, true);
    assert.equal(byKey.comercial?.canView, false, "deny explícito vs baseline VIEWER comercial=V");
  });

  it("DIAG: dual-write — mega-keys mapeadas caem; unmapped preserva; baseline VIEWER sem crm.view 1:1", () => {
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
      "finance.accountsPayable.view",
    ]);
    // costs.view / products.view têm alias no seed → com flags NONE do VIEWER, dual-write NÃO as re-emite.
    assert.equal(bag.includes("costs.view"), false);
    assert.equal(bag.includes("products.view"), false);
    assert.ok(bag.includes("pricing.view"), "preserve no_structural_alias");
    assert.ok(bag.includes("finance.accountsPayable.view"));
    // P06 1:1: crm.view canônico em comercial.crm (NONE no VIEWER) — não sai do pai comercial.
    assert.equal(bag.includes("crm.view"), false, "1:1 não emite crm.view do âncora comercial");
    // Role VIEWER ainda materializa pedidos (canônico) e dashboard.
    assert.ok(bag.includes("sales_orders.view"), "baseline VIEWER pedidos");
    assert.ok(bag.includes("dashboard.view"), "baseline VIEWER dashboard");
  });

  it("DIAG: path /employees protegido por resource quando bag limpa", () => {
    const d = evaluatePathViewAccess("/employees", navCtx(onlyAp));
    assert.equal(d.allowed, false);
    assert.equal(d.source, "resource");
  });

  it("DIAG: createPermissionsApi.canView espelha bleed de Contas a Pagar", () => {
    const api = createPermissionsApi(onlyAp);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO), true);
    assert.equal(api.canView(ResourceKeys.FINANCEIRO_CONCILIACAO_CARTEIRA), true);
    assert.equal(api.canView(ResourceKeys.ADMIN_PESSOAS), false);
  });
});
