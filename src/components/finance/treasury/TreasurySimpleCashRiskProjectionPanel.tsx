/**
 * Painel — Próximos dias (projeção simples de risco de caixa).
 */

import React from "react";
import { Link } from "react-router-dom";
import type {
  TreasuryAgendaDayDto,
  TreasuryAgendaDto,
} from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_SIMPLE_CASH_RISK_ADVANCED_HINT,
  TREASURY_SIMPLE_CASH_RISK_DENIED,
  TREASURY_SIMPLE_CASH_RISK_EMPTY_DESCRIPTION,
  TREASURY_SIMPLE_CASH_RISK_EMPTY_TITLE,
  TREASURY_SIMPLE_CASH_RISK_PERIODS,
  TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIOS,
  TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS,
  formatTreasurySimpleCashRiskDate,
  formatTreasurySimpleCashRiskMoney,
  formatTreasurySimpleCashRiskPercent,
  originLabel,
  reserveIndicatorLabel,
  type TreasurySimpleCashRiskFilterState,
  type TreasurySimpleCashRiskViewKind,
} from "@/src/lib/treasury/treasurySimpleCashRiskProjectionUi.js";
import type {
  TreasurySimpleCashRiskDayDetailDto,
  TreasurySimpleCashRiskSummaryDto,
} from "@/src/lib/treasury/domain/treasurySimpleCashRiskProjectionRules.js";
import { TREASURY_UI_ADVANCED_HUB_PATH } from "@/src/lib/treasury/treasurySimpleNavigation.js";
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

