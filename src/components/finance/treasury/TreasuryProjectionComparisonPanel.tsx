/**
 * Painel — comparação contratual / provável / confirmado.
 * Toggle de cenários é local (sem refetch / sem recálculo).
 */

import React, { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type {
  TreasuryFinancialAccountDto,
  TreasuryProjectionComparisonDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_AGENDA_PERIOD_LABELS,
  TREASURY_AGENDA_PERIOD_PRESETS,
} from "@/src/lib/treasury/treasuryAgendaUi.js";
import {
  TREASURY_COMPARISON_DENIED_MESSAGE,
  TREASURY_COMPARISON_EMPTY_DESCRIPTION,
  TREASURY_COMPARISON_EMPTY_TITLE,
  TREASURY_COMPARISON_SCENARIO_LABELS,
  TREASURY_COMPARISON_SCENARIOS,
  buildTreasuryComparisonChartPoints,
  formatTreasuryComparisonCivilDate,
  formatTreasuryComparisonDateTime,
  formatTreasuryComparisonMoney,
  toggleVisibleScenario,
  type TreasuryAgendaPeriodPreset,
  type TreasuryComparisonFilterState,
  type TreasuryComparisonScenario,
  type TreasuryComparisonViewKind,
} from "@/src/lib/treasury/treasuryProjectionComparisonUi.js";
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
import { TreasuryProjectionComparisonChart } from "./TreasuryProjectionComparisonChart.js";

export type TreasuryProjectionComparisonPanelProps = {
  viewKind: TreasuryComparisonViewKind;
  comparison: TreasuryProjectionComparisonDto | null;
  accounts: TreasuryFinancialAccountDto[];
  error: string | null;
  staleMessage: string | null;
  filters: TreasuryComparisonFilterState;
  onFiltersChange: (next: TreasuryComparisonFilterState) => void;
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

function riskTone(code: string): "sky" | "amber" | "rose" | "slate" {
  const c = (code || "NONE").toUpperCase();
  if (c === "CRITICAL" || c === "HIGH") return "rose";
  if (c === "MEDIUM") return "amber";
  if (c === "LOW") return "sky";
  return "slate";
}

export function TreasuryProjectionComparisonPanel({
  viewKind,
  comparison,
  accounts,
  error,
  staleMessage,
  filters,
  onFiltersChange,
  onRefresh,
  onClearFilters,
  onDismissError,
}: TreasuryProjectionComparisonPanelProps) {
  const field = financeModuleFilterFieldClass();
  const patch = (partial: Partial<TreasuryComparisonFilterState>) =>
    onFiltersChange({ ...filters, ...partial });

  const chartPoints = useMemo(
    () =>
      buildTreasuryComparisonChartPoints(
        comparison?.days ?? [],
        filters.visibleScenarios
      ),
    [comparison?.days, filters.visibleScenarios]
  );

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        title="Sem permissão"
        message={TREASURY_COMPARISON_DENIED_MESSAGE}
        testId="treasury-comparison-permission-denied"
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="treasury-comparison-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Período">
            <select
              className={field}
              value={filters.period}
              onChange={(e) =>
                patch({ period: e.target.value as TreasuryAgendaPeriodPreset })
              }
              data-testid="treasury-comparison-filter-period"
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
                  data-testid="treasury-comparison-filter-base-date"
                />
              </FilterField>
              <FilterField label="Data final">
                <input
                  type="date"
                  className={field}
                  value={filters.endDate}
                  onChange={(e) => patch({ endDate: e.target.value })}
                  data-testid="treasury-comparison-filter-end-date"
                />
              </FilterField>
            </>
          ) : null}
          <FilterField label="Conta">
            <select
              className={field}
              value={filters.accountId}
              onChange={(e) => patch({ accountId: e.target.value })}
              data-testid="treasury-comparison-filter-account"
            >
              <option value="">Todas (consolidado)</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
          </FilterField>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-semibold hover:bg-accent"
            onClick={onClearFilters}
            data-testid="treasury-comparison-clear-filters"
          >
            Limpar filtros
          </button>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
            onClick={onRefresh}
            data-testid="treasury-comparison-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="treasury-comparison-scenario-toggles"
        role="group"
        aria-label="Cenários visíveis (sem recalcular)"
      >
        <span className="text-xs font-semibold text-muted-foreground">
          Exibir cenários:
        </span>
        {TREASURY_COMPARISON_SCENARIOS.map((scenario) => {
          const on = filters.visibleScenarios.includes(scenario);
          return (
            <button
              key={scenario}
              type="button"
              aria-pressed={on}
              className={
                "inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold " +
                (on
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground")
              }
              onClick={() =>
                patch({
                  visibleScenarios: toggleVisibleScenario(
                    filters.visibleScenarios,
                    scenario
                  ),
                })
              }
              data-testid={`treasury-comparison-toggle-${scenario}`}
            >
              {TREASURY_COMPARISON_SCENARIO_LABELS[scenario]}
              <span className="sr-only">
                {on ? " (visível)" : " (oculto)"} — alternar não recalcula
              </span>
            </button>
          );
        })}
        <span className="text-[11px] text-muted-foreground">
          Alternar não dispara recálculo
        </span>
      </div>

      {staleMessage ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          role="status"
          data-testid="treasury-comparison-stale-banner"
        >
          <span className="font-semibold">Atenção — dados stale. </span>
          {staleMessage}
        </div>
      ) : null}

      {error && viewKind !== "ready" ? (
        <div data-testid="treasury-comparison-error">
          <FinanceModuleErrorBanner
            message={error}
            onRetry={onRefresh}
            onDismiss={onDismissError}
          />
        </div>
      ) : null}

      {viewKind === "loading" ? (
        <div data-testid="treasury-comparison-loading">
          <FinanceModuleLoadingBlock label="Carregando comparação de cenários…" />
        </div>
      ) : null}

      {viewKind === "empty" ? (
        <div data-testid="treasury-comparison-empty">
          <FinanceModuleEmptyState
            title={TREASURY_COMPARISON_EMPTY_TITLE}
            description={TREASURY_COMPARISON_EMPTY_DESCRIPTION}
          />
        </div>
      ) : null}

      {viewKind === "ready" && comparison ? (
        <>
          <div
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="treasury-comparison-summary"
          >
            {comparison.scenarios.map((s) => (
              <div
                key={s.scenario}
                className="rounded-xl border border-border bg-card p-3"
                data-testid={`treasury-comparison-summary-${s.scenario}`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {TREASURY_COMPARISON_SCENARIO_LABELS[s.scenario]}
                  {!s.available ? " — indisponível" : ""}
                </p>
                <p className="mt-2 text-xs text-foreground">
                  1ª data negativa:{" "}
                  <strong>
                    {s.firstNegativeDate
                      ? formatTreasuryComparisonCivilDate(s.firstNegativeDate)
                      : "Nenhuma"}
                  </strong>
                </p>
                <p className="mt-1 text-xs text-foreground">
                  Menor saldo:{" "}
                  <strong>
                    {formatTreasuryComparisonMoney(s.minimumBalance)}
                  </strong>
                  {s.minimumBalanceDate
                    ? ` em ${formatTreasuryComparisonCivilDate(s.minimumBalanceDate)}`
                    : ""}
                </p>
              </div>
            ))}
            <div className="rounded-xl border border-border bg-card p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Resumo geral
              </p>
              <p className="mt-2 text-xs">
                1ª negativa (qualquer cenário):{" "}
                <strong>
                  {comparison.summary.firstNegativeDateOverall
                    ? formatTreasuryComparisonCivilDate(
                        comparison.summary.firstNegativeDateOverall
                      )
                    : "Nenhuma"}
                </strong>
              </p>
              <p className="mt-1 text-xs">
                Menor saldo do período:{" "}
                <strong>
                  {formatTreasuryComparisonMoney(
                    comparison.summary.minimumBalanceOverall
                  )}
                </strong>
                {comparison.summary.minimumBalanceOverallScenario
                  ? ` (${TREASURY_COMPARISON_SCENARIO_LABELS[comparison.summary.minimumBalanceOverallScenario]})`
                  : ""}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                recalculated={String(comparison.recalculated)} · leitura de runs
                persistidos
              </p>
            </div>
          </div>

          <TreasuryProjectionComparisonChart
            points={chartPoints}
            visible={filters.visibleScenarios}
          />

          <div
            className="overflow-x-auto rounded-xl border border-border bg-card"
            data-testid="treasury-comparison-table"
          >
            <table className="min-w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold">Dia</th>
                  {filters.visibleScenarios.map((s) => (
                    <th key={s} className="px-3 py-2 font-semibold text-right">
                      Saldo {TREASURY_COMPARISON_SCENARIO_LABELS[s]}
                    </th>
                  ))}
                  <th className="px-3 py-2 font-semibold text-right">
                    Δ Provável − Contratual
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Δ Confirmado − Provável
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Δ Confirmado − Contratual
                  </th>
                  <th className="px-3 py-2 font-semibold text-right">
                    Recebíveis s/ previsão confiável
                  </th>
                  <th className="px-3 py-2 font-semibold">Maior risco</th>
                </tr>
              </thead>
              <tbody>
                {comparison.days.map((day) => (
                  <tr
                    key={day.civilDate}
                    className="border-t border-border"
                    data-testid={`treasury-comparison-row-${day.civilDate}`}
                  >
                    <td className="px-3 py-2 whitespace-nowrap">
                      {formatTreasuryComparisonCivilDate(day.civilDate)}
                    </td>
                    {filters.visibleScenarios.map((s) => (
                      <td
                        key={s}
                        className="px-3 py-2 text-right tabular-nums"
                      >
                        {formatTreasuryComparisonMoney(day.balances[s])}
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTreasuryComparisonMoney(
                        day.differences.probableMinusContractual
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTreasuryComparisonMoney(
                        day.differences.confirmedMinusProbable
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTreasuryComparisonMoney(
                        day.differences.confirmedMinusContractual
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatTreasuryComparisonMoney(
                        day.uncertainReceivables.primary ??
                          day.uncertainReceivables.max
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <OverlayBadge tone={riskTone(day.highestRisk.riskCode)}>
                          {day.highestRisk.riskCode}
                          {day.highestRisk.scenario
                            ? ` · ${TREASURY_COMPARISON_SCENARIO_LABELS[day.highestRisk.scenario]}`
                            : ""}
                        </OverlayBadge>
                        <span className="text-xs text-foreground">
                          {day.highestRisk.riskLabel}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            Atualizado em{" "}
            {formatTreasuryComparisonDateTime(comparison.freshness.asOf)}
          </p>
        </>
      ) : null}
    </div>
  );
}
