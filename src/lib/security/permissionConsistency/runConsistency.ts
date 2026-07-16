/**
 * Orquestra o validador de consistência P02.
 */

import { runPermissionAudit } from "@/src/lib/security/permissionAudit/index.js";
import {
  runCrossCatalogChecks,
  runPermissiveFallbackChecks,
  runStructuralChecks,
} from "./checks.ts";
import { collectPermissionConsistencySources } from "./collectSources.ts";
import {
  isBaselinedFinding,
  listStaleBaselineEntries,
  PERMISSION_CONSISTENCY_BASELINE,
} from "./baseline.ts";
import type {
  PermissionConsistencyFinding,
  PermissionConsistencyMode,
  PermissionConsistencyReport,
  PermissionConsistencySummary,
} from "./types.ts";

const LIMITATIONS = [
  "Baseline temporário documenta gaps históricos; strict só falha em findings novos (code+subject).",
  "Scan de mutações reutiliza permissionAudit (AST); wrappers dinâmicos podem escapar.",
  "Abas financeiras usam heurística de mapeamento id → resourceKey.",
  "RESOURCE_REGISTERED_NEVER_USED ignora uso só via strings dinâmicas.",
  "Não acessa banco nem produção; AppUser.permissions[] não é lido.",
];

function mergeAuditFindings(
  includeAudit: boolean
): PermissionConsistencyFinding[] {
  if (!includeAudit) return [];
  const audit = runPermissionAudit({ mode: "report" });
  const out: PermissionConsistencyFinding[] = [];
  for (const f of audit.findings) {
    if (f.code === "MUTATION_WITHOUT_PERMISSION_GUARD" && f.severity === "error" && !f.knownGap) {
      out.push({
        code: "MUTATION_WITHOUT_PERMISSION_GUARD",
        severity: "error",
        message: f.message,
        subject: f.subject ?? f.message,
        evidence: f.evidence,
      });
    }
    if (f.severity === "error" && !f.knownGap) {
      // já cobertos por checks de consistência ou mutation acima
      if (
        f.code === "USED_NOT_IN_CATALOG" ||
        f.code === "ALIAS_MISSING_FROM_CATALOG" ||
        f.code === "CONTRACT_ISSUE" ||
        f.code === "SIDEBAR_WITHOUT_CONTRACT"
      ) {
        out.push({
          code: "AUDIT_ACTIONABLE_ERROR",
          severity: "error",
          message: `[audit:${f.code}] ${f.message}`,
          subject: `audit:${f.code}:${f.subject ?? f.message}`,
          evidence: f.evidence,
        });
      }
    }
  }
  return out;
}

