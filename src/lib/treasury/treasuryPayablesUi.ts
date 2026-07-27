/**
 * Labels, estados de view e helpers — Contas a pagar Tesouraria (client-safe).
 */

import {
  formatFinanceCurrency,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat.js";
import type {
  TreasuryFinancialAccountDto,
  TreasuryPayableListItemDto,
  TreasuryPayableOperationalStatus,
  TreasuryPayableProgrammingImpactDto,
  TreasuryPayableSortField,
  TreasuryTitleOperationalPriority,
} from "@/src/lib/treasury/contracts/index.js";
import { computeTreasuryPayableProgrammingImpact } from "./domain/treasuryPayableProgrammingRules.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "./treasuryMoney.js";
import type { TreasuryPayablesListParams } from "./treasuryPayablesApi.js";

export type TreasuryPayableBadgeTone =
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "slate"
  | "primary";

export const TREASURY_PAYABLES_PAGE_TITLE = "Contas a pagar" as const;
export const TREASURY_PAYABLES_PAGE_SUBTITLE =
  "Títulos oficiais Nomus com programação operacional da Tesouraria. Não altera vencimento ou saldo oficiais." as const;

export const TREASURY_PAYABLES_DENIED_MESSAGE =
  "Sem permissão para visualizar contas a pagar da Tesouraria (requer também Contas a Pagar)." as const;

export const TREASURY_PAYABLES_EMPTY_TITLE = "Nenhum título a pagar" as const;
export const TREASURY_PAYABLES_EMPTY_DESCRIPTION =
  "Não há títulos sincronizados do Nomus para exibir nesta visão." as const;

export const TREASURY_PAYABLES_EMPTY_FILTERED_TITLE =
  "Nenhum título no filtro" as const;
export const TREASURY_PAYABLES_EMPTY_FILTERED_DESCRIPTION =
  "Ajuste os filtros para ver outros títulos." as const;

export const TREASURY_PAYABLES_STALE_HOURS = 24;

export const TREASURY_PAYABLE_STATUS_LABELS: Record<
  TreasuryPayableOperationalStatus,
  string
> = {
  OPEN: "Em aberto",
  OVERDUE: "Em atraso",
  SETTLED: "Liquidado",
  PROGRAMMED: "Programado",
  AUTHORIZED: "Autorizado",
  EXPECTED: "Data esperada",
  ON_HOLD: "Bloqueado",
  CANCELLED_SOURCE: "Ausente na origem",
  CANCELLED_LOCAL: "Cancelado local",
};

export const TREASURY_PAYABLE_STATUS_TONES: Record<
  TreasuryPayableOperationalStatus,
  TreasuryPayableBadgeTone
> = {
  OPEN: "sky",
  OVERDUE: "rose",
  SETTLED: "emerald",
  PROGRAMMED: "violet",
  AUTHORIZED: "primary",
  EXPECTED: "amber",
  ON_HOLD: "slate",
  CANCELLED_SOURCE: "slate",
  CANCELLED_LOCAL: "slate",
};

export const TREASURY_PAYABLE_PRIORITY_LABELS: Record<
  TreasuryTitleOperationalPriority,
  string
> = {
  LOW: "Baixa",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const TREASURY_PAYABLE_SORT_LABELS: Record<
  TreasuryPayableSortField,
  string
> = {
  dueDate: "Vencimento",
  personName: "Fornecedor",
  openAmount: "Saldo aberto",
  originalAmount: "Valor original",
  daysOverdue: "Dias de atraso",
  scheduledDate: "Data programada",
  priority: "Prioridade",
  lastSyncedAt: "Última sync",
  externalId: "ID Nomus",
  documentNumber: "Documento",
};

export const TREASURY_PAYABLE_PROGRAMMING_STATUS_LABELS = {
  PROGRAMMED: "Programado",
  AUTHORIZED: "Autorizado",
} as const;

export type TreasuryPayablesFilterState = {
  supplierName: string;
  supplierTaxId: string;
  document: string;
  classification: string;
  costCenter: string;
  dueFrom: string;
  dueTo: string;
  scheduledFrom: string;
  scheduledTo: string;
  operationalStatus: string;
  openAmountMin: string;
  openAmountMax: string;
  plannedAccountId: string;
  priority: string;
  responsibleUserId: string;
  includeCancelled: boolean;
  sortBy: TreasuryPayableSortField;
  sortDirection: "asc" | "desc";
};

export function createEmptyTreasuryPayablesFilters(): TreasuryPayablesFilterState {
  return {
    supplierName: "",
    supplierTaxId: "",
    document: "",
    classification: "",
    costCenter: "",
    dueFrom: "",
    dueTo: "",
    scheduledFrom: "",
    scheduledTo: "",
    operationalStatus: "",
    openAmountMin: "",
    openAmountMax: "",
    plannedAccountId: "",
    priority: "",
    responsibleUserId: "",
    includeCancelled: false,
    sortBy: "dueDate",
    sortDirection: "asc",
  };
}

export function formatTreasuryPayableMoney(
  value: string | null | undefined
): string {
  if (value == null || value === "") return "—";
  return formatFinanceCurrency(value);
}

export function formatTreasuryPayableDate(
  value: string | null | undefined
): string {
  if (!value) return "—";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function formatTreasuryPayableDateTime(
  value: string | null | undefined
): string {
  return formatFinanceDateTime(value);
}

export type TreasuryPayablesViewKind =
  | "denied"
  | "loading"
  | "error"
  | "empty"
  | "empty-filtered"
  | "ready";

export function resolveTreasuryPayablesViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  rowCount: number;
  hasFilters: boolean;
}): TreasuryPayablesViewKind {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error && input.rowCount === 0) return "error";
  if (input.rowCount === 0) {
    return input.hasFilters ? "empty-filtered" : "empty";
  }
  return "ready";
}

