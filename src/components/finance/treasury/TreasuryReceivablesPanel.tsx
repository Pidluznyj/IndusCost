import React from "react";
import { RefreshCw } from "lucide-react";
import type { TreasuryReceivableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PRIORITY_LABELS,
  TREASURY_RECEIVABLES_DENIED_MESSAGE,
  TREASURY_RECEIVABLES_EMPTY_DESCRIPTION,
  TREASURY_RECEIVABLES_EMPTY_FILTERED_DESCRIPTION,
  TREASURY_RECEIVABLES_EMPTY_FILTERED_TITLE,
  TREASURY_RECEIVABLES_EMPTY_TITLE,
  TREASURY_RECEIVABLE_SORT_LABELS,
  TREASURY_RECEIVABLE_STATUS_LABELS,
  TREASURY_RECEIVABLE_STATUS_TONES,
  createEmptyTreasuryReceivablesFilters,
  formatTreasuryReceivableDate,
  formatTreasuryReceivableMoney,
  type TreasuryReceivablesFilterState,
  type TreasuryReceivablesViewKind,
} from "@/src/lib/treasury/treasuryReceivablesUi.js";
import { TREASURY_RECEIVABLE_OPERATIONAL_STATUSES } from "@/src/lib/treasury/contracts/index.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";
import { OverlayBadge } from "@/src/components/ui/overlay";

export type TreasuryReceivablesPanelProps = {
  viewKind: TreasuryReceivablesViewKind;
  rows: TreasuryReceivableListItemDto[];
  error: string | null;
  staleMessage: string | null;
  filters: TreasuryReceivablesFilterState;
  page: number;
  pageSize: number;
  totalPages: number;
  titleCount: number;
  openAmountTotal: string;
  onFiltersChange: (next: TreasuryReceivablesFilterState) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  onOpenDetails: (row: TreasuryReceivableListItemDto) => void;
  onDismissError?: () => void;
};

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className={financeModuleFilterLabelClass()}>{label}</span>
      {children}
    </label>
  );
}

