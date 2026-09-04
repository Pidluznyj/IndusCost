import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
import type {
  BillingDashboardTab,
  SalesOrdersDashboardTab,
} from "@/src/lib/executiveDashboardTypes";
import type { FinanceExecutiveReport } from "@/src/lib/financeExecutiveReportTypes";
import {
  resolveExecutiveReportCriticalMonths,
  formatExecutiveReportPresentationCurrency,
} from "@/src/lib/financeExecutiveReportViewModel";
import {
  mapAnnualComparisonToPayablesChart,
  mapAnnualComparisonToReceivablesChart,
  mapBillingMultiYearToBarComparison,
  mapSalesOrdersMonthlyToChart,
  executiveReportTargetMissing,
} from "@/src/lib/financeExecutiveReportPresentation";
import type { ExecutiveAnnualFlowChartRow } from "@/src/lib/financeExecutiveReportPresentation";
import {
  buildExecutiveReportBillingKpis,
  buildExecutiveReportCashFlowKpis,
  buildExecutiveReportSalesOrdersKpis,
  type ExecutiveReportVariation,
  type ExecutiveReportVariationTone,
} from "@/src/lib/financeExecutiveReportSectionKpis";
import { buildExecutiveChartNarrative } from "@/src/lib/financeExecutiveChartNarratives";
import { ExecutiveReportCover } from "@/src/components/finance/executive-report/ExecutiveReportCover";
import { ExecutiveReportPrintCover } from "@/src/components/finance/executive-report/ExecutiveReportPrintCover";
import { ExecutivePrintPageShell } from "@/src/components/finance/executive-report/ExecutivePrintPageShell";
import { ExecutiveReportSection } from "@/src/components/finance/executive-report/ExecutiveReportSection";
import { ExecutiveKpiCard } from "@/src/components/finance/executive-report/ExecutiveKpiCard";
import { ExecutiveKpiGrid } from "@/src/components/finance/executive-report/ExecutiveKpiGrid";
import { ExecutiveNarrativeBox } from "@/src/components/finance/executive-report/ExecutiveNarrativeBox";
import { ExecutiveNarrativeBullets } from "@/src/components/finance/executive-report/ExecutiveNarrativeBullets";
import { ExecutiveBarComparisonChart } from "@/src/components/finance/executive-report/charts/ExecutiveBarComparisonChart";
import { ExecutiveCashFlowChart } from "@/src/components/finance/executive-report/charts/ExecutiveCashFlowChart";
import { ExecutiveSalesOrdersChart } from "@/src/components/finance/executive-report/charts/ExecutiveSalesOrdersChart";
import { ExecutiveReportReceivablesChart } from "@/src/components/finance/executive-report/charts/ExecutiveReportReceivablesChart";
import { ExecutiveReportPayablesChart } from "@/src/components/finance/executive-report/charts/ExecutiveReportPayablesChart";
import { ExecutiveCostCenterTopCardsGrid } from "@/src/components/finance/executive-report/ExecutiveCostCenterTopCardsGrid";
import { ExecutiveReportDocumentFooter } from "@/src/components/finance/executive-report/ExecutiveReportDocumentFooter";
import { FinanceCashFlowMonthlyTimelineTable } from "@/src/components/finance/cash-flow/FinanceCashFlowMonthlyTimelineTable";
import { ExecutiveReportCashRadarSection } from "@/src/components/finance/executive-report/ExecutiveReportCashRadarSection";
import { ExecutiveReportPeriodMeta } from "@/src/components/finance/executive-report/ExecutiveReportPeriodMeta";
import {
  buildExecutiveReportCashFlowPeriodCopy,
  buildExecutiveReportCashFlowScenarioReading,
} from "@/src/lib/financeExecutiveReportCashFlowPeriodCopy";
import {
  EXECUTIVE_REPORT_SECTION_INTROS,
  EXECUTIVE_REPORT_SECTION_SUBTITLES,
  EXECUTIVE_REPORT_AUTO_TARGET_SHORT,
  formatExecutiveReportBillingYearsSubtitle,
  getExecutiveReportKpiHint,
  presentExecutiveReportNarrativeBullets,
} from "@/src/lib/financeExecutiveReportUxCopy";

function printTargetHint(missing: boolean, fallback?: string): string | undefined {
  if (missing) return EXECUTIVE_REPORT_AUTO_TARGET_SHORT;
  return fallback;
}

