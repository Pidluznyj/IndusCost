/**
 * Auditoria de permissões/roles — helpers puros (browser-safe, sem Prisma).
 * Persistência: PermissionAuditLog.
 */

export const PermissionAuditActions = {
  ROLE_CHANGED: "ROLE_CHANGED",
  PERMISSION_GRANTED: "PERMISSION_GRANTED",
  PERMISSION_BLOCKED: "PERMISSION_BLOCKED",
  OVERRIDE_CREATED: "OVERRIDE_CREATED",
  OVERRIDE_REMOVED: "OVERRIDE_REMOVED",
  OVERRIDE_UPDATED: "OVERRIDE_UPDATED",
  PRESET_APPLIED: "PRESET_APPLIED",
  PERMISSIONS_RESTORED_TO_DEFAULT: "PERMISSIONS_RESTORED_TO_DEFAULT",
  ACCESS_PROFILE_CREATED: "ACCESS_PROFILE_CREATED",
  ACCESS_PROFILE_UPDATED: "ACCESS_PROFILE_UPDATED",
  ACCESS_PROFILE_APPLIED: "ACCESS_PROFILE_APPLIED",
} as const;

export type PermissionAuditAction =
  (typeof PermissionAuditActions)[keyof typeof PermissionAuditActions];

export type AuditOverrideLike = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
  reason?: string | null;
};

export type PermissionAuditEntryPlan = {
  action: PermissionAuditAction;
  resourceKey: string | null;
  targetRole: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown> | null;
};

type OverrideSnap = {
  resourceKey: string;
  canView: boolean | null;
  canExecute: boolean | null;
  canManage: boolean | null;
  reason?: string | null;
};

function snapOverride(o: AuditOverrideLike): OverrideSnap {
  return {
    resourceKey: o.resourceKey,
    canView: o.canView,
    canExecute: o.canExecute,
    canManage: o.canManage,
    reason: o.reason ?? null,
  };
}

function overrideKey(o: OverrideSnap): string {
  return `${o.resourceKey}|${o.canView}|${o.canExecute}|${o.canManage}`;
}

export function serializeOverridesForCompare(
  overrides: readonly OverrideSnap[]
): string {
  return JSON.stringify(
    [...overrides]
      .map((o) => ({
        resourceKey: o.resourceKey,
        canView: o.canView,
        canExecute: o.canExecute,
        canManage: o.canManage,
      }))
      .sort((a, b) => a.resourceKey.localeCompare(b.resourceKey))
  );
}

export function overridesUnchanged(
  before: readonly AuditOverrideLike[],
  after: readonly AuditOverrideLike[]
): boolean {
  return (
    serializeOverridesForCompare(before.map(snapOverride)) ===
    serializeOverridesForCompare(after.map(snapOverride))
  );
}

function flagGranted(
  before: boolean | null | undefined,
  after: boolean | null | undefined
): boolean {
  return after === true && before !== true;
}

function flagBlocked(
  before: boolean | null | undefined,
  after: boolean | null | undefined
): boolean {
  return before === true && after !== true;
}

/**
 * Diff de overrides → eventos de auditoria (sem ruído se idêntico).
 */
