import type { Prisma, PrismaClient } from "@prisma/client";
import type { BoaVistaSections } from "./parse.js";
import type {
  BoaVistaBillingStatus,
  BoaVistaConsultationMode,
  BoaVistaConsultationRecord,
  BoaVistaConsultationStatus,
  BoaVistaReserveResult,
  BoaVistaStore,
} from "./store.js";

type BoaVistaRow = {
  id: string;
  customerId: string;
  companyName: string;
  cnpj: string;
  mode: string;
  idempotencyKey: string;
  requestedByUserId: string;
  requestedByRole: string;
  status: string;
  billingStatus: string;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerHttpStatus: number | null;
  providerResult: string | null;
  failureCode: string | null;
  scoreRaw: string | null;
  score: number | null;
  scoreClass: string | null;
  riskText: string | null;
  defaultProbability: string | null;
  suggestedLimitCents: bigint | null;
  suggestedLimitLabel: string | null;
  restrictionCount: number | null;
  confirmedRestriction: boolean;
  insufficient: boolean;
  sections: Prisma.JsonValue | null;
  rawPayload: Prisma.JsonValue | null;
  parserVersion: string | null;
  receiptUrl: string | null;
  validUntil: Date | null;
  consultedAt: Date | null;
  createdAt: Date;
};

function asSections(value: Prisma.JsonValue | null): BoaVistaSections | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as BoaVistaSections;
}

function toRecord(row: BoaVistaRow): BoaVistaConsultationRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    companyName: row.companyName,
    cnpj: row.cnpj,
    mode: row.mode as BoaVistaConsultationMode,
    idempotencyKey: row.idempotencyKey,
    requestedByUserId: row.requestedByUserId,
    requestedByRole: row.requestedByRole,
    status: row.status as BoaVistaConsultationStatus,
    billingStatus: row.billingStatus as BoaVistaBillingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    providerQueryId: row.providerQueryId,
    providerHttpStatus: row.providerHttpStatus,
    providerResult: row.providerResult,
    failureCode: row.failureCode,
    scoreRaw: row.scoreRaw,
    score: row.score,
    scoreClass: row.scoreClass,
    riskText: row.riskText,
    defaultProbability: row.defaultProbability,
    suggestedLimitCents: row.suggestedLimitCents == null ? null : Number(row.suggestedLimitCents),
    suggestedLimitLabel: row.suggestedLimitLabel,
    restrictionCount: row.restrictionCount,
    confirmedRestriction: row.confirmedRestriction,
    insufficient: row.insufficient,
    sections: asSections(row.sections),
    rawPayload: row.rawPayload ?? null,
    parserVersion: row.parserVersion,
    receiptUrl: row.receiptUrl,
    validUntil: row.validUntil?.toISOString() ?? null,
    consultedAt: row.consultedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && (error as { code: string }).code === "P2002";
}

/**
 * Persistência própria (tabela BoaVistaDefineLimiteConsultation): nada é compartilhado com o QUOD nem com o IEPTB.
 * A reserva roda numa transação; o índice único parcial em (cnpj) WHERE mode='LIVE' AND status IN ('RESERVED','SENT')
 * (migration) é a trava no banco contra duas consultas reais concorrentes do mesmo CNPJ.
 */
export function createPrismaBoaVistaStore(prisma: PrismaClient): BoaVistaStore {
  const db = prisma.boaVistaDefineLimiteConsultation;
  return {
    async findByIdempotency(key) {
      const row = await db.findUnique({ where: { idempotencyKey: key } });
      return row ? toRecord(row) : null;
    },
    async findLatestSucceeded(customerId, mode) {
      const row = await db.findFirst({ where: { customerId, mode, status: "SUCCEEDED" }, orderBy: { consultedAt: "desc" } });
      return row ? toRecord(row) : null;
    },
    async findById(id) {
      const row = await db.findUnique({ where: { id } });
      return row ? toRecord(row) : null;
    },
    async listByCustomer(customerId) {
      const rows = await db.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
      return rows.map(toRecord);
    },
    async reserve(input): Promise<BoaVistaReserveResult> {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.boaVistaDefineLimiteConsultation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
          if (existing) return { ok: false, code: "IDEMPOTENT", row: toRecord(existing) };
          const inflight = await tx.boaVistaDefineLimiteConsultation.findFirst({
            where: { cnpj: input.cnpj, mode: input.mode, status: { in: ["RESERVED", "SENT"] } },
          });
          if (inflight) return { ok: false, code: "IN_FLIGHT" };
          if (input.mode === "LIVE") {
            const unknown = await tx.boaVistaDefineLimiteConsultation.findFirst({
              where: { cnpj: input.cnpj, mode: "LIVE", billingStatus: "UNKNOWN" },
            });
            if (unknown) return { ok: false, code: "UNKNOWN_BILLING" };
          }
          const latest = await tx.boaVistaDefineLimiteConsultation.findFirst({
            where: { customerId: input.customerId, mode: input.mode, status: "SUCCEEDED" },
            orderBy: { consultedAt: "desc" },
          });
          if (!input.forceRefresh && latest?.validUntil && latest.validUntil.getTime() > input.now.getTime()) {
            return { ok: false, code: "CACHE_VALID" };
          }
          const created = await tx.boaVistaDefineLimiteConsultation.create({
            data: {
              customerId: input.customerId,
              companyName: input.companyName,
              cnpj: input.cnpj,
              mode: input.mode,
              idempotencyKey: input.idempotencyKey,
              requestedByUserId: input.requestedByUserId,
              requestedByRole: input.requestedByRole,
              status: "RESERVED",
              billingStatus: "NOT_SENT",
              authorizedCostCents: input.authorizedCostCents,
            },
          });
          return { ok: true, row: toRecord(created) };
        });
      } catch (error) {
        if (isUnique(error)) return { ok: false, code: "IN_FLIGHT" };
        throw error;
      }
    },
    async markSent(id) {
      await db.update({ where: { id }, data: { status: "SENT" } });
    },
    async complete(id, patch) {
      await db.update({
        where: { id },
        data: {
          status: patch.status,
          billingStatus: patch.billingStatus,
          chargedCostCents: patch.chargedCostCents,
          providerQueryId: patch.providerQueryId,
          providerHttpStatus: patch.providerHttpStatus,
          providerResult: patch.providerResult,
          failureCode: patch.failureCode,
          scoreRaw: patch.scoreRaw,
          score: patch.score,
          scoreClass: patch.scoreClass,
          riskText: patch.riskText,
          defaultProbability: patch.defaultProbability,
          suggestedLimitCents: patch.suggestedLimitCents == null ? undefined : BigInt(patch.suggestedLimitCents),
          suggestedLimitLabel: patch.suggestedLimitLabel,
          restrictionCount: patch.restrictionCount,
          confirmedRestriction: patch.confirmedRestriction,
          insufficient: patch.insufficient,
          sections: patch.sections == null ? undefined : (patch.sections as unknown as Prisma.InputJsonValue),
          rawPayload: patch.rawPayload == null ? undefined : (patch.rawPayload as Prisma.InputJsonValue),
          parserVersion: patch.parserVersion,
          receiptUrl: patch.receiptUrl,
          validUntil: patch.validUntil ? new Date(patch.validUntil) : undefined,
          consultedAt: patch.consultedAt ? new Date(patch.consultedAt) : undefined,
        },
      });
    },
  };
}