function kpiHint(label: string): string | undefined {
  return getExecutiveReportKpiHint(label);
}

function mapVariationTone(
  tone: ExecutiveReportVariationTone
): "default" | "positive" | "negative" | "neutral" {
  if (tone === "positive") return "positive";
  if (tone === "negative") return "negative";
  if (tone === "warning" || tone === "target" || tone === "reference" || tone === "accent") {
    return "neutral";
  }
  return "neutral";
}

function VariationKpiCard({ label, variation }: { label: string; variation: ExecutiveReportVariation }) {
  return (
    <ExecutiveKpiCard
      label={label}
      value={variation.formattedAbsolute}
      sub={variation.formattedPercent}
      hint={kpiHint(label)}
      tooltip={kpiHint(label)}
      tone={mapVariationTone(variation.tone)}
    />
  );
}

function mapReceivablesRowsForNarrative(
  rows: ExecutiveAnnualFlowChartRow[],
  overdueAmount: number
) {
  return rows.map((row) => ({
    month: row.month,
    monthLabel: row.monthLabel,
    isCurrentMonth: row.isCurrentMonth,
    openAmount: row.receivableOpenAmount,
    overdueAmount: row.isCurrentMonth ? overdueAmount : 0,
    upcomingAmount: row.receivedAmount,
  }));
}

function mapPayablesRowsForNarrative(
  rows: ReturnType<typeof mapAnnualComparisonToPayablesChart>["rows"],
  overdueAmount: number
) {
  return rows.map((row) => ({
    month: row.month,
    monthLabel: row.monthLabel,
    isCurrentMonth: row.isCurrentMonth,
    openAmount: row.payableOpenAmount,
    overdueAmount: row.isCurrentMonth ? overdueAmount : 0,
    upcomingAmount: row.paidAmount,
  }));
}

