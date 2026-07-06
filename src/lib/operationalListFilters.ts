import { normalizeSearchString } from "@/src/lib/utils";
import type {
  PurchasePriority,
  PurchaseRequestRow,
  PurchaseRequestStatus,
} from "@/src/types/purchase";
import type { Proposal, ProposalStatus } from "@/src/types/commercial";

export type PurchaseListFilters = {
  search: string;
  status: "" | PurchaseRequestStatus;
  priority: "" | PurchasePriority;
  costCenterId: string; // "" = todos
};

export function filterPurchaseRequests(
  requests: PurchaseRequestRow[],
  filters: PurchaseListFilters
): PurchaseRequestRow[] {
  const q = normalizeSearchString(filters.search.trim());
  const cc = (filters.costCenterId ?? "").trim();

  return requests.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (filters.priority && r.priority !== filters.priority) return false;

    if (cc) {
      const headerMatch = (r.defaultCostCenterId ?? "").trim() === cc;
      const anyItemMatch = Array.isArray(r.items)
        ? r.items.some((it) => (it.costCenterId ?? "").trim() === cc)
        : false;
      if (!headerMatch && !anyItemMatch) return false;
    }

    if (!q) return true;

    const itemsHay =
      Array.isArray(r.items) && r.items.length
        ? r.items
            .map((it) => {
              const mCode = it.material?.code ?? "";
              const mDesc = it.material?.description ?? "";
              return `${it.description ?? ""} ${it.suggestedSupplier ?? ""} ${it.supplierReference ?? ""} ${mCode} ${mDesc}`;
            })
            .join(" ")
        : "";

    const hay = normalizeSearchString(
      `#${r.number} ${r.requester} ${r.department} ${r.defaultCostCenter?.code ?? ""} ${
        r.defaultCostCenter?.name ?? ""
      } ${itemsHay}`
    );
    return hay.includes(q);
  });
}

export type IndirectCostRow = {
  id: string;
  description: string;
  category: string;
  monthlyValue: number;
  costCenter?: string;
  allocationCriteria: string;
  status: string;
};

export type IndirectCostListFilters = {
  search: string;
  category: string; // "" = todos
  status: string; // "" = todos
};

export function filterIndirectCosts(
  costs: IndirectCostRow[],
  filters: IndirectCostListFilters
): IndirectCostRow[] {
  const q = normalizeSearchString(filters.search.trim());
  const cat = (filters.category ?? "").trim();
  const st = (filters.status ?? "").trim();

  return costs.filter((c) => {
    if (c.category === "GLOBAL_PARAM") return false;
    if (cat && c.category !== cat) return false;
    if (st && c.status !== st) return false;
    if (!q) return true;
    const hay = normalizeSearchString(`${c.description ?? ""} ${c.costCenter ?? ""} ${c.category ?? ""}`);
    return hay.includes(q);
  });
}

export type ProposalListFilters = {
  search: string;
  status: "" | ProposalStatus;
  responsible: string; // "" = todos
  customerId: string; // "" = todos
  startDate: string; // "" = sem início (YYYY-MM-DD)
  endDate: string; // "" = sem fim (YYYY-MM-DD)
  minNetValue: string; // "" = sem min
  maxNetValue: string; // "" = sem max
};

function safeNumber(v: unknown): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : null;
}

function parseDateStart(yyyyMmDd: string): number | null {
  const s = (yyyyMmDd ?? "").trim();
  if (!s) return null;
  const t = Date.parse(`${s}T00:00:00`);
  return Number.isFinite(t) ? t : null;
}

function parseDateEnd(yyyyMmDd: string): number | null {
  const s = (yyyyMmDd ?? "").trim();
  if (!s) return null;
  const t = Date.parse(`${s}T23:59:59.999`);
  return Number.isFinite(t) ? t : null;
}

export function filterProposals(proposals: Proposal[], filters: ProposalListFilters): Proposal[] {
  const q = normalizeSearchString(filters.search.trim());
  const resp = (filters.responsible ?? "").trim();
  const custId = (filters.customerId ?? "").trim();

  const start = parseDateStart(filters.startDate);
  const end = parseDateEnd(filters.endDate);

  const minV = safeNumber(filters.minNetValue.trim());
  const maxV = safeNumber(filters.maxNetValue.trim());

  return proposals.filter((p: Proposal) => {
    if (filters.status && p.status !== filters.status) return false;
    if (resp) {
      const r = String(p.responsible ?? "").trim();
      if (r !== resp) return false;
    }
    if (custId && String(p.customerId ?? "").trim() !== custId) return false;

    if (start != null || end != null) {
      const t = Date.parse(p.createdAt);
      if (!Number.isFinite(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
    }

    if (minV != null || maxV != null) {
      const net = safeNumber(p.totalNetValue) ?? 0;
      if (minV != null && net < minV) return false;
      if (maxV != null && net > maxV) return false;
    }

    if (!q) return true;
    const hay = normalizeSearchString(
      `${p.number} ${p.title ?? ""} ${p.Customer?.companyName ?? ""} ${p.Customer?.tradeName ?? ""} ${
        p.Customer?.taxId ?? ""
      }`
    );
    return hay.includes(q);
  });
}

