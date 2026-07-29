/**
 * Painel — Tesouraria de hoje (experiência guiada, layout BI executivo).
 * Consome apenas TreasuryGuidedTodayDto — KPIs consolidados + rotina + atenção + contas.
 */

import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Circle,
  Landmark,
} from "lucide-react";
import type {
  TreasuryGuidedTodayAccountDto,
  TreasuryGuidedTodayAttentionDto,
  TreasuryGuidedTodayDto,
  TreasuryGuidedTodayStepDto,
} from "@/src/lib/treasury/contracts/index.js";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  financeBiButtonOutlineClass,
  financeBiButtonPrimaryClass,
  financeBiCardClass,
  financeBiEyebrowClass,
  financeBiKpiLabelClass,
  financeBiKpiValueClass,
  financeBiSectionClass,
} from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  TREASURY_TODAY_ACCOUNT_STATUS_LABELS,
  TREASURY_TODAY_ACCOUNTS_TITLE,
  TREASURY_TODAY_ATTENTION_CODE_LABELS,
  TREASURY_TODAY_ATTENTION_TITLE,
  TREASURY_TODAY_CLOSING_SECTION_TITLE,
  TREASURY_TODAY_DENIED_MESSAGE,
  TREASURY_TODAY_EMPTY_CTA_HREF,
  TREASURY_TODAY_EMPTY_CTA_LABEL,
  TREASURY_TODAY_EMPTY_DESCRIPTION,
  TREASURY_TODAY_EMPTY_TITLE,
  TREASURY_TODAY_FLOW_SECTION_TITLE,
  TREASURY_TODAY_METRIC_LABELS,
  TREASURY_TODAY_NEXT_ACTION_TITLE,
  TREASURY_TODAY_ROUTINE_TITLE,
  TREASURY_TODAY_STEP_STATUS_LABELS,
  formatTreasuryTodayAsOf,
  formatTreasuryTodayCivilDate,
  formatTreasuryTodayMoney,
  resolveTreasuryTodayAccountOpenLabel,
  resolveTreasuryTodayAttentionTone,
  resolveTreasuryTodayDivergenceTone,
  resolveTreasuryTodayPrimaryStep,
  resolveTreasuryTodayStepStatusTone,
  type TreasuryTodayMetricTone,
  type TreasuryTodayViewKind,
} from "@/src/lib/treasury/treasuryTodayUi.js";

export type TreasuryTodayPanelProps = {
  viewKind: TreasuryTodayViewKind;
  data: TreasuryGuidedTodayDto | null;
  error: string | null;
  onRefresh: () => void;
  onDismissError?: () => void;
};

/** Grid executivo — espelha SYSTEM_TOTALIZER_GRID sem puxar CSS do MetricCard nos testes. */
const TODAY_KPI_GRID_CLASS =
  "grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5";
const TODAY_KPI_GRID_SECONDARY_CLASS =
  "grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4";

function toneValueClass(tone: TreasuryTodayMetricTone): string {
  if (tone === "success") return "text-[#059669]";
  if (tone === "warning") return "text-[#D97706]";
  if (tone === "danger") return "text-[#DC2626]";
  if (tone === "info") return "text-[#2563EB]";
  return "text-[#111827]";
}

function TodayMetricCard({
  label,
  value,
  testId,
  tone = "neutral",
}: {
  label: string;
  value: string;
  testId: string;
  tone?: TreasuryTodayMetricTone | "info";
}) {
  return (
    <div
      className={cn(financeBiCardClass, "p-4")}
      data-testid={testId}
    >
      <p className={financeBiKpiLabelClass}>{label}</p>
      <p
        className={cn(
          financeBiKpiValueClass,
          "mt-2 text-2xl sm:text-3xl",
          toneValueClass(tone)
        )}
        data-testid={`${testId}-value`}
      >
        {value}
      </p>
    </div>
  );
}

function toneBorder(tone: TreasuryTodayMetricTone): string {
  if (tone === "success") return "border-emerald-200 bg-emerald-50/50";
  if (tone === "warning") return "border-amber-200 bg-amber-50/60";
  if (tone === "danger") return "border-red-200 bg-red-50/50";
  return "border-[#E5E7EB] bg-white";
}

