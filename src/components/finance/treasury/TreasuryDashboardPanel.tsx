/**
 * Painel visual do dashboard diário — estados + cards + listas.
 * Informação não depende somente de cores (rótulos textuais).
 */

import React from "react";
import { RefreshCw } from "lucide-react";
import type {
  TreasuryDashboardDto,
  TreasuryFinancialAccountDto,
} from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_PROJECTION_LAYERS } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_DASHBOARD_DENIED_MESSAGE,
  TREASURY_DASHBOARD_EMPTY_DESCRIPTION,
  TREASURY_DASHBOARD_EMPTY_FILTERED_DESCRIPTION,
  TREASURY_DASHBOARD_EMPTY_FILTERED_TITLE,
  TREASURY_DASHBOARD_EMPTY_TITLE,
  TREASURY_DASHBOARD_PERIOD_LABELS,
  TREASURY_DASHBOARD_RECALCULATING_MESSAGE,
  TREASURY_DASHBOARD_SCENARIO_LABELS,
  TREASURY_DASHBOARD_SEVERITY_LABELS,
  buildTreasuryDashboardShortcuts,
  describeTreasuryDashboardPeriod,
  divergenceStatusLabel,
  formatTreasuryDashboardCivilDate,
  formatTreasuryDashboardDateTime,
  formatTreasuryDashboardMoney,
  type TreasuryDashboardFilterState,
  type TreasuryDashboardPeriod,
  type TreasuryDashboardViewKind,
} from "@/src/lib/treasury/treasuryDashboardUi.js";
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
import type { TreasuryProjectionLayer } from "@/src/lib/treasury/contracts/index.js";

export type TreasuryDashboardPanelProps = {
  viewKind: TreasuryDashboardViewKind;
  dashboard: TreasuryDashboardDto | null;
  accounts: TreasuryFinancialAccountDto[];
  error: string | null;
  staleMessage: string | null;
  recalculating: boolean;
  filters: TreasuryDashboardFilterState;
  onFiltersChange: (next: TreasuryDashboardFilterState) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
  onOpenTotal: (compositionKey: string) => void;
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

function MetricCard({
  label,
  value,
  hint,
  testId,
  onClick,
  statusText,
}: {
  label: string;
  value: string;
  hint?: string;
  testId: string;
  onClick?: () => void;
  statusText?: string;
}) {
  const interactive = Boolean(onClick);
  const className =
    "rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors" +
    (interactive ? " hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" : "");

  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-2 text-xl font-semibold tabular-nums text-foreground"
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
      {statusText ? (
        <p className="mt-2 text-xs font-medium text-foreground" data-testid={`${testId}-status`}>
          {statusText}
        </p>
      ) : null}
      {interactive ? (
        <p className="mt-2 text-[11px] font-semibold text-primary">
          Clique para detalhar
        </p>
      ) : null}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        className={className}
        data-testid={testId}
        onClick={onClick}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={className} data-testid={testId}>
      {body}
    </div>
  );
}

function severityTone(
  severity: "INFO" | "WARNING" | "CRITICAL"
): "sky" | "amber" | "rose" {
  if (severity === "CRITICAL") return "rose";
  if (severity === "WARNING") return "amber";
  return "sky";
}

