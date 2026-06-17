import React from "react";
import type { FinanceExecutiveReport } from "@/src/lib/financeExecutiveReportTypes";
import {
  resolveExecutiveReportCriticalMonths,
  resolveExecutiveSummaryBillingByYear,
  formatExecutiveReportPresentationCurrency,
  formatExecutiveReportPresentationPercent,
  EXECUTIVE_REPORT_NO_TARGET_MESSAGE,
} from "@/src/lib/financeExecutiveReportViewModel";
import {
  mapApScheduleToChart,
  mapArScheduleToChart,
  mapBillingMultiYearToBarComparison,
  mapCashFlowTimelineToChart,
  mapRealizedProjectedChart,
  mapSalesOrdersMonthlyToChart,
  executiveReportTargetMissing,
} from "@/src/lib/financeExecutiveReportPresentation";
import { ExecutiveReportCover } from "@/src/components/finance/executive-report/ExecutiveReportCover";
import { ExecutiveReportSection } from "@/src/components/finance/executive-report/ExecutiveReportSection";
import { ExecutiveReportPageBreak } from "@/src/components/finance/executive-report/ExecutiveReportPageBreak";
import { ExecutiveKpiCard } from "@/src/components/finance/executive-report/ExecutiveKpiCard";
import { ExecutiveKpiGrid } from "@/src/components/finance/executive-report/ExecutiveKpiGrid";
import { ExecutiveNarrativeBox } from "@/src/components/finance/executive-report/ExecutiveNarrativeBox";
import { ExecutiveBarComparisonChart } from "@/src/components/finance/executive-report/charts/ExecutiveBarComparisonChart";
import { ExecutiveRealizedProjectedChart } from "@/src/components/finance/executive-report/charts/ExecutiveRealizedProjectedChart";
import { ExecutiveScheduleChart } from "@/src/components/finance/executive-report/charts/ExecutiveScheduleChart";
import { ExecutiveCashFlowChart } from "@/src/components/finance/executive-report/charts/ExecutiveCashFlowChart";
import { ExecutiveSalesOrdersChart } from "@/src/components/finance/executive-report/charts/ExecutiveSalesOrdersChart";

