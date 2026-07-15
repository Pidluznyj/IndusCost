/**
 * Diff + apply idempotente do plano de catálogo (Prompt 05).
 */

import {
  assertCatalogSeedPlanReady,
  buildPermissionCatalogSeedPlan,
} from "./buildPermissionCatalogSeedPlan.ts";
import type {
  CatalogSeedChange,
  CatalogSeedDiffReport,
  CatalogSeedExistingRow,
  CatalogSeedPlan,
  CatalogSeedResourceRow,
  PermissionCatalogSeedPort,
} from "./types.ts";

const SAFE_FIELDS = [
  "label",
  "description",
  "type",
  "parentKey",
  "module",
  "sortOrder",
  "isSystem",
  "isActive",
] as const;

function changedFields(
  before: CatalogSeedExistingRow,
  after: CatalogSeedResourceRow
): string[] {
  const out: string[] = [];
  for (const f of SAFE_FIELDS) {
    const b = before[f];
    const a = after[f];
    if (f === "description") {
      if ((b ?? "") !== (a ?? "")) out.push(f);
    } else if (b !== a) {
      out.push(f);
    }
  }
  return out;
}

export function diffCatalogSeedPlan(
  plan: CatalogSeedPlan,
  existing: readonly CatalogSeedExistingRow[]
): CatalogSeedChange[] {
  const byKey = new Map(existing.map((e) => [e.key, e]));
  const changes: CatalogSeedChange[] = [];

  for (const after of plan.rows) {
    const before = byKey.get(after.key);
    if (!before) {
      changes.push({ kind: "create", key: after.key, after });
      continue;
    }
    const fields = changedFields(before, after);
    if (fields.length === 0) {
      changes.push({
        kind: after.legacyRetain ? "retain_legacy_only" : "unchanged",
        key: after.key,
        before,
        after,
      });
    } else {
      changes.push({
        kind: "update",
        key: after.key,
        before,
        after,
        changedFields: fields,
      });
    }
  }

  return changes;
}

function summarize(
  dryRun: boolean,
  changes: CatalogSeedChange[],
  issues: CatalogSeedPlan["issues"]
): CatalogSeedDiffReport {
  return {
    dryRun,
    createCount: changes.filter((c) => c.kind === "create").length,
    updateCount: changes.filter((c) => c.kind === "update").length,
    unchangedCount: changes.filter((c) => c.kind === "unchanged").length,
    retainLegacyCount: changes.filter((c) => c.kind === "retain_legacy_only").length,
    changes,
    issues,
    note:
      "Somente PermissionResource. Não altera RolePermission, UserPermissionOverride, AppUser.permissions nem AccessProfile.",
  };
}

async function applyChanges(
  port: PermissionCatalogSeedPort,
  changes: CatalogSeedChange[]
): Promise<void> {
  for (const change of changes) {
    if (change.kind === "create") {
      await port.createResource(change.after);
    } else if (change.kind === "update") {
      await port.updateResource(change.key, change.after);
    }
  }
}

/**
 * Dry-run ou apply. Segunda execução sem drift → create=0 update=0.
 * Usa transaction quando o port disponibiliza.
 */
export async function runPermissionCatalogSeed(args: {
  port: PermissionCatalogSeedPort;
  dryRun: boolean;
  plan?: CatalogSeedPlan;
}): Promise<CatalogSeedDiffReport> {
  const plan = args.plan ?? buildPermissionCatalogSeedPlan();
  assertCatalogSeedPlanReady(plan);

  const existing = await args.port.listResources();
  const changes = diffCatalogSeedPlan(plan, existing);
  const report = summarize(args.dryRun, changes, plan.issues);

  if (args.dryRun) {
    return report;
  }

  const material = changes.filter((c) => c.kind === "create" || c.kind === "update");
  if (material.length === 0) {
    if (args.port.writeAudit) {
      await args.port.writeAudit("SEED_PERMISSION_CATALOG_NOOP", {
        ...report,
        changes: undefined,
        changeKeys: [],
      });
    }
    return report;
  }

  const run = async (p: PermissionCatalogSeedPort) => {
    await applyChanges(p, material);
    if (p.writeAudit) {
      await p.writeAudit("SEED_PERMISSION_CATALOG_FROM_CONTRACT", {
        dryRun: false,
        createCount: report.createCount,
        updateCount: report.updateCount,
        unchangedCount: report.unchangedCount,
        retainLegacyCount: report.retainLegacyCount,
        keysCreated: material.filter((c) => c.kind === "create").map((c) => c.key),
        keysUpdated: material.filter((c) => c.kind === "update").map((c) => c.key),
        note: report.note,
      });
    }
  };

  if (args.port.transaction) {
    await args.port.transaction(run);
  } else {
    await run(args.port);
  }

  return report;
}

/** Formato markdown do relatório de diferenças. */
export function formatCatalogSeedDiffMarkdown(report: CatalogSeedDiffReport): string {
  const lines: string[] = [
    "# Relatório — seed catálogo hierárquico (contrato)",
    "",
    `| dryRun | ${report.dryRun} |`,
    `| create | ${report.createCount} |`,
    `| update | ${report.updateCount} |`,
    `| unchanged | ${report.unchangedCount} |`,
    `| retain legacy | ${report.retainLegacyCount} |`,
    "",
    report.note,
    "",
  ];

  if (report.issues.length) {
    lines.push("## Issues do plano (não bloqueantes, se passou assert)");
    for (const i of report.issues.slice(0, 40)) {
      lines.push(`- \`${i.code}\`: ${i.message}`);
    }
    lines.push("");
  }

  const creates = report.changes.filter((c) => c.kind === "create");
  const updates = report.changes.filter((c) => c.kind === "update");

  lines.push(`## CREATE (${creates.length})`);
  for (const c of creates.slice(0, 80)) {
    lines.push(`- \`${c.key}\` (${c.after.source})`);
  }
  if (creates.length > 80) lines.push(`- … +${creates.length - 80}`);
  lines.push("");

  lines.push(`## UPDATE (${updates.length})`);
  for (const c of updates.slice(0, 80)) {
    lines.push(
      `- \`${c.key}\` fields=${(c.changedFields ?? []).join(",") || "?"}`
    );
  }
  if (updates.length > 80) lines.push(`- … +${updates.length - 80}`);
  lines.push("");

  return lines.join("\n");
}