export function buildOverrideSaveAuditPlans(args: {
  targetRole: string;
  before: readonly AuditOverrideLike[];
  after: readonly AuditOverrideLike[];
  reason?: string | null;
}): PermissionAuditEntryPlan[] {
  if (overridesUnchanged(args.before, args.after)) return [];

  const beforeMap = new Map(args.before.map((o) => [o.resourceKey, snapOverride(o)]));
  const afterMap = new Map(args.after.map((o) => [o.resourceKey, snapOverride(o)]));
  const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const plans: PermissionAuditEntryPlan[] = [];
  const reason = args.reason?.trim() || null;

  for (const resourceKey of [...keys].sort()) {
    const b = beforeMap.get(resourceKey) ?? null;
    const a = afterMap.get(resourceKey) ?? null;

    if (!b && a) {
      plans.push({
        action: PermissionAuditActions.OVERRIDE_CREATED,
        resourceKey,
        targetRole: args.targetRole,
        beforeJson: null,
        afterJson: { ...a, ...(reason ? { reason } : {}) },
      });
      if (a.canView === true || a.canExecute === true || a.canManage === true) {
        plans.push({
          action: PermissionAuditActions.PERMISSION_GRANTED,
          resourceKey,
          targetRole: args.targetRole,
          beforeJson: { canView: false, canExecute: false, canManage: false },
          afterJson: {
            canView: a.canView === true,
            canExecute: a.canExecute === true,
            canManage: a.canManage === true,
            ...(reason ? { reason } : {}),
          },
        });
      }
      continue;
    }

    if (b && !a) {
      plans.push({
        action: PermissionAuditActions.OVERRIDE_REMOVED,
        resourceKey,
        targetRole: args.targetRole,
        beforeJson: b,
        afterJson: reason ? { reason } : null,
      });
      if (b.canView === true || b.canExecute === true || b.canManage === true) {
        plans.push({
          action: PermissionAuditActions.PERMISSION_BLOCKED,
          resourceKey,
          targetRole: args.targetRole,
          beforeJson: {
            canView: b.canView === true,
            canExecute: b.canExecute === true,
            canManage: b.canManage === true,
          },
          afterJson: {
            canView: false,
            canExecute: false,
            canManage: false,
            ...(reason ? { reason } : {}),
          },
        });
      }
      continue;
    }

    if (b && a && overrideKey(b) !== overrideKey(a)) {
      plans.push({
        action: PermissionAuditActions.OVERRIDE_UPDATED,
        resourceKey,
        targetRole: args.targetRole,
        beforeJson: b,
        afterJson: { ...a, ...(reason ? { reason } : {}) },
      });

      const granted: string[] = [];
      const blocked: string[] = [];
      if (flagGranted(b.canView, a.canView)) granted.push("canView");
      if (flagGranted(b.canExecute, a.canExecute)) granted.push("canExecute");
      if (flagGranted(b.canManage, a.canManage)) granted.push("canManage");
      if (flagBlocked(b.canView, a.canView)) blocked.push("canView");
      if (flagBlocked(b.canExecute, a.canExecute)) blocked.push("canExecute");
      if (flagBlocked(b.canManage, a.canManage)) blocked.push("canManage");

      if (granted.length > 0) {
        plans.push({
          action: PermissionAuditActions.PERMISSION_GRANTED,
          resourceKey,
          targetRole: args.targetRole,
          beforeJson: b,
          afterJson: { ...a, flags: granted, ...(reason ? { reason } : {}) },
        });
      }
      if (blocked.length > 0) {
        plans.push({
          action: PermissionAuditActions.PERMISSION_BLOCKED,
          resourceKey,
          targetRole: args.targetRole,
          beforeJson: b,
          afterJson: { ...a, flags: blocked, ...(reason ? { reason } : {}) },
        });
      }
    }
  }

  return plans;
}

export function buildPresetApplyAuditPlans(args: {
  beforeRole: string;
  afterRole: string;
  beforeOverrides: readonly AuditOverrideLike[];
  afterPermissions: readonly string[];
  beforePermissions: readonly string[];
  kind: "preset" | "restore" | "role_change";
  reason?: string | null;
}): PermissionAuditEntryPlan[] {
  const plans: PermissionAuditEntryPlan[] = [];
  const reason = args.reason?.trim() || null;
  const meta = {
    before: {
      role: args.beforeRole,
      overrideCount: args.beforeOverrides.length,
      permissions: [...args.beforePermissions].sort(),
    },
    after: {
      role: args.afterRole,
      overrideCount: 0,
      permissions: [...args.afterPermissions].sort(),
    },
    ...(reason ? { reason } : {}),
  };

  if (args.beforeRole !== args.afterRole) {
    plans.push({
      action: PermissionAuditActions.ROLE_CHANGED,
      resourceKey: null,
      targetRole: args.afterRole,
      beforeJson: { role: args.beforeRole },
      afterJson: { role: args.afterRole, ...(reason ? { reason } : {}) },
    });
  }

  if (args.kind === "restore") {
    plans.push({
      action: PermissionAuditActions.PERMISSIONS_RESTORED_TO_DEFAULT,
      resourceKey: null,
      targetRole: args.afterRole,
      beforeJson: meta.before,
      afterJson: { ...meta.after, ...(reason ? { reason } : {}) },
    });
  } else {
    plans.push({
      action: PermissionAuditActions.PRESET_APPLIED,
      resourceKey: null,
      targetRole: args.afterRole,
      beforeJson: meta.before,
      afterJson: { ...meta.after, ...(reason ? { reason } : {}) },
    });
  }

  for (const ov of args.beforeOverrides) {
    plans.push({
      action: PermissionAuditActions.OVERRIDE_REMOVED,
      resourceKey: ov.resourceKey,
      targetRole: args.afterRole,
      beforeJson: snapOverride(ov),
      afterJson: reason ? { reason } : null,
    });
  }

  return plans;
}

/** Metadados compactos — sem bag completo nem e-mails. */
export function compactAccessProfileAuditMeta(args: {
  profileId: string;
  profileName: string;
  permissionCount: number;
  roleBase?: string | null;
}): Record<string, unknown> {
  return {
    profileId: args.profileId,
    profileName: args.profileName,
    permissionCount: args.permissionCount,
    ...(args.roleBase != null ? { roleBase: args.roleBase } : {}),
  };
}

