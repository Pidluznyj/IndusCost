/**
 * CLI — Validador automático de permissões (Prompt 03).
 *
 * Uso:
 *   npx tsx scripts/auditPermissionContract.ts --report
 *   npx tsx scripts/auditPermissionContract.ts --strict
 *   npx tsx scripts/auditPermissionContract.ts --full
 *
 * npm:
 *   npm run audit:permission-contract
 *   npm run audit:permission-contract:report
 *   npm run audit:permission-contract:strict
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatPermissionAuditMarkdown,
  runPermissionAudit,
  type PermissionAuditMode,
} from "../src/lib/security/permissionAudit/index.ts";

function parseMode(argv: string[]): PermissionAuditMode {
  if (argv.includes("--strict")) return "strict";
  if (argv.includes("--full")) return "full";
  return "report";
}

function main(): void {
  const mode = parseMode(process.argv.slice(2));
  const root = process.cwd();
  const report = runPermissionAudit({ root, mode });

  const outDir = path.join(root, "docs", "generated");
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "permission-contract-audit-report.md");
  const md = formatPermissionAuditMarkdown(report);
  writeFileSync(outPath, md, "utf8");

  const { summary } = report;
  console.log(`[audit:permission-contract] mode=${mode}`);
  console.log(
    `[audit:permission-contract] catalog=${summary.catalogKeyCount} contract=${summary.contractResourceCount} seed=${summary.relationalSeedCount}`
  );
  console.log(
    `[audit:permission-contract] feKeys=${summary.frontendUsageCount} beKeys=${summary.backendUsageCount} routes=${summary.routeScanCount}`
  );
  console.log(
    `[audit:permission-contract] findings error=${summary.findingCounts.error} warn=${summary.findingCounts.warn} info=${summary.findingCounts.info} knownGaps=${summary.knownGapCount} actionableErrors=${summary.actionableErrorCount}`
  );
  console.log(`[audit:permission-contract] report=${path.relative(root, outPath)}`);

  if (mode === "report") {
    process.exit(0);
  }

  // strict e full: falham em erros acionáveis (não knownGap)
  if (!summary.ok) {
    console.error(
      `[audit:permission-contract] FAIL — ${summary.actionableErrorCount} erro(s) estrutural(is) novo(s)`
    );
    const samples = report.findings
      .filter((f) => f.severity === "error" && !f.knownGap)
      .slice(0, 15);
    for (const f of samples) {
      console.error(`  - ${f.code}: ${f.message}`);
    }
    process.exit(1);
  }

  console.log("[audit:permission-contract] OK");
  process.exit(0);
}

main();
