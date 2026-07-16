/**
 * One-shot: regenera baseline.ts a partir dos findings atuais (--no-audit).
 * Uso: npx tsx scripts/generatePermissionConsistencyBaseline.ts
 */
import { writeFileSync } from "node:fs";
import { runPermissionConsistency } from "../src/lib/security/permissionConsistency/index.ts";

const report = runPermissionConsistency({ mode: "report", includeAudit: false });
const entries = report.findings.map((f) => ({
  code: f.code,
  subject: f.subject,
  reason: f.message.length > 140 ? `${f.message.slice(0, 137)}...` : f.message,
}));

const serialized = entries
  .map((e) => `  ${JSON.stringify(e)},`)
  .join("\n");

const file = `/**
 * Baseline temporário P02 — gaps históricos conhecidos (frozen 2026-07-16).
 * Strict falha apenas em findings cujo (code, subject) NÃO está aqui.
 *
 * Ao corrigir um gap: remova a entrada correspondente.
 * Ao introduzir gap novo: o CI deve falhar — NÃO adicione aqui sem revisão em
 * docs/security/permissions-consistency.md.
 */

import type {
  PermissionConsistencyBaselineEntry,
  PermissionConsistencyCode,
} from "./types.ts";

export const PERMISSION_CONSISTENCY_BASELINE: readonly PermissionConsistencyBaselineEntry[] = [
${serialized}
];

export function baselineKey(
  code: PermissionConsistencyCode | string,
  subject: string
): string {
  return \`\${code}::\${subject}\`;
}

export function buildBaselineIndex(
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): ReadonlySet<string> {
  return new Set(entries.map((e) => baselineKey(e.code, e.subject)));
}

let cachedIndex: ReadonlySet<string> | null = null;

export function isBaselinedFinding(
  code: PermissionConsistencyCode,
  subject: string,
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): boolean {
  if (entries === PERMISSION_CONSISTENCY_BASELINE) {
    if (!cachedIndex) cachedIndex = buildBaselineIndex(entries);
    return cachedIndex.has(baselineKey(code, subject));
  }
  return buildBaselineIndex(entries).has(baselineKey(code, subject));
}

export function listStaleBaselineEntries(
  current: readonly { code: PermissionConsistencyCode; subject: string }[],
  entries: readonly PermissionConsistencyBaselineEntry[] = PERMISSION_CONSISTENCY_BASELINE
): PermissionConsistencyBaselineEntry[] {
  const live = new Set(current.map((f) => baselineKey(f.code, f.subject)));
  return entries.filter((e) => !live.has(baselineKey(e.code, e.subject)));
}
`;

writeFileSync("src/lib/security/permissionConsistency/baseline.ts", file, "utf8");
console.log(`[generatePermissionConsistencyBaseline] wrote ${entries.length} entries`);
