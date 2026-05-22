/**
 * Diagnóstico read-only da Carga Mestre Nomus.
 *
 * Não escreve nada. Imprime totais e primeiras linhas faltantes.
 *
 * Uso:
 *   npm run sync:nomus:master-data-diagnostic
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { buildNomusMasterDataImportDiagnostic } from "../src/lib/nomusMasterDataImport.ts";

const prisma = new PrismaClient();
const PILOT = "110.03--";

function log(msg: string): void {
  console.warn(`[master-data-diagnostic] ${msg}`);
}

async function main(): Promise<void> {
  log("iniciando…");
  const result = await buildNomusMasterDataImportDiagnostic({
    limit: 100,
    offset: 0,
    classification: "MISSING",
  });

  if (result.mode !== "READ_ONLY") {
    log(`FALHA: mode esperado READ_ONLY, recebido ${result.mode}`);
    process.exitCode = 1;
    return;
  }

  log(`generatedAt=${result.generatedAt}`);
  log(`totais=${JSON.stringify(result.totals)}`);
  log(
    `paginação · limit=${result.pagination.limit} offset=${result.pagination.offset} hasMore=${result.pagination.hasMore} totalMatched=${result.pagination.totalRowsMatched}`
  );

  log("primeiras linhas faltantes:");
  for (const row of result.rows.slice(0, 10)) {
    log(
      `  ${row.code} | ${row.classificationLabel} | ${row.description ?? "—"} | ${row.reason}`
    );
  }

  // Piloto: 110.03--
  const allDiag = await buildNomusMasterDataImportDiagnostic({
    limit: 500,
    offset: 0,
    search: PILOT,
    includeExisting: true,
  });
  const piloto = allDiag.rows.find((r) => r.code === PILOT) ?? null;
  if (piloto) {
    log(`piloto 110.03-- encontrado: ${piloto.classificationLabel} · ${piloto.reason}`);
    if (piloto.proposedCreatePayloadPreview) {
      log(
        `piloto · payload sugerido: kind=${piloto.proposedCreatePayloadPreview.kind} unit=${(piloto.proposedCreatePayloadPreview as { unit?: string }).unit ?? "—"} category=${(piloto.proposedCreatePayloadPreview as { category?: string }).category ?? "—"}`
      );
    }
  } else {
    log("piloto 110.03-- não localizado neste stage Nomus.");
  }

  log("OK");
}

main()
  .catch((err) => {
    console.error("[master-data-diagnostic] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
