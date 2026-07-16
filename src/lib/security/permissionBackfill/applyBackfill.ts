/**
 * Apply / rollback — lotes, transação, idempotência, auditoria.
 */

import { randomUUID } from "node:crypto";
import { planUserBackfill, planUsersBackfill } from "./planBackfill.ts";
import { writeBackfillSnapshot, readBackfillSnapshot } from "./snapshot.ts";
import type {
  BackfillApplyUserResult,
  BackfillPort,
  BackfillRunReport,
  BackfillUserPlan,
} from "./types.ts";

export type RunBackfillOptions = {
  port: BackfillPort;
  dryRun: boolean;
  apply: boolean;
  confirmApply?: boolean;
  batchSize?: number;
  userIds?: string[];
  actorUserId?: string | null;
  runId?: string;
  label?: string;
  cwd?: string;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function toSnapshot(user: BackfillUserPlan, portUser: BackfillUserSnapshot): BackfillUserSnapshot {
  return {
    userId: user.userId,
    role: portUser.role,
    legacyPermissions: portUser.legacyPermissions,
    overrides: user.beforeOverrides.map((o) => ({ ...o })),
  };
}

export async function applyUserBackfill(args: {
  port: BackfillPort;
  plan: BackfillUserPlan;
  dryRun: boolean;
  actorUserId?: string | null;
}): Promise<BackfillApplyUserResult> {
  const { plan, port } = args;
  if (plan.status !== "ready") {
    return {
      userId: plan.userId,
      subjectRef: plan.subjectRef,
      applied: false,
      unchanged: plan.status === "skipped_idempotent",
      error: plan.status !== "skipped_idempotent" ? `status=${plan.status}` : undefined,
    };
  }

  if (args.dryRun || plan.deltaOverrides.length === 0) {
    return {
      userId: plan.userId,
      subjectRef: plan.subjectRef,
      applied: false,
      unchanged: plan.deltaOverrides.length === 0,
    };
  }

  try {
    await port.transaction(async (tx) => {
      await tx.replaceOverrides(plan.userId, plan.afterOverrides);
      await tx.writeAudit({
        actorUserId: args.actorUserId ?? null,
        targetUserId: plan.userId,
        targetRole: plan.role,
        before: plan.beforeOverrides,
        after: plan.afterOverrides,
        reason: "p20-backfill",
      });
    });
    return {
      userId: plan.userId,
      subjectRef: plan.subjectRef,
      applied: true,
      unchanged: false,
    };
  } catch (err) {
    return {
      userId: plan.userId,
      subjectRef: plan.subjectRef,
      applied: false,
      unchanged: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runPermissionBackfill(
  options: RunBackfillOptions
): Promise<BackfillRunReport> {
  const runId = options.runId ?? randomUUID().slice(0, 8);
  const batchSize = options.batchSize ?? 25;
  const dryRun = !options.apply;
  const users = await options.port.loadUsers(options.userIds);
  const plans = planUsersBackfill(users);

  const ready = plans.filter((p) => p.status === "ready");
  const skipped = plans.filter((p) => p.status.startsWith("skipped_"));
  const pending = plans.filter((p) => p.status === "pending_only");

  let snapshotPath: string | null = null;
  const applyResults: BackfillApplyUserResult[] = [];

  if (options.apply) {
    if (!options.confirmApply) {
      throw new Error(
        "BACKFILL_CONFIRM_REQUIRED: use --apply --confirm=BACKFILL PERMISSIONS (proibido em produção sem backup)."
      );
    }
  if (options.apply && options.dryRun) {
    throw new Error("BACKFILL_APPLY_CONFLICT: --apply não combina com --dry-run.");
  }

    snapshotPath = writeBackfillSnapshot({
      runId,
      label: options.label ?? "pre-apply",
      users: users.map((u) => ({
        userId: u.userId,
        role: u.role,
        legacyPermissions: u.legacyPermissions,
        overrides: u.overrides,
      })),
      cwd: options.cwd,
    });

    for (const batch of chunk(ready, batchSize)) {
      for (const plan of batch) {
        const result = await applyUserBackfill({
          port: options.port,
          plan,
          dryRun: false,
          actorUserId: options.actorUserId,
        });
        applyResults.push(result);
      }
    }
  } else {
    for (const plan of ready) {
      applyResults.push({
        userId: plan.userId,
        subjectRef: plan.subjectRef,
        applied: false,
        unchanged: false,
      });
    }
  }

  const appliedCount = applyResults.filter((r) => r.applied).length;
  const failedCount = applyResults.filter((r) => r.error).length;

  return {
    dryRun,
    runId,
    generatedAt: new Date().toISOString(),
    batchSize,
    subjectCount: plans.length,
    readyCount: ready.length,
    skippedCount: skipped.length,
    pendingCount: pending.length,
    appliedCount,
    failedCount,
    users: plans,
    applyResults,
    snapshotPath,
    note: dryRun
      ? "Preview only. permissions[] não alterada. Apply exige --apply --confirm=BACKFILL PERMISSIONS."
      : `Apply concluído. Snapshot: ${snapshotPath ?? "—"}. permissions[] intacta (anti-loop).`,
  };
}

export async function rollbackPermissionBackfill(args: {
  port: BackfillPort;
  runId: string;
  confirmRollback?: boolean;
  actorUserId?: string | null;
  cwd?: string;
}): Promise<{ restored: number; runId: string }> {
  if (!args.confirmRollback) {
    throw new Error("BACKFILL_ROLLBACK_CONFIRM_REQUIRED: --confirm=ROLLBACK BACKFILL");
  }
  const snap = readBackfillSnapshot(args.runId, args.cwd);
  let restored = 0;
  for (const u of snap.users) {
    await args.port.transaction(async (tx) => {
      const current = await tx.loadUser(u.userId);
      if (!current) return;
      await tx.replaceOverrides(u.userId, u.overrides);
      await tx.writeAudit({
        actorUserId: args.actorUserId ?? null,
        targetUserId: u.userId,
        targetRole: u.role,
        before: current.overrides,
        after: u.overrides,
        reason: `p20-backfill-rollback:${args.runId}`,
      });
    });
    restored += 1;
  }
  return { restored, runId: args.runId };
}

export function formatBackfillMarkdown(report: BackfillRunReport): string {
  const lines = [
    "# Backfill permissões (P20 Etapa B)",
    "",
    `| Run | ${report.runId} |`,
    `| Dry-run | ${report.dryRun} |`,
    `| Subjects | ${report.subjectCount} |`,
    `| Ready | ${report.readyCount} |`,
    `| Skipped | ${report.skippedCount} |`,
    `| Pending | ${report.pendingCount} |`,
    `| Applied | ${report.appliedCount} |`,
    `| Failed | ${report.failedCount} |`,
    "",
  ];

  const leticia = report.users.find((u) => u.scenarioTag === "leticia-ap-only");
  if (leticia) {
    lines.push("## Leticia", "", `- status: **${leticia.status}**`, "");
    for (const p of leticia.pending.slice(0, 10)) {
      lines.push(`- pending: ${p.kind} — ${p.reason}`);
    }
    lines.push("");
  }

  if (report.pendingCount > 0) {
    lines.push("## Pendências (amostra)", "");
    for (const u of report.users.filter((x) => x.pendingCount > 0).slice(0, 5)) {
      lines.push(`### ${u.subjectRef} (${u.role})`);
      for (const p of u.pending.slice(0, 5)) {
        lines.push(`- ${p.kind}: ${p.legacyKey ?? p.resourceKey ?? "—"} — ${p.reason}`);
      }
      lines.push("");
    }
  }

  lines.push("---", "", report.note);
  return lines.join("\n");
}

export { planUserBackfill, planUsersBackfill };
