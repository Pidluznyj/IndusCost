/**
 * Liga a consulta de protesto externo ao Prisma somente quando a integração está habilitada.
 * Desligada por padrão. Não escolhe o bloqueio comercial.
 */

import type { PrismaClient } from "@prisma/client";
import {
  createExternalProtestProvider,
  disabledExternalProtestFact,
  readExternalProtestConfig,
  unavailableExternalProtestFact,
  type ExternalProtestConfig,
  type ExternalProtestCreditFact,
  type ExternalProtestProvider,
} from "./externalProtestProvider.js";
import {
  executeExternalProtestConsultation,
  type ExternalProtestAuditEntry,
  type ExternalProtestCache,
  type ExternalProtestCacheRow,
} from "./externalProtestQuery.js";

type ConsultationDelegate = {
  findFirst(args: {
    where: { cnpj: string; validUntil: { gt: Date } };
    orderBy: { consultedAt: "desc" };
  }): Promise<ExternalProtestCacheRow | null>;
  count(args: {
    where: {
      provider: string;
      consultedAt: { gte: Date };
      executionStatus: { in: string[] };
    };
  }): Promise<number>;
  create(args: { data: ExternalProtestCacheRow }): Promise<ExternalProtestCacheRow>;
};

export function createPrismaExternalProtestCache(
  db: { commercialExternalProtestConsultation: ConsultationDelegate }
): ExternalProtestCache {
  return {
    async findFresh(cnpj, now) {
      return db.commercialExternalProtestConsultation.findFirst({
        where: { cnpj, validUntil: { gt: now } },
        orderBy: { consultedAt: "desc" },
      });
    },
    async countAttempts(provider, since) {
      return db.commercialExternalProtestConsultation.count({
        where: {
          provider,
          consultedAt: { gte: since },
          executionStatus: { in: ["SUCCESS", "FAILED", "TIMEOUT", "UNAVAILABLE"] },
        },
      });
    },
    async insert(row) {
      await db.commercialExternalProtestConsultation.create({ data: row });
    },
  };
}

export async function resolveExternalProtestForDecision(input: {
  cnpj: string | null;
  customerId: string | null;
  now: Date;
  config?: ExternalProtestConfig;
  provider?: ExternalProtestProvider;
  cache?: ExternalProtestCache;
  sleep?: (ms: number) => Promise<void>;
  audit?: (entry: ExternalProtestAuditEntry) => Promise<void>;
  env?: Record<string, string | undefined>;
}): Promise<ExternalProtestCreditFact> {
  const config = input.config ?? readExternalProtestConfig(input.env ?? process.env);
  if (!config.enabled) return disabledExternalProtestFact();
  try {
    const cache = input.cache ?? createPrismaExternalProtestCache((await loadPrisma()) as never);
    const provider = input.provider ?? createExternalProtestProvider(config);
    return await executeExternalProtestConsultation({
      cnpj: input.cnpj,
      customerId: input.customerId,
      now: input.now,
      config,
      provider,
      cache,
      sleep: input.sleep,
      audit: input.audit,
    });
  } catch {
    return unavailableExternalProtestFact("CONSULTATION_ERROR");
  }
}

async function loadPrisma(): Promise<Pick<PrismaClient, "commercialExternalProtestConsultation">> {
  const { prisma } = await import("@/src/lib/prisma.js");
  return prisma;
}
