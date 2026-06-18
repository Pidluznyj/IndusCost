#!/usr/bin/env npx tsx
/**
 * Auditoria consolidada de prints/PDFs do IndusCost.
 * Uso: npm run audit:print-pdf
 */
import {
  PRINT_PDF_AUDIT_ENTRIES,
  assertNoCriticalPrintPending,
  formatPrintPdfAuditReport,
  summarizePrintPdfAudit,
  validatePrintPdfAuditFiles,
} from "../src/lib/printPdfAudit.js";

function main(): void {
  console.log(formatPrintPdfAuditReport());

  const summary = summarizePrintPdfAudit();
  const criticalIssues = assertNoCriticalPrintPending();
  const fileIssues: string[] = [];

  for (const entry of PRINT_PDF_AUDIT_ENTRIES) {
    fileIssues.push(...validatePrintPdfAuditFiles(entry).map((i) => `${entry.id}: ${i}`));
  }

  console.log("--- Detalhes por risco ---");
  for (const risk of ["risk", "pending", "attention"] as const) {
    const items = PRINT_PDF_AUDIT_ENTRIES.filter((e) => e.risk === risk);
    if (items.length === 0) continue;
    console.log(`\n${risk.toUpperCase()} (${items.length}):`);
    for (const entry of items) {
      console.log(`  • ${entry.feature} [${entry.id}]`);
      for (const note of entry.notes) console.log(`    - ${note}`);
    }
  }

  if (fileIssues.length > 0) {
    console.error("\nArquivos ausentes:");
    for (const issue of fileIssues) console.error(`  • ${issue}`);
    process.exitCode = 1;
  }

  if (criticalIssues.length > 0) {
    console.error("\nProblemas críticos:");
    for (const issue of criticalIssues) console.error(`  • ${issue}`);
    process.exitCode = 1;
  }

  if (summary.risk > 0 || summary.pending > 0) {
    console.warn(
      `\nAviso: ${summary.risk} risco(s), ${summary.pending} pendente(s) na matriz completa.`
    );
  } else {
    console.log("\nMatriz completa sem entradas risk/pending.");
  }
}

main();
