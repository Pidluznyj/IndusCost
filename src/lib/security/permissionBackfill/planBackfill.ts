/**
 * Planejamento de backfill por usuário — preview sem gravação.
 */

import { createHash } from "node:crypto";
import { compareAccessForSubject } from "@/src/lib/security/accessComparison/compareUser.ts";
import type { AccessComparisonSubject } from "@/src/lib/security/accessComparison/types.ts";
import { planLegacyToStructured } from "@/src/lib/security/permissionDualWrite/plan.ts";
import { projectLegacyToStructured } from "@/src/lib/security/permissionDualWrite/materialize.ts";
import {
  classifyProfilePermissionKeys,
  listMigratableLegacyKeys,
} from "./classifyLegacyKey.ts";
import type {
  BackfillOverrideRow,
  BackfillPendingItem,
  BackfillPortUser,
  BackfillUserPlan,
} from "./types.ts";

export function hashSubjectRef(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

function snapOverrides(rows: BackfillOverrideRow[]): BackfillOverrideRow[] {
  return rows.map((r) => ({ ...r }));
}

function overrideKey(r: BackfillOverrideRow): string {
  return `${r.resourceKey}|${r.canView}|${r.canExecute}|${r.canManage}`;
}

function mergeOverridesIdempotent(
  existing: readonly BackfillOverrideRow[],
  planned: readonly BackfillOverrideRow[]
): { merged: BackfillOverrideRow[]; delta: BackfillOverrideRow[]; pending: BackfillPendingItem[] } {
  const existingMap = new Map(existing.map((o) => [o.resourceKey, o]));
  const pending: BackfillPendingItem[] = [];
  const delta: BackfillOverrideRow[] = [];
  const merged = snapOverrides(existing);

  for (const p of planned) {
    const ex = existingMap.get(p.resourceKey);
    if (!ex) {
      delta.push(p);
      merged.push(p);
      continue;
    }
    if (overrideKey(ex) === overrideKey(p)) {
      continue;
    }
    pending.push({
      resourceKey: p.resourceKey,
      kind: "existing_override",
      reason: `override existente difere do plano (${ex.canView}/${ex.canExecute}/${ex.canManage})`,
    });
  }

  return { merged, delta, pending };
}

export function planUserBackfill(args: {
  user: BackfillPortUser;
  scenarioTag?: string | null;
  blockOnLockoutRisk?: boolean;
}): BackfillUserPlan {
  const { user } = args;
  const subjectRef = hashSubjectRef(user.userId);
  const beforeOverrides = snapOverrides(user.overrides);
  const pending: BackfillPendingItem[] = [];
  const legacy = [...user.legacyPermissions].sort();

  if (user.role === "SUPER_ADMIN") {
    return {
      userId: user.userId,
      subjectRef,
      role: user.role,
      scenarioTag: args.scenarioTag ?? null,
      status: "skipped_super_admin",
      legacyPermissionCount: legacy.length,
      migratableKeyCount: 0,
      pendingCount: 0,
      classifications: [],
      pending: [],
      beforeOverrides,
      afterOverrides: beforeOverrides,
      deltaOverrides: [],
      compatible: true,
      note: "SUPER_ADMIN protegido — sem backfill.",
    };
  }

  if (legacy.length === 0 && beforeOverrides.length === 0) {
    return {
      userId: user.userId,
      subjectRef,
      role: user.role,
      scenarioTag: args.scenarioTag ?? null,
      status: "skipped_no_legacy_grants",
      legacyPermissionCount: 0,
      migratableKeyCount: 0,
      pendingCount: 0,
      classifications: [],
      pending: [],
      beforeOverrides,
      afterOverrides: beforeOverrides,
      deltaOverrides: [],
      compatible: true,
      note: "Sem bag nem overrides — não injeta baseline de role.",
    };
  }

  const { migratable, classifications } = listMigratableLegacyKeys(legacy);
  for (const c of classifications) {
    if (!c.migratable) {
      pending.push({
        legacyKey: c.legacyKey,
        kind: c.kind,
        reason: c.note ?? c.kind,
      });
    }
  }

  if (user.accessProfilePermissions?.length) {
    for (const pc of classifyProfilePermissionKeys(user.accessProfilePermissions)) {
      pending.push({
        legacyKey: pc.legacyKey,
        kind: "profile",
        reason: pc.note ?? "profile",
      });
    }
  }

  if (migratable.length === 0) {
    return {
      userId: user.userId,
      subjectRef,
      role: user.role,
      scenarioTag: args.scenarioTag ?? null,
      status: "pending_only",
      legacyPermissionCount: legacy.length,
      migratableKeyCount: 0,
      pendingCount: pending.length,
      classifications,
      pending,
      beforeOverrides,
      afterOverrides: beforeOverrides,
      deltaOverrides: [],
      compatible: false,
      note: "Nenhuma chave inequívoca para migrar.",
    };
  }

  const legacyPlan = planLegacyToStructured({
    role: user.role,
    legacyPermissions: migratable,
    dryRun: true,
  });

  if (!legacyPlan.compatible) {
    pending.push({
      kind: "conflict",
      reason: `round-trip incompatível: lost=${legacyPlan.lostLegacy.join(",")}`,
    });
  }

  const projected = projectLegacyToStructured({
    role: user.role,
    legacyPermissions: migratable,
    elevateAncestors: false,
  });

  const plannedOverrides: BackfillOverrideRow[] = projected.projectedOverrides
    .filter((o) => o.canView === true || o.canExecute === true || o.canManage === true)
    .map((o) => ({
      resourceKey: o.resourceKey,
      canView: o.canView,
      canExecute: o.canExecute,
      canManage: o.canManage,
      reason: "p20-backfill",
    }));

  if (args.blockOnLockoutRisk !== false && legacy.length > 0) {
    const comparisonSubject: AccessComparisonSubject = {
      subjectId: user.userId,
      role: user.role,
      input: {
        userId: user.userId,
        role: user.role,
        legacyPermissions: legacy,
        legacyCompatMode: true,
        legacySkipMegaKeys: true,
      },
    };
    const cmp = compareAccessForSubject(comparisonSubject);
    if (cmp.lockoutRiskCount > 0) {
      for (const d of cmp.diffs.filter((x) => x.category === "lockout_risk")) {
        pending.push({
          resourceKey: d.resourceKey,
          kind: "lockout_risk",
          reason: `P20 lockout_risk ${d.resourceKey}:${d.action}`,
        });
      }
    }
  }

  const { merged, delta, pending: mergePending } = mergeOverridesIdempotent(
    beforeOverrides,
    plannedOverrides
  );
  pending.push(...mergePending);

  const hasBlockingPending = pending.some((p) =>
    ["lockout_risk", "conflict", "existing_override"].includes(p.kind)
  );

  if (delta.length === 0 && !hasBlockingPending) {
    return {
      userId: user.userId,
      subjectRef,
      role: user.role,
      scenarioTag: args.scenarioTag ?? null,
      status: "skipped_idempotent",
      legacyPermissionCount: legacy.length,
      migratableKeyCount: migratable.length,
      pendingCount: pending.length,
      classifications,
      pending,
      beforeOverrides,
      afterOverrides: merged,
      deltaOverrides: [],
      compatible: legacyPlan.compatible,
      note: "Idempotente — overrides já materializados.",
    };
  }

  if (hasBlockingPending || !legacyPlan.compatible) {
    return {
      userId: user.userId,
      subjectRef,
      role: user.role,
      scenarioTag: args.scenarioTag ?? null,
      status: "pending_only",
      legacyPermissionCount: legacy.length,
      migratableKeyCount: migratable.length,
      pendingCount: pending.length,
      classifications,
      pending,
      beforeOverrides,
      afterOverrides: merged,
      deltaOverrides: [],
      compatible: legacyPlan.compatible,
      note: "Pendências bloqueiam apply automático.",
    };
  }

  return {
    userId: user.userId,
    subjectRef,
    role: user.role,
    scenarioTag: args.scenarioTag ?? null,
    status: "ready",
    legacyPermissionCount: legacy.length,
    migratableKeyCount: migratable.length,
    pendingCount: pending.length,
    classifications,
    pending,
    beforeOverrides,
    afterOverrides: merged,
    deltaOverrides: delta,
    compatible: legacyPlan.compatible,
    note: "Pronto para apply — somente delta de overrides; permissions[] intacta.",
  };
}

export function planUsersBackfill(users: readonly BackfillPortUser[]): BackfillUserPlan[] {
  return users.map((u) => planUserBackfill({ user: u }));
}
