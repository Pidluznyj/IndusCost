/**
 * Smoke test read-only do fluxo "Igualar Bases" Nomus.
 *
 * Não chama apply real com confirmação correta. Valida:
 *  - preview retorna READ_ONLY;
 *  - apply sem confirmação retorna BLOCKED;
 *  - apply com confirmação errada retorna BLOCKED;
 *  - nenhuma mutation foi executada (contagens de EngineeringSyncRun e
 *    EngineeringChangeLog ficam iguais antes/depois);
 *  - o schema continua tendo a FK runId → EngineeringSyncRun.id, impedindo
 *    regressões como a do commit anterior (FK violada por runId solto).
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

  // Snapshot antes para detectar mutation indevida.
  const [runsBefore, changesBefore] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
  ]);
  log(`snapshot inicial · EngineeringSyncRun=${runsBefore} EngineeringChangeLog=${changesBefore}`);

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
  if (blocked1.runId !== "") {
    fail(`apply BLOCKED deveria ter runId vazio (sem criar EngineeringSyncRun), recebido "${blocked1.runId}"`);
  }
  log(`apply sem confirmação · status=${blocked1.status} runId="" (esperado BLOCKED)`);

  // Apply com confirmação errada → BLOCKED.
  const blocked2 = await applyNomusMasterDataEqualize({
    confirmationText: "TEXTO ERRADO",
    scope: "SAFE_ONLY",
  });
  if (blocked2.status !== "BLOCKED") {
    fail(`apply com confirmação errada deveria ser BLOCKED, recebido ${blocked2.status}`);
  }
  if (blocked2.runId !== "") {
    fail(`apply BLOCKED com confirmação errada deveria ter runId vazio, recebido "${blocked2.runId}"`);
  }
  log(`apply com confirmação errada · status=${blocked2.status} runId="" (esperado BLOCKED)`);

  // Snapshot depois — não pode ter mudado.
  const [runsAfter, changesAfter] = await Promise.all([
    prisma.engineeringSyncRun.count(),
    prisma.engineeringChangeLog.count(),
  ]);
  if (runsAfter !== runsBefore) {
    fail(
      `EngineeringSyncRun cresceu durante smoke read-only: ${runsBefore} → ${runsAfter} (alguma mutation indevida).`
    );
  }
  if (changesAfter !== changesBefore) {
    fail(
      `EngineeringChangeLog cresceu durante smoke read-only: ${changesBefore} → ${changesAfter} (alguma mutation indevida).`
    );
  }
  log(`snapshot final igual ao inicial · runs=${runsAfter} changes=${changesAfter}`);

  // Sanity check da FK: garante que todos os EngineeringChangeLog que têm runId
  // apontam para um EngineeringSyncRun real (caso contrário, regressão histórica).
  const dangling = await prisma.engineeringChangeLog.count({
    where: {
      runId: { not: null },
      run: null,
    },
  });
  if (dangling > 0) {
    fail(`Encontrados ${dangling} EngineeringChangeLog com runId órfão — FK quebrada (regressão).`);
  }
  log(`FK check · 0 registros órfãos em EngineeringChangeLog.runId`);

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
