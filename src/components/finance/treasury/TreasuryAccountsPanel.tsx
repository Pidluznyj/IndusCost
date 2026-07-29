import React from "react";
import { Link } from "react-router-dom";
import { Building2, Plus, RefreshCw } from "lucide-react";
import type { TreasuryFinancialAccountDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_ACCOUNT_TYPE_LABELS,
  TREASURY_ACCOUNTS_DENIED_MESSAGE,
  TREASURY_ACCOUNTS_EMPTY_DESCRIPTION,
  TREASURY_ACCOUNTS_EMPTY_FILTERED_DESCRIPTION,
  TREASURY_ACCOUNTS_EMPTY_FILTERED_TITLE,
  TREASURY_ACCOUNTS_EMPTY_TITLE,
  TREASURY_LIQUIDITY_LABELS,
  formatTreasuryMoneyDisplay,
  formatTreasuryUpdatedAt,
  type TreasuryAccountsViewKind,
} from "@/src/lib/treasury/treasuryAccountsUi.js";
import { buildTreasuryBalancePath } from "@/src/lib/treasury/treasuryBalancesUi.js";
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
import { cn } from "@/src/lib/utils";

export type TreasuryAccountsStatusFilter = "all" | "active" | "inactive";

export type TreasuryAccountsPanelProps = {
  viewKind: TreasuryAccountsViewKind;
  canManage: boolean;
  rows: TreasuryFinancialAccountDto[];
  error: string | null;
  search: string;
  status: TreasuryAccountsStatusFilter;
  page: number;
  pageSize: number;
  totalPages: number;
  total: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: TreasuryAccountsStatusFilter) => void;
  onPageChange: (page: number) => void;
  onRefresh: () => void;
  onCreate: () => void;
  onEdit: (row: TreasuryFinancialAccountDto) => void;
  onDeactivate: (row: TreasuryFinancialAccountDto) => void;
  onReactivate: (row: TreasuryFinancialAccountDto) => void;
  onManageAccess: (row: TreasuryFinancialAccountDto) => void;
  onDismissError?: () => void;
};

