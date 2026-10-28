import { randomUUID } from "node:crypto";
import type { BoaVistaConsultationRecord, BoaVistaReserveResult, BoaVistaStore } from "./store.js";

export function createMemoryBoaVistaStore(): BoaVistaStore & { rows: BoaVistaConsultationRecord[]; failCompleteTimes: number } {
  const rows: BoaVistaConsultationRecord[] = [];
  const locks = new Map<string, Promise<void>>();
  const api: BoaVistaStore & { rows: BoaVistaConsultationRecord[]; failCompleteTimes: number } = {
    rows,
    failCompleteTimes: 0,
    async findByIdempotency(key) {
      return rows.find((row) => row.idempotencyKey === key) ?? null;
    },
    async findLatestSucceeded(customerId, mode) {
      return rows.filter((row) => row.customerId === customerId && row.mode === mode && row.status === "SUCCEEDED").at(-1) ?? null;
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
        if (existing) return { ok: false, code: "IDEMPOTENT", row: existing } satisfies BoaVistaReserveResult;
        if (rows.some((row) => row.cnpj === input.cnpj && row.mode === input.mode && (row.status === "RESERVED" || row.status === "SENT"))) {
          return { ok: false, code: "IN_FLIGHT" };
        }
        if (input.mode === "LIVE" && rows.some((row) => row.cnpj === input.cnpj && row.mode === "LIVE" && row.billingStatus === "UNKNOWN")) {
          return { ok: false, code: "UNKNOWN_BILLING" };
        }
        const latest = rows.filter((row) => row.customerId === input.customerId && row.mode === input.mode && row.status === "SUCCEEDED").at(-1);
        if (!input.forceRefresh && latest?.validUntil && Date.parse(latest.validUntil) > input.now.getTime()) {
          return { ok: false, code: "CACHE_VALID" };
        }
        const row: BoaVistaConsultationRecord = {
          id: randomUUID(),
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
          chargedCostCents: null,
          providerQueryId: null,
          providerHttpStatus: null,
          providerResult: null,
          failureCode: null,
          scoreRaw: null,
          score: null,
          scoreClass: null,
          riskText: null,
          defaultProbability: null,
          suggestedLimitCents: null,
          suggestedLimitLabel: null,
          restrictionCount: null,
          confirmedRestriction: false,
          insufficient: false,
          sections: null,
          rawPayload: null,
          parserVersion: null,
          receiptUrl: null,
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
