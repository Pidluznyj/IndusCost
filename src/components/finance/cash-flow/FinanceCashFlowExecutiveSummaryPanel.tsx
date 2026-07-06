import React from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CircleDollarSign,
  Scale,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { FinanceCashFlowExecutiveSummary } from "@/src/lib/financeCashFlowExecutiveSummary";
import type { CashHealthScore } from "@/src/lib/financeCashFlowCfoDiagnostics";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_KPI_CF_ESTIMATED_AP_YEAR,
  FINANCE_KPI_CF_ESTIMATED_AR_YEAR,
  FINANCE_KPI_CF_ESTIMATED_YEAR_NET,
  FINANCE_KPI_CF_OPEN_AP_TO_YEAR_END,
  FINANCE_KPI_CF_OPEN_AR_TO_YEAR_END,
  FINANCE_KPI_CF_PAID_YTD,
  FINANCE_KPI_CF_PERIOD_INFLOW,
  FINANCE_KPI_CF_PERIOD_NET,
  FINANCE_KPI_CF_PERIOD_OUTFLOW,
  FINANCE_KPI_CF_PROJECTED_REMAINING,
  FINANCE_KPI_CF_REALIZED_YTD,
  FINANCE_KPI_CF_RECEIVED_YTD,
} from "@/src/lib/financeKpiTooltips";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceCashFlowKpiCard } from "@/src/components/finance/cash-flow/FinanceCashFlowKpiCard";
import { cn } from "@/src/lib/utils";

type Props = {
  summary: FinanceCashFlowExecutiveSummary;
  cashHealthScore?: CashHealthScore;
  filtersActive: boolean;
  appliedFiltersLabel?: string;
};

function BlockTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-[#111827]">{title}</h3>
      <p className="text-[10px] text-[#6B7280]">{subtitle}</p>
    </div>
  );
}

