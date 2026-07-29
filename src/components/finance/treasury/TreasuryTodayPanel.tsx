/**
 * Painel — Tesouraria de hoje (experiência guiada).
 */

import React from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import type { TreasuryGuidedTodayDto } from "@/src/lib/treasury/contracts/index.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  TREASURY_TODAY_ACCOUNT_STATUS_LABELS,
  TREASURY_TODAY_ACCOUNTS_TITLE,
  TREASURY_TODAY_ATTENTION_TITLE,
  TREASURY_TODAY_DENIED_MESSAGE,
  TREASURY_TODAY_EMPTY_DESCRIPTION,
  TREASURY_TODAY_EMPTY_TITLE,
  TREASURY_TODAY_METRIC_LABELS,
  TREASURY_TODAY_PAGE_TITLE,
  TREASURY_TODAY_ROUTINE_TITLE,
  TREASURY_TODAY_STEP_STATUS_LABELS,
  formatTreasuryTodayCivilDate,
  formatTreasuryTodayMoney,
  type TreasuryTodayViewKind,
} from "@/src/lib/treasury/treasuryTodayUi.js";

export type TreasuryTodayPanelProps = {
  viewKind: TreasuryTodayViewKind;
  data: TreasuryGuidedTodayDto | null;
  error: string | null;
  onRefresh: () => void;
  onDismissError?: () => void;
};

function MetricCard({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId: string;
}) {
  return (
    <div
      className="rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid={testId}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className="mt-2 text-lg font-semibold tabular-nums text-foreground sm:text-xl"
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
    </div>
  );
}

function stepTone(status: string): string {
  if (status === "DONE") return "border-emerald-200 bg-emerald-50/60";
  if (status === "NEEDS_ATTENTION") return "border-amber-200 bg-amber-50/70";
  return "border-border bg-card";
}

