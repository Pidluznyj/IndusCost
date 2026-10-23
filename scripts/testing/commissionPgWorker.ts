/**
 * Processo auxiliar dos testes de concorrência das comissões (PostgreSQL descartável).
 * Cada instância é um processo Node separado, com o próprio Prisma Client e pool, que
 * executa UMA operação oficial no instante combinado (barreira START_AT) e imprime o
 * resultado numa linha `RESULT {json}`.
 *
 *   tsx scripts/testing/commissionPgWorker.ts apply   <url> <ano> <mês>
 *   tsx scripts/testing/commissionPgWorker.ts rebuild <url> <salesOrderId,…>
 *
 * Recusa qualquer banco que não seja loopback com o marcador do teste (COMMISSION_PG_MARKER).
 */
import { PrismaClient } from "@prisma/client";
import { assertPrismaOnTestDatabase } from "./commissionPostgresHarness.js";

const [action, url, ...rest] = process.argv.slice(2);

async function main(): Promise<unknown> {
  if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("worker: só banco de teste em 127.0.0.1");
  const prisma = new PrismaClient({ datasourceUrl: url });
  await assertPrismaOnTestDatabase(prisma, process.env.COMMISSION_PG_MARKER ?? "");
  (globalThis as unknown as { prisma: PrismaClient }).prisma = prisma;
  process.env.DATABASE_URL = url;
  const closing = await import("../../src/lib/commissions/commissionReceiptClosing.server.js");
  const orchestrator = await import("../../src/lib/commissions/commissionMaterializationOrchestrator.server.js");
  await prisma.$queryRawUnsafe("select 1");
  const startAt = Number(process.env.START_AT ?? 0);
  while (Date.now() < startAt) await new Promise((resolve) => setTimeout(resolve, 2));
  const started = Date.now();
  try {
    if (action === "apply") {
      const result = await closing.applyCommissionReceiptClosing(prisma, { year: Number(rest[0]), month: Number(rest[1]), userId: `worker-${process.pid}` });
      return { ok: true, closingId: result.closingId, lineCount: result.lineCount, ms: Date.now() - started };
    }
    if (action === "rebuild") {
      const result = await orchestrator.rebuildCommissionMaterializationForAffectedSales(prisma, { salesOrderIds: rest[0]!.split(","), apply: true });
      return { ok: result.errors.length === 0, errors: result.errors.map((error) => error.message.slice(-160)), ms: Date.now() - started };
    }
    throw new Error(`ação desconhecida: ${action}`);
  } catch (error) {
    const code = (error as { code?: string }).code ?? null;
    return { ok: false, code, name: (error as Error).name, message: String((error as Error).message).slice(0, 300), ms: Date.now() - started };
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((result) => console.log(`RESULT ${JSON.stringify(result)}`))
  .catch((error) => {
    console.log(`RESULT ${JSON.stringify({ ok: false, fatal: true, message: String((error as Error).message) })}`);
    process.exitCode = 1;
  });
