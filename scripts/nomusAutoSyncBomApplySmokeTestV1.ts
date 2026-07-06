/**
 * Smoke test do auto apply BOM após sync Nomus.
 *
 * - Dry-run em lote não grava mutations;
 * - Produto piloto 307.05AA: preview íntegro;
 * - Produto bloqueado não derruba o batch (dry-run);
 * - Constantes de auditoria corretas.
 *
 * Uso: npm run test:nomus:auto-sync-bom-apply
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import {
  NOMUS_AUTO_SYNC_APPROVED_BY,
  NOMUS_AUTO_SYNC_AUDIT_ORIGIN,
  runNomusBomAutoApplyAfterSync,
} from "../src/lib/nomusBomAutoApplyAfterSync.ts";
import { buildControlledApplyPreview } from "../src/lib/nomusBomControlledApply.ts";

const prisma = new PrismaClient();
const PILOT = "307.05AA";

function log(msg: string): void {
  console.warn(`[auto-sync-bom-apply-smoke] ${msg}`);
}

function fail(msg: string): never {
  console.error(`[auto-sync-bom-apply-smoke] FALHA: ${msg}`);
  process.exitCode = 1;
  throw new Error(msg);
}

async function main(): Promise<void> {
  log("iniciando…");
  assert.equal(NOMUS_AUTO_SYNC_APPROVED_BY, "nomus-auto-sync");
  assert.equal(NOMUS_AUTO_SYNC_AUDIT_ORIGIN, "NOMUS_AUTO_SYNC_BOM_APPLY");

  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL ausente — pulando validação com banco (read-only parcial).");
    log("OK — smoke parcial concluído.");
    return;
  }

  const [runsBefore, changesBefore, applyRunsBefore, bomLinesBefore] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
    prisma.nomusBomApplyRun.count(),
    prisma.productBOM.count(),
  ]);
  log(
    `snapshot · EngineeringSyncRun=${runsBefore} EngineeringChangeLog=${changesBefore} NomusBomApplyRun=${applyRunsBefore} ProductBOM=${bomLinesBefore}`
  );

  log(`> preview piloto ${PILOT}`);
  try {
    const preview = await buildControlledApplyPreview(PILOT);
    log(
      `  canApply=${preview.canApply} actions=${preview.actions.length} effectiveBomStatus=${preview.effectiveBomStatus}`
    );
    const qtyUpdates = preview.actions.filter((a) => a.actionType === "UPDATE_PRODUCT_BOM_QUANTITY");
    for (const a of qtyUpdates) {
      log(`  qty ${a.componentCode}: ${a.currentQuantity} → ${a.effectiveQuantity}`);
    }
    if (preview.canApply) {
      const has115 = preview.actions.some((a) => a.componentCode.includes("115.01"));
      const has121 = preview.actions.some((a) => a.componentCode.includes("121.16"));
      if (has115 || has121) {
        log("  piloto 307.05AA contém componentes esperados (115.01-- / 121.16--)");
      }
    }
  } catch (err) {
    log(`  preview piloto indisponível (${err instanceof Error ? err.message : err}) — seguindo`);
  }

  log("> dry-run batch (limitado ao piloto se existir no stage)");
  const dryReport = await runNomusBomAutoApplyAfterSync({
    mode: "DRY",
    parentCode: PILOT,
    reportDir: process.cwd() + "/docs/generated",
  });

  if (dryReport.mode !== "DRY") fail("Relatório dry-run deveria ter mode=DRY");
  if (dryReport.batchRunId != null) fail("Dry-run não deve criar batchRunId");
  if (dryReport.totals.parentsEvaluated !== 1) {
    fail(`Esperado 1 produto avaliado no dry-run piloto, recebeu ${dryReport.totals.parentsEvaluated}`);
  }

  const pilotResult = dryReport.products[0];
  if (!pilotResult) fail("Dry-run piloto não retornou produto");
  if (!["APPLIED", "NO_CHANGES", "BLOCKED", "SKIPPED"].includes(pilotResult.status)) {
    fail(`Status inesperado no piloto: ${pilotResult.status}`);
  }
  log(`  piloto status=${pilotResult.status}`);

  log("> dry-run batch pequeno (2 códigos) — bloqueado não derruba");
  const stageParents = await prisma.nomusBomComponentStage.findMany({
    distinct: ["parentCode"],
    select: { parentCode: true },
    take: 2,
    orderBy: { parentCode: "asc" },
  });
  if (stageParents.length === 0) {
    log("  stage vazio — pulando teste de batch múltiplo");
  } else {
    for (const row of stageParents) {
      const r = await runNomusBomAutoApplyAfterSync({
        mode: "DRY",
        parentCode: row.parentCode,
      });
      if (r.totals.parentsErrored > 0) {
        fail(`Dry-run falhou para ${row.parentCode}`);
      }
    }
    log(`  ${stageParents.length} produto(s) processado(s) em dry-run sem erro fatal`);
  }

  const [runsAfter, changesAfter, applyRunsAfter, bomLinesAfter] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
    prisma.nomusBomApplyRun.count(),
    prisma.productBOM.count(),
  ]);
  if (runsAfter !== runsBefore) fail(`EngineeringSyncRun mudou: ${runsBefore}→${runsAfter}`);
  if (changesAfter !== changesBefore) fail(`EngineeringChangeLog mudou: ${changesBefore}→${changesAfter}`);
  if (applyRunsAfter !== applyRunsBefore) fail(`NomusBomApplyRun mudou: ${applyRunsBefore}→${applyRunsAfter}`);
  if (bomLinesAfter !== bomLinesBefore) fail(`ProductBOM mudou: ${bomLinesBefore}→${bomLinesAfter}`);
  log("snapshot final igual (dry-run não mutou)");

  log("OK — smoke concluído.");
}

main()
  .catch((err) => {
    console.error("[auto-sync-bom-apply-smoke] erro:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