export function TreasuryAccountsPanel({
  viewKind,
  canManage,
  rows,
  error,
  search,
  status,
  page,
  pageSize,
  totalPages,
  total,
  onSearchChange,
  onStatusChange,
  onPageChange,
  onRefresh,
  onCreate,
  onEdit,
  onDeactivate,
  onReactivate,
  onManageAccess,
  onDismissError,
}: TreasuryAccountsPanelProps) {
  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_ACCOUNTS_DENIED_MESSAGE}
        testId="treasury-accounts-permission-denied"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="treasury-accounts-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:max-w-xl">
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Busca</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Código, nome ou instituição"
              data-testid="treasury-accounts-search"
            />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={status}
              onChange={(e) =>
                onStatusChange(e.target.value as TreasuryAccountsStatusFilter)
              }
              data-testid="treasury-accounts-status-filter"
            >
              <option value="all">Todas</option>
              <option value="active">Ativas</option>
              <option value="inactive">Inativas</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onRefresh}
            data-testid="treasury-accounts-refresh"
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={onCreate}
              data-testid="treasury-accounts-create"
            >
              <Plus className="h-4 w-4" />
              Nova conta
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      ) : null}

      {viewKind === "loading" ? (
        <FinanceModuleLoadingBlock label="Carregando contas financeiras…" />
      ) : null}

      {viewKind === "empty" ? (
        <FinanceModuleEmptyState
          title={TREASURY_ACCOUNTS_EMPTY_TITLE}
          description={TREASURY_ACCOUNTS_EMPTY_DESCRIPTION}
        />
      ) : null}

      {viewKind === "empty-filtered" ? (
        <FinanceModuleEmptyState
          title={TREASURY_ACCOUNTS_EMPTY_FILTERED_TITLE}
          description={TREASURY_ACCOUNTS_EMPTY_FILTERED_DESCRIPTION}
        />
      ) : null}

      {viewKind === "ready" || (viewKind === "error" && rows.length > 0) ? (
        <>
          <p className="text-xs text-muted-foreground" data-testid="treasury-accounts-summary">
            {total} conta(s) · página {page} de {Math.max(totalPages, 1)} ·{" "}
            {pageSize}/página
          </p>

          {/* Desktop / tablet table */}
          <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
            <table
              className="min-w-[960px] w-full text-sm"
              data-testid="treasury-accounts-table"
            >
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left">
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Conta
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Instituição
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Mascarado
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Saldo mín.
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Liquidez
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Consolidado
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Atualizado
                  </th>
                  <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <p className="font-semibold">{row.code}</p>
                      <p className="text-xs text-muted-foreground">{row.name}</p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[11px] text-muted-foreground">
                          {TREASURY_ACCOUNT_TYPE_LABELS[row.accountType]}
                        </span>
                        {row.nomusBankAccountId ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/10 text-blue-700 px-1.5 py-0.5 text-[10px] font-semibold dark:bg-blue-500/20 dark:text-blue-300">
                            <Building2 className="h-3 w-3" />
                            Nomus: {row.nomusBankAccountId}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">{row.institutionName}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {row.agencyMasked} / {row.accountNumberMasked}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {formatTreasuryMoneyDisplay(row.minimumBalance)}
                    </td>
                    <td className="px-3 py-2">
                      {TREASURY_LIQUIDITY_LABELS[row.liquidity]}
                    </td>
                    <td className="px-3 py-2">
                      {row.includeInConsolidated ? "Sim" : "Não"}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-semibold",
                          row.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {row.isActive ? "Ativa" : "Inativa"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {formatTreasuryUpdatedAt(row.updatedAt)}
                    </td>
                    <td className="px-3 py-2">
                      <AccountActions
                        row={row}
                        canManage={canManage}
                        onEdit={onEdit}
                        onDeactivate={onDeactivate}
                        onReactivate={onReactivate}
                        onManageAccess={onManageAccess}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div
            className="grid gap-3 md:hidden"
            data-testid="treasury-accounts-mobile-list"
          >
            {rows.map((row) => (
              <article
                key={row.id}
                className="rounded-xl border border-border bg-card p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {row.code} · {row.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {row.institutionName} ·{" "}
                      {TREASURY_ACCOUNT_TYPE_LABELS[row.accountType]}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      row.isActive
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {row.isActive ? "Ativa" : "Inativa"}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Mascarado</dt>
                    <dd className="font-mono">
                      {row.agencyMasked} / {row.accountNumberMasked}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Saldo mín.</dt>
                    <dd className="tabular-nums">
                      {formatTreasuryMoneyDisplay(row.minimumBalance)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Liquidez</dt>
                    <dd>{TREASURY_LIQUIDITY_LABELS[row.liquidity]}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Consolidado</dt>
                    <dd>{row.includeInConsolidated ? "Sim" : "Não"}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Última atualização</dt>
                    <dd className="tabular-nums">
                      {formatTreasuryUpdatedAt(row.updatedAt)}
                    </dd>
                  </div>
                </dl>
                <AccountActions
                  row={row}
                  canManage={canManage}
                  onEdit={onEdit}
                  onDeactivate={onDeactivate}
                  onReactivate={onReactivate}
                  onManageAccess={onManageAccess}
                />
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

function AccountActions({
  row,
  canManage,
  onEdit,
  onDeactivate,
  onReactivate,
  onManageAccess,
}: {
  row: TreasuryFinancialAccountDto;
  canManage: boolean;
  onEdit: (row: TreasuryFinancialAccountDto) => void;
  onDeactivate: (row: TreasuryFinancialAccountDto) => void;
  onReactivate: (row: TreasuryFinancialAccountDto) => void;
  onManageAccess: (row: TreasuryFinancialAccountDto) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link
        to={buildTreasuryBalancePath(row.id)}
        className="text-xs font-semibold text-primary"
        data-testid="treasury-accounts-balance"
      >
        Saldo
      </Link>
      {canManage ? (
        <>
          <button
            type="button"
            className="text-xs font-semibold text-primary"
            onClick={() => onEdit(row)}
            data-testid="treasury-accounts-edit"
          >
            Editar
          </button>
          <button
            type="button"
            className="text-xs font-semibold text-primary"
            onClick={() => onManageAccess(row)}
            data-testid="treasury-accounts-access"
          >
            Acessos
          </button>
          {row.isActive ? (
            <button
              type="button"
              className="text-xs font-semibold text-amber-700"
              onClick={() => onDeactivate(row)}
              data-testid="treasury-accounts-deactivate"
            >
              Desativar
            </button>
          ) : (
            <button
              type="button"
              className="text-xs font-semibold text-emerald-700"
              onClick={() => onReactivate(row)}
              data-testid="treasury-accounts-reactivate"
            >
              Reativar
            </button>
          )}
        </>
      ) : null}
    </div>
  );
}