export function TreasuryDashboardPanel({
  viewKind,
  dashboard,
  accounts,
  error,
  staleMessage,
  recalculating,
  filters,
  onFiltersChange,
  onRefresh,
  onClearFilters,
  onOpenTotal,
  onDismissError,
}: TreasuryDashboardPanelProps) {
  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_DASHBOARD_DENIED_MESSAGE}
        testId="treasury-dashboard-permission-denied"
      />
    );
  }

  const patch = (partial: Partial<TreasuryDashboardFilterState>) =>
    onFiltersChange({ ...filters, ...partial });
  const field = financeModuleFilterFieldClass();
  const shortcuts = buildTreasuryDashboardShortcuts();

  return (
    <div className="space-y-4" data-testid="treasury-dashboard-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Data">
            <input
              type="date"
              className={field}
              value={filters.date}
              onChange={(e) => patch({ date: e.target.value })}
              data-testid="treasury-dashboard-filter-date"
            />
          </FilterField>
          <FilterField label="Período">
            <select
              className={field}
              value={filters.period}
              onChange={(e) =>
                patch({ period: e.target.value as TreasuryDashboardPeriod })
              }
              data-testid="treasury-dashboard-filter-period"
            >
              {(Object.keys(TREASURY_DASHBOARD_PERIOD_LABELS) as TreasuryDashboardPeriod[]).map(
                (p) => (
                  <option key={p} value={p}>
                    {TREASURY_DASHBOARD_PERIOD_LABELS[p]}
                  </option>
                )
              )}
            </select>
          </FilterField>
          <FilterField label="Conta">
            <select
              className={field}
              value={filters.accountId}
              onChange={(e) => patch({ accountId: e.target.value })}
              data-testid="treasury-dashboard-filter-account"
            >
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Cenário">
            <select
              className={field}
              value={filters.scenario}
              onChange={(e) =>
                patch({ scenario: e.target.value as TreasuryProjectionLayer })
              }
              data-testid="treasury-dashboard-filter-scenario"
            >
              {TREASURY_PROJECTION_LAYERS.map((s) => (
                <option key={s} value={s}>
                  {TREASURY_DASHBOARD_SCENARIO_LABELS[s]}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={onClearFilters}
            data-testid="treasury-dashboard-clear-filters"
          >
            Limpar filtros
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            onClick={onRefresh}
            data-testid="treasury-dashboard-refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground"
        data-testid="treasury-dashboard-meta"
      >
        <span>{describeTreasuryDashboardPeriod(filters)}</span>
        <span aria-hidden>·</span>
        <span>
          Cenário:{" "}
          <strong className="text-foreground">
            {TREASURY_DASHBOARD_SCENARIO_LABELS[filters.scenario]}
          </strong>
        </span>
        <span aria-hidden>·</span>
        <span data-testid="treasury-dashboard-last-updated">
          Última atualização:{" "}
          <strong className="text-foreground">
            {formatTreasuryDashboardDateTime(dashboard?.asOf ?? null)}
          </strong>
        </span>
      </div>

      {error ? (
        <div data-testid="treasury-dashboard-error">
          <FinanceModuleErrorBanner
            message={error}
            onRetry={onRefresh}
            onDismiss={onDismissError}
          />
        </div>
      ) : null}

      {staleMessage ? (
        <div
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          role="status"
          data-testid="treasury-dashboard-stale"
        >
          <strong className="font-semibold">Dados desatualizados. </strong>
          {staleMessage}
        </div>
      ) : null}

      {recalculating ? (
        <div
          className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-sm text-foreground"
          role="status"
          data-testid="treasury-dashboard-recalculating"
        >
          <strong className="font-semibold">Recálculo em andamento. </strong>
          {TREASURY_DASHBOARD_RECALCULATING_MESSAGE}
        </div>
      ) : null}

      {viewKind === "loading" ? (
        <div data-testid="treasury-dashboard-loading">
          <FinanceModuleLoadingBlock label="Carregando dashboard da Tesouraria…" />
        </div>
      ) : null}

      {viewKind === "empty" ? (
        <div data-testid="treasury-dashboard-empty">
          <FinanceModuleEmptyState
            title={TREASURY_DASHBOARD_EMPTY_TITLE}
            description={TREASURY_DASHBOARD_EMPTY_DESCRIPTION}
          />
        </div>
      ) : null}

      {viewKind === "empty-filtered" ? (
        <div data-testid="treasury-dashboard-empty-filtered">
          <FinanceModuleEmptyState
            title={TREASURY_DASHBOARD_EMPTY_FILTERED_TITLE}
            description={TREASURY_DASHBOARD_EMPTY_FILTERED_DESCRIPTION}
          />
        </div>
      ) : null}

      {viewKind === "error" && !dashboard ? (
        <div data-testid="treasury-dashboard-error-state">
          <FinanceModuleEmptyState
            title="Falha ao carregar"
            description={error ?? "Não foi possível carregar o dashboard."}
          />
        </div>
      ) : null}

      {viewKind === "ready" && dashboard ? (
        <>
          <section className="space-y-2" data-testid="treasury-dashboard-balance-cards">
            <h2 className="text-sm font-semibold text-foreground">Cards de saldo</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Saldo observado"
                value={formatTreasuryDashboardMoney(dashboard.observedBalance)}
                hint={`Data ${formatTreasuryDashboardCivilDate(dashboard.civilDate)}`}
                testId="treasury-dashboard-card-observed"
                onClick={() => onOpenTotal("observedBalance")}
              />
              <MetricCard
                label="Saldo calculado"
                value={formatTreasuryDashboardMoney(dashboard.calculatedBalance)}
                testId="treasury-dashboard-card-calculated"
                onClick={() => onOpenTotal("calculatedBalance")}
              />
              <MetricCard
                label="Saldo conciliado"
                value={formatTreasuryDashboardMoney(dashboard.reconciledBalance)}
                testId="treasury-dashboard-card-reconciled"
                onClick={() => onOpenTotal("reconciledBalance")}
              />
              <MetricCard
                label="Diferença"
                value={formatTreasuryDashboardMoney(dashboard.divergence)}
                statusText={divergenceStatusLabel(
                  dashboard.hasDivergence,
                  dashboard.divergence
                )}
                testId="treasury-dashboard-card-divergence"
                onClick={() => onOpenTotal("divergence")}
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard
                label="Saldo atual"
                value={formatTreasuryDashboardMoney(dashboard.currentBalance)}
                hint={dashboard.currentBalanceOrigin}
                testId="treasury-dashboard-card-current"
                onClick={() => onOpenTotal("currentBalance")}
              />
              <MetricCard
                label="Saldo projetado de encerramento"
                value={formatTreasuryDashboardMoney(
                  dashboard.projectedClosingBalance
                )}
                hint={dashboard.projectedClosingOrigin}
                testId="treasury-dashboard-card-projected"
                onClick={() => onOpenTotal("projectedClosingBalance")}
              />
            </div>
          </section>

          <section className="space-y-2" data-testid="treasury-dashboard-planned-realized">
            <h2 className="text-sm font-semibold text-foreground">
              Previsto e realizado
            </h2>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Recebimentos do dia</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("receiptsPlanned")}
                    >
                      Previsto ({dashboard.receipts.plannedTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.receipts.plannedAmount)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("receiptsRealized")}
                    >
                      Realizado ({dashboard.receipts.realizedTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.receipts.realizedAmount)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("receiptsPending")}
                    >
                      Pendente ({dashboard.receipts.pendingTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.receipts.pendingAmount)}
                    </span>
                  </li>
                </ul>
              </div>
              <div className="rounded-xl border border-border p-4">
                <h3 className="text-sm font-semibold">Pagamentos do dia</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("paymentsPlanned")}
                    >
                      Previsto ({dashboard.payments.plannedTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.payments.plannedAmount)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("paymentsRealized")}
                    >
                      Realizado ({dashboard.payments.realizedTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.payments.realizedAmount)}
                    </span>
                  </li>
                  <li className="flex justify-between gap-2">
                    <button
                      type="button"
                      className="text-left font-medium text-primary underline-offset-2 hover:underline"
                      onClick={() => onOpenTotal("paymentsPending")}
                    >
                      Pendente ({dashboard.payments.pendingTitleCount} títulos)
                    </button>
                    <span className="tabular-nums font-semibold">
                      {formatTreasuryDashboardMoney(dashboard.payments.pendingAmount)}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section className="space-y-2" data-testid="treasury-dashboard-accounts">
            <h2 className="text-sm font-semibold text-foreground">
              Posição por conta
            </h2>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Conta</th>
                    <th className="px-3 py-2">Observado</th>
                    <th className="px-3 py-2">Calculado</th>
                    <th className="px-3 py-2">Diferença</th>
                    <th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.accounts.map((acc) => (
                    <tr
                      key={acc.accountId}
                      className="border-t border-border"
                      data-testid={`treasury-dashboard-account-${acc.accountId}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold">
                          {acc.accountCode} — {acc.accountName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {acc.includeInConsolidated
                            ? "No consolidado"
                            : "Fora do consolidado"}
                          {acc.isNegative ? " · Saldo negativo" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasuryDashboardMoney(acc.observedBalance)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasuryDashboardMoney(acc.calculatedBalance)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasuryDashboardMoney(acc.divergence)}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs font-medium">
                          {divergenceStatusLabel(acc.hasDivergence, acc.divergence)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2" data-testid="treasury-dashboard-exceptions">
              <h2 className="text-sm font-semibold text-foreground">Exceções</h2>
              {dashboard.priorityExceptions.length === 0 ? (
                <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">
                  Nenhuma exceção prioritária no momento.
                </p>
              ) : (
                <ul className="space-y-2">
                  {dashboard.priorityExceptions.map((ex) => (
                    <li
                      key={ex.id}
                      className="rounded-xl border border-border px-3 py-3"
                      data-testid={`treasury-dashboard-exception-${ex.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <OverlayBadge
                          tone={severityTone(ex.severity)}
                          variant="soft"
                        >
                          {TREASURY_DASHBOARD_SEVERITY_LABELS[ex.severity]}
                        </OverlayBadge>
                        <span className="text-xs font-semibold uppercase text-muted-foreground">
                          {ex.type}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Status: {ex.status}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-foreground">
                        {ex.title}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="space-y-2" data-testid="treasury-dashboard-alerts">
              <h2 className="text-sm font-semibold text-foreground">Alertas</h2>
              {dashboard.freshness.sources.length === 0 &&
              !dashboard.hasDivergence ? (
                <p className="rounded-xl border border-border px-3 py-4 text-sm text-muted-foreground">
                  Sem alertas de freshness ou divergência.
                </p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {dashboard.hasDivergence ? (
                    <li className="rounded-xl border border-border px-3 py-3">
                      <strong>Divergência consolidada:</strong>{" "}
                      {formatTreasuryDashboardMoney(dashboard.divergence)}{" "}
                      (observado − calculado)
                    </li>
                  ) : null}
                  {dashboard.freshness.sources.map((src) => (
                    <li
                      key={src.source}
                      className="rounded-xl border border-border px-3 py-3"
                      data-testid={`treasury-dashboard-source-${src.source}`}
                    >
                      <div className="font-semibold">{src.label}</div>
                      <div className="text-xs text-muted-foreground">
                        Situação:{" "}
                        <strong className="text-foreground">
                          {src.isStale ? "Desatualizada" : "Atualizada"}
                        </strong>
                        {" · "}
                        Último sucesso:{" "}
                        {formatTreasuryDashboardDateTime(src.lastSuccessAt)}
                      </div>
                      <div className="mt-1 text-xs">{src.detail}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-2" data-testid="treasury-dashboard-shortcuts">
            <h2 className="text-sm font-semibold text-foreground">Atalhos</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {shortcuts.map((s) => (
                <a
                  key={s.id}
                  href={s.path}
                  className="rounded-xl border border-border bg-card px-3 py-3 text-sm shadow-sm hover:bg-accent/40"
                  data-testid={`treasury-dashboard-shortcut-${s.id}`}
                >
                  <div className="font-semibold text-foreground">{s.label}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.description}
                  </div>
                </a>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
