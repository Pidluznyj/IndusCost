import { Prisma, PrismaClient } from "@prisma/client";
import { isDevPerfBaselineEnvEnabled } from "@/src/lib/devPerfBaseline.js";
import { installDevPerfPrismaInstrumentation } from "@/src/lib/devPerfBaseline.server.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Query logging é ruidoso (cada SELECT vira uma linha). Mantemos apenas
 * avisos/erros por padrão e habilitamos o log de query sob demanda com
 * PRISMA_QUERY_LOG=1 — útil para depurar no servidor sem poluir scripts
 * de backfill/auditoria.
 *
 * INDUSCOST_PERF_BASELINE=1 conta queries e tempo de banco por request via
 * `$use` (ver devPerfBaseline.server.ts). NÃO usa evento "query": o evento é
 * emitido pelo engine fora do AsyncLocalStorage do chamador, o que fazia toda
 * medição cair para `db=0ms q=0`. A flag, portanto, não altera o log — só
 * instala a instrumentação. Nenhum SQL é registrado em nenhum dos casos.
 */
const queryLogEnabled = process.env.PRISMA_QUERY_LOG === "1";
const perfBaselineEnabled = isDevPerfBaselineEnvEnabled();

function buildPrismaLog(): Prisma.LogLevel[] {
  if (queryLogEnabled) {
    return ["query", "info", "warn", "error"];
  }
  return ["warn", "error"];
}

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: buildPrismaLog(),
  });

if (perfBaselineEnabled) {
  installDevPerfPrismaInstrumentation(prisma);
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
