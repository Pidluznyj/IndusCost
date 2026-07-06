/**
 * Preview read-only da Carga Mestre Nomus.
 *
 * Mostra quantos Products/Materials seriam criados se a importação segura rodasse.
 * Não escreve nada.
 *
 * Uso:
 *   npm run sync:nomus:master-data-preview
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusMasterDataImportPreview } from "../src/lib/nomusMasterDataImport.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[master-data-preview] ${msg}`);
}

async function main(): Promise<void> {
  log("iniciando…");
  const result = await buildNomusMasterDataImportPreview({ classification: "ALL_SAFE" });

  if (result.mode !== "READ_ONLY") {
    log(`FALHA: mode esperado READ_ONLY, recebido ${result.mode}`);
    process.exitCode = 1;
    return;
  }

  log(`totais=${JSON.stringify(result.totals)}`);
  log(`amostra de até 10 itens que seriam criados:`);
  for (const item of result.toCreate.slice(0, 10)) {
    log(
      `  + ${item.payload?.kind ?? "?"} ${item.code} | ${item.description ?? "—"} | ${item.reason}`
    );
  }
  if (result.blocked.length > 0) {
    log("amostra de até 5 bloqueados:");
    for (const item of result.blocked.slice(0, 5)) {
      log(`  - ${item.code} | ${item.classification} | ${item.reason}`);
    }
  }
  if (result.skippedExisting.length > 0) {
    log(`Já existentes (não serão importados): ${result.skippedExisting.length}.`);
  }

  log("OK");
}

main()
  .catch((err) => {
    console.error("[master-data-preview] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
