/**
 * Preview read-only do fluxo "Igualar Bases" Nomus.
 *
 * Não escreve nada.
 *
 * Uso:
 *   npm run sync:nomus:master-data-equalize-preview
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusMasterDataEqualizePreview } from "../src/lib/nomusMasterDataEqualize.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[equalize-preview] ${msg}`);
}

async function main(): Promise<void> {
  log("iniciando…");
  const result = await buildNomusMasterDataEqualizePreview({
    limit: 200,
    offset: 0,
    scope: "ACTIONABLE",
  });

  if (result.mode !== "READ_ONLY") {
    log(`FALHA: mode esperado READ_ONLY, recebido ${result.mode}`);
    process.exitCode = 1;
    return;
  }
  log(`generatedAt=${result.generatedAt}`);
  log(`totais=${JSON.stringify(result.totals)}`);
  log(
    `paginação · totalRowsMatched=${result.pagination.totalRowsMatched} hasMore=${result.pagination.hasMore}`
  );
  log("amostra de até 15 ações:");
  for (const row of result.rows.slice(0, 15)) {
    log(`  ${row.action} · ${row.code} · ${row.description ?? "—"} · ${row.reason}`);
  }
  log("OK");
}

main()
  .catch((err) => {
    console.error("[equalize-preview] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
