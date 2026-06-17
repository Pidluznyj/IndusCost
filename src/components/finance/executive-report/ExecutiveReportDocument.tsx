import React from "react";
import type { FinanceExecutiveReport } from "@/src/lib/financeExecutiveReportTypes";
import {
  resolveExecutiveReportCriticalMonths,
  resolveExecutiveSummaryBillingByYear,
} from "@/src/lib/financeExecutiveReportViewModel";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { formatExecutivePercent } from "@/src/lib/executiveDashboardFormatters";
import { ExecutiveMonthlyComboChart } from "@/src/components/dashboard/ExecutiveDashboardCharts";
import { FinanceBillingMonthlyComparisonChart } from "@/src/components/finance/billing/FinanceBillingMonthlyComparisonChart";
import { FinanceBillingProjectionChart } from "@/src/components/finance/billing/FinanceBillingProjectionChart";
import { FinanceArMonthlyScheduleChart } from "@/src/components/finance/FinanceAccountsReceivableCharts";
import { FinanceApMonthlyScheduleChart } from "@/src/components/finance/FinanceAccountsPayableCharts";
import { FinanceCashFlowMonthlyPlannedChart } from "@/src/components/finance/cash-flow/FinanceCashFlowMonthlyPlannedChart";
import { FinanceCashFlowMonthlyChart } from "@/src/components/finance/FinanceCashFlowCharts";
import { ExecutiveReportCover } from "@/src/components/finance/executive-report/ExecutiveReportCover";
import { ExecutiveReportSection } from "@/src/components/finance/executive-report/ExecutiveReportSection";
import { ExecutiveKpiCard } from "@/src/components/finance/executive-report/ExecutiveKpiCard";

