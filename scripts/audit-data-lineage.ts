/**
 * Auditoria de rastreabilidade de dados e hardcode de negócio.
 * Read-only — não acessa banco.
 *
 * Uso: npm run audit:data-lineage
 *      npx tsx scripts/audit-data-lineage.ts
 */
import {
  getProductionRiskFindings,
  scanProductionSources,
  summarizeHardcodedFindings,
} from "../src/lib/hardcodedBusinessDataAudit.js";
import {
  SYSTEM_DATA_LINEAGE,
  summarizeSystemDataLineage,
} from "../src/lib/systemDataLineageAudit.js";

function main(): void {
  console.log("=== IndusCost — Data Lineage & Hardcode Audit ===\n");

  const lineageSummary = summarizeSystemDataLineage();
  console.log(`Funcionalidades auditadas: ${lineageSummary.total}`);
  console.log(`  OK (fonte real):        ${lineageSummary.byStatus.ok}`);
  console.log(`  Derived:                ${lineageSummary.byStatus.derived}`);
  console.log(`  Static UI:              ${lineageSummary.byStatus["static-ui"]}`);
  console.log(`  Atenção:                ${lineageSummary.byStatus.attention}`);
  console.log(`  Risco:                  ${lineageSummary.byStatus.risk}`);
  console.log(`  Pendente:               ${lineageSummary.byStatus.pending}`);

  if (lineageSummary.riskIds.length > 0) {
    console.log("\nRiscos na matriz:");
    for (const id of lineageSummary.riskIds) {
      const entry = SYSTEM_DATA_LINEAGE.find((e) => e.id === id);
      console.log(`  - ${id}: ${entry?.feature ?? "?"}`);
    }
  }

  if (lineageSummary.pendingIds.length > 0) {
    console.log("\nPendentes na matriz:");
    for (const id of lineageSummary.pendingIds) {
      console.log(`  - ${id}`);
    }
  }

  console.log("\n--- Fontes principais ---");
  const models = new Set<string>();
  for (const e of SYSTEM_DATA_LINEAGE) {
    for (const m of e.prismaModels) models.add(m);
  }
  console.log(`Modelos Prisma: ${[...models].sort().join(", ")}`);

  console.log("\n--- Hardcode scan (produção) ---");
  const findings = scanProductionSources();
  const hardSummary = summarizeHardcodedFindings(findings);
  console.log(`Achados totais: ${hardSummary.total}`);
  console.log(`  Permitidos:   ${hardSummary.allowed}`);
  console.log(`  Riscos:       ${hardSummary.risks}`);

  const risks = getProductionRiskFindings(findings);
  if (risks.length > 0) {
    console.log("\nArquivos com hardcode suspeito:");
    for (const file of hardSummary.riskFiles) {
      console.log(`  - ${file}`);
      for (const f of risks.filter((r) => r.file === file)) {
        const line = f.lineHint ? `:${f.lineHint}` : "";
        console.log(`      [${f.severity}/${f.kind}]${line} ${f.reason}`);
      }
    }
  } else {
    console.log("\nNenhum hardcode suspeito de alto/médio risco em produção.");
  }

  console.log("\n=== Fim da auditoria ===");
}

main();
