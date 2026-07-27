/**
 * Repository in-memory da consulta CP — testes sem DB.
 */

import type { OfficialNomusPayableRow } from "../mappers/treasuryOfficialTitleMappers.js";
import { toOfficialPayableView } from "../mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  toTreasuryPayableComplementView,
  toTreasuryPayableListItemDto,
  type TreasuryPayableCostCenterProjection,
} from "../mappers/treasuryPayableQueryMappers.js";
import { paginateTreasuryPayables } from "../queries/treasuryPayableQueryEngine.js";
import type { TreasuryPayableQueryRepository } from "./treasuryPayableQueryRepository.server.js";

export type TreasuryPayableCostCenterMemoryRow = {
  accountsPayableId: number;
  costCenterId: string;
  costCenterCode: string | null;
  costCenterName: string;
  percentage: number;
};

export type TreasuryPayableQueryMemoryStore = {
  payables: OfficialNomusPayableRow[];
  complements: TreasuryTitleOperationalComplementRow[];
  costCenters: TreasuryPayableCostCenterMemoryRow[];
};

export function createEmptyTreasuryPayableQueryMemoryStore(): TreasuryPayableQueryMemoryStore {
  return { payables: [], complements: [], costCenters: [] };
}

export function createMemoryTreasuryPayableQueryRepository(
  store: TreasuryPayableQueryMemoryStore
): TreasuryPayableQueryRepository {
  function costCenterMap(): Map<number, TreasuryPayableCostCenterProjection> {
    const map = new Map<number, TreasuryPayableCostCenterProjection>();
    const sorted = [...store.costCenters].sort(
      (a, b) => b.percentage - a.percentage
    );
    for (const row of sorted) {
      if (map.has(row.accountsPayableId)) continue;
      const label =
        [row.costCenterCode, row.costCenterName].filter(Boolean).join(" — ") ||
        row.costCenterName;
      map.set(row.accountsPayableId, {
        costCenterId: row.costCenterId,
        costCenterLabel: label,
      });
    }
    return map;
  }

  function assemble(referenceDate?: Date) {
    const byTitle = new Map(
      store.complements
        .filter((c) => c.titleType === "PAYABLE")
        .map((c) => [c.officialTitleId, c] as const)
    );
    const cc = costCenterMap();
    return store.payables.map((row) => {
      const complementRow = byTitle.get(row.id) ?? null;
      return toTreasuryPayableListItemDto({
        official: toOfficialPayableView(row),
        complement: complementRow
          ? toTreasuryPayableComplementView(complementRow)
          : null,
        costCenter: cc.get(row.externalId) ?? null,
        referenceDate,
      });
    });
  }

  return {
    async list(query, referenceDate) {
      return paginateTreasuryPayables(assemble(referenceDate), query);
    },
    async getByTitleId(titleId, referenceDate) {
      return (
        assemble(referenceDate).find((r) => r.titleId === titleId) ?? null
      );
    },
  };
}
