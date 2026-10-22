import type { Prisma, PrismaClient } from "@prisma/client";
import { writeCommercialAuditLog } from "@/src/lib/commercialAuditLog.js";
import { recordCorporateMembershipsFromLookup } from "@/src/lib/commercial/corporateRelation.server.js";
import { normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import type { CnpjRefreshPartyDocument } from "./eligibility.js";
import type {
  CnpjRefreshChangeRecord,
  CnpjRefreshDivergenceRecord,
  CnpjRefreshItemRecord,
  CnpjRefreshLookupRecord,
  CnpjRefreshRunRecord,
  CnpjRefreshStore,
} from "./store.js";

function asSummary(value: unknown): NormalizedCnpjSummary {
  return value as NormalizedCnpjSummary;
}

function mapRun(row: {
  id: string;
  scheduleSlot: string | null;
  trigger: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  heartbeatAt: Date | null;
  eligibleCount: number;
  consultedCount: number;
  updatedCount: number;
  unchangedCount: number;
  failedCount: number;
  partialCount: number;
  invalidCount: number;
  missingDocumentCount: number;
  customerCount: number;
  supplierCount: number;
  lastCnpj: string | null;
  sourceLabel: string | null;
  statusDetail: string | null;
  errorMessage: string | null;
  requestedByUserId: string | null;
  createdAt: Date;
}): CnpjRefreshRunRecord {
  return {
    ...row,
    trigger: row.trigger as CnpjRefreshRunRecord["trigger"],
    status: row.status as CnpjRefreshRunRecord["status"],
  };
}

function isSlotConflict(error: unknown): boolean {
  return typeof error === "object" && error != null && (error as { code?: string }).code === "P2002";
}

export function createPrismaCnpjRefreshStore(prisma: PrismaClient): CnpjRefreshStore {
  return {
    async listParties() {
      const [customers, suppliers] = await Promise.all([
        prisma.customer.findMany({ select: { id: true, taxId: true } }),
        prisma.financialSupplier.findMany({
          select: { id: true, document: true, normalizedDocument: true },
        }),
      ]);
      const parties: CnpjRefreshPartyDocument[] = customers.map((customer) => ({
        partyType: "CUSTOMER",
        partyId: customer.id,
        rawDocument: customer.taxId,
      }));
      for (const supplier of suppliers) {
        const normalized = normalizeCnpj(supplier.normalizedDocument);
        parties.push({
          partyType: "SUPPLIER",
          partyId: supplier.id,
          rawDocument: normalized || supplier.document,
        });
      }
      return parties;
    },
    async findScheduledRun(slot) {
      const row = await prisma.cnpjRefreshRun.findFirst({
        where: { scheduleSlot: slot, trigger: "SCHEDULED" },
      });
      return row ? mapRun(row) : null;
    },
    async findRun(id) {
      const row = await prisma.cnpjRefreshRun.findUnique({ where: { id } });
      return row ? mapRun(row) : null;
    },
    async findRunning(now, staleMs) {
      const row = await prisma.cnpjRefreshRun.findFirst({
        where: {
          status: "RUNNING",
          heartbeatAt: { gt: new Date(now.getTime() - staleMs) },
        },
        orderBy: { heartbeatAt: "desc" },
      });
      return row ? mapRun(row) : null;
    },
    async insertRun(run) {
      try {
        const row = await prisma.cnpjRefreshRun.create({ data: run });
        return mapRun(row);
      } catch (error) {
        if (!isSlotConflict(error)) throw error;
        const wrapped = new Error("Já existe execução para este horário.");
        (wrapped as { code?: string }).code = run.status === "RUNNING" ? "ALREADY_RUNNING" : "SLOT_EXISTS";
        throw wrapped;
      }
    },
    async updateRun(id, patch) {
      try {
        await prisma.cnpjRefreshRun.update({ where: { id }, data: patch });
      } catch (error) {
        if (!isSlotConflict(error)) throw error;
        const wrapped = new Error("Já existe execução em andamento.");
        (wrapped as { code?: string }).code = "ALREADY_RUNNING";
        throw wrapped;
      }
    },
    async listItems(runId) {
      const rows = await prisma.cnpjRefreshRunItem.findMany({ where: { runId } });
      return rows.map((row) => ({
        ...row,
        status: row.status as CnpjRefreshItemRecord["status"],
      }));
    },
    async insertItems(items) {
      if (items.length === 0) return;
      await prisma.cnpjRefreshRunItem.createMany({ data: items, skipDuplicates: true });
    },
    async updateItem(id, patch) {
      await prisma.cnpjRefreshRunItem.update({ where: { id }, data: patch });
    },
    async latestLookup(cnpj) {
      const row = await prisma.customerCnpjLookup.findFirst({
        where: { cnpj },
        orderBy: { fetchedAt: "desc" },
      });
      if (!row) return null;
      return {
        id: row.id,
        cnpj: row.cnpj,
        customerId: row.customerId,
        summary: asSummary(row.normalizedSummary),
        riskScore: row.riskScore,
        riskVerdict: row.riskVerdict,
        fetchedAt: row.fetchedAt,
      };
    },
    async insertLookup(input) {
      const row = await prisma.customerCnpjLookup.create({
        data: {
          cnpj: input.cnpj,
          customerId: input.customerId,
          source: input.source,
          rawJson: input.rawJson as Prisma.InputJsonValue,
          normalizedSummary: input.summary as Prisma.InputJsonValue,
          riskScore: input.riskScore,
          riskVerdict: input.riskVerdict,
          riskDetails: input.riskDetails as Prisma.InputJsonValue,
          commercialInsights: input.commercialInsights as Prisma.InputJsonValue,
          fetchedAt: input.fetchedAt,
          expiresAt: input.expiresAt,
          fetchedByUserId: input.fetchedByUserId,
        },
      });
      try {
        await recordCorporateMembershipsFromLookup(prisma as never, {
          customerId: input.customerId,
          rawJson: input.rawJson,
          consultedAt: input.fetchedAt,
        });
      } catch (error) {
        console.error("corporate-membership-record", error instanceof Error ? error.name : "error");
      }
      try {
        if (input.customerId) {
          const { scheduleCorporateRadar } = await import("@/src/lib/commercial/corporateRadar.server.js");
          scheduleCorporateRadar(input.customerId, "QSA_REFRESH");
        }
      } catch (error) {
        console.error("corporate-radar", error instanceof Error ? error.name : "error");
      }
      return {
        id: row.id,
        cnpj: row.cnpj,
        customerId: row.customerId,
        summary: input.summary,
        riskScore: row.riskScore,
        riskVerdict: row.riskVerdict,
        fetchedAt: row.fetchedAt,
      } satisfies CnpjRefreshLookupRecord;
    },
    async insertChanges(rows: CnpjRefreshChangeRecord[]) {
      if (rows.length === 0) return;
      await prisma.cnpjCadastreChange.createMany({ data: rows });
    },
    async insertDivergences(rows: CnpjRefreshDivergenceRecord[]) {
      if (rows.length === 0) return;
      await prisma.cnpjCadastreDivergence.createMany({ data: rows });
    },
    async listRuns(limit) {
      const rows = await prisma.cnpjRefreshRun.findMany({
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map(mapRun);
    },
    async listChanges(runId, limit) {
      const rows = await prisma.cnpjCadastreChange.findMany({
        where: { runId },
        orderBy: { detectedAt: "desc" },
        take: limit,
      });
      return rows;
    },
    async readCustomer(id) {
      return prisma.customer.findUnique({
        where: { id },
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          taxId: true,
        },
      });
    },
    async readSupplier(id) {
      const row = await prisma.financialSupplier.findUnique({
        where: { id },
        select: { id: true, legalName: true, tradeName: true, displayName: true },
      });
      return row;
    },
    async audit(entry) {
      try {
        await writeCommercialAuditLog(entry);
      } catch (error) {
        console.error("[cnpj-weekly-refresh] auditoria indisponível", error instanceof Error ? error.name : "error");
      }
    },
  };
}
