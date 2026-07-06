#!/usr/bin/env npx tsx
/**
 * Auditoria automatizada do agrupamento visual da sidebar.
 *
 * Valida paths, labels, permissões, grupos, rotas App.tsx e ausência de Prisma no frontend nav.
 *
 * Uso:
 *   npm run audit:navigation-grouping
 *   npx tsx scripts/audit-navigation-grouping.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatNavigationGroupingAuditReport,
  runNavigationGroupingAudit,
} from "../src/lib/navigationGroupingAudit.js";

const REPORT_PATH = join(process.cwd(), "docs", "navigation", "navigation-grouping-audit-report.json");

function main(): void {
  const result = runNavigationGroupingAudit();
  const report = formatNavigationGroupingAuditReport(result);

  console.log(report);

  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        status: result.status,
        runAt: new Date().toISOString(),
        baselinePath: result.baselinePath,
        findings: result.findings,
      },
      null,
      2
    )
  );
  console.log(`Relatório JSON: ${REPORT_PATH}`);

  if (result.status === "BLOQUEANTE") {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

main();
