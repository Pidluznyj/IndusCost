/**
 * Painel da agenda financeira — filtros, gráfico, tabela detalhável.
 * Informação não depende somente de cores (rótulos textuais de risco/status).
 */

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import type {
  TreasuryAgendaDto,
  TreasuryFinancialAccountDto,
  TreasuryProjectionLayer,
} from "@/src/lib/treasury/contracts/index.js";
import { TREASURY_PROJECTION_LAYERS } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_AGENDA_COLUMN_LABELS,
  TREASURY_AGENDA_DENIED_MESSAGE,
  TREASURY_AGENDA_EMPTY_DESCRIPTION,
  TREASURY_AGENDA_EMPTY_FILTERED_DESCRIPTION,
  TREASURY_AGENDA_EMPTY_FILTERED_TITLE,
  TREASURY_AGENDA_EMPTY_TITLE,
  TREASURY_AGENDA_PERIOD_LABELS,
  TREASURY_AGENDA_PERIOD_PRESETS,
  TREASURY_AGENDA_SCENARIO_LABELS,
  TREASURY_AGENDA_VIEW_MODE_LABELS,
  buildTreasuryAgendaBalanceChartPoints,
  buildTreasuryAgendaDisplayRows,
  formatTreasuryAgendaCivilDate,
  formatTreasuryAgendaDateTime,
  formatTreasuryAgendaMoney,
  listTreasuryAgendaGroupOptions,
  type TreasuryAgendaDisplayRow,
  type TreasuryAgendaFilterState,
  type TreasuryAgendaPeriodPreset,
  type TreasuryAgendaViewKind,
  type TreasuryAgendaViewMode,
} from "@/src/lib/treasury/treasuryAgendaUi.js";
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
import { TreasuryAgendaBalanceChart } from "./TreasuryAgendaBalanceChart.js";

