/**
 * Conexão Prisma SOMENTE LEITURA para as ferramentas de auditoria de
 * CRM > Relatórios (verificador, EXPLAIN, evidências de homologação).
 *
 * Uma única conexão (`connection_limit=1`) cuja sessão fica em
 * `default_transaction_read_only = on` com `statement_timeout`: qualquer
 * escrita é recusada pelo próprio PostgreSQL. A garantia é conferida com
 * `SHOW` antes de devolver o cliente — se não der para garantir, aborta.
 */

import { PrismaClient } from "@prisma/client";

export type ReadOnlyAuditQueryEvent = { query: string; params: string; duration: number };

/** Força pool de 1 conexão (a sessão read-only vale para todas as consultas). */
export function withSingleConnectionUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("connection_limit", "1");
  return parsed.toString();
}

export async function assertReadOnlySession(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ default_transaction_read_only: string }>>(
    "SHOW default_transaction_read_only"
  );
  if (rows[0]?.default_transaction_read_only !== "on") {
    throw new Error("Sessão do banco NÃO está em modo somente leitura — auditoria abortada.");
  }
}

export async function openReadOnlyAuditPrisma(
  options: { statementTimeoutMs?: number; onQuery?: (event: ReadOnlyAuditQueryEvent) => void } = {}
): Promise<{ prisma: PrismaClient; queryCount: () => number }> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente — rode no servidor da homologação (sem alterar o .env).");
  const prisma = new PrismaClient({
    datasources: { db: { url: withSingleConnectionUrl(url) } },
    log: [{ emit: "event", level: "query" }],
  });
  let queries = 0;
  prisma.$on("query" as never, (event: ReadOnlyAuditQueryEvent) => {
    queries += 1;
    options.onQuery?.(event);
  });
  try {
    await prisma.$executeRawUnsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    await prisma.$executeRawUnsafe(`SET statement_timeout = ${Math.trunc(options.statementTimeoutMs ?? 120_000)}`);
    await assertReadOnlySession(prisma);
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
  return { prisma, queryCount: () => queries };
}
