/**
 * Labels, estados de view e helpers — Contas a receber Tesouraria (client-safe).
 */

import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryReceivableListItemDto,
  TreasuryReceivableOperationalStatus,
  TreasuryReceivableSortField,
  TreasuryTitleOperationalPriority,
} from "@/src/lib/treasury/contracts/index.js";
import type { TreasuryReceivablesListParams } from "./treasuryReceivablesApi.js";

/** Tons alinhados a OverlayBadge (sem importar o componente no lib). */
export type TreasuryReceivableBadgeTone =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "slate"
  | "primary";

export const TREASURY_RECEIVABLES_PAGE_TITLE = "Contas a receber" as const;
export const TREASURY_RECEIVABLES_PAGE_SUBTITLE =
  "Títulos oficiais Nomus com complemento operacional da Tesouraria. Não altera vencimento, saldo ou cliente oficiais." as const;

export const TREASURY_RECEIVABLES_DENIED_MESSAGE =
  "Sem permissão para visualizar contas a receber da Tesouraria (requer também Contas a Receber)." as const;

export const TREASURY_RECEIVABLES_EMPTY_TITLE =
  "Nenhum título a receber" as const;
export const TREASURY_RECEIVABLES_EMPTY_DESCRIPTION =
  "Não há títulos sincronizados do Nomus para exibir nesta visão." as const;

export const TREASURY_RECEIVABLES_EMPTY_FILTERED_TITLE =
  "Nenhum título no filtro" as const;
export const TREASURY_RECEIVABLES_EMPTY_FILTERED_DESCRIPTION =
  "Ajuste os filtros para ver outros títulos." as const;

export const TREASURY_RECEIVABLES_STALE_HOURS = 24;

export const TREASURY_RECEIVABLE_STATUS_LABELS: Record<
  TreasuryReceivableOperationalStatus,
  string
> = {
  OPEN: "Em aberto",
  OVERDUE: "Em atraso",
  SETTLED: "Liquidado",
  PROMISED: "Com promessa",
  EXPECTED: "Data esperada",
  ON_HOLD: "Em espera",
  CANCELLED_SOURCE: "Ausente na origem",
  CANCELLED_LOCAL: "Cancelado local",
};

export const TREASURY_RECEIVABLE_STATUS_TONES: Record<
  TreasuryReceivableOperationalStatus,
  TreasuryReceivableBadgeTone
> = {
  OPEN: "sky",
  OVERDUE: "rose",
  SETTLED: "emerald",
  PROMISED: "violet",
  EXPECTED: "amber",
  ON_HOLD: "slate",
  CANCELLED_SOURCE: "slate",
  CANCELLED_LOCAL: "slate",
};

export const TREASURY_PRIORITY_LABELS: Record<
  TreasuryTitleOperationalPriority,
  string
> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const TREASURY_PROMISE_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Ativa",
  PARTIALLY_FULFILLED: "Cumprida parcialmente",
  FULFILLED: "Cumprida",
  EXPIRED: "Expirada",
  BROKEN: "Quebrada",
  CANCELLED: "Cancelada",
};

export const TREASURY_RECEIVABLE_SORT_LABELS: Record<
  TreasuryReceivableSortField,
  string
> = {
  dueDate: "Vencimento",
  personName: "Cliente",
  openAmount: "Saldo aberto",
  originalAmount: "Valor original",
  daysOverdue: "Dias de atraso",
  expectedDate: "Data esperada",
  priority: "Prioridade",
  lastSyncedAt: "Última sync",
  externalId: "ID Nomus",
};

export type TreasuryReceivablesFilterState = {
  customerName: string;
  customerTaxId: string;
  document: string;
  salesOrder: string;
  invoice: string;
  sellerName: string;
  commercialOwnerName: string;
  collectionOwnerUserId: string;
  dueFrom: string;
  dueTo: string;
  expectedFrom: string;
  expectedTo: string;
  hasPromise: "" | "true" | "false";
  operationalStatus: string;
  daysOverdueMin: string;
  daysOverdueMax: string;
  openAmountMin: string;
  openAmountMax: string;
  plannedAccountId: string;
  priority: string;
  nextAction: string;
  includeCancelled: boolean;
  sortBy: TreasuryReceivableSortField;
  sortDirection: "asc" | "desc";
};

