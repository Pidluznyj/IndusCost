/**
 * Adapter in-memory somente leitura — fixtures de títulos oficiais Nomus.
 */

import type {
  OfficialPayableView,
  OfficialReceivableView,
} from "../contracts/treasuryOfficialTitleContracts.js";
import {
  toOfficialPayableView,
  toOfficialReceivableView,
  type OfficialNomusPayableRow,
  type OfficialNomusReceivableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import type {
  OfficialTitlesListFilter,
  OfficialTitlesListResult,
  TreasuryOfficialTitlesAdapter,
} from "./treasuryOfficialTitlesAdapter.types.js";

export type OfficialTitlesMemoryStore = {
  receivables: OfficialNomusReceivableRow[];
  payables: OfficialNomusPayableRow[];
};

export function createEmptyOfficialTitlesMemoryStore(): OfficialTitlesMemoryStore {
  return { receivables: [], payables: [] };
}

function pageOf(filter: OfficialTitlesListFilter): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, filter.pageSize ?? 50));
  return { page, pageSize };
}

function openBalanceNumber(value: OfficialNomusReceivableRow["balanceReceivable"]): number {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(value.toFixed(2));
}

function filterReceivables(
  rows: OfficialNomusReceivableRow[],
  filter: OfficialTitlesListFilter
): OfficialNomusReceivableRow[] {
  let out = [...rows];
  if (filter.openOnly) {
    out = out.filter((r) => openBalanceNumber(r.balanceReceivable) > 0);
  }
  if (filter.personId != null) {
    out = out.filter((r) => r.personId === filter.personId);
  }
  if (filter.externalIds?.length) {
    const set = new Set(filter.externalIds);
    out = out.filter((r) => set.has(r.externalId));
  }
  if (filter.dueFrom) {
    const t = filter.dueFrom.getTime();
    out = out.filter((r) => r.dueDate && r.dueDate.getTime() >= t);
  }
  if (filter.dueTo) {
    const t = filter.dueTo.getTime();
    out = out.filter((r) => r.dueDate && r.dueDate.getTime() <= t);
  }
  out.sort((a, b) => {
    const ad = a.dueDate?.getTime() ?? 0;
    const bd = b.dueDate?.getTime() ?? 0;
    if (ad !== bd) return ad - bd;
    return a.externalId - b.externalId;
  });
  return out;
}

function filterPayables(
  rows: OfficialNomusPayableRow[],
  filter: OfficialTitlesListFilter
): OfficialNomusPayableRow[] {
  let out = [...rows];
  if (filter.openOnly) {
    out = out.filter((r) => openBalanceNumber(r.balancePayable) > 0);
  }
  if (filter.personId != null) {
    out = out.filter((r) => r.personId === filter.personId);
  }
  if (filter.externalIds?.length) {
    const set = new Set(filter.externalIds);
    out = out.filter((r) => set.has(r.externalId));
  }
  if (filter.dueFrom) {
    const t = filter.dueFrom.getTime();
    out = out.filter((r) => r.dueDate && r.dueDate.getTime() >= t);
  }
  if (filter.dueTo) {
    const t = filter.dueTo.getTime();
    out = out.filter((r) => r.dueDate && r.dueDate.getTime() <= t);
  }
  out.sort((a, b) => {
    const ad = a.dueDate?.getTime() ?? 0;
    const bd = b.dueDate?.getTime() ?? 0;
    if (ad !== bd) return ad - bd;
    return a.externalId - b.externalId;
  });
  return out;
}

export function createMemoryTreasuryOfficialTitlesAdapter(
  store: OfficialTitlesMemoryStore
): TreasuryOfficialTitlesAdapter {
  return {
    async findReceivableById(id) {
      const row = store.receivables.find((r) => r.id === id);
      return row ? toOfficialReceivableView(row) : null;
    },
    async findReceivableByExternalId(externalId) {
      const row = store.receivables.find((r) => r.externalId === externalId);
      return row ? toOfficialReceivableView(row) : null;
    },
    async listReceivables(filter = {}) {
      const { page, pageSize } = pageOf(filter);
      const filtered = filterReceivables(store.receivables, filter);
      const start = (page - 1) * pageSize;
      return {
        rows: filtered
          .slice(start, start + pageSize)
          .map(toOfficialReceivableView),
        total: filtered.length,
        page,
        pageSize,
      } satisfies OfficialTitlesListResult<OfficialReceivableView>;
    },
    async findPayableById(id) {
      const row = store.payables.find((r) => r.id === id);
      return row ? toOfficialPayableView(row) : null;
    },
    async findPayableByExternalId(externalId) {
      const row = store.payables.find((r) => r.externalId === externalId);
      return row ? toOfficialPayableView(row) : null;
    },
    async listPayables(filter = {}) {
      const { page, pageSize } = pageOf(filter);
      const filtered = filterPayables(store.payables, filter);
      const start = (page - 1) * pageSize;
      return {
        rows: filtered.slice(start, start + pageSize).map(toOfficialPayableView),
        total: filtered.length,
        page,
        pageSize,
      } satisfies OfficialTitlesListResult<OfficialPayableView>;
    },
  };
}
