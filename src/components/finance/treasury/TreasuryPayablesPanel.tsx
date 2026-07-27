import React from "react";
import { RefreshCw } from "lucide-react";
import type { TreasuryPayableListItemDto } from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_PAYABLE_OPERATIONAL_STATUSES } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_PAYABLE_PRIORITY_LABELS,
  TREASURY_PAYABLE_SORT_LABELS,
  TREASURY_PAYABLE_STATUS_LABELS,
  TREASURY_PAYABLE_STATUS_TONES,
  TREASURY_PAYABLES_DENIED_MESSAGE,
  TREASURY_PAYABLES_EMPTY_DESCRIPTION,
  TREASURY_PAYABLES_EMPTY_FILTERED_DESCRIPTION,
  TREASURY_PAYABLES_EMPTY_FILTERED_TITLE,
  TREASURY_PAYABLES_EMPTY_TITLE,
  formatTreasuryPayableDate,
  formatTreasuryPayableMoney,
  resolveTreasuryPayableAccountLabel,
  type TreasuryPayablesFilterState,
  type TreasuryPayablesViewKind,
} from "@/src/lib/treasury/treasuryPayablesUi.js";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
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

export type TreasuryPayablesPanelProps = {
  viewKind: TreasuryPayablesViewKind;
  rows: TreasuryPayableListItemDto[];
  accounts: TreasuryFinancialAccountDto[];
  error: string | null;
  staleMessage: string | null;
  filters: TreasuryPayablesFilterState;
  page: number;
  pageSize: number;
  totalPages: number;
  titleCount: number;
  openAmountTotal: string;
  onFiltersChange: (next: TreasuryPayablesFilterState) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  onOpenDetails: (row: TreasuryPayableListItemDto) => void;
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

function StatusBadge({ status }: { status: TreasuryPayableListItemDto["operationalStatus"] }) {
  return (
    <OverlayBadge
      tone={TREASURY_PAYABLE_STATUS_TONES[status]}
      variant="soft"
      testId={`treasury-payable-status-${status}`}
    >
      {TREASURY_PAYABLE_STATUS_LABELS[status]}
    </OverlayBadge>
  );
}

export function TreasuryPayablesPanel({
  viewKind,
  rows,
  accounts,
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
}: TreasuryPayablesPanelProps) {
  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_PAYABLES_DENIED_MESSAGE}
        testId="treasury-payables-permission-denied"
      />
    );
  }

  const patch = (partial: Partial<TreasuryPayablesFilterState>) =>
    onFiltersChange({ ...filters, ...partial });
  const field = financeModuleFilterFieldClass();

  return (
    <div className="space-y-4" data-testid="treasury-payables-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Fornecedor">
            <input
              className={field}
              value={filters.supplierName}
              onChange={(e) => patch({ supplierName: e.target.value })}
              data-testid="treasury-payables-filter-supplier"
            />
          </FilterField>
          <FilterField label="CNPJ/CPF">
            <input
              className={field}
              value={filters.supplierTaxId}
              onChange={(e) => patch({ supplierTaxId: e.target.value })}
            />
          </FilterField>
          <FilterField label="Documento">
            <input
              className={field}
              value={filters.document}
              onChange={(e) => patch({ document: e.target.value })}
            />
          </FilterField>
          <FilterField label="Categoria">
            <input
              className={field}
              value={filters.classification}
              onChange={(e) => patch({ classification: e.target.value })}
            />
          </FilterField>
          <FilterField label="Centro de custo">
            <input
              className={field}
              value={filters.costCenter}
              onChange={(e) => patch({ costCenter: e.target.value })}
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
          <FilterField label="Programada de">
            <input
              type="date"
              className={field}
              value={filters.scheduledFrom}
              onChange={(e) => patch({ scheduledFrom: e.target.value })}
              data-testid="treasury-payables-filter-scheduled-from"
            />
          </FilterField>
          <FilterField label="Programada até">
            <input
              type="date"
              className={field}
              value={filters.scheduledTo}
              onChange={(e) => patch({ scheduledTo: e.target.value })}
            />
          </FilterField>
          <FilterField label="Situação">
            <select
              className={field}
              value={filters.operationalStatus}
              onChange={(e) => patch({ operationalStatus: e.target.value })}
              data-testid="treasury-payables-filter-status"
            >
              <option value="">Todas</option>
              {TREASURY_PAYABLE_OPERATIONAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {TREASURY_PAYABLE_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Prioridade">
            <select
              className={field}
              value={filters.priority}
              onChange={(e) => patch({ priority: e.target.value })}
            >
              <option value="">Todas</option>
              {Object.entries(TREASURY_PAYABLE_PRIORITY_LABELS).map(
                ([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                )
              )}
            </select>
          </FilterField>
          <FilterField label="Conta pagadora">
            <select
              className={field}
              value={filters.plannedAccountId}
              onChange={(e) => patch({ plannedAccountId: e.target.value })}
              data-testid="treasury-payables-filter-account"
            >
              <option value="">Todas</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.code} · {acc.name}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Responsável (userId)">
            <input
              className={field}
              value={filters.responsibleUserId}
              onChange={(e) => patch({ responsibleUserId: e.target.value })}
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
                    .value as TreasuryPayablesFilterState["sortBy"],
                })
              }
            >
              {Object.entries(TREASURY_PAYABLE_SORT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
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
            data-testid="treasury-payables-refresh"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClearFilters}
            data-testid="treasury-payables-clear-filters"
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
          data-testid="treasury-payables-stale"
          role="status"
        >
          {staleMessage}
        </div>
      ) : null}

      {viewKind === "loading" ? (
        <FinanceModuleLoadingBlock label="Carregando contas a pagar…" />
      ) : null}

      {viewKind === "empty" ? (
        <FinanceModuleEmptyState
          title={TREASURY_PAYABLES_EMPTY_TITLE}
          description={TREASURY_PAYABLES_EMPTY_DESCRIPTION}
        />
      ) : null}

      {viewKind === "empty-filtered" ? (
        <FinanceModuleEmptyState
          title={TREASURY_PAYABLES_EMPTY_FILTERED_TITLE}
          description={TREASURY_PAYABLES_EMPTY_FILTERED_DESCRIPTION}
        />
      ) : null}

      {viewKind === "ready" || (viewKind === "error" && rows.length > 0) ? (
        <>
          <p
            className="text-xs text-muted-foreground"
            data-testid="treasury-payables-summary"
          >
            {titleCount} título(s) · total aberto{" "}
            {formatTreasuryPayableMoney(openAmountTotal)} · página {page} de{" "}
            {Math.max(totalPages, 1)} · {pageSize}/página
          </p>

          <div className="hidden overflow-x-auto rounded-xl border border-border xl:block">
            <table
              className="min-w-[1280px] w-full text-sm"
              data-testid="treasury-payables-table"
            >
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  {[
                    "Fornecedor",
                    "Vencimento",
                    "Aberto",
                    "Situação",
                    "Prioridade",
                    "Programada",
                    "Conta pagadora",
                    "Impacto caixa",
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
                        {row.official.documentNumber
                          ? ` · ${row.official.documentNumber}`
                          : ""}
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatTreasuryPayableDate(row.official.dueDate)}
                    </td>
                    <td className="px-3 py-2 tabular-nums font-medium">
                      {formatTreasuryPayableMoney(row.openAmount)}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.operationalStatus} />
                    </td>
                    <td className="px-3 py-2">
                      {row.priority
                        ? TREASURY_PAYABLE_PRIORITY_LABELS[row.priority]
                        : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      <div>{formatTreasuryPayableDate(row.scheduledDate)}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {formatTreasuryPayableMoney(row.scheduledAmount)}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {resolveTreasuryPayableAccountLabel(
                        accounts,
                        row.plannedAccountId
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {row.scheduledAmount
                        ? `− ${formatTreasuryPayableMoney(row.scheduledAmount)}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-semibold"
                        onClick={() => onOpenDetails(row)}
                        data-testid={`treasury-payables-open-${row.titleId}`}
                      >
                        Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            className="space-y-3 xl:hidden"
            data-testid="treasury-payables-mobile-list"
          >
            {rows.map((row) => (
              <button
                key={row.titleId}
                type="button"
                className="w-full rounded-xl border border-border p-3 text-left"
                onClick={() => onOpenDetails(row)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {row.official.counterparty.name ?? "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Venc. {formatTreasuryPayableDate(row.official.dueDate)} ·{" "}
                      {formatTreasuryPayableMoney(row.openAmount)}
                    </p>
                  </div>
                  <StatusBadge status={row.operationalStatus} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Prog. {formatTreasuryPayableDate(row.scheduledDate)} ·{" "}
                  {resolveTreasuryPayableAccountLabel(
                    accounts,
                    row.plannedAccountId
                  )}
                </p>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Anterior
            </button>
            <span className="text-xs text-muted-foreground">
              Página {page} / {Math.max(totalPages, 1)}
            </span>
            <button
              type="button"
              className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Próxima
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