export function treasuryPayablesFiltersActive(
  filters: TreasuryPayablesFilterState
): boolean {
  const empty = createEmptyTreasuryPayablesFilters();
  return (Object.keys(empty) as (keyof TreasuryPayablesFilterState)[]).some(
    (key) => {
      if (key === "sortBy" || key === "sortDirection") return false;
      return filters[key] !== empty[key];
    }
  );
}

export function buildTreasuryPayablesListQuery(input: {
  filters: TreasuryPayablesFilterState;
  page: number;
  pageSize: number;
}): TreasuryPayablesListParams & { hasFilters: boolean } {
  const f = input.filters;
  return {
    page: input.page,
    pageSize: input.pageSize,
    sortBy: f.sortBy,
    sortDirection: f.sortDirection,
    supplierName: f.supplierName.trim() || null,
    supplierTaxId: f.supplierTaxId.trim() || null,
    document: f.document.trim() || null,
    classification: f.classification.trim() || null,
    costCenter: f.costCenter.trim() || null,
    dueFrom: f.dueFrom.trim() || null,
    dueTo: f.dueTo.trim() || null,
    scheduledFrom: f.scheduledFrom.trim() || null,
    scheduledTo: f.scheduledTo.trim() || null,
    operationalStatus: f.operationalStatus.trim() || null,
    openAmountMin: f.openAmountMin.trim() || null,
    openAmountMax: f.openAmountMax.trim() || null,
    plannedAccountId: f.plannedAccountId.trim() || null,
    priority: f.priority.trim() || null,
    responsibleUserId: f.responsibleUserId.trim() || null,
    includeCancelled: f.includeCancelled,
    hasFilters: treasuryPayablesFiltersActive(f),
  };
}

export function resolveTreasuryPayablesStaleState(
  rows: TreasuryPayableListItemDto[],
  staleHours = TREASURY_PAYABLES_STALE_HOURS
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

export function buildTreasuryPayableOperationalHistory(
  row: TreasuryPayableListItemDto
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
  if (row.complement?.scheduledDate || row.scheduledDate) {
    const date = row.complement?.scheduledDate ?? row.scheduledDate;
    items.push({
      at: `${date}T12:00:00.000+00:00`,
      label: "Programação",
      detail: [
        formatTreasuryPayableDate(date),
        row.scheduledAmount
          ? formatTreasuryPayableMoney(row.scheduledAmount)
          : null,
        row.plannedAccountId ? `conta ${row.plannedAccountId.slice(0, 8)}…` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  if (row.complement?.status === "ON_HOLD") {
    items.push({
      at: row.complement.updatedAt,
      label: "Bloqueio",
      detail: row.complement.reason ?? "Título bloqueado operacionalmente",
    });
  }
  if (row.complement?.notes) {
    items.push({
      at: row.complement.updatedAt,
      label: "Observações",
      detail: row.complement.notes,
    });
  }
  if (row.official.settlements.settledAt) {
    items.push({
      at: `${row.official.settlements.settledAt}T12:00:00.000+00:00`,
      label: "Baixa oficial",
      detail: formatTreasuryPayableMoney(
        row.official.settlements.settledAmount
      ),
    });
  }
  items.push({
    at: row.official.lastSyncedAt,
    label: "Última sincronização Nomus",
    detail: formatTreasuryPayableDateTime(row.official.lastSyncedAt),
  });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function resolveTreasuryPayableAccountLabel(
  accounts: TreasuryFinancialAccountDto[],
  accountId: string | null | undefined
): string {
  if (!accountId) return "—";
  const acc = accounts.find((a) => a.id === accountId);
  if (!acc) return accountId;
  return `${acc.code} · ${acc.name}`;
}

/** Preview de impacto no caixa antes de confirmar a programação. */
export function previewTreasuryPayableProgrammingImpact(input: {
  accountId: string;
  scheduledAmount: string;
  accounts: TreasuryFinancialAccountDto[];
  balancesByAccountId: Record<string, string | null | undefined>;
}): TreasuryPayableProgrammingImpactDto {
  const account = input.accounts.find((a) => a.id === input.accountId);
  const accountBalanceBefore = normalizeTreasuryMoneyString(
    input.balancesByAccountId[input.accountId] ?? "0.00"
  );
  let consolidatedBalanceBefore = "0.00";
  for (const acc of input.accounts) {
    if (!acc.includeInConsolidated || !acc.isActive) continue;
    consolidatedBalanceBefore = addTreasuryMoney(
      consolidatedBalanceBefore,
      normalizeTreasuryMoneyString(
        input.balancesByAccountId[acc.id] ?? "0.00"
      )
    );
  }
  return computeTreasuryPayableProgrammingImpact({
    accountId: input.accountId,
    accountBalanceBefore,
    consolidatedBalanceBefore,
    scheduledAmount: input.scheduledAmount,
    accountIncludedInConsolidated: account?.includeInConsolidated ?? false,
  });
}

export function describeTreasuryPayableProgrammingRisk(
  impact: TreasuryPayableProgrammingImpactDto
): string {
  if (
    impact.createsNegativeAccountBalance &&
    impact.createsNegativeConsolidatedBalance
  ) {
    return "Risco alto: saldo negativo na conta e no consolidado.";
  }
  if (impact.createsNegativeAccountBalance) {
    return "Risco: saldo projetado negativo na conta pagadora.";
  }
  if (impact.createsNegativeConsolidatedBalance) {
    return "Risco: saldo consolidado projetado negativo.";
  }
  return "Sem risco de saldo negativo projetado.";
}
