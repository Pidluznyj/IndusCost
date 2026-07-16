/**
 * Exportação segura — preview/pendências sem PII.
 */

import type { BackfillRunReport, BackfillUserPlan } from "./types.ts";

function escapeCsv(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toSafeBackfillJson(report: BackfillRunReport): unknown {
  return {
    dryRun: report.dryRun,
    runId: report.runId,
    generatedAt: report.generatedAt,
    subjectCount: report.subjectCount,
    readyCount: report.readyCount,
    skippedCount: report.skippedCount,
    pendingCount: report.pendingCount,
    appliedCount: report.appliedCount,
    failedCount: report.failedCount,
    snapshotPath: report.snapshotPath,
    note: report.note,
    users: report.users.map(sanitizeUserPlan),
    applyResults: report.applyResults.map((r) => ({
      subjectRef: r.subjectRef,
      applied: r.applied,
      unchanged: r.unchanged,
      error: r.error,
    })),
  };
}

function sanitizeUserPlan(u: BackfillUserPlan): unknown {
  return {
    subjectRef: u.subjectRef,
    role: u.role,
    scenarioTag: u.scenarioTag,
    status: u.status,
    legacyPermissionCount: u.legacyPermissionCount,
    migratableKeyCount: u.migratableKeyCount,
    pendingCount: u.pendingCount,
    deltaOverrideCount: u.deltaOverrides.length,
    pending: u.pending.map((p) => ({
      kind: p.kind,
      legacyKey: p.legacyKey,
      resourceKey: p.resourceKey,
      reason: p.reason,
    })),
    classifications: u.classifications.map((c) => ({
      legacyKey: c.legacyKey,
      kind: c.kind,
      migratable: c.migratable,
      canonicalResourceKey: c.canonicalResourceKey,
    })),
  };
}

export function toPendingCsv(report: BackfillRunReport): string {
  const header = "subjectRef,role,status,kind,legacyKey,resourceKey,reason";
  const rows = [header];
  for (const u of report.users) {
    for (const p of u.pending) {
      rows.push(
        [u.subjectRef, u.role, u.status, p.kind, p.legacyKey ?? "", p.resourceKey ?? "", p.reason]
          .map(escapeCsv)
          .join(",")
      );
    }
  }
  return rows.join("\n");
}

export function toSummaryCsv(report: BackfillRunReport): string {
  const header =
    "subjectRef,role,scenarioTag,status,legacyPermissionCount,migratableKeyCount,pendingCount,deltaOverrideCount";
  const rows = [header];
  for (const u of report.users) {
    rows.push(
      [
        u.subjectRef,
        u.role,
        u.scenarioTag ?? "",
        u.status,
        u.legacyPermissionCount,
        u.migratableKeyCount,
        u.pendingCount,
        u.deltaOverrides.length,
      ]
        .map(escapeCsv)
        .join(",")
    );
  }
  return rows.join("\n");
}
