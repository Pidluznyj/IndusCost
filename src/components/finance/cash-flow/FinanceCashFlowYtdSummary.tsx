import React from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type {
  FinanceCashFlowExecutiveYtd,
  FinanceCashFlowExecutiveYtdReceived,
} from "@/src/lib/financeCashFlowExecutiveYtd";
import {
  formatCashFlowKpiDisplay,
  resolveCashFlowMetricTone,
} from "@/src/lib/financeCashFlowDisplay";
import { FINANCE_CASH_FLOW_SANITIZED_SCOPE } from "@/src/lib/financeFilterScope";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceCashFlowYtdTrendChart } from "@/src/components/finance/cash-flow/FinanceCashFlowYtdTrendChart";
import { FinanceCashFlowYtdTotalsPanel } from "@/src/components/finance/cash-flow/FinanceCashFlowYtdTotalsPanel";
import { FinanceCashFlowExecutiveMetricCard } from "@/src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard";
import { cn } from "@/src/lib/utils";
import "./finance-cash-flow-executive-summary.css";

export function FinanceCashFlowYtdSummary({
  executiveYtd,
  executiveYtdReading,
  filtersActive,
  appliedFiltersLabel,
}: {
  executiveYtd: FinanceCashFlowExecutiveYtd;
  executiveYtdReading: string[];
  filtersActive: boolean;
  appliedFiltersLabel?: string;
}) {
  const isDeficit = executiveYtd.netCashPosition < 0;
  const receivedSub = formatReceivedComparisonSub(executiveYtd.received);

  const trendIcon =
    executiveYtd.trend.direction === "improving"
      ? TrendingUp
      : executiveYtd.trend.direction === "worsening"
        ? TrendingDown
        : TrendingUp;
  const trendTone =
    executiveYtd.trend.direction === "improving"
      ? "positive"
      : executiveYtd.trend.direction === "worsening"
        ? "negative"
        : "neutral";

  return (
    <section
      className={cn(financeBiSectionClass, "finance-cash-flow-executive-summary")}
      data-testid="cash-flow-ytd-summary"
    >
      <div className="px-4 py-3 border-b border-[#E5E7EB] space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[#111827]">Resumo executivo YTD</h2>
          <span
            data-testid="cash-flow-ytd-scope-chip"
            className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8]"
          >
            Topo: YTD
          </span>
          {filtersActive ? (
            <span
              data-testid="cash-flow-filtered-scope-chip"
              className="rounded-full bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 text-[10px] font-medium text-[#374151]"
            >
              Análises abaixo: filtros aplicados
            </span>
          ) : null}
          <span
            data-testid="cash-flow-sanitized-scope-chip"
            className="rounded-full bg-[#F0FDF4] border border-[#BBF7D0] px-2 py-0.5 text-[10px] font-medium text-[#166534]"
            title={FINANCE_CASH_FLOW_SANITIZED_SCOPE}
          >
            {FINANCE_CASH_FLOW_SANITIZED_SCOPE}
          </span>
        </div>
        <p className="text-[11px] text-[#6B7280]">
          {executiveYtd.isCurrentYear
            ? "Visão acumulada do ano até hoje, independente dos recortes operacionais abaixo."
            : "Visão acumulada do ano selecionado."}
        </p>
        <p
          data-testid="cash-flow-ytd-scope-label"
          className="text-[11px] font-medium text-[#111827]"
        >
          {executiveYtd.scopeLabel}
        </p>
        {filtersActive && appliedFiltersLabel ? (
          <p className="text-[10px] text-[#6B7280]">
            Filtros operacionais nas seções abaixo: {appliedFiltersLabel}
          </p>
        ) : null}
        <p className="text-[10px] text-[#6B7280] italic">
          Resumo YTD considera o ano até a data de corte. Gráficos, listas e detalhes abaixo
          respeitam os filtros aplicados.
        </p>
      </div>

      <div className="p-4 space-y-3">
        <SummaryKpiGrid minColumnWidth={168} className="finance-cash-flow-metric-grid">
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-net-position"
            label="Posição líquida YTD"
            amount={executiveYtd.netCashPosition}
            subtitle={isDeficit ? "Déficit projetado" : "Superávit projetado"}
            icon={isDeficit ? ArrowDownRight : ArrowUpRight}
            tone={resolveCashFlowMetricTone(executiveYtd.netCashPosition)}
            featured
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-receivable"
            label="A receber YTD"
            amount={executiveYtd.totalReceivableOpen}
            subtitle="Saldo AR em aberto"
            icon={ArrowDownRight}
            tone="positive"
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-received"
            label="Recebido YTD"
            amount={executiveYtd.received.currentAmount}
            subtitle={receivedSub.short}
            hint={receivedSub.full}
            icon={
              executiveYtd.received.direction === "up"
                ? TrendingUp
                : executiveYtd.received.direction === "down"
                  ? TrendingDown
                  : CircleDollarSign
            }
            tone={receivedComparisonTone(executiveYtd.received.direction)}
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-payable"
            label="A pagar YTD"
            amount={executiveYtd.totalPayableOpen}
            subtitle="Saldo AP em aberto"
            icon={ArrowUpRight}
            tone="negative"
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-cash-need"
            label={isDeficit ? "Necessidade YTD" : "Folga YTD"}
            amount={isDeficit ? executiveYtd.cashNeedAmount : executiveYtd.cashSurplusAmount}
            subtitle={isDeficit ? "Para zerar déficit" : "Excesso projetado"}
            icon={CircleDollarSign}
            tone={isDeficit ? "negative" : "positive"}
          />
          <FinanceCashFlowExecutiveMetricCard
            testId="ytd-kpi-trend"
            label="Tendência do ano"
            value={executiveYtd.trend.label}
            valueFull={executiveYtd.trend.label}
            subtitle={`${executiveYtd.negativeMonthsCount} mês(es) negativo(s)`}
            icon={trendIcon}
            tone={trendTone}
          />
        </SummaryKpiGrid>

        <FinanceCashFlowYtdTotalsPanel totals={executiveYtd.totals} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="lg:col-span-2">
            <FinanceCashFlowYtdTrendChart points={executiveYtd.trend.monthlyNetSeries} />
          </div>
          <div
            data-testid="cash-flow-ytd-executive-reading"
            className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] p-3 space-y-2"
          >
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-[#2563EB]" />
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#111827]">
                Leitura executiva YTD
              </h3>
            </div>
            <ul className="space-y-1.5">
              {executiveYtdReading.map((line) => (
                <li key={line} className="text-[11px] text-[#374151] leading-snug">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <SummaryKpiGrid minColumnWidth={140} className="finance-cash-flow-metric-grid">
          <MiniMetricCard
            label="Vencidos AR"
            amount={executiveYtd.overdueReceivableAmount}
            variant="success"
          />
          <MiniMetricCard
            label="Vencidos AP"
            amount={executiveYtd.overduePayableAmount}
            variant="danger"
          />
          <MiniMetricCard
            label="Meses negativos"
            value={String(executiveYtd.negativeMonthsCount)}
            variant="neutral"
          />
          <MiniMetricCard
            label="Impacto vencidos"
            amount={executiveYtd.overdueCashImpact}
            variant="warning"
          />
        </SummaryKpiGrid>
      </div>
    </section>
  );
}

function receivedComparisonTone(
  direction: FinanceCashFlowExecutiveYtdReceived["direction"]
): "positive" | "negative" | "info" {
  if (direction === "up") return "positive";
  if (direction === "down") return "negative";
  return "info";
}

function formatReceivedComparisonSub(received: FinanceCashFlowExecutiveYtdReceived): {
  short: string;
  full: string;
} {
  const prev = formatCashFlowKpiDisplay(received.previousAmount);
  const prevLine = `Mesmo período ${received.previousYear}: ${prev.display}`;

  if (received.direction === "no_previous") {
    return {
      short: "Sem base no ano anterior",
      full: `${prevLine}\nSem comparação percentual`,
    };
  }

  const delta = formatCashFlowKpiDisplay(Math.abs(received.deltaAmount));
  const sign = received.deltaAmount >= 0 ? "+" : "-";
  const pct =
    received.deltaPercent != null
      ? `${received.deltaPercent >= 0 ? "+" : ""}${received.deltaPercent.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`
      : "";
  const deltaLine = pct ? `${sign}${delta.display} · ${pct}` : `${sign}${delta.display}`;

  return {
    short: `${prevLine}\n${deltaLine}`,
    full: `${prevLine} (${prev.full})\nVariação: ${sign}${delta.full}${pct ? ` · ${pct}` : ""}`,
  };
}

function MiniMetricCard({
  label,
  amount,
  value,
  variant,
}: {
  label: string;
  amount?: number;
  value?: string;
  variant: "success" | "danger" | "warning" | "neutral";
}) {
  const formatted = amount != null ? formatCashFlowKpiDisplay(amount) : null;
  return (
    <MetricCard
      label={label}
      formattedValue={formatted?.display ?? value ?? "—"}
      fullValue={formatted?.full ?? value}
      variant={variant}
      compact
      className="finance-cash-flow-metric-card"
    />
  );
}