function StepStatusIcon({
  status,
}: {
  status: TreasuryGuidedTodayStepDto["status"];
}) {
  if (status === "DONE") {
    return <CheckCircle2 className="h-4 w-4 text-[#059669]" aria-hidden />;
  }
  if (status === "NEEDS_ATTENTION") {
    return <AlertTriangle className="h-4 w-4 text-[#D97706]" aria-hidden />;
  }
  return <Circle className="h-4 w-4 text-[#6B7280]" aria-hidden />;
}

function PrimaryNextAction({ step }: { step: TreasuryGuidedTodayStepDto }) {
  return (
    <section
      className={cn(
        financeBiCardClass,
        "flex flex-col gap-3 border-[#BFDBFE] bg-[#EFF6FF] p-5 sm:flex-row sm:items-center sm:justify-between",
        "animate-in fade-in duration-200"
      )}
      data-testid="treasury-today-next-action"
      aria-label={TREASURY_TODAY_NEXT_ACTION_TITLE}
    >
      <div className="space-y-1">
        <p className={financeBiEyebrowClass}>{TREASURY_TODAY_NEXT_ACTION_TITLE}</p>
        <p className="text-base font-extrabold tracking-tight text-[#111827]">
          {step.order}. {step.title}
        </p>
        <p className="text-xs font-medium text-[#6B7280]">
          Status: {TREASURY_TODAY_STEP_STATUS_LABELS[step.status]}
        </p>
      </div>
      <Link
        to={step.continueHref}
        className={cn(financeBiButtonPrimaryClass, "shrink-0")}
        data-testid="treasury-today-next-action-cta"
      >
        {step.continueLabel}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}

function RoutineStepRow({ step }: { step: TreasuryGuidedTodayStepDto }) {
  const tone = resolveTreasuryTodayStepStatusTone(step.status);
  const isPrimary = step.status !== "DONE";
  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        toneBorder(tone)
      )}
      data-testid={`treasury-today-step-${step.id}`}
    >
      <div className="flex items-start gap-3">
        <StepStatusIcon status={step.status} />
        <div className="space-y-0.5">
          <p className="text-sm font-semibold text-[#111827]">
            {step.order}. {step.title}
          </p>
          <p
            className="text-[11px] font-medium text-[#6B7280]"
            data-testid={`treasury-today-step-${step.id}-status`}
          >
            {TREASURY_TODAY_STEP_STATUS_LABELS[step.status]}
          </p>
        </div>
      </div>
      <Link
        to={step.continueHref}
        className={cn(
          isPrimary ? financeBiButtonPrimaryClass : financeBiButtonOutlineClass,
          "shrink-0"
        )}
        data-testid={`treasury-today-step-${step.id}-continue`}
      >
        {step.continueLabel}
      </Link>
    </li>
  );
}

