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

export function permissionAuditActionLabel(action: string): string {
  switch (action) {
    case PermissionAuditActions.ROLE_CHANGED:
      return "Role alterada";
    case PermissionAuditActions.PERMISSION_GRANTED:
      return "Permissão liberada";
    case PermissionAuditActions.PERMISSION_BLOCKED:
      return "Permissão bloqueada";
    case PermissionAuditActions.OVERRIDE_CREATED:
      return "Override criado";
    case PermissionAuditActions.OVERRIDE_REMOVED:
      return "Override removido";
    case PermissionAuditActions.OVERRIDE_UPDATED:
      return "Override atualizado";
    case PermissionAuditActions.PRESET_APPLIED:
      return "Preset aplicado";
    case PermissionAuditActions.PERMISSIONS_RESTORED_TO_DEFAULT:
      return "Permissões restauradas ao padrão";
    case "SAVE_OVERRIDES":
      return "Overrides salvos";
    case "APPLY_ROLE_PRESET":
      return "Preset da role aplicado";
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
      before: before?.role != null ? `Role ${String(before.role)}` : "—",
      after: after?.role != null ? `Role ${String(after.role)}` : "—",
      reason,
    };
  }

  if (before?.overrideCount != null || after?.overrideCount != null) {
    return {
      before: `Overrides: ${String(before?.overrideCount ?? "—")}`,
      after: `Overrides: ${String(after?.overrideCount ?? "—")}`,
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
