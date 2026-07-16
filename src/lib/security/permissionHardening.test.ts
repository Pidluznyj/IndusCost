/**
 * P23 — hardening integrado: personas, resolvedor, deny, sessão, backfill, comparação.
 * Sem side-effects de DB; complementa permissionPersonaMatrix e módulos P15–P22.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessPath,
  canViewModule,
  evaluatePathViewAccess,
} from "@/src/lib/resourceNavigationAccess.js";
import {
  buildPersonaContext,
  PERMISSION_PERSONA_MATRIX,
} from "@/src/lib/security/permissionPersonaMatrix.js";
import {
  assertCanChangeSuperAdminRole,
  UserPermissionAdminError,
} from "@/src/lib/security/userPermissionAdminService.js";
import {
  authorizeRequireResource,
  REQUIRE_RESOURCE_ADMIN_KEYS,
} from "@/src/lib/security/requireResource.js";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/index.js";
import {
  fixtureDenyWinsAllow,
  fixtureLeticiaAccountsPayableOnly,
  fixtureSuperAdmin,
  fixtureViewerRolePreset,
} from "@/src/lib/security/effectiveAccess/fixtures.js";
import {
  buildBackfillTestUsers,
  createInMemoryBackfillPort,
  runPermissionBackfill,
} from "@/src/lib/security/permissionBackfill/index.js";
import {
  buildDefaultComparisonSubjects,
  runAccessComparison,
} from "@/src/lib/security/accessComparison/index.js";
import { runPermissionConsistency } from "@/src/lib/security/permissionConsistency/index.js";
import {
  isSessionPermissionsVersionStale,
  normalizePermissionsVersion,
} from "@/src/lib/permissionsVersion.js";
import { runLegacyVsResourceComparison } from "../../../scripts/compareLegacyVsResourceNavAccess.ts";

describe("P23 — Leticia somente AP", () => {
  const leticia = PERMISSION_PERSONA_MATRIX.find((p) => p.id === "leticia_ap_only")!;

  it("sidebar/path: AP sim; AR, conciliação, RH, máquinas não", () => {
    const c = buildPersonaContext(leticia);
    assert.equal(canAccessPath("/finance/accounts-payable", c), true);
    for (const path of leticia.expectDenyPaths ?? []) {
      assert.equal(canAccessPath(path, c), false, path);
    }
  });

  it("resolvedor: AP view; finance shell e employees deny", () => {
    const r = resolveEffectiveAccess(fixtureLeticiaAccountsPayableOnly());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), true);
    assert.equal(canEffectiveAccess(r, "finance.accounts_receivable", "view"), false);
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), false);
    assert.equal(canEffectiveAccess(r, "operations.machines", "view"), false);
    assert.equal(canEffectiveAccess(r, "commercial.crm", "view"), false);
  });

  it("mega-key costs.view não abre RH via resolvedor", () => {
    const r = resolveEffectiveAccess({
      userId: "mega",
      role: "VIEWER",
      legacyPermissions: ["costs.view"],
      legacyCompatMode: true,
    });
    assert.equal(canEffectiveAccess(r, "admin.employees", "view"), false);
    assert.equal(canEffectiveAccess(r, "operations.machines", "view"), false);
  });
});

describe("P23 — VIEWER vazio e deny", () => {
  it("VIEWER bag vazia: zero módulos", () => {
    const viewer = PERMISSION_PERSONA_MATRIX.find((p) => p.id === "viewer")!;
    const c = buildPersonaContext(viewer);
    assert.equal(viewer.expectViewModules.length, 0);
    for (const mod of viewer.expectDenyModules) {
      assert.equal(canViewModule(mod, c), false, mod);
    }
  });

  it("deny vence allow no resolvedor", () => {
    const r = resolveEffectiveAccess(fixtureDenyWinsAllow());
    assert.equal(canEffectiveAccess(r, "finance.accounts_payable", "view"), false);
  });

  it("role preset VIEWER sem bag não ganha comercial no strict", () => {
    const r = resolveEffectiveAccess({
      ...fixtureViewerRolePreset(),
      legacyCompatMode: false,
    });
    assert.equal(canEffectiveAccess(r, "commercial.crm", "view"), false);
  });
});

describe("P23 — SUPER_ADMIN e guards BE", () => {
  it("SUPER_ADMIN bypass no resolvedor", () => {
    const r = resolveEffectiveAccess(fixtureSuperAdmin());
    assert.equal(canEffectiveAccess(r, "admin.settings.security", "manage"), true);
  });

  it("último SUPER_ADMIN não pode ser rebaixado", () => {
    assert.throws(
      () =>
        assertCanChangeSuperAdminRole({
          existingRole: "SUPER_ADMIN",
          existingActive: true,
          nextRole: "ADMIN",
          activeSuperAdminCount: 1,
        }),
      (e: unknown) => e instanceof UserPermissionAdminError && e.code === "LAST_SUPER_ADMIN"
    );
  });

  it("API guard: VIEWER sem permissão → 403", () => {
    const d = authorizeRequireResource(
      { id: "u1", role: "VIEWER", permissions: [], effectivePermissions: [] },
      REQUIRE_RESOURCE_ADMIN_KEYS.security,
      "manage"
    );
    assert.equal(d.ok, false);
    if (!d.ok) assert.equal(d.status, 403);
  });
});

describe("P23 — sessão permissionsVersion", () => {
  it("epoch stale revoga freshness", () => {
    assert.equal(isSessionPermissionsVersionStale(0, 1), true);
    assert.equal(isSessionPermissionsVersionStale(3, 3), false);
  });

  it("normalização monotônica", () => {
    assert.equal(normalizePermissionsVersion(-1), 0);
    assert.equal(normalizePermissionsVersion(2.7), 2);
  });
});

describe("P23 — comparação legado × novo (fixtures)", () => {
  it("nav: zero revogações involuntárias", () => {
    const r = runLegacyVsResourceComparison();
    assert.equal(r.summary.involuntaryRevocations, 0);
  });

  it("effective: comparação fixtures completa", () => {
    const report = runAccessComparison(buildDefaultComparisonSubjects());
    assert.ok(report.subjectCount >= 10);
    assert.ok(report.probeCount > 0);
  });
});

describe("P23 — backfill dry-run (fixtures)", () => {
  it("preview idempotente sem apply", async () => {
    const port = createInMemoryBackfillPort(buildBackfillTestUsers());
    const r1 = await runPermissionBackfill({ port, dryRun: true, apply: false });
    const r2 = await runPermissionBackfill({ port, dryRun: true, apply: false });
    assert.equal(r1.appliedCount, 0);
    assert.equal(r2.appliedCount, 0);
    assert.ok(r1.subjectCount >= 1);
  });
});

describe("P23 — consistência contrato (strict)", () => {
  it("zero gap crítico/alto novo", () => {
    const report = runPermissionConsistency({ mode: "strict", includeAudit: false });
    assert.equal(report.summary.ok, true);
    assert.equal(report.summary.newFindingCount, 0);
  });
});

describe("P23 — parent/child path deny", () => {
  it("sem finance.view bloqueia filhos mesmo com alias AP", () => {
    const c = buildPersonaContext(
      PERMISSION_PERSONA_MATRIX.find((p) => p.id === "usuario_com_deny")!
    );
    assert.equal(canAccessPath("/finance", c), false);
    assert.equal(evaluatePathViewAccess("/finance/accounts-payable", c).allowed, false);
  });
});
