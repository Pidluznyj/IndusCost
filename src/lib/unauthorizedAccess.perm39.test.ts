/**
 * PERM-39 — rota/aba negada, nenhuma rota, SUPER_ADMIN, sem redirect silencioso.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import type { NavigationAccessContext } from "@/src/lib/resourceNavigationAccess.js";
import { getSafeFirstAllowedPath } from "@/src/lib/resourceNavigationAccess.js";
import {
  NO_ACCESS_PAGE_DESCRIPTION,
  NO_ACCESS_PAGE_TITLE,
  UNAUTHORIZED_ACCESS_MESSAGE,
  resolveDeniedTabAccessOutcome,
  resolveUnauthorizedAccessOutcome,
} from "@/src/lib/unauthorizedAccess.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function user(role: AuthUser["role"] = "VIEWER"): AuthUser {
  return {
    id: "u-perm39",
    name: "P39",
    email: "p39@example.com",
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

function dto(allowed: string[], isSuperAdmin = false): EffectiveAccessMeDto {
  const actionsByResource: EffectiveAccessMeDto["actionsByResource"] = {};
  const capabilities: EffectiveAccessMeDto["capabilities"] = {};
  for (const k of allowed) {
    actionsByResource[k] = ["view"];
    capabilities[k] = { canView: true, canExecute: false, canManage: false };
  }
  return {
    permissionsVersion: 1,
    role: isSuperAdmin ? "SUPER_ADMIN" : "VIEWER",
    isSuperAdmin,
    allowedResources: allowed,
    actionsByResource,
    navigationReveal: [...allowed],
    capabilities,
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: false,
      legacyPermissionsPresent: false,
      legacyCompatApplied: false,
    },
  };
}

function ctx(
  allowed: string[],
  opts?: { isSuperAdmin?: boolean; authLoading?: boolean }
): NavigationAccessContext {
  const isSuperAdmin = opts?.isSuperAdmin === true;
  return {
    user: user(isSuperAdmin ? "SUPER_ADMIN" : "VIEWER"),
    checker: {
      hasPermission: () => false,
      hasAnyPermission: () => false,
      authUser: null,
    },
    effectiveAccess: dto(allowed, isSuperAdmin),
    authLoading: opts?.authLoading === true,
    authError: null,
  };
}

describe("PERM-39 — resolveUnauthorizedAccessOutcome", () => {
  it("rota negada → modal + fallback = primeira rota do catálogo", () => {
    const c = ctx(["dashboard", "commercial.crm"]);
    const outcome = resolveUnauthorizedAccessOutcome({
      ctx: c,
      pathname: "/finance",
    });
    assert.equal(outcome.kind, "show_modal");
    if (outcome.kind !== "show_modal") return;
    assert.equal(outcome.fallbackPath, getSafeFirstAllowedPath(c));
    assert.equal(outcome.fallbackPath, "/dashboard");
  });

  it("aba negada (forceDenied) → modal mesmo com módulo permitido", () => {
    const c = ctx([
      "dashboard",
      "finance",
      "finance.accounts_payable",
    ]);
    const outcome = resolveDeniedTabAccessOutcome(c, {
      requestedDenied: true,
      isEmpty: false,
      pathname: "/finance/cash-flow",
    });
    assert.equal(outcome.kind, "show_modal");
    if (outcome.kind !== "show_modal") return;
    assert.equal(outcome.fallbackPath, "/dashboard");
  });

  it("nenhuma rota permitida → no_access (sem loop)", () => {
    const c = ctx([]);
    const outcome = resolveUnauthorizedAccessOutcome({
      ctx: c,
      pathname: "/finance",
    });
    assert.equal(outcome.kind, "no_access");
    assert.equal(getSafeFirstAllowedPath(c), null);
  });

  it("SUPER_ADMIN em rota mapeada → allowed", () => {
    const c = ctx([], { isSuperAdmin: true });
    const outcome = resolveUnauthorizedAccessOutcome({
      ctx: c,
      pathname: "/finance",
    });
    assert.equal(outcome.kind, "allowed");
    assert.equal(getSafeFirstAllowedPath(c), "/dashboard");
  });

  it("path permitido → allowed (sem modal)", () => {
    const c = ctx(["dashboard", "finance", "finance.accounts_payable"]);
    const outcome = resolveUnauthorizedAccessOutcome({
      ctx: c,
      pathname: "/finance",
    });
    assert.equal(outcome.kind, "allowed");
  });

  it("authLoading → pending", () => {
    const c = ctx(["dashboard"], { authLoading: true });
    assert.equal(
      resolveUnauthorizedAccessOutcome({ ctx: c, pathname: "/finance" }).kind,
      "pending"
    );
  });
});

describe("PERM-39 — mensagens e wiring de UI", () => {
  it("constantes de cópia canônicas", () => {
    assert.equal(
      UNAUTHORIZED_ACCESS_MESSAGE,
      "Você não tem acesso a este conteúdo."
    );
    assert.equal(NO_ACCESS_PAGE_TITLE, "Nenhum acesso liberado");
    assert.match(NO_ACCESS_PAGE_DESCRIPTION, /administrador/i);
  });

  it("UnauthorizedAccessGate: modal, OK, sem dismiss silencioso", () => {
    const gate = read("src/components/UnauthorizedAccessGate.tsx");
    assert.match(gate, /UNAUTHORIZED_ACCESS_MESSAGE/);
    assert.match(gate, /unauthorized-access-ok/);
    assert.match(gate, /dismissOnBackdrop=\{false\}/);
    assert.match(gate, /dismissOnEsc=\{false\}/);
    assert.match(gate, /setAcknowledged\(true\)/);
    assert.match(gate, /Navigate/);
    assert.match(gate, /NoPermissionsGranted/);
  });

  it("AccessDenied e Layout/RequirePathViewAccess usam o gate", () => {
    assert.match(read("src/components/AccessDenied.tsx"), /UnauthorizedAccessGate/);
    assert.match(read("src/components/layout/Layout.tsx"), /AccessDenied/);
    assert.match(
      read("src/components/RequirePathViewAccess.tsx"),
      /AccessDenied/
    );
  });

  it("FinanceModule: aba/seção negada sem Navigate silencioso", () => {
    const mod = read("src/components/FinanceModule.tsx");
    assert.match(mod, /UnauthorizedAccessGate/);
    assert.match(mod, /forceDenied/);
    assert.doesNotMatch(
      mod,
      /onDeniedSection[\s\S]{0,120}Navigate to=\{defaultPath\}/
    );
  });

  it("CommissionsModule / MaterialsModule / ProtectedTab: modal em vez de Navigate silencioso", () => {
    const commissions = read("src/components/CommissionsModule.tsx");
    assert.match(commissions, /UnauthorizedAccessGate/);
    assert.doesNotMatch(
      commissions,
      /!allowedIds\.has\(currentSection\)[\s\S]{0,80}Navigate to=\{defaultPath\}/
    );

    const materials = read("src/components/MaterialsModule.tsx");
    assert.match(materials, /UnauthorizedAccessGate/);

    const tab = read("src/components/security/ProtectedTab.tsx");
    assert.match(tab, /UnauthorizedAccessGate/);
    assert.doesNotMatch(tab, /PermissionDenied/);
  });

  it("NoPermissionsGranted é página neutra sem Link/Navigate", () => {
    const page = read("src/components/NoPermissionsGranted.tsx");
    assert.match(page, /no-permissions-granted/);
    assert.match(page, /NO_ACCESS_PAGE_TITLE/);
    assert.doesNotMatch(page, /from ["']react-router/);
    assert.doesNotMatch(page, /<Navigate\b|<Link\b/);
  });
});
