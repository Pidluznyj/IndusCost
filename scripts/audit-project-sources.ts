/**
 * Auditoria arquitetural de inventário de fontes do IndusCost.
 * Read-only — não acessa banco, não remove arquivos.
 *
 * Uso: npm run audit:project-sources
 */
import {
  formatProjectSourceAuditReport,
  PROJECT_MODULE_AUDIT_SUMMARY,
  PROJECT_REFACTOR_CANDIDATES,
  summarizeProjectSourceAudit,
} from "../src/lib/projectSourceInventoryAudit.js";

function main(): void {
  console.log(formatProjectSourceAuditReport());

  const summary = summarizeProjectSourceAudit();
  console.log("\n--- Resumo por módulo (top 10) ---");
  for (const mod of PROJECT_MODULE_AUDIT_SUMMARY.slice(0, 10)) {
    console.log(
      `${mod.module}: ${mod.filesCount} arquivos | ativos ${mod.activeCount} | risco ${mod.riskCount} | remoção futura ${mod.removalCandidatesCount}`
    );
  }

  console.log("\n--- Candidatos substituição ---");
  console.log(`Total: ${PROJECT_REFACTOR_CANDIDATES.replaceCandidates.length}`);
  for (const c of PROJECT_REFACTOR_CANDIDATES.replaceCandidates.slice(0, 8)) {
    console.log(`  - ${c.file}: ${c.reason}`);
  }

  console.log("\n--- Candidatos duplicação ---");
  console.log(`Total: ${PROJECT_REFACTOR_CANDIDATES.duplicateCandidates.length}`);
  for (const c of PROJECT_REFACTOR_CANDIDATES.duplicateCandidates) {
    console.log(`  - ${c.file}`);
  }

  console.log("\n--- Candidatos remoção futura (revisar antes) ---");
  console.log(`Total: ${PROJECT_REFACTOR_CANDIDATES.removalCandidates.length}`);
  for (const c of PROJECT_REFACTOR_CANDIDATES.removalCandidates.slice(0, 10)) {
    console.log(`  - ${c.file} [${c.risk}]`);
  }

  console.log(`\nTodos safeToRemoveNow=false: ${PROJECT_REFACTOR_CANDIDATES.removalCandidates.every((c) => c.safeToRemoveNow === false)}`);
  console.log(`\nMódulos auditados: ${summary.moduleCount}`);
}

main();
