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
import { formatCashFlowKpiDisplay } from "@/src/lib/financeCashFlowDisplay";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceCashFlowYtdTrendChart } from "@/src/components/finance/cash-flow/FinanceCashFlowYtdTrendChart";
import { cn } from "@/src/lib/utils";

function CompactYtdCard({
  testId,
  label,
  value,
  valueFull,
  sub,
  icon: Icon,
  colorClass,
  featured = false,
  titleExtra,
}: {
  testId: string;
  label: string;
  value: string;
  valueFull: string;
  sub: string;
  icon: React.ElementType;
  colorClass: string;
  featured?: boolean;
  titleExtra?: string;
}) {
  return (
    <div
      data-testid={testId}
      title={titleExtra ? `${valueFull}\n${titleExtra}` : valueFull}
      className={cn(
        "rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5 min-h-[88px] flex flex-col justify-between",
        featured && "ring-1 ring-[#2563EB]/20 border-[#BFDBFE]"
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] leading-tight">
          {label}
        </span>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", colorClass)} />
      </div>
      <p
        className={cn(
          "text-lg sm:text-xl font-bold tabular-nums leading-tight break-words mt-1",
          colorClass
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "text-[10px] text-[#6B7280] leading-snug mt-0.5",
          titleExtra && "whitespace-pre-line"
        )}
      >
        {sub}
      </p>
    </div>
  );
}

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
  const netKpi = formatCashFlowKpiDisplay(executiveYtd.netCashPosition);
  const receivableKpi = formatCashFlowKpiDisplay(executiveYtd.totalReceivableOpen);
  const receivedKpi = formatCashFlowKpiDisplay(executiveYtd.received.currentAmount);
  const receivedSub = formatReceivedComparisonSub(executiveYtd.received);
  const payableKpi = formatCashFlowKpiDisplay(executiveYtd.totalPayableOpen);
  const needKpi = formatCashFlowKpiDisplay(
    isDeficit ? executiveYtd.cashNeedAmount : executiveYtd.cashSurplusAmount
  );
  const overdueKpi = formatCashFlowKpiDisplay(executiveYtd.overdueCashImpact);

  const trendIcon =
    executiveYtd.trend.direction === "improving"
      ? TrendingUp
      : executiveYtd.trend.direction === "worsening"
        ? TrendingDown
        : TrendingUp;
  const trendColor =
    executiveYtd.trend.direction === "improving"
      ? "text-[#059669]"
      : executiveYtd.trend.direction === "worsening"
        ? "text-[#DC2626]"
        : "text-[#6B7280]";

  return (
    <section className={financeBiSectionClass} data-testid="cash-flow-ytd-summary">
      <div className="px-4 py-3 border-b border-[#E5E7EB] space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-[#111827]">Resumo executivo YTD</h2>
          <span
            data-testid="cash-flow-ytd-scope-chip"
            className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]"
          >
            Topo: YTD
          </span>
          {filtersActive ? (
            <span
              data-testid="cash-flow-filtered-scope-chip"
              className="rounded-full bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 text-[10px] font-semibold text-[#374151]"
            >
              Análises abaixo: filtros aplicados
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-[#6B7280]">
          {executiveYtd.isCurrentYear
            ? "Visão acumulada do ano até hoje, independente dos recortes operacionais abaixo."
            : "Visão acumulada do ano selecionado."}
        </p>
        <p
          data-testid="cash-flow-ytd-scope-label"
          className="text-[11px] font-semibold text-[#111827]"
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
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
          <CompactYtdCard
            testId="ytd-kpi-net-position"
            label="Posição líquida YTD"
            value={netKpi.display}
            valueFull={netKpi.full}
            sub={isDeficit ? "Déficit projetado" : "Superávit projetado"}
            icon={isDeficit ? ArrowDownRight : ArrowUpRight}
            colorClass={isDeficit ? "text-[#DC2626]" : "text-[#059669]"}
            featured
          />
          <CompactYtdCard
            testId="ytd-kpi-receivable"
            label="A receber YTD"
            value={receivableKpi.display}
            valueFull={receivableKpi.full}
            sub="Saldo AR em aberto"
            icon={ArrowDownRight}
            colorClass="text-[#059669]"
          />
          <CompactYtdCard
            testId="ytd-kpi-received"
            label="Recebido YTD"
            value={receivedKpi.display}
            valueFull={receivedKpi.full}
            sub={receivedSub.short}
            icon={
              executiveYtd.received.direction === "up"
                ? TrendingUp
                : executiveYtd.received.direction === "down"
                  ? TrendingDown
                  : CircleDollarSign
            }
            colorClass={receivedComparisonColor(executiveYtd.received.direction)}
            titleExtra={receivedSub.full}
          />
          <CompactYtdCard
            testId="ytd-kpi-payable"
            label="A pagar YTD"
            value={payableKpi.display}
            valueFull={payableKpi.full}
            sub="Saldo AP em aberto"
            icon={ArrowUpRight}
            colorClass="text-[#DC2626]"
          />
          <CompactYtdCard
            testId="ytd-kpi-cash-need"
            label={isDeficit ? "Necessidade YTD" : "Folga YTD"}
            value={needKpi.display}
            valueFull={needKpi.full}
            sub={isDeficit ? "Para zerar déficit" : "Excesso projetado"}
            icon={CircleDollarSign}
            colorClass={isDeficit ? "text-[#DC2626]" : "text-[#059669]"}
          />
          <CompactYtdCard
            testId="ytd-kpi-trend"
            label="Tendência do ano"
            value={executiveYtd.trend.label}
            valueFull={executiveYtd.trend.label}
            sub={`${executiveYtd.negativeMonthsCount} mês(es) negativo(s)`}
            icon={trendIcon}
            colorClass={trendColor}
          />
        </div>

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
              <h3 className="text-[11px] font-bold uppercase tracking-wide text-[#111827]">
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <MiniStat label="Vencidos AR" value={formatCashFlowKpiDisplay(executiveYtd.overdueReceivableAmount)} tone="in" />
          <MiniStat label="Vencidos AP" value={formatCashFlowKpiDisplay(executiveYtd.overduePayableAmount)} tone="out" />
          <MiniStat
            label="Meses negativos"
            value={{ display: String(executiveYtd.negativeMonthsCount), full: String(executiveYtd.negativeMonthsCount) }}
          />
          <MiniStat
            label="Impacto vencidos"
            value={overdueKpi}
            tone="warn"
          />
        </div>
      </div>
    </section>
  );
}

function receivedComparisonColor(
  direction: FinanceCashFlowExecutiveYtdReceived["direction"]
): string {
  if (direction === "up") return "text-[#059669]";
  if (direction === "down") return "text-[#DC2626]";
  return "text-[#2563EB]";
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

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: { display: string; full: string };
  tone?: "in" | "out" | "warn";
}) {
  return (
    <div className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5" title={value.full}>
      <p className="text-[9px] font-semibold uppercase text-[#6B7280]">{label}</p>
      <p
        className={cn(
          "text-sm font-bold tabular-nums truncate",
          tone === "in"
            ? "text-[#059669]"
            : tone === "out"
              ? "text-[#DC2626]"
              : tone === "warn"
                ? "text-[#D97706]"
                : "text-[#111827]"
        )}
      >
        {value.display}
      </p>
    </div>
  );
}
