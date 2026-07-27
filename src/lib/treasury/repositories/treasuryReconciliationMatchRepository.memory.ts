/**
 * Repository in-memory de matches de conciliação — testes.
 */

import { randomUUID } from "node:crypto";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryReconciliationMatchRow } from "../mappers/treasuryReconciliationMatchMappers.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";
import type {
  TreasuryBankMovementReconciliationSnapshot,
  TreasuryReconciliationMatchCreateData,
  TreasuryReconciliationMatchRepository,
} from "./treasuryReconciliationMatchRepository.server.js";

export type TreasuryReconciliationMatchMemoryStore = {
  matches: TreasuryReconciliationMatchRow[];
  movements: TreasuryBankMovementReconciliationSnapshot[];
};

export function createEmptyTreasuryReconciliationMatchMemoryStore(): TreasuryReconciliationMatchMemoryStore {
  return { matches: [], movements: [] };
}

function cloneMatch(row: TreasuryReconciliationMatchRow): TreasuryReconciliationMatchRow {
  return {
    ...row,
    matchedCivilDate:
      row.matchedCivilDate instanceof Date
        ? new Date(row.matchedCivilDate)
        : row.matchedCivilDate,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    unmatchedAt: row.unmatchedAt ? new Date(row.unmatchedAt) : null,
    movements: row.movements.map((m) => ({ ...m })),
    allocations: row.allocations.map((a) => ({ ...a })),
    suggestionReasonsJson: Array.isArray(row.suggestionReasonsJson)
      ? [...row.suggestionReasonsJson]
      : row.suggestionReasonsJson,
  };
}

function parseCivil(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Data civil inválida: ${value}`,
      "matchedCivilDate"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function createMemoryTreasuryReconciliationMatchRepository(
  store: TreasuryReconciliationMatchMemoryStore
): TreasuryReconciliationMatchRepository {
  return {
    async findById(id) {
      const row = store.matches.find((m) => m.id === id);
      return row ? cloneMatch(row) : null;
    },

    async listActiveByBankMovementId(bankMovementId) {
      const id = bankMovementId.trim();
      return store.matches
        .filter(
          (m) =>
            (m.status === "MATCHED" || m.status === "PENDING") &&
            m.movements.some((mov) => mov.bankMovementId === id)
        )
        .map(cloneMatch);
    },

    async create(data: TreasuryReconciliationMatchCreateData) {
      const id = randomUUID();
      const now = new Date();
      const row: TreasuryReconciliationMatchRow = {
        id,
        companyCode: data.companyCode,
        accountId: data.accountId,
        status: data.status,
        matchedAmount: normalizeTreasuryMoneyString(data.matchedAmount),
        currency: data.currency ?? "BRL",
        matchedCivilDate: parseCivil(data.matchedCivilDate),
        justification: data.justification ?? null,
        suggestionKey: data.suggestionKey ?? null,
        algorithmVersion: data.algorithmVersion ?? null,
        suggestionScore: data.suggestionScore ?? null,
        suggestionConfidence: data.suggestionConfidence ?? null,
        suggestionReasonsJson: data.suggestionReasonsJson ?? null,
        version: 1,
        createdAt: now,
        createdByUserId: data.createdByUserId,
        updatedAt: now,
        updatedByUserId: null,
        unmatchedAt: null,
        unmatchedByUserId: null,
        unmatchReason: null,
        movements: data.movements.map((m) => ({
          id: randomUUID(),
          matchId: id,
          bankMovementId: m.bankMovementId,
          amount: normalizeTreasuryMoneyString(m.amount),
          sortOrder: m.sortOrder,
        })),
        allocations: data.allocations.map((a) => ({
          id: randomUUID(),
          matchId: id,
          kind: a.kind,
          amount: normalizeTreasuryMoneyString(a.amount),
          memo: a.memo ?? null,
          nomusSide: a.nomusSide ?? null,
          officialTitleId: a.officialTitleId ?? null,
          nomusExternalId: a.nomusExternalId ?? null,
          transferId: a.transferId ?? null,
          transferGroupId: a.transferGroupId ?? null,
          ledgerEntryId: a.ledgerEntryId ?? null,
          differenceCode: a.differenceCode ?? null,
          sortOrder: a.sortOrder,
        })),
      };
      store.matches.push(row);
      return cloneMatch(row);
    },

    async unmatch(id, data) {
      const row = store.matches.find((m) => m.id === id);
      if (!row) {
        throw new TreasuryDomainError("NOT_FOUND", "Match não encontrado.", "id");
      }
      if (row.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do match desatualizada.",
          "expectedVersion"
        );
      }
      row.status = "UNMATCHED";
      row.version += 1;
      row.unmatchedAt = new Date();
      row.unmatchedByUserId = data.unmatchedByUserId;
      row.unmatchReason = data.unmatchReason;
      row.updatedByUserId = data.unmatchedByUserId;
      row.updatedAt = new Date();
      return cloneMatch(row);
    },

    async sumActiveAllocatedByMovementIds(movementIds) {
      const map = new Map<string, string>();
      for (const match of store.matches) {
        if (match.status !== "MATCHED" && match.status !== "PENDING") continue;
        for (const mov of match.movements) {
          if (!movementIds.includes(mov.bankMovementId)) continue;
          const prev = map.get(mov.bankMovementId) ?? "0.00";
          map.set(
            mov.bankMovementId,
            addTreasuryMoney(
              prev,
              normalizeTreasuryMoneyString(String(mov.amount))
            )
          );
        }
      }
      return map;
    },

    async findMovementSnapshot(id) {
      const row = store.movements.find((m) => m.id === id);
      return row ? { ...row } : null;
    },

    async updateMovementReconciliation(id, data) {
      const row = store.movements.find((m) => m.id === id);
      if (!row) {
        throw new TreasuryDomainError(
          "NOT_FOUND",
          "Movimento bancário não encontrado.",
          "id"
        );
      }
      row.reconciledAmount = normalizeTreasuryMoneyString(data.reconciledAmount);
      row.reconciliationStatus = data.reconciliationStatus;
      return { ...row };
    },
  };
}

export function seedMemoryBankMovement(
  store: TreasuryReconciliationMatchMemoryStore,
  movement: TreasuryBankMovementReconciliationSnapshot
): void {
  store.movements.push({ ...movement });
}