export function ExecutiveReportDocument({
  report,
  branding,
  reportQuery = "",
}: {
  report: FinanceExecutiveReport;
  branding: BrandingSettingsDTO;
  reportQuery?: string;
}) {
  const billingTab = report.billingComparison.tab;
  const billingPayload = report.billingComparison.payload;
  const arCards = report.accountsReceivable.payload.cards;
  const apCards = report.accountsPayable.payload.cards;
  const salesTab = report.salesOrders.tab;
  const month = report.month ?? billingPayload.currentMonth;
  const previousYear = report.year - 1;
  const targetsDerived = report.dataQuality.targetsDerived;

  const printHeader = {
    branding,
    periodLabel: report.cover.periodLabel,
    reportDateLabel: report.cover.reportDateLabel,
    companyLabel: report.cover.companyLabel ?? "Consolidado",
  };

  const salesKpis = buildExecutiveReportSalesOrdersKpis(salesTab as SalesOrdersDashboardTab, month);
  const billingKpis = buildExecutiveReportBillingKpis(billingTab as BillingDashboardTab, month);
  const arKpis = report.accountsReceivable.kpis;
  const apKpis = report.accountsPayable.kpis;
  const cashFlowKpis = buildExecutiveReportCashFlowKpis(report.calendarAgenda.annualChart, report.year);
  const cashFlowPeriodCopy = buildExecutiveReportCashFlowPeriodCopy(report);

  const billingComparison = mapBillingMultiYearToBarComparison(
    billingTab.multiYearMonthly,
    billingPayload.selectedYear,
    month
  );

  const arReceivablesChart = mapAnnualComparisonToReceivablesChart(
    report.annualComparison.currentYear,
    month
  );

  const apPayablesChart = mapAnnualComparisonToPayablesChart(
    report.annualComparison.currentYear,
    month
  );

  const cashFlowChart = {
    rows: report.calendarAgenda.annualChart.points,
    hasData: report.calendarAgenda.annualChart.hasData,
  };

  const cashFlowMonthlyTimeline = report.calendarAgenda.executiveSummary?.monthlyTimeline ?? [];

  const salesChart = mapSalesOrdersMonthlyToChart(salesTab.monthlySeries ?? [], month);

  const criticalMonths = resolveExecutiveReportCriticalMonths(report);
  const billingTargetMissing =
    executiveReportTargetMissing(billingTab.target.target) || targetsDerived;
  const salesTargetMissing =
    executiveReportTargetMissing(salesTab.target?.target) || targetsDerived;

  const summaryBullets = presentExecutiveReportNarrativeBullets({
    highlights: report.executiveSummary.highlights,
    narrative: report.executiveNarrative,
    warnings: report.dataQuality.warnings,
  });

  const billingChartNarrative = buildExecutiveChartNarrative("billing-comparison", {
    billingComparison: {
      rows: billingComparison.rows,
      selectedYear: billingPayload.selectedYear,
      currentMonth: month,
      target: billingTab.target.target,
      actual: billingTab.target.actual,
    },
  });

  const arChartNarrative = buildExecutiveChartNarrative("accounts-receivable", {
    arSchedule: mapReceivablesRowsForNarrative(arReceivablesChart.rows, arKpis.overdueAmount),
  });

  const apChartNarrative = buildExecutiveChartNarrative("accounts-payable", {
    apSchedule: mapPayablesRowsForNarrative(apPayablesChart.rows, apKpis.overdueAmount),
  });

  const cashFlowChartNarrative = buildExecutiveChartNarrative("cash-flow", {
    cashFlow: cashFlowChart.rows,
  });
  const cashFlowScenarioReading = buildExecutiveReportCashFlowScenarioReading({
    periodCopy: cashFlowPeriodCopy,
    netTotal: cashFlowKpis.netTotal,
    chartNarrative: cashFlowChartNarrative,
  });

  const salesChartNarrative = buildExecutiveChartNarrative("sales-orders", {
    salesOrders: {
      rows: salesChart.rows,
      target: salesTab.target?.target ?? null,
      actual: salesTab.target?.actual ?? null,
      currentMonth: month,
    },
  });

  return (
    <div
      className="executive-report-print-root finance-executive-report-document"
      data-testid="executive-report-document"
      data-report-ready="false"
    >
      <ExecutivePrintPageShell pageId="cover" pageNumber={1} cover generatedAt={report.generatedAt}>
        <div className="executive-report-screen-cover">
          <ExecutiveReportCover cover={report.cover} generatedAt={report.generatedAt} />
        </div>
        <ExecutiveReportPrintCover
          cover={report.cover}
          generatedAt={report.generatedAt}
          branding={branding}
        />
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="summary"
        pageNumber={2}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="summary"
          eyebrow="Visão geral"
          title="Resumo Executivo"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES.summary}
          intro={EXECUTIVE_REPORT_SECTION_INTROS.summary}
        >
          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Pedidos mês"
              value={formatExecutiveReportPresentationCurrency(salesKpis.monthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Vendido no mês")}
              tooltip={kpiHint("Vendido no mês")}
              highlight
            />
            <ExecutiveKpiCard
              label="Pedidos YTD"
              value={formatExecutiveReportPresentationCurrency(salesKpis.ytdCurrent)}
              sub={`Até mês ${month}`}
              hint={kpiHint("Realizado YTD")}
              tooltip={kpiHint("Realizado YTD")}
            />
            <ExecutiveKpiCard
              label="Faturamento mês"
              value={formatExecutiveReportPresentationCurrency(billingKpis.monthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Faturamento mês")}
              tooltip={kpiHint("Faturamento mês")}
              accent
            />
            <ExecutiveKpiCard
              label="Faturamento YTD"
              value={formatExecutiveReportPresentationCurrency(billingKpis.ytdCurrent)}
              sub={`Até mês ${month}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="AR aberto"
              value={formatExecutiveReportPresentationCurrency(arCards.totalOpenAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="AP aberto"
              value={formatExecutiveReportPresentationCurrency(apCards.totalOpenAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Saldo planejado ano"
              value={formatExecutiveReportPresentationCurrency(cashFlowKpis.finalAccumulated)}
              sub={`Projeção ${report.year}`}
              hint={kpiHint("Saldo acumulado")}
              tooltip={kpiHint("Saldo acumulado")}
              tone={cashFlowKpis.finalAccumulated < 0 ? "negative" : "positive"}
            />
          </ExecutiveKpiGrid>

          {summaryBullets.length > 0 ? (
            <div className="mt-5">
              <ExecutiveNarrativeBullets title="Leitura rápida" bullets={summaryBullets} />
            </div>
          ) : null}
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="sales-orders"
        pageNumber={3}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="sales-orders"
          eyebrow="Comercial"
          title="Pedidos de Venda"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["sales-orders"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["sales-orders"]}
          withChart
        >
          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Pedidos mês"
              value={formatExecutiveReportPresentationCurrency(salesKpis.monthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Vendido no mês")}
              tooltip={kpiHint("Vendido no mês")}
              highlight
            />
            <ExecutiveKpiCard
              label="Pedidos mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(salesKpis.monthPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("Vendido no mês")}
              tooltip={kpiHint("Vendido no mês")}
            />
            <VariationKpiCard label="Variação mês" variation={salesKpis.monthVariation} />
            <ExecutiveKpiCard
              label="Pedidos YTD"
              value={formatExecutiveReportPresentationCurrency(salesKpis.ytdCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Realizado YTD")}
              tooltip={kpiHint("Realizado YTD")}
            />
            <ExecutiveKpiCard
              label="Pedidos YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(salesKpis.ytdPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("Realizado YTD")}
              tooltip={kpiHint("Realizado YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={salesKpis.ytdVariation} />
            <ExecutiveKpiCard
              label="Meta mês"
              value={
                salesKpis.target != null
                  ? formatExecutiveReportPresentationCurrency(salesKpis.target)
                  : "—"
              }
              hint={printTargetHint(salesTargetMissing, kpiHint("Meta mês"))}
              tooltip={kpiHint("Meta mês")}
            />
            <ExecutiveKpiCard
              label="Projeção mês"
              value={
                salesKpis.projection != null
                  ? formatExecutiveReportPresentationCurrency(salesKpis.projection)
                  : "—"
              }
              hint={kpiHint("Projeção mês")}
              tooltip={kpiHint("Projeção mês")}
            />
          </ExecutiveKpiGrid>

          <div className="mt-3 executive-chart-region">
            {salesTab.chartSeries ? (
              <ExecutiveSalesOrdersChart
                title={`Pedidos de venda — ${report.year}`}
                rows={salesChart.rows}
                config={salesTab.chartSeries}
                empty={!salesChart.hasData}
                targetMissing={salesTargetMissing}
                scenarioText={salesChartNarrative}
              />
            ) : null}
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="billing-comparison"
        pageNumber={4}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="billing-comparison"
          eyebrow="Faturamento"
          title="Faturamento Comparativo"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["billing-comparison"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["billing-comparison"]}
          withChart
        >
          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Faturamento mês"
              value={formatExecutiveReportPresentationCurrency(billingKpis.monthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Faturamento mês")}
              tooltip={kpiHint("Faturamento mês")}
              highlight
            />
            <ExecutiveKpiCard
              label="Faturamento mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(billingKpis.monthPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("Faturamento mês")}
              tooltip={kpiHint("Faturamento mês")}
            />
            <VariationKpiCard label="Variação mês" variation={billingKpis.monthVariation} />
            <ExecutiveKpiCard
              label="Faturamento YTD"
              value={formatExecutiveReportPresentationCurrency(billingKpis.ytdCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="Faturamento YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(billingKpis.ytdPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={billingKpis.ytdVariation} />
            <ExecutiveKpiCard
              label="Meta mês"
              value={
                billingKpis.target != null
                  ? formatExecutiveReportPresentationCurrency(billingKpis.target)
                  : "—"
              }
              hint={printTargetHint(billingTargetMissing, kpiHint("Meta mês"))}
              tooltip={kpiHint("Meta mês")}
            />
            <ExecutiveKpiCard
              label="Projeção mês"
              value={
                billingKpis.projection != null
                  ? formatExecutiveReportPresentationCurrency(billingKpis.projection)
                  : "—"
              }
              hint={kpiHint("Projetado mês")}
              tooltip={kpiHint("Projetado mês")}
            />
          </ExecutiveKpiGrid>

          <div className="mt-3 executive-chart-region">
            <ExecutiveBarComparisonChart
              title="Faturamento mês a mês"
              subtitle={formatExecutiveReportBillingYearsSubtitle(
                billingComparison.years.map((y) => y.year)
              )}
              years={billingComparison.years}
              rows={billingComparison.rows}
              empty={!billingComparison.hasData}
              scenarioText={billingChartNarrative}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="accounts-receivable"
        pageNumber={5}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="accounts-receivable"
          eyebrow="Recebíveis"
          title="Contas a Receber"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["accounts-receivable"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["accounts-receivable"]}
          withChart
        >
          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Recebido mês"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedMonthCurrent)}
              sub={`${String(month).padStart(2, "0")}/${report.year}`}
              hint={kpiHint("Recebido")}
              highlight
            />
            <VariationKpiCard label="Variação mês" variation={arKpis.receivedMonthVariation} />
            <ExecutiveKpiCard
              label="Recebido YTD"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedYtdCurrent)}
              sub={`Até mês ${month}`}
              hint={kpiHint("YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={arKpis.receivedYtdVariation} />
            <ExecutiveKpiCard
              label="Recebido mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedMonthPrevious)}
              sub={`${String(month).padStart(2, "0")}/${previousYear}`}
              hint={kpiHint("Recebido")}
            />
            <ExecutiveKpiCard
              label="Recebido YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedYtdPrevious)}
              sub={`Até mês ${month}`}
              hint={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(arKpis.openAmount)}
              hint={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Atrasados"
              value={formatExecutiveReportPresentationCurrency(arKpis.overdueAmount)}
              hint={kpiHint("Atrasados")}
              tone="negative"
            />
          </ExecutiveKpiGrid>

          <div className="mt-3 executive-chart-region">
            <ExecutiveReportReceivablesChart
              title="Recebimentos e saldo a receber — ano"
              subtitle={`Realizado e em aberto por mês — ${report.year}`}
              rows={arReceivablesChart.rows}
              empty={!arReceivablesChart.hasData}
              scenarioText={arChartNarrative}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="accounts-payable"
        pageNumber={6}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="accounts-payable"
          eyebrow="Pagamentos"
          title="Contas a Pagar"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["accounts-payable"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["accounts-payable"]}
          withChart
        >
          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Total a pagar"
              value={formatExecutiveReportPresentationCurrency(apKpis.totalPayableAmount)}
              hint={kpiHint("Total a pagar")}
            />
            <ExecutiveKpiCard
              label="Pago no mês"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidMonthCurrent)}
              sub={`Mês de ${String(month).padStart(2, "0")}/${report.year}`}
              hint={kpiHint("Pago")}
              highlight
            />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(apKpis.openAmount)}
              hint={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Vencido gerencial"
              value={formatExecutiveReportPresentationCurrency(apKpis.overdueAmount)}
              hint={kpiHint("Vencido gerencial")}
              tone="negative"
            />
            <ExecutiveKpiCard
              label="Vence hoje"
              value={formatExecutiveReportPresentationCurrency(apKpis.dueTodayAmount)}
              hint={kpiHint("Vence hoje")}
            />
            <ExecutiveKpiCard
              label="Próx. 7 dias"
              value={formatExecutiveReportPresentationCurrency(apKpis.dueNext7DaysAmount)}
              hint={kpiHint("Próx. 7 dias")}
            />
            <ExecutiveKpiCard
              label="Próx. 30 dias"
              value={formatExecutiveReportPresentationCurrency(apKpis.dueNext30DaysAmount)}
              hint={kpiHint("Próx. 30 dias")}
            />
            <ExecutiveKpiCard
              label="Agendados"
              value={formatExecutiveReportPresentationCurrency(apKpis.scheduledOpenAmount)}
              hint={kpiHint("Agendados")}
            />
          </ExecutiveKpiGrid>

          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact mt-2">
            <ExecutiveKpiCard
              label="Pago mês atual"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidMonthCurrent)}
              sub={`${String(month).padStart(2, "0")}/${report.year}`}
              hint={kpiHint("Pago")}
            />
            <ExecutiveKpiCard
              label="Pago mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidMonthPrevious)}
              sub={`${String(month).padStart(2, "0")}/${previousYear}`}
              hint={kpiHint("Pago")}
            />
            <VariationKpiCard label="Variação mês" variation={apKpis.paidMonthVariation} />
            <ExecutiveKpiCard
              label="Pago YTD"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidYtdCurrent)}
              sub={`Até mês ${month}`}
              hint={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="Pago YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidYtdPrevious)}
              sub={`Até mês ${month}`}
              hint={kpiHint("YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={apKpis.paidYtdVariation} />
          </ExecutiveKpiGrid>

          <div className="mt-3 executive-chart-region">
            <ExecutiveReportPayablesChart
              title="Pagamentos e saldo a pagar — ano"
              subtitle={`Realizado e em aberto por mês — ${report.year}`}
              rows={apPayablesChart.rows}
              empty={!apPayablesChart.hasData}
              scenarioText={apChartNarrative}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="cash-flow"
        pageNumber={7}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="cash-flow"
          eyebrow="Caixa"
          title="Fluxo de Caixa / Agenda"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["cash-flow"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["cash-flow"]}
          withChart
        >
          <ExecutiveReportPeriodMeta testId="executive-report-cash-flow-period-meta">
            {cashFlowPeriodCopy.metadataLine}
          </ExecutiveReportPeriodMeta>

          <ExecutiveKpiGrid columns={4} className="executive-kpi-grid--compact">
            <ExecutiveKpiCard
              label="Entradas previstas"
              value={formatExecutiveReportPresentationCurrency(cashFlowKpis.totalInflow)}
              sub={cashFlowPeriodCopy.cardSubs.inflow}
              hint={cashFlowPeriodCopy.cardHints.inflow}
              tooltip={cashFlowPeriodCopy.cardHints.inflow}
              tone="positive"
            />
            <ExecutiveKpiCard
              label="Saídas previstas"
              value={formatExecutiveReportPresentationCurrency(cashFlowKpis.totalOutflow)}
              sub={cashFlowPeriodCopy.cardSubs.outflow}
              hint={cashFlowPeriodCopy.cardHints.outflow}
              tooltip={cashFlowPeriodCopy.cardHints.outflow}
              tone="negative"
            />
            <ExecutiveKpiCard
              label="Saldo líquido"
              value={formatExecutiveReportPresentationCurrency(cashFlowKpis.netTotal)}
              sub={cashFlowPeriodCopy.cardSubs.net}
              hint={cashFlowPeriodCopy.cardHints.net}
              tooltip={cashFlowPeriodCopy.cardHints.net}
              tone={cashFlowKpis.netTotal < 0 ? "negative" : "positive"}
            />
            <ExecutiveKpiCard
              label="Saldo acumulado"
              value={formatExecutiveReportPresentationCurrency(cashFlowKpis.finalAccumulated)}
              sub={cashFlowPeriodCopy.cardSubs.accumulated}
              hint={cashFlowPeriodCopy.cardHints.accumulated}
              tooltip={cashFlowPeriodCopy.cardHints.accumulated}
              accent
            />
          </ExecutiveKpiGrid>

          {criticalMonths.length > 0 ? (
            <div className="mt-4">
              <ExecutiveNarrativeBox
                title="Meses críticos"
                body="Fluxo previsto exige atenção nos próximos meses."
              />
            </div>
          ) : null}

          <div className="mt-3 executive-chart-region">
            <ExecutiveCashFlowChart
              year={report.year}
              rows={cashFlowChart.rows}
              empty={!cashFlowChart.hasData}
              title={cashFlowPeriodCopy.chartTitle}
              subtitle={cashFlowPeriodCopy.chartSubtitle}
              scenarioText={cashFlowScenarioReading}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="cost-center-spending"
        pageNumber={8}
        allowContentFlow
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="cost-center-spending"
          eyebrow="Centro de Custo"
          title="Principais Centros de Custo"
          subtitle="Top 12 centros por valor no período filtrado"
          intro={EXECUTIVE_REPORT_SECTION_INTROS["cost-center-spending"]}
        >
          <div className="mt-3">
            <ExecutiveCostCenterTopCardsGrid
              topCards={report.costCenterSpending.topCards}
              summary={report.costCenterSpending.summary}
              totals={report.costCenterSpending.totals}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="cash-flow-monthly-timeline"
        pageNumber={9}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <div className="executive-print-monthly-timeline" data-testid="executive-report-monthly-timeline">
          <FinanceCashFlowMonthlyTimelineTable rows={cashFlowMonthlyTimeline} year={report.year} />
        </div>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="cash-radar"
        pageNumber={10}
        allowContentFlow
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="cash-radar"
          className="executive-section--cash-radar"
          eyebrow="Fluxo de Caixa"
          title="Radar Diário de Caixa"
          subtitle="Comparativo diário de entradas e saídas conforme os filtros do Relatório Presidencial."
          intro="Horizonte de vencimentos AR/AP abertos a partir da data-base operacional."
        >
          <ExecutiveReportCashRadarSection
            cashRadar={report.cashRadar}
            reportQuery={reportQuery}
            showHeader={false}
          />
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutiveReportDocumentFooter generatedAt={report.generatedAt} />
    </div>
  );
}
