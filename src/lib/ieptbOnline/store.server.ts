import type { Prisma, PrismaClient } from "@prisma/client";
import { IEPTB_COVERAGE_NOTE } from "./config.js";
import type { IeptbSections } from "./parse.js";
import type {
  IeptbBillingStatus,
  IeptbConsultationRecord,
  IeptbConsultationStatus,
  IeptbReserveResult,
  IeptbStore,
} from "./store.js";

type IeptbRow = {
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
  confirmedProtest: boolean;
  confirmedClear: boolean;
  insufficient: boolean;
  protestCount: number | null;
  totalAmount: number | null;
  states: Prisma.JsonValue | null;
  coverageNote: string;
  sections: Prisma.JsonValue | null;
  validUntil: Date | null;
  consultedAt: Date | null;
  createdAt: Date;
};

function asSections(value: Prisma.JsonValue | null): IeptbSections | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as IeptbSections;
}

function asStates(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toRecord(row: IeptbRow): IeptbConsultationRecord {
  return {
    id: row.id,
    customerId: row.customerId,
    companyName: row.companyName,
    cnpj: row.cnpj,
    idempotencyKey: row.idempotencyKey,
    requestedByUserId: row.requestedByUserId,
    requestedByRole: row.requestedByRole,
    status: row.status as IeptbConsultationStatus,
    billingStatus: row.billingStatus as IeptbBillingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    providerQueryId: row.providerQueryId,
    providerHttpStatus: row.providerHttpStatus,
    failureCode: row.failureCode,
    confirmedProtest: row.confirmedProtest,
    confirmedClear: row.confirmedClear,
    insufficient: row.insufficient,
    protestCount: row.protestCount,
    totalAmount: row.totalAmount,
    states: asStates(row.states),
    coverageNote: row.coverageNote || IEPTB_COVERAGE_NOTE,
    sections: asSections(row.sections),
    validUntil: row.validUntil?.toISOString() ?? null,
    consultedAt: row.consultedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function isUnique(error: unknown): boolean {
  return typeof error === "object" && error != null && "code" in error && (error as { code: string }).code === "P2002";
}

export function createPrismaIeptbStore(prisma: PrismaClient): IeptbStore {
  const db = prisma.ieptbOnlineConsultation;
  return {
    async findByIdempotency(key) {
      const row = await db.findUnique({ where: { idempotencyKey: key } });
      return row ? toRecord(row) : null;
    },
    async findLatestSucceeded(customerId) {
      const row = await db.findFirst({
        where: { customerId, status: "SUCCEEDED" },
        orderBy: { consultedAt: "desc" },
      });
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
    async reserve(input): Promise<IeptbReserveResult> {
      try {
        return await prisma.$transaction(async (tx) => {
          const existing = await tx.ieptbOnlineConsultation.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
          });
          if (existing) return { ok: false, code: "IDEMPOTENT", row: toRecord(existing) };
          const inflight = await tx.ieptbOnlineConsultation.findFirst({
            where: { cnpj: input.cnpj, status: { in: ["RESERVED", "SENT"] } },
          });
          if (inflight) return { ok: false, code: "IN_FLIGHT" };
          const unknown = await tx.ieptbOnlineConsultation.findFirst({
            where: { cnpj: input.cnpj, billingStatus: "UNKNOWN" },
          });
          if (unknown) return { ok: false, code: "UNKNOWN_BILLING" };
          const latest = await tx.ieptbOnlineConsultation.findFirst({
            where: { customerId: input.customerId, status: "SUCCEEDED" },
            orderBy: { consultedAt: "desc" },
          });
          if (!input.forceRefresh && latest?.validUntil && latest.validUntil.getTime() > input.now.getTime()) {
            return { ok: false, code: "CACHE_VALID" };
          }
          const created = await tx.ieptbOnlineConsultation.create({
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
              coverageNote: IEPTB_COVERAGE_NOTE,
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
          confirmedProtest: patch.confirmedProtest,
          confirmedClear: patch.confirmedClear,
          insufficient: patch.insufficient,
          protestCount: patch.protestCount,
          totalAmount: patch.totalAmount,
          states: patch.states == null ? undefined : (patch.states as unknown as Prisma.InputJsonValue),
          coverageNote: patch.coverageNote,
          sections: patch.sections == null ? undefined : (patch.sections as unknown as Prisma.InputJsonValue),
          validUntil: patch.validUntil ? new Date(patch.validUntil) : undefined,
          consultedAt: patch.consultedAt ? new Date(patch.consultedAt) : undefined,
        },
      });
    },
  };
}