export function ExecutiveReportDocument({ report }: { report: FinanceExecutiveReport }) {
  const billingTab = report.billingComparison.tab;
  const billingPayload = report.billingComparison.payload;
  const projectionTab = report.billingProjection.tab;
  const arCards = report.accountsReceivable.payload.cards;
  const apCards = report.accountsPayable.payload.cards;
  const cashCards = report.cashFlow.payload.cards;
  const salesTab = report.salesOrders.tab;
  const month = report.month ?? billingPayload.currentMonth;
  const targetsDerived = report.dataQuality.targetsDerived;

  const billingByYear = resolveExecutiveSummaryBillingByYear(
    billingTab.multiYearMonthly,
    month,
    report.year
  );

  const billingComparison = mapBillingMultiYearToBarComparison(
    billingTab.multiYearMonthly,
    billingPayload.selectedYear,
    month
  );

  const realizedProjected = mapRealizedProjectedChart(projectionTab.realizedVsProjected, month);

  const arSchedule = mapArScheduleToChart(
    report.accountsReceivable.payload.monthlyDueSchedule ?? [],
    report.year,
    month
  );

  const apSchedule = mapApScheduleToChart(
    report.accountsPayable.payload.monthlyDueSchedule ?? [],
    report.year,
    month
  );

  const cashFlowChart = mapCashFlowTimelineToChart(
    report.calendarAgenda.executiveSummary?.monthlyTimeline ?? [],
    month
  );

  const salesChart = mapSalesOrdersMonthlyToChart(salesTab.monthlySeries ?? [], month);

  const criticalMonths = resolveExecutiveReportCriticalMonths(report);
  const billingTargetMissing =
    executiveReportTargetMissing(billingTab.target.target) || targetsDerived;
  const salesTargetMissing =
    executiveReportTargetMissing(salesTab.target?.target) || targetsDerived;

  return (
    <div className="finance-executive-report-document space-y-8" data-testid="executive-report-document">
      <ExecutiveReportCover cover={report.cover} generatedAt={report.generatedAt} />

      <ExecutiveReportSection
        id="summary"
        eyebrow="Visão geral"
        title="Resumo Executivo"
        subtitle="Faturamento comparativo do mês e leitura rápida"
      >
        <ExecutiveKpiGrid columns={4}>
          {billingByYear.map((row) => (
            <div key={row.year}>
              <ExecutiveKpiCard
                label={`Faturamento mês — ${row.year}`}
                value={row.formatted}
                sub={`Ano ${row.year}`}
                accent={row.year === report.year}
                highlight={row.year === report.year}
              />
            </div>
          ))}
          <ExecutiveKpiCard
            label="Atingimento meta mês"
            value={billingTab.target.formatted.achievementPercent}
            sub={
              billingTargetMissing
                ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE
                : `Meta: ${billingTab.target.formatted.target}`
            }
            accent
          />
        </ExecutiveKpiGrid>

        {report.executiveSummary.highlights.length > 0 ? (
          <div className="mt-5 space-y-3">
            {report.executiveSummary.highlights.map((line) => (
              <div key={line}>
                <ExecutiveNarrativeBox body={line} />
              </div>
            ))}
          </div>
        ) : null}
      </ExecutiveReportSection>

      <ExecutiveReportPageBreak />

      <ExecutiveReportSection
        id="billing-comparison"
        eyebrow="Faturamento"
        title="Faturamento Comparativo"
        subtitle="Evolução mensal multi-ano — fonte NF-e oficial IndusCost"
        pageBreakBefore
      >
        <ExecutiveKpiGrid columns={4}>
          <ExecutiveKpiCard
            label="Realizado mês"
            value={formatExecutiveReportPresentationCurrency(billingTab.target.actual)}
            highlight
          />
          <ExecutiveKpiCard
            label="Projetado mês"
            value={formatExecutiveReportPresentationCurrency(projectionTab.projection.projectedMonth)}
          />
          <ExecutiveKpiCard
            label="Meta mês"
            value={billingTab.target.formatted.target}
            hint={billingTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : undefined}
          />
          <ExecutiveKpiCard
            label="YTD"
            value={formatExecutiveReportPresentationCurrency(billingTab.yearComparison.yearToDateCurrent)}
            sub={`Ano ${billingPayload.selectedYear}`}
          />
        </ExecutiveKpiGrid>

        <div className="mt-6">
          <ExecutiveBarComparisonChart
            title="Faturamento mês a mês"
            subtitle="Comparativo 2024 · 2025 · 2026 — valores em R$ mil / R$ Mi"
            years={billingComparison.years}
            rows={billingComparison.rows}
            empty={!billingComparison.hasData}
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="billing-projection"
        eyebrow="Projeção"
        title="Realizado vs Projetado"
        subtitle="Média diária, faturado, projeção e meta anual"
      >
        <ExecutiveKpiGrid columns={5}>
          <ExecutiveKpiCard label="Média diária" value={projectionTab.projection.formatted.dailyAverage} />
          <ExecutiveKpiCard
            label="Faturado"
            value={projectionTab.realizedVsProjected.formatted.realized}
            highlight
          />
          <ExecutiveKpiCard
            label="Projetado"
            value={projectionTab.realizedVsProjected.formatted.projected}
          />
          <ExecutiveKpiCard
            label="Meta do ano"
            value={billingTab.yearComparison.formatted.annualTarget}
            hint={billingTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : undefined}
          />
          <ExecutiveKpiCard
            label="Atingimento"
            value={
              billingTab.target.achievementPercent != null
                ? formatExecutiveReportPresentationPercent(billingTab.target.achievementPercent, 2)
                : "—"
            }
          />
        </ExecutiveKpiGrid>

        <div className="mt-6">
          <ExecutiveRealizedProjectedChart
            title="Realizado × Projeção × Meta"
            model={realizedProjected}
            selectedYear={billingPayload.selectedYear}
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportPageBreak />

      <ExecutiveReportSection
        id="accounts-receivable"
        eyebrow="Recebíveis"
        title="Contas a Receber"
        subtitle="Base saneada Nomus — valores consolidados"
        pageBreakBefore
      >
        <ExecutiveKpiGrid columns={4}>
          <ExecutiveKpiCard
            label="A receber"
            value={formatExecutiveReportPresentationCurrency(arCards.totalAmountReceivable)}
          />
          <ExecutiveKpiCard
            label="Recebido"
            value={formatExecutiveReportPresentationCurrency(arCards.totalReceivedAmount)}
            tone="positive"
          />
          <ExecutiveKpiCard
            label="Em aberto"
            value={formatExecutiveReportPresentationCurrency(arCards.totalOpenAmount)}
          />
          <ExecutiveKpiCard
            label="Atrasados"
            value={formatExecutiveReportPresentationCurrency(arCards.overdueAmount)}
            tone="negative"
          />
        </ExecutiveKpiGrid>

        <div className="mt-6">
          <ExecutiveScheduleChart
            title="Agenda mensal — Contas a Receber"
            subtitle="Em aberto, atrasado e a vencer por mês"
            rows={arSchedule.rows}
            empty={!arSchedule.hasData}
            variant="receivable"
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="accounts-payable"
        eyebrow="Pagamentos"
        title="Contas a Pagar"
        subtitle="Base saneada Nomus — valores consolidados"
      >
        <ExecutiveKpiGrid columns={4}>
          <ExecutiveKpiCard
            label="A pagar total"
            value={formatExecutiveReportPresentationCurrency(apCards.totalPayableAmount)}
          />
          <ExecutiveKpiCard
            label="Pago"
            value={formatExecutiveReportPresentationCurrency(
              apCards.totalPayableAmount - apCards.totalOpenAmount
            )}
            tone="positive"
          />
          <ExecutiveKpiCard
            label="Em aberto"
            value={formatExecutiveReportPresentationCurrency(apCards.totalOpenAmount)}
          />
          <ExecutiveKpiCard
            label="Vencidos"
            value={formatExecutiveReportPresentationCurrency(apCards.overdueAmount)}
            tone="negative"
          />
        </ExecutiveKpiGrid>

        <div className="mt-6">
          <ExecutiveScheduleChart
            title="Agenda mensal — Contas a Pagar"
            subtitle="Em aberto, vencido e a vencer por mês"
            rows={apSchedule.rows}
            empty={!apSchedule.hasData}
            variant="payable"
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportPageBreak />

      <ExecutiveReportSection
        id="cash-flow"
        eyebrow="Caixa"
        title="Fluxo de Caixa / Agenda"
        subtitle="Entradas, saídas, saldo líquido e acumulado"
        pageBreakBefore
      >
        <ExecutiveKpiGrid columns={4}>
          <ExecutiveKpiCard
            label="Entradas previstas"
            value={formatExecutiveReportPresentationCurrency(cashCards.inflowAmount)}
            tone="positive"
          />
          <ExecutiveKpiCard
            label="Saídas previstas"
            value={formatExecutiveReportPresentationCurrency(cashCards.outflowAmount)}
            tone="negative"
          />
          <ExecutiveKpiCard
            label="Saldo líquido"
            value={formatExecutiveReportPresentationCurrency(cashCards.netFlowAmount)}
            tone={cashCards.netFlowAmount < 0 ? "negative" : "positive"}
          />
          <ExecutiveKpiCard
            label="Saldo acumulado"
            value={formatExecutiveReportPresentationCurrency(cashCards.accumulatedBalance)}
            accent
          />
        </ExecutiveKpiGrid>

        {criticalMonths.length > 0 ? (
          <div className="mt-4">
            <ExecutiveNarrativeBox
              title="Meses críticos"
              body={`Saldo negativo projetado em: ${criticalMonths.join(", ")}.`}
            />
          </div>
        ) : null}

        <div className="mt-6">
          <ExecutiveCashFlowChart
            title="Fluxo de caixa planejado"
            rows={cashFlowChart.rows}
            empty={!cashFlowChart.hasData}
          />
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportSection
        id="sales-orders"
        eyebrow="Comercial"
        title="Pedidos de Venda"
        subtitle="SalesOrder — carteira e projeção comercial"
      >
        <ExecutiveKpiGrid columns={4}>
          <ExecutiveKpiCard
            label="Realizado YTD"
            value={salesTab.summaryCards.find((c) => c.id === "realized-ytd")?.formatted ?? "—"}
          />
          <ExecutiveKpiCard
            label="Meta mês"
            value={salesTab.target?.formatted.target ?? "—"}
            hint={salesTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : undefined}
          />
          <ExecutiveKpiCard
            label="Projeção mês"
            value={salesTab.projection?.formatted.monthlyProjection ?? "—"}
          />
          <ExecutiveKpiCard
            label="Atingimento"
            value={salesTab.target?.formatted.achievementPercent ?? "—"}
            highlight
          />
        </ExecutiveKpiGrid>

        <div className="mt-6">
          {salesTab.chartSeries ? (
            <ExecutiveSalesOrdersChart
              title={`Pedidos de venda — ${report.year}`}
              rows={salesChart.rows}
              config={salesTab.chartSeries}
              empty={!salesChart.hasData}
              targetMissing={salesTargetMissing}
            />
          ) : null}
        </div>
      </ExecutiveReportSection>

      <ExecutiveReportPageBreak />

      <ExecutiveReportSection
        id="conclusion"
        eyebrow="Encerramento"
        title="Conclusão Executiva"
        subtitle="Alertas, pontos de atenção e leitura automática"
        pageBreakBefore
      >
        {report.executiveNarrative?.sections.length ? (
          <div className="space-y-4">
            {report.executiveNarrative.sections.map((section) => (
              <div key={section.id}>
                <ExecutiveNarrativeBox title={section.title} body={section.body} />
              </div>
            ))}
          </div>
        ) : (
          <ExecutiveNarrativeBox body="Narrativa executiva indisponível para os filtros aplicados." />
        )}

        {report.dataQuality.warnings.length > 0 ? (
          <div className="mt-6 executive-alerts-panel">
            <h3 className="executive-alerts-title">Principais alertas</h3>
            <ul className="executive-alerts-list">
              {report.dataQuality.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </ExecutiveReportSection>

      <footer className="finance-executive-report-footer">
        Fonte: IndusCost + Nomus — dados consolidados via /api/finance/executive-report.
      </footer>
    </div>
  );
}
