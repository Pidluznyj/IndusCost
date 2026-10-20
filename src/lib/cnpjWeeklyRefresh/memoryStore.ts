import { randomUUID } from "node:crypto";
import type { CnpjRefreshPartyDocument } from "./eligibility.js";
import type {
  CnpjRefreshAuditRecord,
  CnpjRefreshChangeRecord,
  CnpjRefreshDivergenceRecord,
  CnpjRefreshItemRecord,
  CnpjRefreshLookupRecord,
  CnpjRefreshRunRecord,
  CnpjRefreshStore,
  CustomerOfficialSnapshot,
  SupplierOfficialSnapshot,
} from "./store.js";

export function createMemoryCnpjRefreshStore(input?: {
  parties?: CnpjRefreshPartyDocument[];
  customers?: CustomerOfficialSnapshot[];
  suppliers?: SupplierOfficialSnapshot[];
  lookups?: CnpjRefreshLookupRecord[];
}): CnpjRefreshStore & {
  runs: CnpjRefreshRunRecord[];
  items: CnpjRefreshItemRecord[];
  lookups: CnpjRefreshLookupRecord[];
  changes: CnpjRefreshChangeRecord[];
  divergences: CnpjRefreshDivergenceRecord[];
  audits: CnpjRefreshAuditRecord[];
  customers: CustomerOfficialSnapshot[];
  suppliers: SupplierOfficialSnapshot[];
} {
  const runs: CnpjRefreshRunRecord[] = [];
  const items: CnpjRefreshItemRecord[] = [];
  const lookups: CnpjRefreshLookupRecord[] = [...(input?.lookups ?? [])];
  const changes: CnpjRefreshChangeRecord[] = [];
  const divergences: CnpjRefreshDivergenceRecord[] = [];
  const audits: CnpjRefreshAuditRecord[] = [];
  const customers = input?.customers ?? [];
  const suppliers = input?.suppliers ?? [];
  const parties = input?.parties ?? [];

  return {
    runs,
    items,
    lookups,
    changes,
    divergences,
    audits,
    customers,
    suppliers,
    async listParties() {
      return parties;
    },
    async findScheduledRun(slot) {
      return runs.find((run) => run.scheduleSlot === slot && run.trigger === "SCHEDULED") ?? null;
    },
    async findRun(id) {
      return runs.find((run) => run.id === id) ?? null;
    },
    async findRunning(now, staleMs) {
      return (
        runs.find(
          (run) =>
            run.status === "RUNNING" &&
            now.getTime() - (run.heartbeatAt?.getTime() ?? 0) < staleMs
        ) ?? null
      );
    },
    async insertRun(run) {
      if (run.scheduleSlot && runs.some((row) => row.scheduleSlot === run.scheduleSlot && row.trigger === "SCHEDULED")) {
        const error = new Error("slot");
        (error as { code?: string }).code = "SLOT_EXISTS";
        throw error;
      }
      if (run.status === "RUNNING" && runs.some((row) => row.status === "RUNNING")) {
        const error = new Error("running");
        (error as { code?: string }).code = "ALREADY_RUNNING";
        throw error;
      }
      runs.push(run);
      return run;
    },
    async updateRun(id, patch) {
      const run = runs.find((row) => row.id === id);
      if (!run) return;
      if (patch.status === "RUNNING" && runs.some((row) => row.status === "RUNNING" && row.id !== id)) {
        const error = new Error("running");
        (error as { code?: string }).code = "ALREADY_RUNNING";
        throw error;
      }
      Object.assign(run, patch);
    },
    async listItems(runId) {
      return items.filter((item) => item.runId === runId);
    },
    async insertItems(rows) {
      for (const row of rows) {
        if (!items.some((item) => item.runId === row.runId && item.subjectKey === row.subjectKey)) {
          items.push(row);
        }
      }
    },
    async updateItem(id, patch) {
      const item = items.find((row) => row.id === id);
      if (item) Object.assign(item, patch);
    },
    async latestLookup(cnpj) {
      return (
        lookups
          .filter((row) => row.cnpj === cnpj)
          .sort((left, right) => right.fetchedAt.getTime() - left.fetchedAt.getTime())[0] ?? null
      );
    },
    async insertLookup(row) {
      const saved: CnpjRefreshLookupRecord = {
        id: randomUUID(),
        cnpj: row.cnpj,
        customerId: row.customerId,
        summary: row.summary,
        riskScore: row.riskScore,
        riskVerdict: row.riskVerdict,
        fetchedAt: row.fetchedAt,
      };
      lookups.push(saved);
      return saved;
    },
    async insertChanges(rows) {
      changes.push(...rows);
    },
    async insertDivergences(rows) {
      divergences.push(...rows);
    },
    async listRuns(limit) {
      return [...runs].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime()).slice(0, limit);
    },
    async listChanges(runId, limit) {
      return changes.filter((row) => row.runId === runId).slice(0, limit);
    },
    async readCustomer(id) {
      return customers.find((row) => row.id === id) ?? null;
    },
    async readSupplier(id) {
      return suppliers.find((row) => row.id === id) ?? null;
    },
    async audit(entry) {
      audits.push(entry);
    },
  };
}