export type TreasurySimpleCashRiskProjectionPanelProps = {
  viewKind: TreasurySimpleCashRiskViewKind;
  agenda: TreasuryAgendaDto | null;
  days: TreasuryAgendaDayDto[];
  summary: TreasurySimpleCashRiskSummaryDto | null;
  dayDetail: TreasurySimpleCashRiskDayDetailDto | null;
  filters: TreasurySimpleCashRiskFilterState;
  error: string | null;
  staleMessage: string | null;
  pendingAlertCount: number;
  onFiltersChange: (next: TreasurySimpleCashRiskFilterState) => void;
  onSelectDay: (civilDate: string) => void;
  onRefresh: () => void;
  onDismissError?: () => void;
};

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function TreasurySimpleCashRiskProjectionPanel(
  props: TreasurySimpleCashRiskProjectionPanelProps
) {
  const {
    viewKind,
    agenda,
    days,
    summary,
    dayDetail,
    filters,
    error,
    staleMessage,
    pendingAlertCount,
    onFiltersChange,
    onSelectDay,
    onRefresh,
    onDismissError,
  } = props;

  if (viewKind === "denied") {
    return <PermissionDenied message={TREASURY_SIMPLE_CASH_RISK_DENIED} />;
  }

  return (
    <div
      data-testid="treasury-simple-cash-risk-panel"
      className="flex flex-col gap-4"
    >
      {error ? (
        <FinanceModuleErrorBanner
          message={error}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      ) : null}

      {staleMessage ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {staleMessage}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Período</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={filters.period}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                period: e.target.value as TreasurySimpleCashRiskFilterState["period"],
              })
            }
            data-testid="treasury-simple-cash-risk-period"
          >
            {TREASURY_SIMPLE_CASH_RISK_PERIODS.map((p) => (
              <option key={p} value={p}>
                {TREASURY_SIMPLE_CASH_RISK_PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 sm:col-span-2">
          <span className={financeModuleFilterLabelClass()}>Cenário</span>
          <div className="flex flex-wrap gap-2">
            {TREASURY_SIMPLE_CASH_RISK_SCENARIOS.map((s) => {
              const meta = TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[s];
              const selected = filters.scenario === s;
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`treasury-simple-cash-risk-scenario-${s}`}
                  onClick={() =>
                    onFiltersChange({ ...filters, scenario: s })
                  }
                  className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                    selected
                      ? "border-sky-300 bg-sky-50 text-sky-950"
                      : "border-border bg-card text-foreground hover:bg-muted/40"
                  }`}
                >
                  <span className="font-medium">{meta.short}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {meta.description}
                  </span>
                </button>
              );
            })}
          </div>
        </label>
      </div>

      <p className="text-xs text-muted-foreground">
        {TREASURY_SIMPLE_CASH_RISK_ADVANCED_HINT}{" "}
        <Link
          to={TREASURY_UI_ADVANCED_HUB_PATH}
          className="underline underline-offset-2"
        >
          Abrir recursos avançados
        </Link>
      </p>

      {viewKind === "loading" ? <FinanceModuleLoadingBlock /> : null}

      {viewKind === "empty" ? (
        <FinanceModuleEmptyState
          title={TREASURY_SIMPLE_CASH_RISK_EMPTY_TITLE}
          description={TREASURY_SIMPLE_CASH_RISK_EMPTY_DESCRIPTION}
        />
      ) : null}

      {viewKind === "ready" && summary ? (
        <>
          <div
            className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
            data-testid="treasury-simple-cash-risk-summary"
          >
            <Metric
              label="Saldo inicial da projeção"
              value={formatTreasurySimpleCashRiskMoney(summary.openingBalance)}
            />
            <Metric
              label="Entradas previstas"
              value={formatTreasurySimpleCashRiskMoney(summary.plannedInflows)}
            />
            <Metric
              label="Saídas previstas"
              value={formatTreasurySimpleCashRiskMoney(summary.plannedOutflows)}
            />
            <Metric
              label="Menor saldo do período"
              value={formatTreasurySimpleCashRiskMoney(summary.lowestBalance)}
              hint={
                summary.lowestBalanceDate
                  ? formatTreasurySimpleCashRiskDate(summary.lowestBalanceDate)
                  : null
              }
            />
            <Metric
              label="Primeiro dia com saldo negativo"
              value={formatTreasurySimpleCashRiskDate(summary.firstNegativeDate)}
            />
            <Metric
              label="Maior déficit"
              value={formatTreasurySimpleCashRiskMoney(summary.largestDeficit)}
              hint={
                summary.largestDeficitDate
                  ? formatTreasurySimpleCashRiskDate(summary.largestDeficitDate)
                  : null
              }
            />
            <Metric
              label="Primeiro dia abaixo da reserva"
              value={formatTreasurySimpleCashRiskDate(
                summary.firstDayBelowReserve
              )}
            />
            <Metric
              label="Maior excedente sobre a reserva"
              value={formatTreasurySimpleCashRiskMoney(
                summary.largestSurplusVsReserve
              )}
              hint={
                summary.largestSurplusVsReserveDate
                  ? formatTreasurySimpleCashRiskDate(
                      summary.largestSurplusVsReserveDate
                    )
                  : null
              }
            />
          </div>

          {summary.reserve ? (
            <div
              className="rounded-lg border border-border bg-card p-3"
              data-testid="treasury-simple-cash-risk-reserve"
            >
              <p className="text-sm font-medium text-foreground">
                Reserva mínima consolidada
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {reserveIndicatorLabel(summary)}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Metric
                  label="Saldo projetado (fim do período)"
                  value={formatTreasurySimpleCashRiskMoney(
                    summary.reserve.projectedBalance
                  )}
                />
                <Metric
                  label="Reserva mínima"
                  value={formatTreasurySimpleCashRiskMoney(
                    summary.reserve.minimumReserve
                  )}
                />
                <Metric
                  label={
                    summary.reserve.kind === "SHORTAGE"
                      ? "Insuficiência"
                      : "Excedente"
                  }
                  value={formatTreasurySimpleCashRiskMoney(
                    summary.reserve.surplusOrShortage
                  )}
                />
                <Metric
                  label="Superávit sobre a reserva"
                  value={
                    summary.reserve.surplusPercent == null
                      ? "Não aplicável"
                      : formatTreasurySimpleCashRiskPercent(
                          summary.reserve.surplusPercent
                        )
                  }
                  hint="Somente quando a reserva for maior que zero e houver excedente"
                />
              </div>
            </div>
          ) : null}

          {pendingAlertCount > 0 ? (
            <p
              className="text-sm text-amber-800"
              data-testid="treasury-simple-cash-risk-pendencies"
            >
              Pendências / alertas no horizonte: {pendingAlertCount}
              {agenda?.baseDate
                ? ` · base ${formatTreasurySimpleCashRiskDate(agenda.baseDate)}`
                : ""}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-sm" data-testid="treasury-simple-cash-risk-days">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Dia</th>
                  <th className="px-3 py-2 font-medium">Entradas</th>
                  <th className="px-3 py-2 font-medium">Saídas</th>
                  <th className="px-3 py-2 font-medium">Saldo projetado</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => {
                  const selected = d.civilDate === filters.selectedCivilDate;
                  return (
                    <tr
                      key={d.civilDate}
                      className={`cursor-pointer border-t border-border ${
                        selected ? "bg-sky-50/80" : "hover:bg-muted/30"
                      }`}
                      onClick={() => onSelectDay(d.civilDate)}
                      data-testid={`treasury-simple-cash-risk-day-${d.civilDate}`}
                    >
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasurySimpleCashRiskDate(d.civilDate)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasurySimpleCashRiskMoney(
                          d.plannedInflows ?? d.inflows
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {formatTreasurySimpleCashRiskMoney(
                          d.plannedOutflows ?? d.outflows
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {formatTreasurySimpleCashRiskMoney(d.closingBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {summary.topImpacts.length > 0 ? (
            <div data-testid="treasury-simple-cash-risk-impacts">
              <h3 className="text-sm font-medium text-foreground">
                Contas ou títulos que mais impactam
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {summary.topImpacts.map((item) => (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <span>
                      {item.label}
                      {item.civilDate ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {formatTreasurySimpleCashRiskDate(item.civilDate)}
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums font-medium">
                      {formatTreasurySimpleCashRiskMoney(item.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {dayDetail ? (
            <div
              className="rounded-lg border border-border bg-card p-3"
              data-testid="treasury-simple-cash-risk-day-detail"
            >
              <h3 className="text-sm font-medium text-foreground">
                Detalhe do dia ·{" "}
                {formatTreasurySimpleCashRiskDate(dayDetail.civilDate)}
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {dayDetail.scenarioDescription} (
                {TREASURY_SIMPLE_CASH_RISK_SCENARIO_LABELS[dayDetail.scenario]
                  .short}
                )
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <Metric
                  label="Saldo anterior"
                  value={formatTreasurySimpleCashRiskMoney(
                    dayDetail.previousBalance
                  )}
                />
                <Metric
                  label="Recebimentos"
                  value={formatTreasurySimpleCashRiskMoney(dayDetail.receipts)}
                />
                <Metric
                  label="Pagamentos"
                  value={formatTreasurySimpleCashRiskMoney(dayDetail.payments)}
                />
                <Metric
                  label="Transferências"
                  value={formatTreasurySimpleCashRiskMoney(dayDetail.transfers)}
                />
                <Metric
                  label="Saldo final"
                  value={formatTreasurySimpleCashRiskMoney(
                    dayDetail.closingBalance
                  )}
                />
              </div>
              {dayDetail.mainTitles.length > 0 ? (
                <ul className="mt-3 divide-y divide-border rounded-md border border-border">
                  {dayDetail.mainTitles.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
                    >
                      <span>
                        {t.label}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {originLabel(t.origin)}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {formatTreasurySimpleCashRiskMoney(t.amount)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Sem títulos detalhados neste dia.
                </p>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