export type TreasuryAgendaPanelProps = {
  viewKind: TreasuryAgendaViewKind;
  agenda: TreasuryAgendaDto | null;
  accounts: TreasuryFinancialAccountDto[];
  error: string | null;
  staleMessage: string | null;
  filters: TreasuryAgendaFilterState;
  onFiltersChange: (next: TreasuryAgendaFilterState) => void;
  onRefresh: () => void;
  onClearFilters: () => void;
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

function riskTone(riskCode: string): "sky" | "amber" | "rose" | "slate" {
  const code = (riskCode || "NONE").toUpperCase();
  if (code === "CRITICAL" || code === "HIGH") return "rose";
  if (code === "MEDIUM") return "amber";
  if (code === "LOW") return "sky";
  return "slate";
}

function AccountOrGroupCell({ row }: { row: TreasuryAgendaDisplayRow }) {
  if (row.groupLabel) {
    return (
      <span>
        Grupo: {row.groupLabel}
        <span className="sr-only"> ({row.groupKey})</span>
      </span>
    );
  }
  if (row.accountCode || row.accountName) {
    return (
      <span>
        {[row.accountCode, row.accountName].filter(Boolean).join(" — ")}
      </span>
    );
  }
  return <span>Consolidado</span>;
}

function DayDetail({ row }: { row: TreasuryAgendaDisplayRow }) {
  const items = row.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="treasury-agenda-day-detail-empty">
        Sem itens de composição neste dia (itemCount={row.itemCount}).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="treasury-agenda-day-detail">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="px-2 py-1 font-semibold">Tipo</th>
            <th className="px-2 py-1 font-semibold">Descrição</th>
            <th className="px-2 py-1 font-semibold text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-t border-border/60">
              <td className="px-2 py-1">{item.itemKind}</td>
              <td className="px-2 py-1">
                {item.label ?? item.sourceRef ?? item.officialTitleId ?? "—"}
              </td>
              <td className="px-2 py-1 text-right tabular-nums">
                {formatTreasuryAgendaMoney(item.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TreasuryAgendaPanel({
  viewKind,
  agenda,
  accounts,
  error,
  staleMessage,
  filters,
  onFiltersChange,
  onRefresh,
  onClearFilters,
  onDismissError,
}: TreasuryAgendaPanelProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const field = financeModuleFilterFieldClass();
  const patch = (partial: Partial<TreasuryAgendaFilterState>) =>
    onFiltersChange({ ...filters, ...partial });

  const displayRows = useMemo(() => {
    if (!agenda?.days) return [];
    return buildTreasuryAgendaDisplayRows({
      days: agenda.days,
      accounts,
      viewMode: filters.viewMode,
      groupKeyFilter: filters.groupKey,
    });
  }, [agenda?.days, accounts, filters.viewMode, filters.groupKey]);

  const chartPoints = useMemo(
    () => buildTreasuryAgendaBalanceChartPoints(displayRows),
    [displayRows]
  );

  const groupOptions = useMemo(
    () => listTreasuryAgendaGroupOptions(accounts),
    [accounts]
  );

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_AGENDA_DENIED_MESSAGE}
        testId="treasury-agenda-permission-denied"
      />
    );
  }

  const toggleRow = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="space-y-4" data-testid="treasury-agenda-panel">
      {agenda && (agenda.alerts ?? []).length > 0 ? (
        <div
          className="space-y-2 rounded-xl border border-border px-3 py-3"
          data-testid="treasury-agenda-alerts"
        >
          <h2 className="text-sm font-semibold text-foreground">Alertas</h2>
          <ul className="space-y-2 text-sm">
            {(agenda.alerts ?? []).slice(0, 8).map((alert) => (
              <li key={alert.id} data-testid={`treasury-agenda-alert-${alert.kind}`}>
                <span className="font-medium">{alert.title}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {alert.severity} · {alert.description}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Período">
            <select
              className={field}
              value={filters.period}
              onChange={(e) =>
                patch({
                  period: e.target.value as TreasuryAgendaPeriodPreset,
                })
              }
              data-testid="treasury-agenda-filter-period"
            >
              {TREASURY_AGENDA_PERIOD_PRESETS.map((p) => (
                <option key={p} value={p}>
                  {TREASURY_AGENDA_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </FilterField>
          {filters.period === "custom" ? (
            <>
              <FilterField label="Data inicial">
                <input
                  type="date"
                  className={field}
                  value={filters.baseDate}
                  onChange={(e) => patch({ baseDate: e.target.value })}
                  data-testid="treasury-agenda-filter-base-date"
                />
              </FilterField>
              <FilterField label="Data final">
                <input
                  type="date"
                  className={field}
                  value={filters.endDate}
                  onChange={(e) => patch({ endDate: e.target.value })}
                  data-testid="treasury-agenda-filter-end-date"
                />
              </FilterField>
            </>
          ) : null}
          <FilterField label="Visão">
            <select
              className={field}
              value={filters.viewMode}
              onChange={(e) =>
                patch({
                  viewMode: e.target.value as TreasuryAgendaViewMode,
                  groupKey:
                    e.target.value === "byGroup" ? filters.groupKey : "",
                })
              }
              data-testid="treasury-agenda-filter-view"
            >
              {(
                Object.keys(
                  TREASURY_AGENDA_VIEW_MODE_LABELS
                ) as TreasuryAgendaViewMode[]
              ).map((mode) => (
                <option key={mode} value={mode}>
                  {TREASURY_AGENDA_VIEW_MODE_LABELS[mode]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Cenário">
            <select
              className={field}
              value={filters.scenario}
              onChange={(e) =>
                patch({
                  scenario: e.target.value as TreasuryProjectionLayer,
                })
              }
              data-testid="treasury-agenda-filter-scenario"
            >
              {TREASURY_PROJECTION_LAYERS.map((layer) => (
                <option key={layer} value={layer}>
                  {TREASURY_AGENDA_SCENARIO_LABELS[layer]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Conta">
            <select
              className={field}
              value={filters.accountId}
              onChange={(e) => patch({ accountId: e.target.value })}
              data-testid="treasury-agenda-filter-account"
            >
              <option value="">Todas as contas</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </FilterField>
          {filters.viewMode === "byGroup" ? (
            <FilterField label="Grupo de contas">
              <select
                className={field}
                value={filters.groupKey}
                onChange={(e) => patch({ groupKey: e.target.value })}
                data-testid="treasury-agenda-filter-group"
              >
                <option value="">Todos os grupos</option>
                {groupOptions.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.label}
                  </option>
                ))}
              </select>
            </FilterField>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-accent"
            onClick={onClearFilters}
            data-testid="treasury-agenda-clear-filters"
          >
            Limpar filtros
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
            onClick={onRefresh}
            data-testid="treasury-agenda-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      {staleMessage ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
          data-testid="treasury-agenda-stale-banner"
        >
          <span className="font-semibold">Atenção — dados stale. </span>
          {staleMessage}
        </div>
      ) : null}

      {error && viewKind !== "ready" ? (
        <div data-testid="treasury-agenda-error">
          <FinanceModuleErrorBanner
            message={error}
            onRetry={onRefresh}
            onDismiss={onDismissError}
          />
        </div>
      ) : null}

      {viewKind === "loading" ? (
        <div data-testid="treasury-agenda-loading">
          <FinanceModuleLoadingBlock label="Carregando agenda financeira…" />
        </div>
      ) : null}

      {viewKind === "empty" ? (
        <div data-testid="treasury-agenda-empty">
          <FinanceModuleEmptyState
            title={TREASURY_AGENDA_EMPTY_TITLE}
            description={TREASURY_AGENDA_EMPTY_DESCRIPTION}
          />
        </div>
      ) : null}

      {viewKind === "empty-filtered" ? (
        <div data-testid="treasury-agenda-empty-filtered">
          <FinanceModuleEmptyState
            title={TREASURY_AGENDA_EMPTY_FILTERED_TITLE}
            description={TREASURY_AGENDA_EMPTY_FILTERED_DESCRIPTION}
          />
        </div>
      ) : null}

      {viewKind === "ready" || (viewKind === "error" && agenda) ? (
        <>
          <div
            className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            data-testid="treasury-agenda-meta"
          >
            <span>
              Cenário:{" "}
              <strong className="text-foreground">
                {TREASURY_AGENDA_SCENARIO_LABELS[agenda!.scenario]}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              Período:{" "}
              <strong className="text-foreground">
                {formatTreasuryAgendaCivilDate(agenda!.baseDate)} —{" "}
                {formatTreasuryAgendaCivilDate(agenda!.endDate)}
              </strong>
            </span>
            <span aria-hidden>·</span>
            <span>
              Visão:{" "}
              <strong className="text-foreground">
                {TREASURY_AGENDA_VIEW_MODE_LABELS[filters.viewMode]}
              </strong>
            </span>
            {agenda?.freshness?.asOf ? (
              <>
                <span aria-hidden>·</span>
                <span>
                  Atualizado em{" "}
                  {formatTreasuryAgendaDateTime(agenda.freshness.asOf)}
                </span>
              </>
            ) : null}
            {agenda?.sourceVersion ? (
              <>
                <span aria-hidden>·</span>
                <span title={agenda.sourceVersion}>
                  sourceVersion {agenda.sourceVersion.slice(0, 10)}…
                </span>
              </>
            ) : null}
          </div>

          <TreasuryAgendaBalanceChart points={chartPoints} />

          <div
            className="overflow-x-auto rounded-xl border border-border bg-card"
            data-testid="treasury-agenda-table"
          >
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold w-8" aria-label="Detalhe" />
                  <th className="px-3 py-2 font-semibold">
                    {TREASURY_AGENDA_COLUMN_LABELS.civilDate}
                  </th>
                  {filters.viewMode !== "consolidated" ? (
                    <th className="px-3 py-2 font-semibold">
                      {TREASURY_AGENDA_COLUMN_LABELS.account}
                    </th>
                  ) : null}
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.openingBalance}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.plannedInflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.confirmedInflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.realizedInflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.plannedOutflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.programmedOutflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.realizedOutflows}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.transfers}
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    {TREASURY_AGENDA_COLUMN_LABELS.closingBalance}
                  </th>
                  <th className="px-3 py-2 font-semibold">
                    {TREASURY_AGENDA_COLUMN_LABELS.risk}
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row) => {
                  const open = expandedKeys.has(row.rowKey);
                  return (
                    <React.Fragment key={row.rowKey}>
                      <tr
                        className="border-t border-border hover:bg-accent/30"
                        data-testid={`treasury-agenda-row-${row.rowKey}`}
                      >
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border"
                            aria-expanded={open}
                            aria-label={
                              open
                                ? `Recolher detalhe de ${row.civilDate}`
                                : `Expandir detalhe de ${row.civilDate}`
                            }
                            onClick={() => toggleRow(row.rowKey)}
                            data-testid={`treasury-agenda-expand-${row.rowKey}`}
                          >
                            {open ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatTreasuryAgendaCivilDate(row.civilDate)}
                        </td>
                        {filters.viewMode !== "consolidated" ? (
                          <td className="px-3 py-2">
                            <AccountOrGroupCell row={row} />
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.openingBalance)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.plannedInflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.confirmedInflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.realizedInflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.plannedOutflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.programmedOutflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.realizedOutflows)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {formatTreasuryAgendaMoney(row.transfers)}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">
                          {formatTreasuryAgendaMoney(row.closingBalance)}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            <OverlayBadge tone={riskTone(row.riskCode)}>
                              {row.riskCode}
                            </OverlayBadge>
                            <span
                              className="text-xs text-foreground"
                              data-testid={`treasury-agenda-risk-label-${row.rowKey}`}
                            >
                              {row.riskLabel}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="border-t border-border bg-muted/20">
                          <td
                            colSpan={filters.viewMode === "consolidated" ? 12 : 13}
                            className="px-4 py-3"
                          >
                            <DayDetail row={row} />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}
