#!/usr/bin/env npx tsx
/**
 * Diagnóstico de bootstrap da cobertura de comissão — SOMENTE LEITURA.
 *
 * Mostra como a base fica no cutover Nomus → IndusCost: recebimentos antes da
 * janela legada (ignorados), candidatos de 08/2026 e 09/2026, quantos já têm
 * cobertura importada do Nomus, quantos não, ambíguos e pós-cutover.
 *
 * Não existe "bootstrap apply": a regra da janela não depende de dados gravados
 * e a cobertura legada entra só pela importação do relatório do Nomus
 * (npm run commission:coverage:legacy-import).
 *
 * Uso:
 *   npm run commission:coverage:bootstrap:preview
 *   npm run commission:coverage:bootstrap:preview -- --json
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/prisma.ts";
import { buildCommissionCoverageBootstrapPreview } from "../src/lib/commissions/commissionCoverageAudit.server.ts";
import { hasFlag, requireDatabaseUrl } from "./commission-script-utils.ts";

async function main(): Promise<void> {
  requireDatabaseUrl();
  const preview = await buildCommissionCoverageBootstrapPreview(prisma);

  if (hasFlag("json")) {
    const payload = { mode: "bootstrap-preview-read-only", ...preview };
    writeFileSync("commission-coverage-bootstrap-preview.json", JSON.stringify(payload, null, 2), "utf8");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("=== Bootstrap da cobertura de comissão — prévia (somente leitura) ===");
  console.log(`Cutover oficial IndusCost: ${preview.cutoverDate}`);
  console.log(`Início da janela de conciliação legada: ${preview.legacyReconciliationStartDate}`);
  console.log();
  console.log(
    `Recebimentos antes de ${preview.legacyReconciliationStartDate} (histórico Nomus, ignorados): ${preview.beforeWindowReceipts}`
  );
  for (const month of preview.months) {
    console.log();
    console.log(`Competência ${month.competence} (Nomus oficial):`);
    console.log(`  Recebimentos: ${month.receipts}`);
    console.log(`  Cobertos pela importação do Nomus: ${month.coveredByNomusImport}`);
    console.log(`  Não cobertos (candidatos a pendência legada): ${month.notCovered}`);
    console.log(`  Ambíguos (revisão manual): ${month.ambiguous}`);
    console.log(`  Relatório do Nomus importado: ${month.imported ? "sim" : "NÃO — importar antes de liberar"}`);
  }
  console.log();
  console.log(`Pós-cutover (desde ${preview.cutoverDate}):`);
  console.log(`  Recebimentos: ${preview.postCutover.receipts}`);
  console.log(`  Cobertos por fechamento IndusCost: ${preview.postCutover.coveredByInduscost}`);
  console.log(`  Pendentes: ${preview.postCutover.pending}`);
  console.log();
  console.log("Nada foi gravado. Não há bootstrap apply: use a importação do relatório do Nomus.");
}

main()
  .catch((error) => {
    console.error(
      "[commission-coverage-bootstrap-preview] falhou:",
      error instanceof Error ? error.message : error
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
