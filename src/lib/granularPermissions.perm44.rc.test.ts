/**
 * PERM-44 — smoke do release candidate do permissionamento granular.
 * Consolida critérios de aceite PERM-25…43 sem perfil de produção.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";
import {
  buildCanonicalEffectiveAccessInput,
  resolveCanonicalEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/canonicalEffectiveAccess.js";
import {
  buildAnalistaComprasDto,
  analistaComprasNavContext,
} from "@/src/lib/security/fixtures/analistaComprasPersona.js";
import {
  canAccessPath,
  canPerformAction,
  canViewModule,
} from "@/src/lib/resourceNavigationAccess.js";
import { filterOfficialSidebarByEffectiveAccess } from "@/src/lib/sidebarEffectiveAccess.js";
import { UNAUTHORIZED_ACCESS_MESSAGE } from "@/src/lib/unauthorizedAccess.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function auth(role: AppAuthContext["role"] = "VIEWER"): AppAuthContext {
  return {
    id: "u-perm44",
    name: "P44",
    email: "p44@example.com",
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
    sessionId: "s-perm44",
  };
}

describe("PERM-44 — RC catálogo FE/BE único", () => {
  it("contrato tem recursos; sidebar e requireResource leem o mesmo catálogo", () => {
    assert.ok(PERMISSION_CONTRACT_RESOURCES.length >= 80);
    const keys = new Set(PERMISSION_CONTRACT_RESOURCES.map((r) => r.resourceKey));
    assert.ok(keys.has("dashboard"));
    assert.ok(keys.has("finance.accounts_payable"));
    assert.ok(keys.has("operations.purchases"));
    assert.ok(keys.has("engineering.materials"));
    assert.ok(keys.has("admin.employees"));

    assert.match(
      read("src/lib/security/requireResource.ts"),
      /resolveCanonicalEffectiveAccess|buildRequireResourceInput/
    );
    assert.match(
      read("src/lib/resourceNavigationAccess.ts"),
      /canViewModule|canPerformAction|effectiveAccess/
    );
    assert.match(read("server.ts"), /effectiveAccess|buildEffectiveAccessDtoFromUser|\/api\/auth\/me/);
  });

  it("ALLOW / DENY / INHERIT no resolvedor canônico", () => {
    const denied = resolveCanonicalEffectiveAccess(
      buildCanonicalEffectiveAccessInput({
        userId: "u1",
        role: "VIEWER",
        profileSnapshot: { "finance.accounts_payable": { view: true } },
        overrides: { "finance.accounts_payable": { view: "deny" } },
        legacyCompatMode: false,
      })
    );
    assert.equal(
      denied.byResourceAction["finance.accounts_payable"]?.view?.decision,
      "deny"
    );

    const allowed = resolveCanonicalEffectiveAccess(
      buildCanonicalEffectiveAccessInput({
        userId: "u1",
        role: "VIEWER",
        profileSnapshot: {},
        overrides: { "finance.accounts_payable": { view: "allow" } },
        legacyCompatMode: false,
      })
    );
    assert.equal(
      allowed.byResourceAction["finance.accounts_payable"]?.view?.decision,
      "allow"
    );

    const inherit = resolveCanonicalEffectiveAccess(
      buildCanonicalEffectiveAccessInput({
        userId: "u1",
        role: "VIEWER",
        profileSnapshot: { "finance.accounts_payable": { view: true } },
        overrides: {},
        legacyCompatMode: false,
      })
    );
    assert.equal(
      inherit.byResourceAction["finance.accounts_payable"]?.view?.decision,
      "allow"
    );
    assert.equal(
      inherit.byResourceAction["finance.accounts_payable"]?.view?.source,
      "PROFILE"
    );
  });

  it("recurso desconhecido e SUPER_ADMIN", () => {
    const unknown = authorizeRequireResource(auth(), "totally.unknown.resource", "view", {
      legacyCompatMode: false,
      profileSnapshot: null,
    });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.equal(unknown.status, 403);

    const sa = auth("SUPER_ADMIN");
    assert.equal(
      authorizeRequireResource(sa, "finance.accounts_payable", "view", {
        legacyCompatMode: false,
        profileSnapshot: null,
      }).ok,
      true
    );
  });

  it("Analista de Compras fixture + modal message", () => {
    const c = analistaComprasNavContext();
    assert.equal(canViewModule("purchases", c), true);
    assert.equal(canViewModule("pricing", c), false);
    assert.equal(canAccessPath("/purchases", c), true);
    assert.equal(
      canPerformAction(
        "finance.suppliers",
        "manage",
        c
      ),
      true
    );
    const nav = filterOfficialSidebarByEffectiveAccess(buildAnalistaComprasDto());
    assert.equal(nav.groups.find((g) => g.id === "comercial"), undefined);
    assert.match(UNAUTHORIZED_ACCESS_MESSAGE, /não tem acesso/i);
  });

  it("permissionsVersion + bag temporária documentados no código", () => {
    assert.match(read("src/lib/permissionsVersion.ts"), /bumpPermissionsVersion/);
    assert.match(read("src/contexts/AuthContext.tsx"), /pollPermissionsVersion/);
    assert.match(
      read("src/lib/security/requireResource.ts"),
      /legacyCompatMode|REQUIRE_RESOURCE_LEGACY_COMPAT/
    );
    assert.match(
      read("docs/security/granular-permissions-release-candidate.md"),
      /PERM-25|PERM-43|Analista de Compras|limitação/i
    );
  });
});
