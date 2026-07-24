import { Prisma, PrismaClient } from "@prisma/client";
import { isDevPerfBaselineEnvEnabled } from "@/src/lib/devPerfBaseline.js";
import { installDevPerfPrismaQueryListener } from "@/src/lib/devPerfBaseline.server.js";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Query logging é ruidoso (cada SELECT vira uma linha). Mantemos apenas
 * avisos/erros por padrão e habilitamos o log de query sob demanda com
 * PRISMA_QUERY_LOG=1 — útil para depurar no servidor sem poluir scripts
 * de backfill/auditoria.
 *
 * INDUSCOST_PERF_BASELINE=1 (nunca em produção) emite eventos "query"
 * para contagem/tempo de DB na linha de base PERFORMANCE 02 — sem logar SQL.
 */
const queryLogEnabled = process.env.PRISMA_QUERY_LOG === "1";
const perfBaselineEnabled = isDevPerfBaselineEnvEnabled();

function buildPrismaLog():
  | Prisma.LogLevel[]
  | Array<Prisma.LogLevel | { emit: "event"; level: "query" }> {
  if (perfBaselineEnabled) {
    return [{ emit: "event", level: "query" }, "warn", "error"];
  }
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
  installDevPerfPrismaQueryListener(prisma);
}

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