export function buildAccessProfileAuditPlans(args: {
  kind: "created" | "updated" | "applied";
  profileId: string;
  profileName: string;
  before?: { permissionCount: number; roleBase?: string | null };
  after: { permissionCount: number; roleBase?: string | null; appliedUserCount?: number };
  reason?: string | null;
}): PermissionAuditEntryPlan[] {
  const reason = args.reason?.trim() || null;
  const action =
    args.kind === "created"
      ? PermissionAuditActions.ACCESS_PROFILE_CREATED
      : args.kind === "updated"
        ? PermissionAuditActions.ACCESS_PROFILE_UPDATED
        : PermissionAuditActions.ACCESS_PROFILE_APPLIED;

  const beforeJson = args.before
    ? compactAccessProfileAuditMeta({
        profileId: args.profileId,
        profileName: args.profileName,
        permissionCount: args.before.permissionCount,
        roleBase: args.before.roleBase,
      })
    : null;

  const afterJson: Record<string, unknown> = {
    ...compactAccessProfileAuditMeta({
      profileId: args.profileId,
      profileName: args.profileName,
      permissionCount: args.after.permissionCount,
      roleBase: args.after.roleBase,
    }),
    ...(typeof args.after.appliedUserCount === "number"
      ? { appliedUserCount: args.after.appliedUserCount }
      : {}),
    ...(reason ? { reason } : {}),
  };

  return [
    {
      action,
      resourceKey: args.profileId,
      targetRole: "VIEWER",
      beforeJson,
      afterJson,
    },
  ];
}

export function buildAccessProfileUserApplyAuditPlans(args: {
  profileId: string;
  profileName: string;
  targetRole: string;
  userId: string;
}): PermissionAuditEntryPlan[] {
  return [
    {
      action: PermissionAuditActions.ACCESS_PROFILE_APPLIED,
      resourceKey: args.profileId,
      targetRole: args.targetRole,
      beforeJson: null,
      afterJson: {
        profileId: args.profileId,
        profileName: args.profileName,
        userId: args.userId,
      },
    },
  ];
}

export function permissionAuditActionLabel(action: string): string {
  switch (action) {
    case PermissionAuditActions.ROLE_CHANGED:
      return "Perfil alterado";
    case PermissionAuditActions.PERMISSION_GRANTED:
      return "Permissão liberada";
    case PermissionAuditActions.PERMISSION_BLOCKED:
      return "Permissão bloqueada";
    case PermissionAuditActions.OVERRIDE_CREATED:
      return "Personalização criada";
    case PermissionAuditActions.OVERRIDE_REMOVED:
      return "Personalização removida";
    case PermissionAuditActions.OVERRIDE_UPDATED:
      return "Personalização atualizada";
    case PermissionAuditActions.PRESET_APPLIED:
      return "Padrão do perfil aplicado";
    case PermissionAuditActions.PERMISSIONS_RESTORED_TO_DEFAULT:
      return "Acessos restaurados ao padrão";
    case PermissionAuditActions.ACCESS_PROFILE_CREATED:
      return "Perfil de acesso criado";
    case PermissionAuditActions.ACCESS_PROFILE_UPDATED:
      return "Perfil de acesso atualizado";
    case PermissionAuditActions.ACCESS_PROFILE_APPLIED:
      return "Perfil de acesso aplicado ao usuário";
    case "SAVE_OVERRIDES":
      return "Personalizações salvas";
    case "APPLY_ROLE_PRESET":
      return "Padrão do perfil aplicado";
    default:
      return action;
  }
}

function formatFlags(flags: Record<string, unknown> | null): string {
  if (!flags) return "—";
  const parts: string[] = [];
  if ("canView" in flags) parts.push(`Ver:${flags.canView ? "sim" : "não"}`);
  if ("canExecute" in flags) parts.push(`Exec:${flags.canExecute ? "sim" : "não"}`);
  if ("canManage" in flags) parts.push(`Gerir:${flags.canManage ? "sim" : "não"}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/** Resumo curto para UI da aba Auditoria. */
export function summarizePermissionAuditChange(
  beforeJson: unknown,
  afterJson: unknown
): { before: string; after: string; reason: string | null } {
  const before =
    beforeJson && typeof beforeJson === "object"
      ? (beforeJson as Record<string, unknown>)
      : null;
  const after =
    afterJson && typeof afterJson === "object"
      ? (afterJson as Record<string, unknown>)
      : null;

  const reason =
    (typeof after?.reason === "string" && after.reason) ||
    (typeof before?.reason === "string" && before.reason) ||
    null;

  if (before?.role != null || after?.role != null) {
    return {
      before: before?.role != null ? `Perfil ${String(before.role)}` : "—",
      after: after?.role != null ? `Perfil ${String(after.role)}` : "—",
      reason,
    };
  }

  if (before?.overrideCount != null || after?.overrideCount != null) {
    return {
      before: `Personalizações: ${String(before?.overrideCount ?? "—")}`,
      after: `Personalizações: ${String(after?.overrideCount ?? "—")}`,
      reason,
    };
  }

  return {
    before: formatFlags(before),
    after: formatFlags(after),
    reason,
  };
}

/**
 * Quem pode ver auditoria completa de permissões (qualquer usuário-alvo).
 * Mapeia admin.permissoes:admin → resource admin.permissoes.action.manage + admin.
 */
export function canViewFullPermissionAudit(hasPermissionsAdmin: boolean): boolean {
  return hasPermissionsAdmin === true;
}
