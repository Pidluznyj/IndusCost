/**
 * Metas (OKR) — job diário de snapshots (RN-008).
 *
 * Para cada KR ATIVO de Objetivo ATIVO:
 *   - com regra dinâmica: executa o motor (janela = período do Objetivo),
 *     grava achievedValue + snapshot do dia (source ENGINE);
 *   - manual: grava o retrato diário do valor vivo (burn-up contínuo).
 * Idempotente: 1 snapshot por dia por KR (unique) — reexecutar substitui o
 * retrato do MESMO dia; dias passados nunca são tocados (RN-009).
 *
 * Uso (cron do servidor, após os syncs Nomus da madrugada):
 *   npx tsx scripts/goalSnapshotsDailyV1.ts
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createGoalService } from "../src/lib/goals/goalService.server.ts";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const service = createGoalService({ prisma });
  const startedAt = Date.now();
  const result = await service.runDailySnapshots();
  console.log(
    JSON.stringify(
      {
        job: "goal-snapshots-daily-v1",
        computed: result.computed,
        manualSnapshotted: result.manualSnapshotted,
        failures: result.failures,
        elapsedMs: Date.now() - startedAt,
      },
      null,
      2
    )
  );
  if (result.failures.length > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("[goal-snapshots-daily-v1] erro:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
