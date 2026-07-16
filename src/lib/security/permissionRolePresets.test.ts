import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildRolePermissionMatrixRows,
  getOfficialRolePreset,
  listOfficialRolePresets,
  materializeLegacyPermissionsFromFlags,
  planApplyRolePreset,
  resolveMatrixCellStatus,
  buildEffectiveFlagsMap,
  diffUserAgainstRolePreset,
} from "./permissionRolePresets.ts";
import {
  assertCanChangeSuperAdminRole,
  assertSelfUsersManageLock,
  buildEditablePermissionTree,
  buildUserPermissionsPayload,
  normalizeOverrideInputs,
  UserPermissionAdminError,
  planApplyRolePreset as planFromService,
} from "./userPermissionAdminService.ts";

describe("permissionRolePresets", () => {
  it("lista presets oficiais das 5 roles", () => {
    const presets = listOfficialRolePresets();
    assert.equal(presets.length, 5);
    assert.ok(presets.every((p) => p.resources.length > 0));
  });

  it("SUPER_ADMIN preset é full em todos os recursos", () => {
    const preset = getOfficialRolePreset("SUPER_ADMIN");
    for (const row of preset.resources) {
      assert.equal(row.flags.canView, true);
      assert.equal(row.flags.canExecute, true);
      assert.equal(row.flags.canManage, true);
    }
  });

  it("ADMIN amplo sem manage da ação crítica de ACL", () => {
    const preset = getOfficialRolePreset("ADMIN");
    const acl = preset.resources.find((r) => r.resourceKey === "admin.permissoes.action.manage");
    assert.ok(acl);
    assert.equal(acl!.flags.canManage, false);
    assert.equal(acl!.flags.canView, false);
    const users = preset.resources.find((r) => r.resourceKey === "admin.usuarios");
    assert.equal(users!.flags.canManage, true);
  });

  it("COMMERCIAL_MANAGER e SELLER sem admin", () => {
    for (const role of ["COMMERCIAL_MANAGER", "SELLER"] as const) {
      const preset = getOfficialRolePreset(role);
      const admin = preset.resources.find((r) => r.resourceKey === "admin");
      assert.equal(admin!.flags.canView, false);
    }
  });

  it("matriz marca SUPER_ADMIN allowed e VIEWER bloqueado em admin", () => {
    const rows = buildRolePermissionMatrixRows({ includeActions: false });
    const adminRow = rows.find((r) => r.resourceKey === "admin");
    assert.ok(adminRow);
    const sa = adminRow!.cells.find((c) => c.role === "SUPER_ADMIN");
    const viewer = adminRow!.cells.find((c) => c.role === "VIEWER");
    assert.equal(sa!.status, "allowed");
    assert.equal(viewer!.status, "blocked");
  });

  it("resolveMatrixCellStatus partial quando view+execute sem manage", () => {
    assert.equal(
      resolveMatrixCellStatus({ canView: true, canExecute: true, canManage: false }),
      "partial"
    );
    assert.equal(
      resolveMatrixCellStatus({ canView: false, canExecute: false, canManage: false }),
      "blocked"
    );
  });

  it("planApplyRolePreset exige confirmação quando há overrides", () => {
    const blocked = planApplyRolePreset({
      role: "VIEWER",
      currentOverrides: [
        {
          userId: "u1",
          resourceKey: "dashboard",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      currentLegacyPermissions: [],
      confirmClearOverrides: false,
    });
    assert.ok("error" in blocked);
    assert.equal(blocked.error, "CONFIRM_CLEAR_OVERRIDES_REQUIRED");

    const ok = planApplyRolePreset({
      role: "VIEWER",
      currentOverrides: [
        {
          userId: "u1",
          resourceKey: "dashboard",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
      currentLegacyPermissions: [],
      confirmClearOverrides: true,
    });
    assert.ok(!("error" in ok));
    assert.equal(ok.clearOverrideKeys.length, 1);
  });

  it("apply preset é idempotente (mesmo legacy)", () => {
    const first = planApplyRolePreset({
      role: "VIEWER",
      currentOverrides: [],
      currentLegacyPermissions: [],
      confirmClearOverrides: true,
    });
    assert.ok(!("error" in first));
    const second = planApplyRolePreset({
      role: "VIEWER",
      currentOverrides: [],
      currentLegacyPermissions: first.legacyPermissions,
      confirmClearOverrides: true,
    });
    assert.ok(!("error" in second));
    assert.equal(second.unchanged, true);
    assert.deepEqual(second.legacyPermissions, first.legacyPermissions);
  });

  it("materializeLegacyPermissionsFromFlags inclui aliases de view", () => {
    const effective = buildEffectiveFlagsMap("ADMIN", []);
    const legacy = materializeLegacyPermissionsFromFlags(effective);
    assert.ok(legacy.includes("dashboard.view") || legacy.includes("finance.view"));
    assert.ok(legacy.includes("users.manage"));
    assert.ok(!legacy.includes("accessProfiles.manage"));
  });

  it("diffUserAgainstRolePreset detecta override", () => {
    const diff = diffUserAgainstRolePreset({
      role: "VIEWER",
      overrides: [
        {
          userId: "u1",
          resourceKey: "comissoes",
          canView: true,
          canExecute: null,
          canManage: null,
        },
      ],
    });
    assert.ok(diff.some((d) => d.resourceKey === "comissoes" && d.hasOverride));
  });
});

describe("userPermissionAdminService pure", () => {
  it("buildEditablePermissionTree aninha filhos", () => {
    const tree = buildEditablePermissionTree("ADMIN", []);
    const financeiro = tree.find((n) => n.key === "financeiro");
    assert.ok(financeiro);
    assert.ok(financeiro!.children.some((c) => c.key === "financeiro.conciliacao_carteira"));

    const comercial = tree.find((n) => n.key === "comercial");
    assert.ok(comercial);
    assert.ok(comercial!.children.some((c) => c.key === "comissoes"));
    assert.equal(tree.some((n) => n.key === "comissoes"), false);

    const operations = tree.find((n) => n.key === "operations");
    assert.ok(operations);
    assert.ok(operations!.children.some((c) => c.key === "operations.inventory"));
  });

  it("buildUserPermissionsPayload marca SUPER_ADMIN read-only", () => {
    const payload = buildUserPermissionsPayload({
      user: {
        id: "1",
        name: "SA",
        email: "sa@x.com",
        role: "SUPER_ADMIN",
        isActive: true,
        lastLoginAt: null,
        permissions: [],
      },
      overrides: [],
      activeSuperAdminCount: 1,
    });
    assert.equal(payload.treeReadOnly, true);
    assert.equal(payload.warnings.isLastSuperAdmin, true);
  });

  it("não permite rebaixar último SUPER_ADMIN", () => {
    assert.throws(
      () =>
        assertCanChangeSuperAdminRole({
          existingRole: "SUPER_ADMIN",
          existingActive: true,
          nextRole: "ADMIN",
          activeSuperAdminCount: 1,
        }),
      (err: unknown) =>
        err instanceof UserPermissionAdminError && err.code === "LAST_SUPER_ADMIN"
    );
  });

  it("bloqueia remover users.manage de si mesmo", () => {
    assert.throws(
      () =>
        assertSelfUsersManageLock({
          isEditingSelf: true,
          existingRole: "ADMIN",
          existingPermissions: ["users.manage"],
          nextRole: "VIEWER",
          nextLegacyPermissions: ["dashboard.view"],
        }),
      (err: unknown) =>
        err instanceof UserPermissionAdminError &&
        err.code === "CANNOT_REMOVE_OWN_USERS_MANAGE"
    );
  });

  it("normalizeOverrideInputs rejeita recurso desconhecido; omite tudo INHERIT", () => {
    assert.throws(
      () => normalizeOverrideInputs([{ resourceKey: "nao.existe", canView: true }]),
      (err: unknown) =>
        err instanceof UserPermissionAdminError && err.code === "UNKNOWN_RESOURCE"
    );
    const cleared = normalizeOverrideInputs([
      { resourceKey: "dashboard", canView: null, canExecute: null, canManage: null },
    ]);
    assert.equal(cleared.length, 0);
    const out = normalizeOverrideInputs([{ resourceKey: "dashboard", canView: true }]);
    assert.equal(out.length, 1);
    assert.equal(out[0]!.resourceKey, "dashboard");
  });

  it("planApplyRolePreset reexportado do service", () => {
    const plan = planFromService({
      role: "SELLER",
      currentOverrides: [],
      currentLegacyPermissions: ["x"],
    });
    assert.ok(!("error" in plan));
  });
});