export function TreasuryTodayPanel(props: TreasuryTodayPanelProps) {
  const { viewKind, data, error, onRefresh, onDismissError } = props;

  if (viewKind === "denied") {
    return (
      <PermissionDenied
        message={TREASURY_TODAY_DENIED_MESSAGE}
        testId="treasury-today-denied"
      />
    );
  }

  if (viewKind === "loading") {
    return (
      <div data-testid="treasury-today-loading">
        <FinanceModuleLoadingBlock label="Carregando a Tesouraria de hoje…" />
      </div>
    );
  }

  if (viewKind === "error") {
    return (
      <div data-testid="treasury-today-error">
        <FinanceModuleErrorBanner
          message={error ?? "Não foi possível carregar a Tesouraria de hoje."}
          onRetry={onRefresh}
          onDismiss={onDismissError}
        />
      </div>
    );
  }

  if (viewKind === "empty" || !data) {
    return (
      <div data-testid="treasury-today-empty">
        <FinanceModuleEmptyState
          title={TREASURY_TODAY_EMPTY_TITLE}
          description={TREASURY_TODAY_EMPTY_DESCRIPTION}
        />
      </div>
    );
  }

  const [selectedAccountId, setSelectedAccountId] = React.useState<string>("all");

  const selectedAccount = React.useMemo(() => {
    if (selectedAccountId === "all" || !data?.accounts) return null;
    return data.accounts.find((a) => a.accountId === selectedAccountId) ?? null;
  }, [selectedAccountId, data]);

  const c = React.useMemo(() => {
    if (selectedAccount) {
      return {
        openingBalance: selectedAccount.openingBalance,
        plannedInflows: "0.00",
        realizedInflows: "0.00",
        plannedOutflows: "0.00",
        realizedOutflows: "0.00",
        predictedClosingBalance: selectedAccount.predictedClosingBalance,
        realizedClosingBalance: selectedAccount.realizedClosingBalance,
        informedClosingBalance: selectedAccount.informedClosingBalance,
        divergence: selectedAccount.divergence,
      };
    }
    return data.consolidated;
  }, [selectedAccount, data]);

  return (
    <div className="space-y-6" data-testid="treasury-today-ready">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2
            className="text-lg font-semibold text-foreground sm:text-xl"
            data-testid="treasury-today-title"
          >
            {data.title || TREASURY_TODAY_PAGE_TITLE}
          </h2>
          <p
            className="text-sm text-muted-foreground"
            data-testid="treasury-today-date"
          >
            {formatTreasuryTodayCivilDate(data.civilDate)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-sm"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            data-testid="treasury-today-account-selector"
          >
            <option value="all">Todas as Contas (Consolidado)</option>
            {data.accounts.map((acc) => (
              <option key={acc.accountId} value={acc.accountId}>
                {acc.name} {acc.bank ? `(${acc.bank})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent"
            data-testid="treasury-today-refresh"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Atualizar
          </button>
        </div>
      </div>

      <section aria-label="Resumo consolidado do dia" className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.openingBalance}
            value={formatTreasuryTodayMoney(c.openingBalance)}
            testId="treasury-today-metric-opening"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.plannedInflows}
            value={formatTreasuryTodayMoney(c.plannedInflows)}
            testId="treasury-today-metric-planned-in"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.realizedInflows}
            value={formatTreasuryTodayMoney(c.realizedInflows)}
            testId="treasury-today-metric-realized-in"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.plannedOutflows}
            value={formatTreasuryTodayMoney(c.plannedOutflows)}
            testId="treasury-today-metric-planned-out"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.realizedOutflows}
            value={formatTreasuryTodayMoney(c.realizedOutflows)}
            testId="treasury-today-metric-realized-out"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.predictedClosingBalance}
            value={formatTreasuryTodayMoney(c.predictedClosingBalance)}
            testId="treasury-today-metric-predicted-close"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.realizedClosingBalance}
            value={formatTreasuryTodayMoney(c.realizedClosingBalance)}
            testId="treasury-today-metric-realized-close"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.informedClosingBalance}
            value={formatTreasuryTodayMoney(c.informedClosingBalance)}
            testId="treasury-today-metric-informed-close"
          />
          <MetricCard
            label={TREASURY_TODAY_METRIC_LABELS.divergence}
            value={formatTreasuryTodayMoney(c.divergence)}
            testId="treasury-today-metric-divergence"
          />
        </div>
      </section>

      <section aria-labelledby="treasury-today-routine-heading" className="space-y-3">
        <h3
          id="treasury-today-routine-heading"
          className="text-base font-semibold text-foreground"
        >
          {TREASURY_TODAY_ROUTINE_TITLE}
        </h3>
        <ol className="space-y-2" data-testid="treasury-today-steps">
          {data.steps.map((step) => {
            const statusLabel = TREASURY_TODAY_STEP_STATUS_LABELS[step.status];
            return (
              <li
                key={step.id}
                className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between ${stepTone(step.status)}`}
                data-testid={`treasury-today-step-${step.id}`}
              >
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {step.order}. {step.title}
                  </p>
                  <p
                    className="text-xs font-medium text-foreground"
                    data-testid={`treasury-today-step-${step.id}-status`}
                  >
                    Status: {statusLabel}
                  </p>
                </div>
                <Link
                  to={step.continueHref}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
                  data-testid={`treasury-today-step-${step.id}-continue`}
                >
                  {step.continueLabel}
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      {data.attention.length > 0 ? (
        <section
          aria-labelledby="treasury-today-attention-heading"
          className="space-y-3"
        >
          <h3
            id="treasury-today-attention-heading"
            className="text-base font-semibold text-foreground"
          >
            {TREASURY_TODAY_ATTENTION_TITLE}
          </h3>
          <ul className="space-y-2" data-testid="treasury-today-attention">
            {data.attention.map((item) => (
              <li
                key={item.id}
                className="rounded-xl border border-amber-200 bg-amber-50/70 p-4"
                data-testid={`treasury-today-attention-${item.code}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {item.message}
                    </p>
                    {item.amount != null ? (
                      <p className="text-xs tabular-nums text-muted-foreground">
                        Valor: {formatTreasuryTodayMoney(item.amount)}
                      </p>
                    ) : null}
                  </div>
                  <Link
                    to={item.href}
                    className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
                  >
                    Resolver
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="treasury-today-accounts-heading" className="space-y-3">
        <h3
          id="treasury-today-accounts-heading"
          className="text-base font-semibold text-foreground"
        >
          {TREASURY_TODAY_ACCOUNTS_TITLE}
        </h3>
        <div
          className="grid grid-cols-1 gap-3 md:grid-cols-2"
          data-testid="treasury-today-accounts"
        >
          {data.accounts.map((acc) => (
            <article
              key={acc.accountId}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid={`treasury-today-account-${acc.accountId}`}
            >
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-foreground">
                  {acc.name}
                </h4>
                <p className="text-xs text-muted-foreground">
                  Banco: {acc.bank ?? "—"}
                </p>
                <p
                  className="text-xs font-medium text-foreground"
                  data-testid={`treasury-today-account-${acc.accountId}-status`}
                >
                  Status: {TREASURY_TODAY_ACCOUNT_STATUS_LABELS[acc.status]}
                </p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Saldo inicial</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasuryTodayMoney(acc.openingBalance)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Previsto</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasuryTodayMoney(acc.predictedClosingBalance)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Realizado</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasuryTodayMoney(acc.realizedClosingBalance)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Final informado</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasuryTodayMoney(acc.informedClosingBalance)}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-muted-foreground">Divergência</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatTreasuryTodayMoney(acc.divergence)}
                  </dd>
                </div>
              </dl>
              <Link
                to={acc.openHref}
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent"
                data-testid={`treasury-today-account-${acc.accountId}-open`}
              >
                Abrir conta
              </Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
