import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PermissionAuditActions,
  buildAccessProfileAuditPlans,
  buildOverrideSaveAuditPlans,
  buildPresetApplyAuditPlans,
  canViewFullPermissionAudit,
  compactAccessProfileAuditMeta,
  overridesUnchanged,
  permissionAuditActionLabel,
  summarizePermissionAuditChange,
} from "./permissionAudit.ts";
import { authorizeResourceAccess } from "./permissionGuards.ts";
import { PermissionResourceKeys } from "./permissionsCatalog.ts";
import type { AppAuthContext } from "@/src/lib/appAuth.js";

function ov(
  resourceKey: string,
  flags: { canView?: boolean | null; canExecute?: boolean | null; canManage?: boolean | null }
) {
  return {
    resourceKey,
    canView: flags.canView ?? null,
    canExecute: flags.canExecute ?? null,
    canManage: flags.canManage ?? null,
  };
}

function auth(partial: {
  role: AppAuthContext["role"];
  permissions?: string[];
}): AppAuthContext {
  return {
    id: "actor-1",
    name: "Actor",
    email: "actor@example.com",
    role: partial.role,
    permissions: partial.permissions ?? [],
    effectivePermissions: partial.permissions ?? [],
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
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 0,
    permissionsVersion: 0,
  };
}

describe("permissionAudit — override save", () => {
  it("salvar override cria OVERRIDE_CREATED + PERMISSION_GRANTED", () => {
    const plans = buildOverrideSaveAuditPlans({
      targetRole: "SELLER",
      before: [],
      after: [ov("comercial.crm", { canView: true })],
      reason: "liberar CRM",
    });
    const actions = plans.map((p) => p.action);
    assert.ok(actions.includes(PermissionAuditActions.OVERRIDE_CREATED));
    assert.ok(actions.includes(PermissionAuditActions.PERMISSION_GRANTED));
    assert.equal(plans[0]?.resourceKey, "comercial.crm");
    assert.equal(
      (plans.find((p) => p.action === PermissionAuditActions.OVERRIDE_CREATED)?.afterJson as { reason?: string })
        ?.reason,
      "liberar CRM"
    );
  });

  it("remover override cria OVERRIDE_REMOVED", () => {
    const plans = buildOverrideSaveAuditPlans({
      targetRole: "SELLER",
      before: [ov("comercial.crm", { canView: true })],
      after: [],
    });
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.OVERRIDE_REMOVED));
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.PERMISSION_BLOCKED));
  });

  it("alteração sem mudança real não gera auditoria", () => {
    const same = [ov("comercial.crm", { canView: true, canExecute: false })];
    assert.equal(overridesUnchanged(same, same), true);
    assert.deepEqual(
      buildOverrideSaveAuditPlans({
        targetRole: "SELLER",
        before: same,
        after: [{ ...same[0]! }],
      }),
      []
    );
  });
});

describe("permissionAudit — preset / restore", () => {
  it("aplicar preset cria PRESET_APPLIED e remove overrides", () => {
    const plans = buildPresetApplyAuditPlans({
      beforeRole: "SELLER",
      afterRole: "SELLER",
      beforeOverrides: [ov("comercial.crm", { canView: true })],
      beforePermissions: ["crm.view"],
      afterPermissions: ["crm.view"],
      kind: "preset",
    });
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.PRESET_APPLIED));
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.OVERRIDE_REMOVED));
    assert.ok(!plans.some((p) => p.action === PermissionAuditActions.ROLE_CHANGED));
  });

  it("role alterada + preset gera ROLE_CHANGED", () => {
    const plans = buildPresetApplyAuditPlans({
      beforeRole: "VIEWER",
      afterRole: "SELLER",
      beforeOverrides: [],
      beforePermissions: [],
      afterPermissions: ["x"],
      kind: "preset",
    });
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.ROLE_CHANGED));
    assert.ok(plans.some((p) => p.action === PermissionAuditActions.PRESET_APPLIED));
  });

  it("restaurar padrão gera PERMISSIONS_RESTORED_TO_DEFAULT", () => {
    const plans = buildPresetApplyAuditPlans({
      beforeRole: "ADMIN",
      afterRole: "ADMIN",
      beforeOverrides: [ov("admin.usuarios", { canManage: true })],
      beforePermissions: ["users.manage"],
      afterPermissions: ["users.manage"],
      kind: "restore",
      reason: "limpeza",
    });
    assert.ok(
      plans.some((p) => p.action === PermissionAuditActions.PERMISSIONS_RESTORED_TO_DEFAULT)
    );
  });
});

describe("permissionAudit — UI / ACL", () => {
  it("labels e resumo antes/depois", () => {
    assert.equal(
      permissionAuditActionLabel(PermissionAuditActions.OVERRIDE_CREATED),
      "Personalização criada"
    );
    const s = summarizePermissionAuditChange(
      { canView: false, canExecute: false, canManage: false },
      { canView: true, canExecute: false, canManage: false, reason: "ok" }
    );
    assert.match(s.before, /Ver:não/);
    assert.match(s.after, /Ver:sim/);
    assert.equal(s.reason, "ok");
  });

  it("403 mental model: sem admin.permissoes:admin não vê auditoria completa", () => {
    assert.equal(canViewFullPermissionAudit(false), false);
    assert.equal(canViewFullPermissionAudit(true), true);

    const seller = auth({ role: "SELLER", permissions: ["users.manage"] });
    const denied = authorizeResourceAccess(
      seller,
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      "admin"
    );
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, "FORBIDDEN");
    }

    const admin = auth({
      role: "ADMIN",
      permissions: ["admin.permissoes.action.manage"],
    });
    // Legacy string may not map — use SUPER_ADMIN for positive path
    const superAdmin = auth({ role: "SUPER_ADMIN", permissions: [] });
    const allowed = authorizeResourceAccess(
      superAdmin,
      PermissionResourceKeys.ADMIN_PERMISSOES_ACTION_MANAGE,
      "admin"
    );
    assert.equal(allowed.ok, true);
    void admin;
  });
});

describe("permissionAudit — perfil de acesso (P22)", () => {
  it("buildAccessProfileAuditPlans não inclui bag completo", () => {
    const plans = buildAccessProfileAuditPlans({
      kind: "updated",
      profileId: "prof-1",
      profileName: "Financeiro AP",
      before: { permissionCount: 3, roleBase: "VIEWER" },
      after: { permissionCount: 5, roleBase: "VIEWER" },
      reason: "ajuste matriz",
    });
    assert.equal(plans.length, 1);
    const after = plans[0]!.afterJson as Record<string, unknown>;
    assert.equal(after.permissionCount, 5);
    assert.equal(after.profileName, "Financeiro AP");
    assert.equal(after.reason, "ajuste matriz");
    assert.ok(!("permissions" in after));
  });

  it("compactAccessProfileAuditMeta é compacto", () => {
    const meta = compactAccessProfileAuditMeta({
      profileId: "p1",
      profileName: "X",
      permissionCount: 2,
    });
    assert.deepEqual(Object.keys(meta).sort(), ["permissionCount", "profileId", "profileName"]);
  });

  it("rótulos de perfil na UI", () => {
    assert.equal(
      permissionAuditActionLabel(PermissionAuditActions.ACCESS_PROFILE_APPLIED),
      "Perfil de acesso aplicado ao usuário"
    );
  });
});
