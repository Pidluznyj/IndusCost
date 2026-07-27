/**
 * Repository in-memory da consulta CR — testes de filtros/paginação sem DB.
 */

import type { OfficialNomusReceivableRow } from "../mappers/treasuryOfficialTitleMappers.js";
import { toOfficialReceivableView } from "../mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  toTreasuryReceivableComplementView,
  toTreasuryReceivableListItemDto,
} from "../mappers/treasuryReceivableQueryMappers.js";
import { paginateTreasuryReceivables } from "../queries/treasuryReceivableQueryEngine.js";
import type { TreasuryReceivableQueryRepository } from "./treasuryReceivableQueryRepository.server.js";

export type TreasuryReceivableQueryMemoryStore = {
  receivables: OfficialNomusReceivableRow[];
  complements: TreasuryTitleOperationalComplementRow[];
};

export function createEmptyTreasuryReceivableQueryMemoryStore(): TreasuryReceivableQueryMemoryStore {
  return { receivables: [], complements: [] };
}

export function createMemoryTreasuryReceivableQueryRepository(
  store: TreasuryReceivableQueryMemoryStore
): TreasuryReceivableQueryRepository {
  function assemble(referenceDate?: Date) {
    const byTitle = new Map(
      store.complements
        .filter((c) => c.titleType === "RECEIVABLE")
        .map((c) => [c.officialTitleId, c] as const)
    );
    return store.receivables.map((row) => {
      const complementRow = byTitle.get(row.id) ?? null;
      return toTreasuryReceivableListItemDto({
        official: toOfficialReceivableView(row),
        complement: complementRow
          ? toTreasuryReceivableComplementView(complementRow)
          : null,
        rawPayload: row.rawPayload,
        referenceDate,
      });
    });
  }

  return {
    async list(query, referenceDate) {
      return paginateTreasuryReceivables(assemble(referenceDate), query);
    },
    async getByTitleId(titleId, referenceDate) {
      return (
        assemble(referenceDate).find((r) => r.titleId === titleId) ?? null
      );
    },
  };
}