function AttentionItem({ item }: { item: TreasuryGuidedTodayAttentionDto }) {
  const tone = resolveTreasuryTodayAttentionTone(item.code);
  return (
    <li
      className={cn("rounded-xl border p-4", toneBorder(tone))}
      data-testid={`treasury-today-attention-${item.code}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className={financeBiEyebrowClass}>
            {TREASURY_TODAY_ATTENTION_CODE_LABELS[item.code]}
          </p>
          <p className="text-sm font-medium text-[#111827]">{item.message}</p>
          {item.amount != null ? (
            <p className="text-xs tabular-nums text-[#6B7280]">
              {formatTreasuryTodayMoney(item.amount)}
            </p>
          ) : null}
        </div>
        <Link
          to={item.href}
          className={cn(financeBiButtonAccentOrOutline(tone), "shrink-0")}
        >
          Resolver
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
    </li>
  );
}

function financeBiButtonAccentOrOutline(tone: TreasuryTodayMetricTone): string {
  if (tone === "warning" || tone === "danger") {
    return financeBiButtonPrimaryClass;
  }
  return financeBiButtonOutlineClass;
}

function AccountRow({ acc }: { acc: TreasuryGuidedTodayAccountDto }) {
  const divergenceTone = resolveTreasuryTodayDivergenceTone(acc.divergence);
  return (
    <article
      className={cn(financeBiCardClass, "p-4")}
      data-testid={`treasury-today-account-${acc.accountId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-[#6B7280]" aria-hidden />
            <h4 className="text-sm font-extrabold tracking-tight text-[#111827]">
              {acc.name}
            </h4>
          </div>
          <p className="text-xs text-[#6B7280]">
            {acc.bank?.trim() ? acc.bank : "Instituição não informada"}
          </p>
          <p
            className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]"
            data-testid={`treasury-today-account-${acc.accountId}-status`}
          >
            {TREASURY_TODAY_ACCOUNT_STATUS_LABELS[acc.status]}
          </p>
        </div>
        <Link
          to={acc.openHref}
          className={financeBiButtonOutlineClass}
          data-testid={`treasury-today-account-${acc.accountId}-open`}
        >
          {resolveTreasuryTodayAccountOpenLabel(acc.status)}
        </Link>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="text-[#6B7280]">Inicial</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[#111827]">
            {formatTreasuryTodayMoney(acc.openingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-[#6B7280]">Previsto</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[#111827]">
            {formatTreasuryTodayMoney(acc.predictedClosingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-[#6B7280]">Realizado</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[#111827]">
            {formatTreasuryTodayMoney(acc.realizedClosingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-[#6B7280]">Banco</dt>
          <dd className="mt-0.5 font-semibold tabular-nums text-[#111827]">
            {formatTreasuryTodayMoney(acc.informedClosingBalance)}
          </dd>
        </div>
        <div>
          <dt className="text-[#6B7280]">Divergência</dt>
          <dd
            className={cn(
              "mt-0.5 font-semibold tabular-nums",
              divergenceTone === "warning"
                ? "text-[#D97706]"
                : divergenceTone === "success"
                  ? "text-[#059669]"
                  : "text-[#111827]"
            )}
          >
            {formatTreasuryTodayMoney(acc.divergence)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function ReadyBody({ data }: { data: TreasuryGuidedTodayDto }) {
  const c = data.consolidated;
  const primaryStep = useMemo(
    () => resolveTreasuryTodayPrimaryStep(data.steps),
    [data.steps]
  );
  const asOfLabel = formatTreasuryTodayAsOf(data.asOf);
  const divergenceTone = resolveTreasuryTodayDivergenceTone(c.divergence);

  return (
    <div
      className="space-y-5 animate-in fade-in duration-200"
      data-testid="treasury-today-ready"
    >
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6B7280]"
        data-testid="treasury-today-meta"
      >
        <span data-testid="treasury-today-date">
          Dia {formatTreasuryTodayCivilDate(data.civilDate)}
        </span>
        {asOfLabel ? (
          <span data-testid="treasury-today-asof">Dados às {asOfLabel}</span>
        ) : null}
        <span className="font-semibold text-[#111827]" data-testid="treasury-today-title">
          Consolidado
        </span>
      </div>

      {primaryStep ? <PrimaryNextAction step={primaryStep} /> : null}

      <section aria-label={TREASURY_TODAY_FLOW_SECTION_TITLE} className="space-y-2.5">
        <p className={financeBiEyebrowClass}>{TREASURY_TODAY_FLOW_SECTION_TITLE}</p>
        <div className={TODAY_KPI_GRID_CLASS} data-testid="treasury-today-flow-kpis">
          <TodayMetricCard
            testId="treasury-today-metric-opening"
            label={TREASURY_TODAY_METRIC_LABELS.openingBalance}
            value={formatTreasuryTodayMoney(c.openingBalance)}
            tone="neutral"
          />
          <TodayMetricCard
            testId="treasury-today-metric-planned-in"
            label={TREASURY_TODAY_METRIC_LABELS.plannedInflows}
            value={formatTreasuryTodayMoney(c.plannedInflows)}
            tone="info"
          />
          <TodayMetricCard
            testId="treasury-today-metric-realized-in"
            label={TREASURY_TODAY_METRIC_LABELS.realizedInflows}
            value={formatTreasuryTodayMoney(c.realizedInflows)}
            tone="success"
          />
          <TodayMetricCard
            testId="treasury-today-metric-planned-out"
            label={TREASURY_TODAY_METRIC_LABELS.plannedOutflows}
            value={formatTreasuryTodayMoney(c.plannedOutflows)}
            tone="info"
          />
          <TodayMetricCard
            testId="treasury-today-metric-realized-out"
            label={TREASURY_TODAY_METRIC_LABELS.realizedOutflows}
            value={formatTreasuryTodayMoney(c.realizedOutflows)}
            tone="warning"
          />
        </div>
      </section>

      <section
        aria-label={TREASURY_TODAY_CLOSING_SECTION_TITLE}
        className="space-y-2.5"
      >
        <p className={financeBiEyebrowClass}>
          {TREASURY_TODAY_CLOSING_SECTION_TITLE}
        </p>
        <div
          className={TODAY_KPI_GRID_SECONDARY_CLASS}
          data-testid="treasury-today-closing-kpis"
        >
          <TodayMetricCard
            testId="treasury-today-metric-predicted-close"
            label={TREASURY_TODAY_METRIC_LABELS.predictedClosingBalance}
            value={formatTreasuryTodayMoney(c.predictedClosingBalance)}
            tone="neutral"
          />
          <TodayMetricCard
            testId="treasury-today-metric-realized-close"
            label={TREASURY_TODAY_METRIC_LABELS.realizedClosingBalance}
            value={formatTreasuryTodayMoney(c.realizedClosingBalance)}
            tone="neutral"
          />
          <TodayMetricCard
            testId="treasury-today-metric-informed-close"
            label={TREASURY_TODAY_METRIC_LABELS.informedClosingBalance}
            value={formatTreasuryTodayMoney(c.informedClosingBalance)}
            tone="info"
          />
          <TodayMetricCard
            testId="treasury-today-metric-divergence"
            label={TREASURY_TODAY_METRIC_LABELS.divergence}
            value={formatTreasuryTodayMoney(c.divergence)}
            tone={divergenceTone}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <section
          aria-labelledby="treasury-today-routine-heading"
          className={cn(financeBiSectionClass, "space-y-3 p-4 sm:p-5")}
        >
          <h3
            id="treasury-today-routine-heading"
            className="text-sm font-extrabold tracking-tight text-[#111827]"
          >
            {TREASURY_TODAY_ROUTINE_TITLE}
          </h3>
          <ol className="space-y-2" data-testid="treasury-today-steps">
            {data.steps.map((step) => (
              <RoutineStepRow key={step.id} step={step} />
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="treasury-today-attention-heading"
          className={cn(financeBiSectionClass, "space-y-3 p-4 sm:p-5")}
        >
          <h3
            id="treasury-today-attention-heading"
            className="text-sm font-extrabold tracking-tight text-[#111827]"
          >
            {TREASURY_TODAY_ATTENTION_TITLE}
          </h3>
          {data.attention.length > 0 ? (
            <ul className="space-y-2" data-testid="treasury-today-attention">
              {data.attention.map((item) => (
                <AttentionItem key={item.id} item={item} />
              ))}
            </ul>
          ) : (
            <div
              className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-6 text-sm text-[#059669]"
              data-testid="treasury-today-attention-empty"
            >
              Nada pendente neste momento. Siga a rotina ou feche o dia quando
              estiver pronto.
            </div>
          )}
        </section>
      </div>

      <section
        aria-labelledby="treasury-today-accounts-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3
            id="treasury-today-accounts-heading"
            className="text-sm font-extrabold tracking-tight text-[#111827]"
          >
            {TREASURY_TODAY_ACCOUNTS_TITLE}
          </h3>
          <Link
            to="/finance/treasury/accounts"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] hover:underline"
          >
            <Building2 className="h-3.5 w-3.5" aria-hidden />
            Gerenciar contas
          </Link>
        </div>
        <div className="space-y-3" data-testid="treasury-today-accounts">
          {data.accounts.map((acc) => (
            <AccountRow key={acc.accountId} acc={acc} />
          ))}
        </div>
      </section>
    </div>
  );
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
      <div data-testid="treasury-today-empty" className="space-y-4">
        <FinanceModuleEmptyState
          title={TREASURY_TODAY_EMPTY_TITLE}
          description={TREASURY_TODAY_EMPTY_DESCRIPTION}
        />
        <div className="flex justify-center">
          <Link
            to={TREASURY_TODAY_EMPTY_CTA_HREF}
            className={financeBiButtonPrimaryClass}
            data-testid="treasury-today-empty-cta"
          >
            {TREASURY_TODAY_EMPTY_CTA_LABEL}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  return <ReadyBody data={data} />;
}
