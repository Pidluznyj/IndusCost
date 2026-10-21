import type { Prisma, PrismaClient } from "@prisma/client";
import type { QuodSections } from "./parse.js";
import type { QuodBillingStatus, QuodConsultationRecord, QuodConsultationStatus, QuodReserveResult, QuodStore } from "./store.js";

type QuodRow = {
  id: string;
  customerId: string;
  companyName: string;
  cnpj: string;
  idempotencyKey: string;
  requestedByUserId: string;
  requestedByRole: string;
  status: string;
  billingStatus: string;
  authorizedCostCents: number;
  chargedCostCents: number | null;
  providerQueryId: string | null;
  providerHttpStatus: number | null;
  failureCode: string | null;
  score: number | null;
  restrictionCount: number | null;
  confirmedRestriction: boolean;
  insufficient: boolean;
  sections: Prisma.JsonValue | null;
  partners: Prisma.JsonValue | null;
  validUntil: Date | null;
  consultedAt: Date | null;
  createdAt: Date;
};

function asSections(value: Prisma.JsonValue | null): QuodSections | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as QuodSections;
}

function asPartners(value: Prisma.JsonValue | null): QuodConsultationRecord["partners"] {
  if (!Array.isArray(value)) return [];
  return value as QuodConsultationRecord["partners"];
}

function toRecord(row: QuodRow): QuodConsultationRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    companyName: row.companyName,
    cnpj: row.cnpj,
    idempotencyKey: row.idempotencyKey,
    requestedByUserId: row.requestedByUserId,
    requestedByRole: row.requestedByRole,
    status: row.status as QuodConsultationStatus,
    billingStatus: row.billingStatus as QuodBillingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    providerQueryId: row.providerQueryId,
    providerHttpStatus: row.providerHttpStatus,
    failureCode: row.failureCode,
    score: row.score,
    restrictionCount: row.restrictionCount,
    confirmedRestriction: row.confirmedRestriction,
    insufficient: row.insufficient,
    sections: asSections(row.sections),
    partners: asPartners(row.partners),
    validUntil: row.validUntil?.toISOString() ?? null,
    consultedAt: row.consultedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && (error as { code: string }).code === "P2002";
}

export function createPrismaQuodStore(prisma: PrismaClient): QuodStore {
  const db = prisma.quodDossierConsultation;
  return {
    async findByIdempotency(key) {
      const row = await db.findUnique({ where: { idempotencyKey: key } });
      return row ? toRecord(row) : null;
    },
    async findLatestSucceeded(customerId) {
      const row = await db.findFirst({ where: { customerId, status: "SUCCEEDED" }, orderBy: { consultedAt: "desc" } });
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
    async reserve(input): Promise<QuodReserveResult> {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.quodDossierConsultation.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
          if (existing) return { ok: false, code: "IDEMPOTENT", row: toRecord(existing) };
          const inflight = await tx.quodDossierConsultation.findFirst({
            where: { cnpj: input.cnpj, status: { in: ["RESERVED", "SENT"] } },
          });
          if (inflight) return { ok: false, code: "IN_FLIGHT" };
          const unknown = await tx.quodDossierConsultation.findFirst({
            where: { cnpj: input.cnpj, billingStatus: "UNKNOWN" },
          });
          if (unknown) return { ok: false, code: "UNKNOWN_BILLING" };
          const latest = await tx.quodDossierConsultation.findFirst({
            where: { customerId: input.customerId, status: "SUCCEEDED" },
            orderBy: { consultedAt: "desc" },
          });
          if (!input.forceRefresh && latest?.validUntil && latest.validUntil.getTime() > input.now.getTime()) {
            return { ok: false, code: "CACHE_VALID" };
          }
          const created = await tx.quodDossierConsultation.create({
            data: {
              customerId: input.customerId,
              companyName: input.companyName,
              cnpj: input.cnpj,
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
          failureCode: patch.failureCode,
          score: patch.score,
          restrictionCount: patch.restrictionCount,
          confirmedRestriction: patch.confirmedRestriction,
          insufficient: patch.insufficient,
          sections: patch.sections == null ? undefined : (patch.sections as unknown as Prisma.InputJsonValue),
          partners: patch.partners == null ? undefined : (patch.partners as unknown as Prisma.InputJsonValue),
          validUntil: patch.validUntil ? new Date(patch.validUntil) : undefined,
          consultedAt: patch.consultedAt ? new Date(patch.consultedAt) : undefined,
        },
      });
    },
  };
}
