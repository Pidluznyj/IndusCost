/**
 * CLI P02 — check:permission-consistency
 *
 *   npx tsx scripts/checkPermissionConsistency.ts --report
 *   npx tsx scripts/checkPermissionConsistency.ts --strict
 *   npx tsx scripts/checkPermissionConsistency.ts --report --json docs/generated/permission-consistency.json
 *   npx tsx scripts/checkPermissionConsistency.ts --dump-baseline  # regenera lista sugerida (stdout)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatPermissionConsistencyMarkdown,
  formatPermissionConsistencyText,
  permissionConsistencyReportToJson,
  runPermissionConsistency,
  type PermissionConsistencyMode,
} from "../src/lib/security/permissionConsistency/index.ts";

function parseArgs(argv: string[]): {
  mode: PermissionConsistencyMode;
  jsonPath: string | null;
  mdPath: string | null;
  dumpBaseline: boolean;
  noAudit: boolean;
} {
  const mode: PermissionConsistencyMode = argv.includes("--strict")
    ? "strict"
    : "report";
  let jsonPath: string | null = null;
  let mdPath: string | null = null;
  const jsonIdx = argv.indexOf("--json");
  if (jsonIdx >= 0 && argv[jsonIdx + 1]) jsonPath = argv[jsonIdx + 1]!;
  const mdIdx = argv.indexOf("--md");
  if (mdIdx >= 0 && argv[mdIdx + 1]) mdPath = argv[mdIdx + 1]!;
  return {
    mode,
    jsonPath,
    mdPath,
    dumpBaseline: argv.includes("--dump-baseline"),
    noAudit: argv.includes("--no-audit"),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const root = process.cwd();

  const report = runPermissionConsistency({
    mode: args.mode,
    includeAudit: !args.noAudit,
  });

  if (args.dumpBaseline) {
    const entries = report.findings
      .filter((f) => f.code !== "BASELINE_STALE")
      .map((f) => ({
        code: f.code,
        subject: f.subject,
        reason: f.message.slice(0, 160),
      }));
    console.log(
      `// Auto-dump ${entries.length} entries — revise before committing\n`
    );
    console.log("export const PERMISSION_CONSISTENCY_BASELINE = ");
    console.log(JSON.stringify(entries, null, 2));
    console.log(" as const;");
    process.exit(0);
  }

  console.log(formatPermissionConsistencyText(report));

  const outDir = path.join(root, "docs", "generated");
  mkdirSync(outDir, { recursive: true });
  const defaultMd = path.join(outDir, "permission-consistency-report.md");
  const mdTarget = args.mdPath
    ? path.isAbsolute(args.mdPath)
      ? args.mdPath
      : path.join(root, args.mdPath)
    : defaultMd;
  writeFileSync(mdTarget, formatPermissionConsistencyMarkdown(report), "utf8");
  console.log(
    `[check:permission-consistency] report=${path.relative(root, mdTarget)}`
  );

  if (args.jsonPath) {
    const jsonTarget = path.isAbsolute(args.jsonPath)
      ? args.jsonPath
      : path.join(root, args.jsonPath);
    mkdirSync(path.dirname(jsonTarget), { recursive: true });
    writeFileSync(jsonTarget, permissionConsistencyReportToJson(report), "utf8");
    console.log(
      `[check:permission-consistency] json=${path.relative(root, jsonTarget)}`
    );
  }

  if (args.mode === "report") {
    process.exit(0);
  }

  if (!report.summary.ok) {
    console.error(
      `[check:permission-consistency] FAIL — ${report.summary.newFindingCount} novo(s) gap(s)`
    );
    for (const f of report.newFindings.slice(0, 25)) {
      console.error(`  - ${f.code}: ${f.subject}`);
    }
    process.exit(1);
  }

  console.log("[check:permission-consistency] OK");
  process.exit(0);
}

main();