export function createEmptyTreasuryReceivablesFilters(): TreasuryReceivablesFilterState {
  return {
    customerName: "",
    customerTaxId: "",
    document: "",
    salesOrder: "",
    invoice: "",
    sellerName: "",
    commercialOwnerName: "",
    collectionOwnerUserId: "",
    dueFrom: "",
    dueTo: "",
    expectedFrom: "",
    expectedTo: "",
    hasPromise: "",
    operationalStatus: "",
    daysOverdueMin: "",
    daysOverdueMax: "",
    openAmountMin: "",
    openAmountMax: "",
    plannedAccountId: "",
    priority: "",
    nextAction: "",
    includeCancelled: false,
    sortBy: "dueDate",
    sortDirection: "asc",
  };
}

export const TREASURY_COLLECTION_ACTION_TYPE_LABELS: Record<string, string> = {
  PHONE: "Telefone",
  WHATSAPP: "WhatsApp",
  EMAIL: "E-mail",
  MEETING: "Reunião",
  COMMERCIAL_CONTACT: "Contato comercial",
  INTERNAL_ANALYSIS: "Análise interna",
  OTHER: "Outro",
};

export const TREASURY_DISPUTE_STATUS_LABELS: Record<string, string> = {
  OPEN: "Aberta",
  RESOLVED: "Resolvida",
  CANCELLED: "Cancelada",
};

/** Taxa 0–1 (string decimal) → percentual pt-BR. */
export function formatTreasuryPromiseFulfillmentRate(
  rate: string | null | undefined
): string {
  if (rate == null || rate === "") return "—";
  const n = Number(rate);
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

export function formatTreasuryReceivableMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatFinanceCurrency(value);
}

export function formatTreasuryReceivableDate(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function formatTreasuryReceivableDateTime(
  value: string | null | undefined
): string {
  return formatFinanceDateTime(value);
}

export type TreasuryReceivablesViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "empty-filtered"
  | "ready";

export function resolveTreasuryReceivablesViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  rowCount: number;
  hasFilters: boolean;
}): TreasuryReceivablesViewKind {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error && input.rowCount === 0) return "error";
  if (input.rowCount === 0) {
    return input.hasFilters ? "empty-filtered" : "empty";
  }
  return "ready";
}

export function treasuryReceivablesFiltersActive(
  filters: TreasuryReceivablesFilterState
): boolean {
  const empty = createEmptyTreasuryReceivablesFilters();
  return (Object.keys(empty) as (keyof TreasuryReceivablesFilterState)[]).some(
    (key) => {
      if (key === "sortBy" || key === "sortDirection") return false;
      return filters[key] !== empty[key];
    }
  );
}