function dedupeFindings(
  findings: PermissionConsistencyFinding[]
): PermissionConsistencyFinding[] {
  const seen = new Set<string>();
  const out: PermissionConsistencyFinding[] = [];
  for (const f of findings) {
    const id = `${f.code}::${f.subject}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  return out;
}

function summarize(
  mode: PermissionConsistencyMode,
  findings: PermissionConsistencyFinding[],
  newFindings: PermissionConsistencyFinding[],
  stale: PermissionConsistencyFinding[],
  sources: ReturnType<typeof collectPermissionConsistencySources>
): PermissionConsistencySummary {
  const findingCounts = { error: 0, warn: 0, info: 0 };
  let baselinedCount = 0;
  for (const f of findings) {
    findingCounts[f.severity] += 1;
    if (f.baselined) baselinedCount += 1;
  }
  const newFindingCount = newFindings.length;
  const ok = mode === "report" ? true : newFindingCount === 0;
  return {
    mode,
    sources: {
      contractResources: sources.contractKeys.size,
      seedResources: sources.seedKeys.size,
      frontendResources: sources.frontendKeys.size,
      catalogLegacyKeys: sources.catalogLegacyKeys.size,
      sidebarModulesMapped: sources.sidebarModuleKeys.size,
      tabResources: sources.tabEntries.length,
    },
    findingCounts,
    baselinedCount,
    newFindingCount,
    staleBaselineCount: stale.length,
    ok,
  };
}

export function runPermissionConsistency(options?: {
  mode?: PermissionConsistencyMode;
  includeAudit?: boolean;
  /** Em strict, reportar baseline stale como finding (não falha por default). */
  failOnStaleBaseline?: boolean;
}): PermissionConsistencyReport {
  const mode = options?.mode ?? "report";
  const includeAudit = options?.includeAudit ?? true;
  const sources = collectPermissionConsistencySources();

  let findings = dedupeFindings([
    ...runStructuralChecks(sources),
    ...runCrossCatalogChecks(sources),
    ...runPermissiveFallbackChecks(),
    ...mergeAuditFindings(includeAudit),
  ]);

  for (const f of findings) {
    f.baselined = isBaselinedFinding(f.code, f.subject);
  }

  const newFindings = findings.filter((f) => !f.baselined);
  const baselinedFindings = findings.filter((f) => f.baselined);

  const staleEntries = listStaleBaselineEntries(
    findings.map((f) => ({ code: f.code, subject: f.subject }))
  );
  const staleBaselineEntries: PermissionConsistencyFinding[] = staleEntries.map(
    (e) => ({
      code: "BASELINE_STALE",
      severity: "info",
      message: `Baseline sem finding atual: ${e.code} / ${e.subject}`,
      subject: `${e.code}::${e.subject}`,
      staleBaseline: true,
      evidence: [e.reason],
    })
  );

  if (options?.failOnStaleBaseline) {
    findings = [...findings, ...staleBaselineEntries];
  }

  const summary = summarize(
    mode,
    findings,
    newFindings,
    staleBaselineEntries,
    sources
  );

  // Em strict com failOnStaleBaseline, stale conta como “novo”
  if (mode === "strict" && options?.failOnStaleBaseline && staleBaselineEntries.length > 0) {
    summary.ok = false;
    summary.newFindingCount += staleBaselineEntries.length;
  }

  return {
    generatedAt: new Date().toISOString(),
    summary,
    findings,
    newFindings,
    baselinedFindings,
    staleBaselineEntries,
    limitations: [...LIMITATIONS],
  };
}

export function formatPermissionConsistencyText(
  report: PermissionConsistencyReport
): string {
  const lines: string[] = [];
  const s = report.summary;
  lines.push(`[check:permission-consistency] mode=${s.mode} ok=${s.ok}`);
  lines.push(
    `[check:permission-consistency] sources contract=${s.sources.contractResources} seed=${s.sources.seedResources} fe=${s.sources.frontendResources} catalog=${s.sources.catalogLegacyKeys} sidebar=${s.sources.sidebarModulesMapped} tabs=${s.sources.tabResources}`
  );
  lines.push(
    `[check:permission-consistency] findings error=${s.findingCounts.error} warn=${s.findingCounts.warn} info=${s.findingCounts.info} baselined=${s.baselinedCount} new=${s.newFindingCount} staleBaseline=${s.staleBaselineCount}`
  );

  if (report.newFindings.length > 0) {
    lines.push("");
    lines.push("## Novos gaps (falham --strict)");
    for (const f of report.newFindings.slice(0, 40)) {
      lines.push(`- [${f.severity}] ${f.code}: ${f.message}`);
    }
    if (report.newFindings.length > 40) {
      lines.push(`- … +${report.newFindings.length - 40}`);
    }
  }

  if (report.baselinedFindings.length > 0) {
    lines.push("");
    lines.push(`## Baseline temporário (${report.baselinedFindings.length})`);
    const byCode = new Map<string, number>();
    for (const f of report.baselinedFindings) {
      byCode.set(f.code, (byCode.get(f.code) ?? 0) + 1);
    }
    for (const [code, n] of [...byCode.entries()].sort()) {
      lines.push(`- ${code}: ${n}`);
    }
  }

  lines.push("");
  lines.push("## Limitações");
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push(`baselineEntries=${PERMISSION_CONSISTENCY_BASELINE.length}`);
  return lines.join("\n");
}

export function formatPermissionConsistencyMarkdown(
  report: PermissionConsistencyReport
): string {
  const lines: string[] = [];
  lines.push("# Relatório — consistência de permissões (P02)");
  lines.push("");
  lines.push("| | |");
  lines.push("|---|---|");
  lines.push(`| Gerado | ${report.generatedAt} |`);
  lines.push(`| Modo | ${report.summary.mode} |`);
  lines.push(`| OK | ${report.summary.ok ? "sim" : "não"} |`);
  lines.push(`| Novos gaps | ${report.summary.newFindingCount} |`);
  lines.push(`| Baselined | ${report.summary.baselinedCount} |`);
  lines.push(`| Stale baseline | ${report.summary.staleBaselineCount} |`);
  lines.push("");
  lines.push("## Fontes");
  lines.push(`- Contrato: ${report.summary.sources.contractResources}`);
  lines.push(`- Seed: ${report.summary.sources.seedResources}`);
  lines.push(`- Frontend: ${report.summary.sources.frontendResources}`);
  lines.push(`- Catálogo legado: ${report.summary.sources.catalogLegacyKeys}`);
  lines.push("");
  lines.push("## Novos gaps");
  if (report.newFindings.length === 0) lines.push("_Nenhum._");
  else {
    for (const f of report.newFindings) {
      lines.push(`- **${f.severity}** \`${f.code}\` \`${f.subject}\`: ${f.message}`);
    }
  }
  lines.push("");
  lines.push("## Baseline (amostra)");
  for (const f of report.baselinedFindings.slice(0, 60)) {
    lines.push(`- \`${f.code}\` / \`${f.subject}\``);
  }
  if (report.baselinedFindings.length > 60) {
    lines.push(`- … +${report.baselinedFindings.length - 60}`);
  }
  lines.push("");
  lines.push("## Limitações");
  for (const l of report.limitations) lines.push(`- ${l}`);
  lines.push("");
  return lines.join("\n");
}

export function permissionConsistencyReportToJson(
  report: PermissionConsistencyReport
): string {
  return JSON.stringify(report, null, 2);
}
