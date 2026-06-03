/**
 * Aplica automaticamente ProductBOM a partir do stage Nomus para todos os produtos
 * (ou um parentCode específico), respeitando gates do apply controlado.
 *
 * Uso:
 *   npm run sync:nomus:bom-auto-apply              # dry-run
 *   npm run sync:nomus:bom-auto-apply -- --apply   # aplica de fato
 *   npm run sync:nomus:bom-auto-apply -- --parentCode=307.05AA --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  resolveAutoApplyBatchOutcome,
  runNomusBomAutoApplyAfterSync,
} from "../src/lib/nomusBomAutoApplyAfterSync.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[nomus-bom-auto-apply] ${msg}`);
}

function parseArgs(): { mode: "DRY" | "APPLY"; parentCode?: string } {
  const args = process.argv.slice(2);
  const mode: "DRY" | "APPLY" = args.includes("--apply") ? "APPLY" : "DRY";
  let parentCode: string | undefined;
  for (const arg of args) {
    const m = arg.match(/^--parentCode=(.+)$/);
    if (m) parentCode = m[1].trim();
  }
  return { mode, parentCode };
}

async function main(): Promise<void> {
  const { mode, parentCode } = parseArgs();
  log(`modo=${mode}${parentCode ? ` parentCode=${parentCode}` : " (todos os produtos no stage)"}`);

  const report = await runNomusBomAutoApplyAfterSync({
    mode,
    parentCode,
  });

  console.log(JSON.stringify(report, null, 2));

  log("--- RESUMO ---");
  log(`avaliados=${report.totals.parentsEvaluated}`);
  log(`aplicados=${report.totals.parentsApplied}`);
  log(`sem alteração=${report.totals.parentsNoChanges}`);
  log(`bloqueados=${report.totals.parentsBlocked}`);
  log(`erros=${report.totals.parentsErrored}`);
  log(`linhas: +${report.totals.linesCreated} ~${report.totals.linesUpdated} -${report.totals.linesRemoved}`);
  if (report.reportMdPath) log(`relatório MD: ${report.reportMdPath}`);
  if (report.reportJsonPath) log(`relatório JSON: ${report.reportJsonPath}`);

  const outcome = report.batchOutcome ?? resolveAutoApplyBatchOutcome(report.totals);
  if (outcome === "FAILED") {
    process.exitCode = 1;
  }
  if (outcome === "SUCCESS_WITH_BLOCKED") {
    log(
      `concluído com bloqueios: ${report.totals.parentsBlocked} produto(s) — resolva na Manutenção Nomus (opcionais/engenharia).`
    );
  }
}

main()
  .catch((err) => {
    console.error("[nomus-bom-auto-apply] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
