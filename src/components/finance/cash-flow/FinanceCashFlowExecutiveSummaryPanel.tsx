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
import { resolveCashFlowMetricTone } from "@/src/lib/financeCashFlowDisplay";
import {
  FINANCE_KPI_CF_ESTIMATED_AP_YEAR,
  FINANCE_KPI_CF_ESTIMATED_AR_YEAR,
  FINANCE_KPI_CF_ESTIMATED_YEAR_NET,
  FINANCE_KPI_CF_OPEN_AP_FORWARD_BREAKDOWN,
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
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { FinanceCashFlowExecutiveMetricCard } from "@/src/components/finance/cash-flow/FinanceCashFlowExecutiveMetricCard";
import { cn } from "@/src/lib/utils";
import "./finance-cash-flow-executive-summary.css";

type Props = {
  summary: FinanceCashFlowExecutiveSummary;
  cashHealthScore?: CashHealthScore;
  filtersActive: boolean;
  appliedFiltersLabel?: string;
};

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
  const annualScopeNote = metadata.annualScopeIgnoresMonthFilter
    ? "Ignora filtro de mês — visão do restante do ano"
    : "Projeção até 31/12 do ano selecionado";
  const forwardApMonths = payable.openForwardByMonth.filter(
    (row) => row.includedInForwardRange && row.openAmount > 0
  );
  const periodVsForward = payable.periodVsForward;

  return (
    <section
      data-testid="cash-flow-executive-summary"
      className={cn(financeBiSectionClass, "finance-cash-flow-executive-summary overflow-hidden")}
    >
      <div className="px-4 py-3 border-b border-[#E5E7EB] space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-[#111827]">Visão executiva do caixa</h2>
          <span className="rounded-full bg-[#EFF6FF] border border-[#BFDBFE] px-2 py-0.5 text-[10px] font-medium text-[#1D4ED8]">
            Ano {metadata.year}
          </span>
          {period.monthFiltered ? (
            <span className="rounded-full bg-[#FEF3C7] border border-[#FDE68A] px-2 py-0.5 text-[10px] font-medium text-[#92400E]">
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
        <ExecutiveSummarySection
          embedded
          title="Contas a Receber — Entradas"
          eyebrow={`Realizado YTD e ${annualScopeNote} · Origem: ${metadata.receivableOrigin}`}
        >
          <SummaryKpiGrid minColumnWidth={168} className="finance-cash-flow-metric-grid">
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-received-ytd"
              label="Recebido YTD"
              hint={FINANCE_KPI_CF_RECEIVED_YTD}
              amount={receivable.receivedYtd}
              icon={TrendingUp}
              tone="positive"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-open-ar-year-end"
              label="A receber restante no ano"
              hint={`${FINANCE_KPI_CF_OPEN_AR_TO_YEAR_END} Intervalo: ${forwardHint}.`}
              amount={receivable.openFromTodayToYearEnd}
              icon={ArrowDownRight}
              tone="positive"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-estimated-ar-year"
              label="Estimativa AR do ano"
              hint={FINANCE_KPI_CF_ESTIMATED_AR_YEAR}
              amount={receivable.estimatedYearTotal}
              icon={Wallet}
              tone="positive"
              featured
            />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>

        <ExecutiveSummarySection
          embedded
          title="Contas a Pagar — Saídas"
          eyebrow={`Realizado YTD e ${annualScopeNote}`}
        >
          <SummaryKpiGrid minColumnWidth={168} className="finance-cash-flow-metric-grid">
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-paid-ytd"
              label="Pago YTD"
              hint={FINANCE_KPI_CF_PAID_YTD}
              amount={payable.paidYtd}
              icon={TrendingDown}
              tone="negative"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-open-ap-year-end"
              label="A pagar restante no ano"
              hint={`${FINANCE_KPI_CF_OPEN_AP_TO_YEAR_END} Intervalo: ${forwardHint}.`}
              amount={payable.openFromTodayToYearEnd}
              icon={ArrowUpRight}
              tone="negative"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-estimated-ap-year"
              label="Estimativa AP do ano"
              hint={FINANCE_KPI_CF_ESTIMATED_AP_YEAR}
              amount={payable.estimatedYearTotal}
              icon={Wallet}
              tone="negative"
              featured
            />
          </SummaryKpiGrid>
          {forwardApMonths.length > 0 ? (
            <div
              data-testid="exec-kpi-ap-forward-breakdown"
              className="finance-cash-flow-executive-summary__forward-breakdown"
              title={FINANCE_KPI_CF_OPEN_AP_FORWARD_BREAKDOWN}
            >
              <p className="finance-cash-flow-executive-summary__forward-breakdown-title">
                Composição do saldo a pagar restante ({forwardHint})
              </p>
              <div className="finance-cash-flow-executive-summary__forward-breakdown-body">
                {forwardApMonths.map((row) => (
                  <span key={row.month} className="tabular-nums">
                    {row.monthLabel}: {formatFinanceCurrency(row.openAmount)}
                  </span>
                ))}
                <span className="font-medium tabular-nums">
                  Total: {formatFinanceCurrency(payable.openFromTodayToYearEnd)}
                </span>
              </div>
              {periodVsForward && periodVsForward.gapVsPeriodOutflow > 0 ? (
                <p
                  data-testid="exec-kpi-ap-period-gap-note"
                  className="finance-cash-flow-executive-summary__forward-breakdown-gap"
                >
                  Diferença de {formatFinanceCurrency(periodVsForward.gapVsPeriodOutflow)} em
                  relação a Saídas do período ({periodVsForward.filteredMonthLabel}):{" "}
                  {formatFinanceCurrency(periodVsForward.forwardOpenOutsideFilteredMonth)} em meses
                  fora do mês filtrado no intervalo {periodVsForward.forwardRangeLabel}.
                </p>
              ) : null}
            </div>
          ) : null}
        </ExecutiveSummarySection>

        <ExecutiveSummarySection
          embedded
          title="Resultado do caixa"
          eyebrow="Saldo realizado, projeção restante e estimativa líquida anual"
        >
          <SummaryKpiGrid minColumnWidth={168} className="finance-cash-flow-metric-grid">
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-realized-ytd"
              label="Saldo realizado YTD"
              hint={FINANCE_KPI_CF_REALIZED_YTD}
              amount={net.realizedYtd}
              icon={Scale}
              tone={resolveCashFlowMetricTone(net.realizedYtd)}
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-projected-remaining"
              label="Saldo projetado restante"
              hint={FINANCE_KPI_CF_PROJECTED_REMAINING}
              amount={net.projectedRemaining}
              icon={CircleDollarSign}
              tone={resolveCashFlowMetricTone(net.projectedRemaining)}
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-estimated-year-net"
              label="Estimativa líquida anual"
              hint={FINANCE_KPI_CF_ESTIMATED_YEAR_NET}
              amount={net.estimatedYearNet}
              icon={netPositive ? TrendingUp : TrendingDown}
              tone={resolveCashFlowMetricTone(net.estimatedYearNet)}
              featured
            />
            {cashHealthScore ? (
              <FinanceCashFlowExecutiveMetricCard
                testId="exec-kpi-cfo-score"
                label="Score CFO"
                hint="Score composto de saúde do caixa (0–100) com base em carteira, vencidos e tendência."
                value={String(cashHealthScore.score)}
                valueFull={`${cashHealthScore.score} — ${cashHealthScore.classificationLabel}`}
                subtitle={cashHealthScore.classificationLabel}
                icon={CircleDollarSign}
                tone="info"
              />
            ) : null}
          </SummaryKpiGrid>
          <p
            data-testid="exec-kpi-year-net-status"
            className={cn(
              "finance-cash-flow-executive-summary__status-note",
              netPositive
                ? "finance-cash-flow-executive-summary__status-note--positive"
                : "finance-cash-flow-executive-summary__status-note--negative"
            )}
          >
            Caixa previsto do ano:{" "}
            <strong>
              {netPositive ? "positivo" : "negativo"} ({formatFinanceCurrency(net.estimatedYearNet)})
            </strong>
          </p>
        </ExecutiveSummarySection>

        <ExecutiveSummarySection
          embedded
          title="Período filtrado"
          eyebrow={
            period.monthFiltered
              ? `Recorte operacional ${period.periodLabel} — distinto da visão anual acima`
              : `Recorte do ano ${metadata.year} conforme modo ${metadata.viewMode}`
          }
        >
          <SummaryKpiGrid minColumnWidth={168} className="finance-cash-flow-metric-grid">
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-period-inflow"
              label="Entradas do período"
              hint={FINANCE_KPI_CF_PERIOD_INFLOW}
              amount={period.inflowAmount}
              icon={TrendingUp}
              tone="positive"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-period-outflow"
              label="Saídas do período"
              hint={FINANCE_KPI_CF_PERIOD_OUTFLOW}
              amount={period.outflowAmount}
              icon={TrendingDown}
              tone="negative"
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-period-net"
              label="Saldo líquido do período"
              hint={FINANCE_KPI_CF_PERIOD_NET}
              amount={period.netFlowAmount}
              icon={Scale}
              tone={resolveCashFlowMetricTone(period.netFlowAmount)}
            />
            <FinanceCashFlowExecutiveMetricCard
              testId="exec-kpi-period-accumulated"
              label="Saldo acumulado do período"
              hint="Soma do fluxo líquido mês a mês no período filtrado. Não é saldo bancário."
              amount={period.accumulatedBalance}
              icon={CircleDollarSign}
              tone="neutral"
            />
          </SummaryKpiGrid>
          <p
            data-testid="exec-kpi-period-status"
            className={cn(
              "finance-cash-flow-executive-summary__status-note",
              periodPositive
                ? "finance-cash-flow-executive-summary__status-note--positive"
                : "finance-cash-flow-executive-summary__status-note--negative"
            )}
          >
            Período filtrado:{" "}
            <strong>
              {periodPositive ? "positivo" : "negativo"} ({formatFinanceCurrency(period.netFlowAmount)})
            </strong>
          </p>
        </ExecutiveSummarySection>
      </div>
    </section>
  );
}
