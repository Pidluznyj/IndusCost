import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

/**
 * Query logging é ruidoso (cada SELECT vira uma linha). Mantemos apenas
 * avisos/erros por padrão e habilitamos o log de query sob demanda com
 * PRISMA_QUERY_LOG=1 — útil para depurar no servidor sem poluir scripts
 * de backfill/auditoria.
 */
const queryLogEnabled = process.env.PRISMA_QUERY_LOG === "1";
const logLevels: Prisma.LogLevel[] = queryLogEnabled
  ? ["query", "info", "warn", "error"]
  : ["warn", "error"];

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: logLevels,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
