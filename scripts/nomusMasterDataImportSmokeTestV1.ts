/**
 * Smoke test read-only da Carga Mestre Nomus.
 *
 * Não chama apply real. Apenas diagnóstico e preview.
 *
 * Uso:
 *   npm run test:nomus:master-data-import
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  applyNomusMasterDataImport,
  buildNomusMasterDataImportDiagnostic,
  buildNomusMasterDataImportPreview,
} from "../src/lib/nomusMasterDataImport.ts";

const prisma = new PrismaClient();
const PILOT = "110.03--";

function log(msg: string): void {
  console.warn(`[master-data-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[master-data-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  log("iniciando…");

  const diag = await buildNomusMasterDataImportDiagnostic({
    limit: 50,
    offset: 0,
    classification: "MISSING",
  });
  if (diag.mode !== "READ_ONLY") {
    fail(`mode esperado READ_ONLY, recebido ${diag.mode}`);
  }
  if (!diag.totals || typeof diag.totals.distinctNomusCodes !== "number") {
    fail("totals ausente ou inválido");
  }
  if (!Array.isArray(diag.rows)) {
    fail("rows deve ser array");
  }
  log(
    `diagnostic OK · distinct=${diag.totals.distinctNomusCodes} missing=${diag.totals.missingTotal} safeProduct=${diag.totals.safeProductCandidates} safeMaterial=${diag.totals.safeMaterialCandidates} blocked=${diag.totals.blocked + diag.totals.ambiguousReview}`
  );

  // Piloto: 110.03--
  const pilotDiag = await buildNomusMasterDataImportDiagnostic({
    limit: 500,
    offset: 0,
    search: PILOT,
    includeExisting: true,
  });
  const pilot = pilotDiag.rows.find((r) => r.code === PILOT) ?? null;
  if (pilot) {
    log(
      `piloto 110.03-- · ${pilot.classificationLabel} · existingMaterial=${pilot.existingMaterialId != null} existingProduct=${pilot.existingProductId != null} canImport=${pilot.canImportSafely}`
    );
    if (
      pilot.existingMaterialId == null &&
      pilot.existingProductId == null &&
      pilot.classification !== "SAFE_MATERIAL_CANDIDATE"
    ) {
      log(
        `piloto · classificação ${pilot.classification} não é SAFE_MATERIAL_CANDIDATE — investigar motivo: ${pilot.reason}`
      );
    }
  } else {
    log("piloto 110.03-- não encontrado no stage Nomus.");
  }

  const preview = await buildNomusMasterDataImportPreview({ classification: "ALL_SAFE" });
  if (preview.mode !== "READ_ONLY") {
    fail(`preview.mode esperado READ_ONLY, recebido ${preview.mode}`);
  }
  log(
    `preview OK · candidatesPlanned=${preview.totals.candidatesPlanned} (Product=${preview.totals.productsPlanned} Material=${preview.totals.materialsPlanned}) skipped=${preview.totals.skippedExistingPlanned} blocked=${preview.totals.blockedPlanned}`
  );

  // Apply sem confirmação: deve retornar BLOCKED, nunca alterar dados.
  const blockedNoConfirm = await applyNomusMasterDataImport({
    mode: "SAFE_ONLY",
    confirmationText: "",
  });
  if (blockedNoConfirm.status !== "BLOCKED") {
    fail(`apply sem confirmação deveria retornar BLOCKED, recebido ${blockedNoConfirm.status}`);
  }
  log(`apply sem confirmação · status=${blockedNoConfirm.status} (esperado BLOCKED)`);

  const blockedWrong = await applyNomusMasterDataImport({
    mode: "SAFE_ONLY",
    confirmationText: "TEXTO ERRADO",
  });
  if (blockedWrong.status !== "BLOCKED") {
    fail(`apply com confirmação errada deveria retornar BLOCKED, recebido ${blockedWrong.status}`);
  }
  log(`apply com confirmação errada · status=${blockedWrong.status} (esperado BLOCKED)`);

  log("OK — smoke read-only concluído. Nenhuma mutation executada.");
}

main()
  .catch((err) => {
    console.error("[master-data-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