export function ExecutiveReportDocument({ report }: { report: FinanceExecutiveReport }) {
  const billingTab = report.billingComparison.tab;
  const billingPayload = report.billingComparison.payload;
  const projectionTab = report.billingProjection.tab;
  const arCards = report.accountsReceivable.payload.cards;
  const apCards = report.accountsPayable.payload.cards;
  const cashCards = report.cashFlow.payload.cards;
  const salesTab = report.salesOrders.tab;
  const month = report.month ?? billingPayload.currentMonth;

  const billingByYear = resolveExecutiveSummaryBillingByYear(
    billingTab.multiYearMonthly,
    month,
    report.year
  );

  const criticalMonths = resolveExecutiveReportCriticalMonths(report);

  return (
    <div className="finance-executive-report-document space-y-8" data-testid="executive-report-document">
      <ExecutiveReportCover cover={report.cover} generatedAt={report.generatedAt} />

      <ExecutiveReportSection
        id="summary"
        title="Resumo Executivo"
        subtitle="Leitura rápida do mês e indicadores-chave"
      >
        <div className="finance-executive-kpi-grid mb-5">
          {billingByYear.map((row) => (
            <div key={row.year}>
              <ExecutiveKpiCard
                label={`Faturamento mês — ${row.year}`}
                value={row.formatted}
                accent={row.year === report.year}
              />
            </div>
          ))}
          <ExecutiveKpiCard
            label="% atingimento meta mês"
            value={billingTab.target.formatted.achievementPercent}
            sub={`Meta: ${billingTab.target.formatted.target}`}
            accent
          />
        </div>
        {report.executiveSummary.highlights.length > 0 ? (
          <div className="space-y-2">
            {report.executiveSummary.highlights.map((line) => (
              <p key={line} className="finance-executive-reading">
                {line}
              </p>
            ))}
          </div>
        ) : null}
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="billing-comparison"
        title="Faturamento Comparativo"
        subtitle="Evolução mensal multi-ano — fonte NF-e oficial"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Realizado mês"
            value={billingTab.target.formatted.actual}
          />
          <ExecutiveKpiCard
            label="Projetado mês"
            value={projectionTab.projection.formatted.projectedMonth}
          />
          <ExecutiveKpiCard
            label="Meta mês"
            value={billingTab.target.formatted.target}
          />
          <ExecutiveKpiCard
            label="YTD ano selecionado"
            value={formatFinanceCurrency(billingTab.yearComparison.yearToDateCurrent)}
          />
        </div>
        <FinanceBillingMonthlyComparisonChart
          points={billingTab.multiYearMonthly}
          selectedYear={billingPayload.selectedYear}
        />
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="billing-projection"
        title="Realizado vs Projetado"
        subtitle="Média diária, projeção e meta anual"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Média diária"
            value={projectionTab.projection.formatted.dailyAverage}
          />
          <ExecutiveKpiCard
            label="Faturado"
            value={projectionTab.realizedVsProjected.formatted.realized}
          />
          <ExecutiveKpiCard
            label="Faturamento projetado"
            value={projectionTab.realizedVsProjected.formatted.projected}
          />
          <ExecutiveKpiCard
            label="Meta do ano"
            value={billingTab.yearComparison.formatted.annualTarget}
          />
          <ExecutiveKpiCard
            label="% atingimento projetado"
            value={
              billingTab.target.achievementPercent != null
                ? formatExecutivePercent(billingTab.target.achievementPercent, 1)
                : "—"
            }
          />
        </div>
        <FinanceBillingProjectionChart
          data={projectionTab.realizedVsProjected}
          selectedYear={billingPayload.selectedYear}
        />
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="accounts-receivable"
        title="Contas a Receber"
        subtitle="Base saneada Nomus — visão gerencial"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Valor a receber"
            value={formatFinanceCurrency(arCards.totalAmountReceivable)}
          />
          <ExecutiveKpiCard
            label="Valor recebido"
            value={formatFinanceCurrency(arCards.totalReceivedAmount)}
          />
          <ExecutiveKpiCard
            label="Em aberto"
            value={formatFinanceCurrency(arCards.totalOpenAmount)}
          />
          <ExecutiveKpiCard
            label="Atrasados"
            value={formatFinanceCurrency(arCards.overdueAmount)}
          />
        </div>
        <FinanceArMonthlyScheduleChart rows={report.accountsReceivable.payload.monthlyDueSchedule} />
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="accounts-payable"
        title="Contas a Pagar"
        subtitle="Base saneada Nomus — visão gerencial"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Valor a pagar total"
            value={formatFinanceCurrency(apCards.totalPayableAmount)}
          />
          <ExecutiveKpiCard
            label="Valor pago"
            value={formatFinanceCurrency(apCards.totalPayableAmount - apCards.totalOpenAmount)}
          />
          <ExecutiveKpiCard
            label="Em aberto"
            value={formatFinanceCurrency(apCards.totalOpenAmount)}
          />
          <ExecutiveKpiCard
            label="Vencidos"
            value={formatFinanceCurrency(apCards.overdueAmount)}
          />
        </div>
        <FinanceApMonthlyScheduleChart rows={report.accountsPayable.payload.monthlyDueSchedule} />
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="cash-flow"
        title="Fluxo de Caixa / Agenda"
        subtitle="Motor saneado — saldo mensal e meses críticos"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Entradas previstas"
            value={formatFinanceCurrency(cashCards.inflowAmount)}
          />
          <ExecutiveKpiCard
            label="Saídas previstas"
            value={formatFinanceCurrency(cashCards.outflowAmount)}
          />
          <ExecutiveKpiCard
            label="Saldo líquido"
            value={formatFinanceCurrency(cashCards.netFlowAmount)}
          />
          <ExecutiveKpiCard
            label="Saldo acumulado"
            value={formatFinanceCurrency(cashCards.accumulatedBalance)}
          />
        </div>
        {criticalMonths.length > 0 ? (
          <p className="finance-executive-reading mb-4">
            Meses críticos (saldo negativo): {criticalMonths.join(", ")}
          </p>
        ) : null}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <FinanceCashFlowMonthlyPlannedChart
            year={report.year}
            rows={report.calendarAgenda.executiveSummary?.monthlyTimeline ?? []}
          />
          <FinanceCashFlowMonthlyChart
            points={report.cashFlow.payload.monthlySeries}
            viewModeLabel="Projetado"
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="sales-orders"
        title="Pedidos de Venda"
        subtitle="SalesOrder — carteira comercial e projeção"
      >
        <div className="finance-executive-kpi-grid mb-6">
          <ExecutiveKpiCard
            label="Pedidos YTD"
            value={salesTab.summaryCards.find((c) => c.id === "realized-ytd")?.formatted ?? "—"}
          />
          <ExecutiveKpiCard
            label="Meta mês"
            value={salesTab.target.formatted.target}
          />
          <ExecutiveKpiCard
            label="Projeção"
            value={salesTab.projection.formatted.monthlyProjection}
          />
          <ExecutiveKpiCard
            label="Atingimento"
            value={salesTab.target.formatted.achievementPercent}
          />
        </div>
        {salesTab.monthlySeries.length > 0 && salesTab.chartSeries ? (
          <ExecutiveMonthlyComboChart
            title={`Pedidos — ${report.year}`}
            series={salesTab.monthlySeries}
            config={salesTab.chartSeries}
          />
        ) : null}
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="conclusion"
        title="Conclusão Executiva"
        subtitle="Alertas, pontos de atenção e leitura automática"
      >
        {report.executiveNarrative?.sections.length ? (
          <div className="space-y-4">
            {report.executiveNarrative.sections.map((section) => (
              <div key={section.id}>
                <h3 className="text-sm font-bold text-[#1e3a5f] mb-1">{section.title}</h3>
                <p className="finance-executive-reading">{section.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-[#64748b]">Narrativa executiva indisponível.</p>
        )}

        {report.dataQuality.warnings.length > 0 ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
            <h3 className="text-sm font-bold text-amber-950 mb-2">Principais alertas</h3>
            <ul className="list-disc pl-5 text-sm text-amber-950 space-y-1">
              {report.dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </ExecutiveReportSection>

      <footer className="finance-executive-report-footer">
        Fonte: IndusCost + Nomus — dados consolidados via /api/finance/executive-report. Metas
        derivadas quando não cadastradas.
      </footer>
    </div>
  );
}
