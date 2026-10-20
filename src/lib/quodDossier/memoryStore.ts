import { randomUUID } from "node:crypto";
import type { QuodConsultationRecord, QuodReserveResult, QuodStore } from "./store.js";

export function createMemoryQuodStore(): QuodStore & { rows: QuodConsultationRecord[]; failCompleteTimes: number } {
  const rows: QuodConsultationRecord[] = [];
  const locks = new Map<string, Promise<void>>();
  const api: QuodStore & { rows: QuodConsultationRecord[]; failCompleteTimes: number } = {
    rows,
    failCompleteTimes: 0,
    async findByIdempotency(key) {
      return rows.find((row) => row.idempotencyKey === key) ?? null;
    },
    async findLatestSucceeded(customerId) {
      return rows.filter((row) => row.customerId === customerId && row.status === "SUCCEEDED").at(-1) ?? null;
    },
    async findById(id) {
      return rows.find((row) => row.id === id) ?? null;
    },
    async listByCustomer(customerId) {
      return rows.filter((row) => row.customerId === customerId);
    },
    async reserve(input) {
      const previous = locks.get(input.cnpj) ?? Promise.resolve();
      let release: () => void = () => undefined;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      locks.set(input.cnpj, previous.then(() => current));
      await previous;
      try {
        const existing = rows.find((row) => row.idempotencyKey === input.idempotencyKey);
        if (existing) return { ok: false, code: "IDEMPOTENT", row: existing } satisfies QuodReserveResult;
        if (rows.some((row) => row.cnpj === input.cnpj && (row.status === "RESERVED" || row.status === "SENT"))) {
          return { ok: false, code: "IN_FLIGHT" };
        }
        if (rows.some((row) => row.cnpj === input.cnpj && row.billingStatus === "UNKNOWN")) {
          return { ok: false, code: "UNKNOWN_BILLING" };
        }
        const latest = rows.filter((row) => row.customerId === input.customerId && row.status === "SUCCEEDED").at(-1);
        if (!input.forceRefresh && latest?.validUntil && Date.parse(latest.validUntil) > input.now.getTime()) {
          return { ok: false, code: "CACHE_VALID" };
        }
        const spent = rows
          .filter((row) => {
            const created = Date.parse(row.createdAt);
            return created >= input.monthStart.getTime() && created < input.monthEnd.getTime() && row.billingStatus !== "NOT_SENT";
          })
          .reduce((sum, row) => sum + row.authorizedCostCents, 0);
        if (spent + input.authorizedCostCents > input.monthlyLimitCents) return { ok: false, code: "BUDGET" };
        const recent = rows.filter((row) => row.cnpj === input.cnpj && Date.parse(row.createdAt) >= input.intervalStart.getTime() && row.status !== "FAILED").length;
        if (recent >= input.maxPerCnpj) return { ok: false, code: "INTERVAL" };
        const row: QuodConsultationRecord = {
          id: randomUUID(),
          customerId: input.customerId,
          companyName: input.companyName,
          cnpj: input.cnpj,
          idempotencyKey: input.idempotencyKey,
          requestedByUserId: input.requestedByUserId,
          requestedByRole: input.requestedByRole,
          status: "RESERVED",
          billingStatus: "NOT_SENT",
          authorizedCostCents: input.authorizedCostCents,
          chargedCostCents: null,
          providerQueryId: null,
          providerHttpStatus: null,
          failureCode: null,
          score: null,
          restrictionCount: null,
          confirmedRestriction: false,
          insufficient: false,
          sections: null,
          partners: [],
          validUntil: null,
          consultedAt: null,
          createdAt: input.now.toISOString(),
        };
        rows.push(row);
        return { ok: true, row };
      } finally {
        release();
      }
    },
    async markSent(id) {
      const row = rows.find((item) => item.id === id);
      if (row) row.status = "SENT";
    },
    async complete(id, patch) {
      if (api.failCompleteTimes > 0) {
        api.failCompleteTimes -= 1;
        throw new Error("persistência recusada");
      }
      const row = rows.find((item) => item.id === id);
      if (!row) throw new Error("consulta inexistente");
      Object.assign(row, patch);
    },
  };
  return api;
}
