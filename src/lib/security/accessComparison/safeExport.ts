/**
 * Exportação segura JSON/CSV — sem nome, e-mail ou bag completa.
 */

import type {
  AccessComparisonGlobalReport,
  AccessComparisonUserReport,
  AccessDiffCategory,
} from "./types.ts";

const CSV_CATEGORIES: AccessDiffCategory[] = [
  "preserved_intentional",
  "new_legitimate_access",
  "removed_by_deny",
  "mega_key_bleed",
  "permissive_fallback",
  "unmapped_resource",
  "conflict",
  "lockout_risk",
];

function escapeCsv(value: string | number | boolean | null): string {
  const s = value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** JSON seguro — omitir granting keys completas no resumo global. */
export function toSafeJsonReport(report: AccessComparisonGlobalReport): unknown {
  return {
    dryRun: report.dryRun,
    generatedAt: report.generatedAt,
    migratedModuleScope: report.migratedModuleScope,
    probeCount: report.probeCount,
    subjectCount: report.subjectCount,
    categoryCounts: report.categoryCounts,
    lockoutRiskCount: report.lockoutRiskCount,
    megaKeyBleedCount: report.megaKeyBleedCount,
    unmappedResourceCount: report.unmappedResourceCount,
    conflictCount: report.conflictCount,
    note: report.note,
    byProfile: report.byProfile.map((p) => ({
      accessProfileRef: p.accessProfileRef,
      subjectCount: p.subjectCount,
      categoryCounts: p.categoryCounts,
      lockoutRiskCount: p.lockoutRiskCount,
      megaKeyBleedCount: p.megaKeyBleedCount,
    })),
    users: report.users.map(sanitizeUserReport),
  };
}

function sanitizeUserReport(u: AccessComparisonUserReport): unknown {
  return {
    subjectRef: u.subjectRef,
    role: u.role,
    accessProfileRef: u.accessProfileRef,
    scenarioTag: u.scenarioTag,
    legacyCompatMode: u.legacyCompatMode,
    legacyPermissionCount: u.legacyPermissionCount,
    overrideResourceCount: u.overrideResourceCount,
    probeCount: u.probeCount,
    categoryCounts: u.categoryCounts,
    lockoutRiskCount: u.lockoutRiskCount,
    megaKeyBleedCount: u.megaKeyBleedCount,
    diffs: u.diffs.map((d) => ({
      resourceKey: d.resourceKey,
      action: d.action,
      category: d.category,
      legacyAllow: d.legacyAllow,
      newAllow: d.newAllow,
      newSource: d.newSource,
      legacyBleedKeyCount: d.legacyBleedKeys.length,
      legacyDedicatedKeyCount: d.legacyDedicatedKeys.length,
      note: d.note,
    })),
  };
}

export function toUserDiffsCsv(report: AccessComparisonGlobalReport): string {
  const header = [
    "subjectRef",
    "role",
    "accessProfileRef",
    "scenarioTag",
    "resourceKey",
    "action",
    "category",
    "legacyAllow",
    "newAllow",
    "newSource",
    "legacyBleedKeyCount",
    "legacyDedicatedKeyCount",
  ].join(",");

  const rows: string[] = [header];
  for (const u of report.users) {
    for (const d of u.diffs) {
      rows.push(
        [
          u.subjectRef,
          u.role,
          u.accessProfileRef ?? "",
          u.scenarioTag ?? "",
          d.resourceKey,
          d.action,
          d.category,
          d.legacyAllow,
          d.newAllow,
          d.newSource,
          d.legacyBleedKeys.length,
          d.legacyDedicatedKeys.length,
        ]
          .map(escapeCsv)
          .join(",")
      );
    }
  }
  return rows.join("\n");
}

export function toUserSummaryCsv(report: AccessComparisonGlobalReport): string {
  const header = [
    "subjectRef",
    "role",
    "accessProfileRef",
    "scenarioTag",
    "legacyPermissionCount",
    "lockoutRiskCount",
    "megaKeyBleedCount",
    ...CSV_CATEGORIES,
  ].join(",");

  const rows: string[] = [header];
  for (const u of report.users) {
    rows.push(
      [
        u.subjectRef,
        u.role,
        u.accessProfileRef ?? "",
        u.scenarioTag ?? "",
        u.legacyPermissionCount,
        u.lockoutRiskCount,
        u.megaKeyBleedCount,
        ...CSV_CATEGORIES.map((c) => u.categoryCounts[c] ?? 0),
      ]
        .map(escapeCsv)
          .join(",")
    );
  }
  return rows.join("\n");
}

export function formatComparisonMarkdown(report: AccessComparisonGlobalReport): string {
  const lines: string[] = [
    "# Comparação legado × novo (requireResource)",
    "",
    `| Gerado | ${report.generatedAt} |`,
    `| Dry-run | ${report.dryRun} |`,
    `| Subjects | ${report.subjectCount} |`,
    `| Probes (recurso×ação migrados) | ${report.probeCount} |`,
    `| Lockout risk | ${report.lockoutRiskCount} |`,
    `| Mega-key bleed removido | ${report.megaKeyBleedCount} |`,
    `| Sem mapeamento | ${report.unmappedResourceCount} |`,
    `| Conflito | ${report.conflictCount} |`,
    "",
    "## Categorias (global)",
    "",
    "| Categoria | Count |",
    "|-----------|-------|",
  ];

  for (const [cat, n] of Object.entries(report.categoryCounts).sort()) {
    lines.push(`| ${cat} | ${n} |`);
  }

  const leticia = report.users.find((u) => u.scenarioTag === "leticia-ap-only");
  if (leticia) {
    lines.push("", "## Cenário Leticia (AP only)", "");
    lines.push(`| subjectRef | ${leticia.subjectRef} |`);
    lines.push(`| lockout_risk | ${leticia.lockoutRiskCount} |`);
    lines.push(`| mega_key_bleed | ${leticia.megaKeyBleedCount} |`);
    lines.push("", "### Diffs", "");
    for (const d of leticia.diffs) {
      lines.push(
        `- \`${d.resourceKey}\` / \`${d.action}\`: **${d.category}** (legado=${d.legacyAllow} novo=${d.newAllow} source=${d.newSource})`
      );
    }
  }

  if (report.lockoutRiskCount > 0) {
    lines.push("", "## Lockout risk (amostra)", "");
    for (const u of report.users.filter((x) => x.lockoutRiskCount > 0).slice(0, 5)) {
      lines.push(`### ${u.subjectRef} (${u.role})`);
      for (const d of u.diffs.filter((x) => x.category === "lockout_risk").slice(0, 8)) {
        lines.push(`- \`${d.resourceKey}:${d.action}\``);
      }
    }
  }

  lines.push("", "---", "", report.note);
  return lines.join("\n");
}
