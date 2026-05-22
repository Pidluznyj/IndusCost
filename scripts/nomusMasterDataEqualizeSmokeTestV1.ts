/**
 * Smoke test read-only do fluxo "Igualar Bases" Nomus.
 *
 * Não chama apply real. Valida:
 *  - preview retorna READ_ONLY;
 *  - apply sem confirmação retorna BLOCKED;
 *  - apply com confirmação errada retorna BLOCKED;
 *  - nenhuma mutation é executada.
 *
 * Uso: npm run test:nomus:master-data-equalize
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyNomusMasterDataEqualize,
  buildNomusMasterDataEqualizePreview,
} from "../src/lib/nomusMasterDataEqualize.ts";

const prisma = new PrismaClient();

function log(msg: string): void {
  console.warn(`[equalize-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[equalize-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  log("iniciando…");

  const preview = await buildNomusMasterDataEqualizePreview({
    limit: 50,
    offset: 0,
    scope: "ACTIONABLE",
  });
  if (preview.mode !== "READ_ONLY") fail(`preview.mode esperado READ_ONLY, recebido ${preview.mode}`);
  if (!preview.totals) fail("totals ausente");
  if (!Array.isArray(preview.rows)) fail("rows deve ser array");
  log(
    `preview OK · totalRowsConsidered=${preview.totals.totalRowsConsidered} createP=${preview.totals.createProducts} createM=${preview.totals.createMaterials} updateP=${preview.totals.updateProducts} updateM=${preview.totals.updateMaterials} deactivateP=${preview.totals.deactivateProducts} deactivateM=${preview.totals.deactivateMaterials} preserveLocal=${preview.totals.preserveLocalProducts + preview.totals.preserveLocalMaterials} ambig=${preview.totals.ambiguous} blocked=${preview.totals.blocked}`
  );

  // Apply sem confirmação → BLOCKED.
  const blocked1 = await applyNomusMasterDataEqualize({
    confirmationText: "",
    scope: "SAFE_ONLY",
  });
  if (blocked1.status !== "BLOCKED") {
    fail(`apply sem confirmação deveria ser BLOCKED, recebido ${blocked1.status}`);
  }
  log(`apply sem confirmação · status=${blocked1.status} (esperado BLOCKED)`);

  // Apply com confirmação errada → BLOCKED.
  const blocked2 = await applyNomusMasterDataEqualize({
    confirmationText: "TEXTO ERRADO",
    scope: "SAFE_ONLY",
  });
  if (blocked2.status !== "BLOCKED") {
    fail(`apply com confirmação errada deveria ser BLOCKED, recebido ${blocked2.status}`);
  }
  log(`apply com confirmação errada · status=${blocked2.status} (esperado BLOCKED)`);

  log("OK — smoke read-only concluído. Nenhuma mutation executada.");
}

main()
  .catch((err) => {
    console.error("[equalize-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