export function FinanceCashFlowExecutiveSummaryPanel({
  summary,
  cashHealthScore,
  filtersActive,
  appliedFiltersLabel,
}: Props) {
  const { receivable, payable, net, period, metadata } = summary;
  const netPositive = net.estimatedYearNet >= 0;
  const periodPositive = period.netFlowAmount >= 0;
  const forwardHint = metadata.forwardRangeActive
    ? metadata.forwardRangeLabel
    : "Sem projeção futura — ano já encerrado";

  return (
    <section
      data-testid="cash-flow-executive-summary"
      className={cn(financeBiSectionClass, "overflow-hidden")}
    >
      <div className="px-4 py-3 border-b border-[#E5E7EB] space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-[#111827]">Visão executiva do caixa</h2>
          <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-semibold text-[#1D4ED8]">
            Ano {metadata.year}
          </span>
          {period.monthFiltered ? (
            <span className="rounded-full bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[10px] font-semibold text-[#92400E]">
              Mês filtrado: {period.periodLabel}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-[#6B7280]">{metadata.ytdScopeLabel}</p>
        <p className="text-[10px] text-[#6B7280]">
          Entradas = Contas a Receber · Saídas = Contas a Pagar · Faturamento não é caixa
        </p>
        {filtersActive && appliedFiltersLabel ? (
          <p className="text-[10px] text-[#6B7280]">
            Filtros: {appliedFiltersLabel}
            {metadata.receivableOrigin !== "Tudo"
              ? ` · Origem AR: ${metadata.receivableOrigin}`
              : ""}
          </p>
        ) : null}
      </div>

      <div className="p-4 space-y-5">
        <div>
          <BlockTitle
            title="Contas a Receber — Entradas"
            subtitle={`Realizado YTD e projeção até 31/12 · Origem: ${metadata.receivableOrigin}`}
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FinanceCashFlowKpiCard
              testId="exec-kpi-received-ytd"
              label="Recebido YTD"
              hint={FINANCE_KPI_CF_RECEIVED_YTD}
              value={formatFinanceCurrency(receivable.receivedYtd)}
              valueFull={formatFinanceCurrency(receivable.receivedYtd)}
              icon={TrendingUp}
              colorClass="text-[#059669]"
              valueClassName="text-[#059669] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-open-ar-year-end"
              label="A receber até 31/12"
              hint={`${FINANCE_KPI_CF_OPEN_AR_TO_YEAR_END} Período: ${forwardHint}.`}
              value={formatFinanceCurrency(receivable.openFromTodayToYearEnd)}
              valueFull={formatFinanceCurrency(receivable.openFromTodayToYearEnd)}
              icon={ArrowDownRight}
              colorClass="text-[#059669]"
              valueClassName="text-[#059669] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-estimated-ar-year"
              label="Estimativa AR do ano"
              hint={FINANCE_KPI_CF_ESTIMATED_AR_YEAR}
              value={formatFinanceCurrency(receivable.estimatedYearTotal)}
              valueFull={formatFinanceCurrency(receivable.estimatedYearTotal)}
              icon={Wallet}
              colorClass="text-[#047857]"
              valueClassName="text-[#047857] font-bold tabular-nums text-lg sm:text-xl"
              featured
            />
          </div>
        </div>

        <div>
          <BlockTitle
            title="Contas a Pagar — Saídas"
            subtitle="Realizado YTD e projeção até 31/12"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <FinanceCashFlowKpiCard
              testId="exec-kpi-paid-ytd"
              label="Pago YTD"
              hint={FINANCE_KPI_CF_PAID_YTD}
              value={formatFinanceCurrency(payable.paidYtd)}
              valueFull={formatFinanceCurrency(payable.paidYtd)}
              icon={TrendingDown}
              colorClass="text-[#DC2626]"
              valueClassName="text-[#DC2626] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-open-ap-year-end"
              label="A pagar até 31/12"
              hint={`${FINANCE_KPI_CF_OPEN_AP_TO_YEAR_END} Período: ${forwardHint}.`}
              value={formatFinanceCurrency(payable.openFromTodayToYearEnd)}
              valueFull={formatFinanceCurrency(payable.openFromTodayToYearEnd)}
              icon={ArrowUpRight}
              colorClass="text-[#DC2626]"
              valueClassName="text-[#DC2626] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-estimated-ap-year"
              label="Estimativa AP do ano"
              hint={FINANCE_KPI_CF_ESTIMATED_AP_YEAR}
              value={formatFinanceCurrency(payable.estimatedYearTotal)}
              valueFull={formatFinanceCurrency(payable.estimatedYearTotal)}
              icon={Wallet}
              colorClass="text-[#B91C1C]"
              valueClassName="text-[#B91C1C] font-bold tabular-nums text-lg sm:text-xl"
              featured
            />
          </div>
        </div>

        <div>
          <BlockTitle
            title="Resultado do caixa"
            subtitle="Saldo realizado, projeção restante e estimativa líquida anual"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceCashFlowKpiCard
              testId="exec-kpi-realized-ytd"
              label="Saldo realizado YTD"
              hint={FINANCE_KPI_CF_REALIZED_YTD}
              value={formatFinanceCurrency(net.realizedYtd)}
              valueFull={formatFinanceCurrency(net.realizedYtd)}
              icon={Scale}
              colorClass={net.realizedYtd >= 0 ? "text-[#059669]" : "text-[#DC2626]"}
              valueClassName={cn(
                "font-bold tabular-nums text-lg sm:text-xl",
                net.realizedYtd >= 0 ? "text-[#059669]" : "text-[#DC2626]"
              )}
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-projected-remaining"
              label="Saldo projetado restante"
              hint={FINANCE_KPI_CF_PROJECTED_REMAINING}
              value={formatFinanceCurrency(net.projectedRemaining)}
              valueFull={formatFinanceCurrency(net.projectedRemaining)}
              icon={CircleDollarSign}
              colorClass={net.projectedRemaining >= 0 ? "text-[#059669]" : "text-[#DC2626]"}
              valueClassName={cn(
                "font-bold tabular-nums text-lg sm:text-xl",
                net.projectedRemaining >= 0 ? "text-[#059669]" : "text-[#DC2626]"
              )}
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-estimated-year-net"
              label="Estimativa líquida anual"
              hint={FINANCE_KPI_CF_ESTIMATED_YEAR_NET}
              featured
              value={formatFinanceCurrency(net.estimatedYearNet)}
              valueFull={formatFinanceCurrency(net.estimatedYearNet)}
              icon={netPositive ? TrendingUp : TrendingDown}
              colorClass={netPositive ? "text-[#059669]" : "text-[#DC2626]"}
              valueClassName={cn(
                "font-bold tabular-nums text-xl sm:text-2xl",
                netPositive ? "text-[#059669]" : "text-[#DC2626]"
              )}
            />
            {cashHealthScore ? (
              <FinanceCashFlowKpiCard
                testId="exec-kpi-cfo-score"
                label="Score CFO"
                hint="Score composto de saúde do caixa (0–100) com base em carteira, vencidos e tendência."
                value={String(cashHealthScore.score)}
                valueFull={`${cashHealthScore.score} — ${cashHealthScore.classificationLabel}`}
                icon={CircleDollarSign}
                colorClass="text-[#2563EB]"
                valueClassName="text-[#2563EB] font-bold tabular-nums text-lg sm:text-xl"
              />
            ) : null}
          </div>
          <p
            data-testid="exec-kpi-year-net-status"
            className={cn(
              "mt-2 text-xs font-semibold",
              netPositive ? "text-[#059669]" : "text-[#DC2626]"
            )}
          >
            Caixa previsto do ano: {netPositive ? "positivo" : "negativo"} (
            {formatFinanceCurrency(net.estimatedYearNet)})
          </p>
        </div>

        <div>
          <BlockTitle
            title="Período filtrado"
            subtitle={
              period.monthFiltered
                ? `Recorte operacional ${period.periodLabel} — distinto da visão anual acima`
                : `Recorte do ano ${metadata.year} conforme modo ${metadata.viewMode}`
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <FinanceCashFlowKpiCard
              testId="exec-kpi-period-inflow"
              label="Entradas do período"
              hint={FINANCE_KPI_CF_PERIOD_INFLOW}
              value={formatFinanceCurrency(period.inflowAmount)}
              valueFull={formatFinanceCurrency(period.inflowAmount)}
              icon={TrendingUp}
              colorClass="text-[#059669]"
              valueClassName="text-[#059669] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-period-outflow"
              label="Saídas do período"
              hint={FINANCE_KPI_CF_PERIOD_OUTFLOW}
              value={formatFinanceCurrency(period.outflowAmount)}
              valueFull={formatFinanceCurrency(period.outflowAmount)}
              icon={TrendingDown}
              colorClass="text-[#DC2626]"
              valueClassName="text-[#DC2626] font-bold tabular-nums text-lg sm:text-xl"
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-period-net"
              label="Saldo líquido do período"
              hint={FINANCE_KPI_CF_PERIOD_NET}
              value={formatFinanceCurrency(period.netFlowAmount)}
              valueFull={formatFinanceCurrency(period.netFlowAmount)}
              icon={Scale}
              colorClass={periodPositive ? "text-[#059669]" : "text-[#DC2626]"}
              valueClassName={cn(
                "font-bold tabular-nums text-lg sm:text-xl",
                periodPositive ? "text-[#059669]" : "text-[#DC2626]"
              )}
            />
            <FinanceCashFlowKpiCard
              testId="exec-kpi-period-accumulated"
              label="Saldo acumulado do período"
              hint="Soma do fluxo líquido mês a mês no período filtrado. Não é saldo bancário."
              value={formatFinanceCurrency(period.accumulatedBalance)}
              valueFull={formatFinanceCurrency(period.accumulatedBalance)}
              icon={CircleDollarSign}
              colorClass="text-[#111827]"
              valueClassName="text-[#111827] font-bold tabular-nums text-lg sm:text-xl"
            />
          </div>
          <p
            data-testid="exec-kpi-period-status"
            className={cn(
              "mt-2 text-xs font-semibold",
              periodPositive ? "text-[#059669]" : "text-[#DC2626]"
            )}
          >
            Período filtrado: {periodPositive ? "positivo" : "negativo"} (
            {formatFinanceCurrency(period.netFlowAmount)})
          </p>
        </div>
      </div>
    </section>
  );
}