export function buildTreasuryReceivablesListQuery(input: {
  filters: TreasuryReceivablesFilterState;
  page: number;
  pageSize: number;
}): TreasuryReceivablesListParams & { hasFilters: boolean } {
  const f = input.filters;
  const hasPromise =
    f.hasPromise === "true" ? true : f.hasPromise === "false" ? false : null;
  const daysOverdueMin = f.daysOverdueMin.trim()
    ? Number(f.daysOverdueMin)
    : null;
  const daysOverdueMax = f.daysOverdueMax.trim()
    ? Number(f.daysOverdueMax)
    : null;

  return {
    page: input.page,
    pageSize: input.pageSize,
    sortBy: f.sortBy,
    sortDirection: f.sortDirection,
    customerName: f.customerName.trim() || null,
    customerTaxId: f.customerTaxId.trim() || null,
    document: f.document.trim() || null,
    salesOrder: f.salesOrder.trim() || null,
    invoice: f.invoice.trim() || null,
    sellerName: f.sellerName.trim() || null,
    commercialOwnerName: f.commercialOwnerName.trim() || null,
    collectionOwnerUserId: f.collectionOwnerUserId.trim() || null,
    dueFrom: f.dueFrom.trim() || null,
    dueTo: f.dueTo.trim() || null,
    expectedFrom: f.expectedFrom.trim() || null,
    expectedTo: f.expectedTo.trim() || null,
    hasPromise,
    operationalStatus: f.operationalStatus.trim() || null,
    daysOverdueMin:
      daysOverdueMin != null && Number.isFinite(daysOverdueMin)
        ? daysOverdueMin
        : null,
    daysOverdueMax:
      daysOverdueMax != null && Number.isFinite(daysOverdueMax)
        ? daysOverdueMax
        : null,
    openAmountMin: f.openAmountMin.trim() || null,
    openAmountMax: f.openAmountMax.trim() || null,
    plannedAccountId: f.plannedAccountId.trim() || null,
    priority: f.priority.trim() || null,
    nextAction: f.nextAction.trim() || null,
    includeCancelled: f.includeCancelled,
    hasFilters: treasuryReceivablesFiltersActive(f),
  };
}

/** Sync “desatualizada” se o título mais recente da página ultrapassar o limite. */
export function resolveTreasuryReceivablesStaleState(
  rows: TreasuryReceivableListItemDto[],
  staleHours = TREASURY_RECEIVABLES_STALE_HOURS
): { kind: "ok" | "stale" | "missing"; message: string | null } {
  if (!rows.length) {
    return { kind: "missing", message: null };
  }
  let newest = 0;
  for (const row of rows) {
    const t = Date.parse(row.official.lastSyncedAt);
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  if (!newest) {
    return {
      kind: "missing",
      message: "Sem data de sincronização nos títulos exibidos.",
    };
  }
  const hours = (Date.now() - newest) / (1000 * 60 * 60);
  if (hours > staleHours) {
    return {
      kind: "stale",
      message: `Dados possivelmente desatualizados: última sync há ${Math.floor(hours)} h (limite ${staleHours} h).`,
    };
  }
  return { kind: "ok", message: null };
}

export function buildTreasuryReceivableOperationalHistory(
  row: TreasuryReceivableListItemDto
): Array<{ at: string; label: string; detail: string }> {
  const items: Array<{ at: string; label: string; detail: string }> = [];
  if (row.lastAction) {
    items.push({
      at: row.lastAction.at,
      label: "Última ação",
      detail: row.lastAction.summary,
    });
  }
  if (row.complement?.cancelledAt) {
    items.push({
      at: row.complement.cancelledAt,
      label: "Cancelamento local",
      detail: row.complement.reason ?? "Complemento cancelado",
    });
  }
  if (row.complement?.confirmedDate) {
    items.push({
      at: `${row.complement.confirmedDate}T12:00:00.000+00:00`,
      label: "Promessa / confirmação",
      detail: [
        formatTreasuryReceivableDate(row.complement.confirmedDate),
        row.complement.confirmedAmount
          ? formatTreasuryReceivableMoney(row.complement.confirmedAmount)
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (row.complement?.expectedDate) {
    items.push({
      at: `${row.complement.expectedDate}T12:00:00.000+00:00`,
      label: "Data esperada",
      detail: formatTreasuryReceivableDate(row.complement.expectedDate),
    });
  }
  if (row.official.settlements.settledAt) {
    items.push({
      at: `${row.official.settlements.settledAt}T12:00:00.000+00:00`,
      label: "Baixa oficial",
      detail: formatTreasuryReceivableMoney(
        row.official.settlements.settledAmount
      ),
    });
  }
  items.push({
    at: row.official.lastSyncedAt,
    label: "Última sincronização Nomus",
    detail: formatTreasuryReceivableDateTime(row.official.lastSyncedAt),
  });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}