export function TreasuryReceivablesPanel({
  viewKind,
  rows,
  error,
  staleMessage,
  filters,
  page,
  pageSize,
  totalPages,
  titleCount,
  openAmountTotal,
  onFiltersChange,
  onPageChange,
  onRefresh,
  onClearFilters,
  onOpenDetails,
  onDismissError,
}: TreasuryReceivablesPanelProps) {
  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_RECEIVABLES_DENIED_MESSAGE}
        testId="treasury-receivables-permission-denied"
      />
    );
  }

  const patch = (partial: Partial<TreasuryReceivablesFilterState>) =>
    onFiltersChange({ ...filters, ...partial });

  const field = financeModuleFilterFieldClass();

  return (
    <div className="space-y-4" data-testid="treasury-receivables-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Cliente">
            <input
              className={field}
              value={filters.customerName}
              onChange={(e) => patch({ customerName: e.target.value })}
              data-testid="treasury-receivables-filter-customer"
            />
          </FilterField>
          <FilterField label="CNPJ/CPF">
            <input
              className={field}
              value={filters.customerTaxId}
              onChange={(e) => patch({ customerTaxId: e.target.value })}
            />
          </FilterField>
          <FilterField label="Documento">
            <input
              className={field}
              value={filters.document}
              onChange={(e) => patch({ document: e.target.value })}
            />
          </FilterField>
          <FilterField label="Pedido">
            <input
              className={field}
              value={filters.salesOrder}
              onChange={(e) => patch({ salesOrder: e.target.value })}
            />
          </FilterField>
          <FilterField label="Nota fiscal">
            <input
              className={field}
              value={filters.invoice}
              onChange={(e) => patch({ invoice: e.target.value })}
            />
          </FilterField>
          <FilterField label="Vendedor">
            <input
              className={field}
              value={filters.sellerName}
              onChange={(e) => patch({ sellerName: e.target.value })}
            />
          </FilterField>
          <FilterField label="Resp. comercial">
            <input
              className={field}
              value={filters.commercialOwnerName}
              onChange={(e) => patch({ commercialOwnerName: e.target.value })}
            />
          </FilterField>
          <FilterField label="Resp. cobrança (userId)">
            <input
              className={field}
              value={filters.collectionOwnerUserId}
              onChange={(e) =>
                patch({ collectionOwnerUserId: e.target.value })
              }
            />
          </FilterField>
          <FilterField label="Vencimento de">
            <input
              type="date"
              className={field}
              value={filters.dueFrom}
              onChange={(e) => patch({ dueFrom: e.target.value })}
            />
          </FilterField>
          <FilterField label="Vencimento até">
            <input
              type="date"
              className={field}
              value={filters.dueTo}
              onChange={(e) => patch({ dueTo: e.target.value })}
            />
          </FilterField>
          <FilterField label="Data esperada de">
            <input
              type="date"
              className={field}
              value={filters.expectedFrom}
              onChange={(e) => patch({ expectedFrom: e.target.value })}
            />
          </FilterField>
          <FilterField label="Data esperada até">
            <input
              type="date"
              className={field}
              value={filters.expectedTo}
              onChange={(e) => patch({ expectedTo: e.target.value })}
            />
          </FilterField>
          <FilterField label="Situação">
            <select
              className={field}
              value={filters.operationalStatus}
              onChange={(e) => patch({ operationalStatus: e.target.value })}
              data-testid="treasury-receivables-filter-status"
            >
              <option value="">Todas</option>
              {TREASURY_RECEIVABLE_OPERATIONAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TREASURY_RECEIVABLE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Promessa">
            <select
              className={field}
              value={filters.hasPromise}
              onChange={(e) =>
                patch({
                  hasPromise: e.target.value as "" | "true" | "false",
                })
              }
            >
              <option value="">Todas</option>
              <option value="true">Com promessa</option>
              <option value="false">Sem promessa</option>
            </select>
          </FilterField>
          <FilterField label="Prioridade">
            <select
              className={field}
              value={filters.priority}
              onChange={(e) => patch({ priority: e.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(TREASURY_PRIORITY_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Próxima ação">
            <input
              className={field}
              value={filters.nextAction}
              onChange={(e) => patch({ nextAction: e.target.value })}
              placeholder="Contém…"
              data-testid="treasury-receivables-filter-next-action"
            />
          </FilterField>
          <FilterField label="Conta prevista">
            <input
              className={field}
              value={filters.plannedAccountId}
              onChange={(e) => patch({ plannedAccountId: e.target.value })}
            />
          </FilterField>
          <FilterField label="Atraso mín. (dias)">
            <input
              className={field}
              inputMode="numeric"
              value={filters.daysOverdueMin}
              onChange={(e) => patch({ daysOverdueMin: e.target.value })}
            />
          </FilterField>
          <FilterField label="Atraso máx. (dias)">
            <input
              className={field}
              inputMode="numeric"
              value={filters.daysOverdueMax}
              onChange={(e) => patch({ daysOverdueMax: e.target.value })}
            />
          </FilterField>
          <FilterField label="Valor aberto mín.">
            <input
              className={field}
              value={filters.openAmountMin}
              onChange={(e) => patch({ openAmountMin: e.target.value })}
              placeholder="0.00"
            />
          </FilterField>
          <FilterField label="Valor aberto máx.">
            <input
              className={field}
              value={filters.openAmountMax}
              onChange={(e) => patch({ openAmountMax: e.target.value })}
              placeholder="0.00"
            />
          </FilterField>
          <FilterField label="Ordenar por">
            <select
              className={field}
              value={filters.sortBy}
              onChange={(e) =>
                patch({
                  sortBy: e.target
                    .value as TreasuryReceivablesFilterState["sortBy"],
                })
              }
            >
              {Object.entries(TREASURY_RECEIVABLE_SORT_LABELS).map(
                ([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                )
              )}
            </select>
          </FilterField>
          <FilterField label="Direção">
            <select
              className={field}
              value={filters.sortDirection}
              onChange={(e) =>
                patch({
                  sortDirection: e.target.value as "asc" | "desc",
                })
              }
            >
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </FilterField>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={filters.includeCancelled}
              onChange={(e) => patch({ includeCancelled: e.target.checked })}
            />
            Incluir cancelados
          </label>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onRefresh}
            data-testid="treasury-receivables-refresh"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClearFilters}
            data-testid="treasury-receivables-clear-filters"
          >
            Limpar filtros
          </button>
        </div>
      </div>

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      ) : null}

      {staleMessage ? (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          data-testid="treasury-receivables-stale"
          role="status"
        >
          {staleMessage}
        </div>
      ) : null}

      {viewKind === "loading" ? (
        <FinanceModuleLoadingBlock label="Carregando contas a receber…" />
      ) : null}

      {viewKind === "empty" ? (
        <FinanceModuleEmptyState
          title={TREASURY_RECEIVABLES_EMPTY_TITLE}
          description={TREASURY_RECEIVABLES_EMPTY_DESCRIPTION}
        />
      ) : null}

      {viewKind === "empty-filtered" ? (
        <FinanceModuleEmptyState
          title={TREASURY_RECEIVABLES_EMPTY_FILTERED_TITLE}
          description={TREASURY_RECEIVABLES_EMPTY_FILTERED_DESCRIPTION}
        />
      ) : null}

      {viewKind === "ready" || (viewKind === "error" && rows.length > 0) ? (
        <>
          <p
            className="text-xs text-muted-foreground"
            data-testid="treasury-receivables-summary"
          >
            {titleCount} título(s) · total aberto{" "}
            {formatTreasuryReceivableMoney(openAmountTotal)} · página {page} de{" "}
            {Math.max(totalPages, 1)} · {pageSize}/página
          </p>

          {/* Desktop: colunas completas */}
          <div className="hidden overflow-x-auto rounded-xl border border-border xl:block">
            <table
              className="min-w-[1200px] w-full text-sm"
              data-testid="treasury-receivables-table"
            >
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {[
                    "Cliente",
                    "Vencimento",
                    "Aberto",
                    "Situação",
                    "Atraso",
                    "Prioridade",
                    "Responsável",
                    "Última ação",
                    "Próxima ação",
                    "",
                  ].map((h) => (
                    <th
                      key={h || "actions"}
                      className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.titleId} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-semibold">
                        {row.official.counterparty.name ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        #{row.externalId}
                        {row.official.invoice.number
                          ? ` · NF ${row.official.invoice.number}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatTreasuryReceivableDate(row.official.dueDate)}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium">
                      {formatTreasuryReceivableMoney(row.openAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.operationalStatus} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.daysOverdue > 0 ? row.daysOverdue : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.complement
                        ? TREASURY_PRIORITY_LABELS[row.complement.priority]
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.complement?.responsibleUserId ??
                        row.commercialOwnerName ??
                        "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px] truncate">
                      {row.lastAction?.summary ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[140px] truncate">
                      {row.nextAction ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onOpenDetails(row)}
                        data-testid={`treasury-receivables-open-${row.externalId}`}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Tablet: colunas reduzidas */}
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block xl:hidden">
            <table
              className="min-w-[720px] w-full text-sm"
              data-testid="treasury-receivables-table-md"
            >
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {["Cliente", "Venc.", "Aberto", "Situação", "Atraso", ""].map(
                    (h) => (
                      <th
                        key={h || "a"}
                        className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.titleId} className="border-b border-border/60">
                    <td className="px-3 py-2 font-semibold">
                      {row.official.counterparty.name ?? "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatTreasuryReceivableDate(row.official.dueDate)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatTreasuryReceivableMoney(row.openAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.operationalStatus} />
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.daysOverdue > 0 ? row.daysOverdue : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onOpenDetails(row)}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div
            className="grid gap-3 md:hidden"
            data-testid="treasury-receivables-mobile-list"
          >
            {rows.map((row) => (
              <article
                key={row.titleId}
                className="space-y-2 rounded-xl border border-border bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {row.official.counterparty.name ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      #{row.externalId} · venc.{" "}
                      {formatTreasuryReceivableDate(row.official.dueDate)}
                    </p>
                  </div>
                  <StatusBadge status={row.operationalStatus} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Aberto</dt>
                    <dd className="tabular-nums font-medium">
                      {formatTreasuryReceivableMoney(row.openAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Atraso</dt>
                    <dd className="tabular-nums">
                      {row.daysOverdue > 0 ? `${row.daysOverdue} d` : "—"}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Próxima ação</dt>
                    <dd>{row.nextAction ?? "—"}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm font-semibold"
                  onClick={() => onOpenDetails(row)}
                >
                  Ver detalhes
                </button>
              </article>
            ))}
          </div>

          {totalPages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                data-testid="treasury-receivables-prev"
              >
                Anterior
              </button>
              <span className="text-xs text-muted-foreground">
                Página {page} / {totalPages}
              </span>
              <button
                type="button"
                className="rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-40"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                data-testid="treasury-receivables-next"
              >
                Próxima
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StatusBadge({
  status,
}: {
  status: TreasuryReceivableListItemDto["operationalStatus"];
}) {
  return (
    <OverlayBadge
      tone={TREASURY_RECEIVABLE_STATUS_TONES[status]}
      variant="soft"
      testId={`treasury-receivable-status-${status}`}
    >
      {TREASURY_RECEIVABLE_STATUS_LABELS[status]}
    </OverlayBadge>
  );
}

export { createEmptyTreasuryReceivablesFilters };
