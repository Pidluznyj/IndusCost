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
  buildExecutiveReportApKpis,
  buildExecutiveReportArKpis,
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
import { ExecutiveReportDocumentFooter } from "@/src/components/finance/executive-report/ExecutiveReportDocumentFooter";
import { ExecutiveReportPeriodMeta } from "@/src/components/finance/executive-report/ExecutiveReportPeriodMeta";
import {
  buildExecutiveReportCashFlowPeriodCopy,
  buildExecutiveReportCashFlowScenarioReading,
} from "@/src/lib/financeExecutiveReportCashFlowPeriodCopy";
import {
  EXECUTIVE_REPORT_SECTION_INTROS,
  EXECUTIVE_REPORT_SECTION_SUBTITLES,
  EXECUTIVE_REPORT_AUTO_TARGET_SHORT,
  EXECUTIVE_REPORT_PRINT_DATA_NOTE,
  formatExecutiveReportBillingYearsSubtitle,
  getExecutiveReportKpiHint,
  presentExecutiveReportNarrativeBullets,
  simplifyExecutiveHighlight,
  translateExecutiveReportWarning,
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

function resolvePrincipalAlerta(report: FinanceExecutiveReport): string {
  const warning = report.dataQuality.warnings[0];
  if (warning) return translateExecutiveReportWarning(warning);

  const highlight = report.executiveSummary.highlights[0];
  if (highlight) return simplifyExecutiveHighlight(highlight);

  const narrative = report.executiveNarrative?.sections[0]?.body;
  if (narrative) return simplifyExecutiveHighlight(narrative);

  return "Sem alertas relevantes para o período.";
}

export function ExecutiveReportDocument({
  report,
  branding,
}: {
  report: FinanceExecutiveReport;
  branding: BrandingSettingsDTO;
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
  const arKpis = buildExecutiveReportArKpis({
    currentYear: report.annualComparison.currentYear,
    previousYear: report.annualComparison.previousYear,
    cards: arCards,
    month,
  });
  const apKpis = buildExecutiveReportApKpis({
    currentYear: report.annualComparison.currentYear,
    previousYear: report.annualComparison.previousYear,
    cards: apCards,
    month,
  });
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

  const conclusionBullets = presentExecutiveReportNarrativeBullets({
    narrative: report.executiveNarrative,
  });

  const principalAlerta = resolvePrincipalAlerta(report);

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
          <ExecutiveKpiGrid columns={4}>
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
            <ExecutiveKpiCard
              label="Principal alerta"
              value={principalAlerta}
              hint="Leitura prioritária para decisão no período."
              tooltip="Leitura prioritária para decisão no período."
              tone="neutral"
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
        >
          <ExecutiveKpiGrid columns={4}>
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

          <div className="mt-6 executive-chart-region">
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
        >
          <ExecutiveKpiGrid columns={4}>
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

          <div className="mt-6 executive-chart-region">
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
        >
          <ExecutiveKpiGrid columns={4}>
            <ExecutiveKpiCard
              label="Recebido mês"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedMonthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Recebido")}
              tooltip={kpiHint("Recebido")}
              highlight
            />
            <ExecutiveKpiCard
              label="Recebido mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedMonthPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("Recebido")}
              tooltip={kpiHint("Recebido")}
            />
            <VariationKpiCard label="Variação mês" variation={arKpis.receivedMonthVariation} />
            <ExecutiveKpiCard
              label="Recebido YTD"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedYtdCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="Recebido YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(arKpis.receivedYtdPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={arKpis.receivedYtdVariation} />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(arKpis.openAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Atrasados"
              value={formatExecutiveReportPresentationCurrency(arKpis.overdueAmount)}
              hint={kpiHint("Atrasados")}
              tooltip={kpiHint("Atrasados")}
              tone="negative"
            />
          </ExecutiveKpiGrid>

          <div className="mt-6 executive-chart-region">
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
        >
          <ExecutiveKpiGrid columns={4}>
            <ExecutiveKpiCard
              label="Pago mês"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidMonthCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("Pago")}
              tooltip={kpiHint("Pago")}
              highlight
            />
            <ExecutiveKpiCard
              label="Pago mês — ano anterior"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidMonthPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("Pago")}
              tooltip={kpiHint("Pago")}
            />
            <VariationKpiCard label="Variação mês" variation={apKpis.paidMonthVariation} />
            <ExecutiveKpiCard
              label="Pago YTD"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidYtdCurrent)}
              sub={`Ano ${report.year}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <ExecutiveKpiCard
              label="Pago YTD — ano anterior"
              value={formatExecutiveReportPresentationCurrency(apKpis.paidYtdPrevious)}
              sub={`Ano ${previousYear}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
            <VariationKpiCard label="Variação YTD" variation={apKpis.paidYtdVariation} />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(apKpis.openAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Vencidos"
              value={formatExecutiveReportPresentationCurrency(apKpis.overdueAmount)}
              hint={kpiHint("Vencidos")}
              tooltip={kpiHint("Vencidos")}
              tone="negative"
            />
          </ExecutiveKpiGrid>

          <div className="mt-6 executive-chart-region">
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
        >
          <ExecutiveReportPeriodMeta testId="executive-report-cash-flow-period-meta">
            {cashFlowPeriodCopy.metadataLine}
          </ExecutiveReportPeriodMeta>

          <ExecutiveKpiGrid columns={4}>
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

          <div className="mt-6 executive-chart-region">
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
        pageId="conclusion"
        pageNumber={8}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="conclusion"
          eyebrow="Encerramento"
          title="Conclusão Executiva"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES.conclusion}
          intro={EXECUTIVE_REPORT_SECTION_INTROS.conclusion}
        >
          <ExecutiveNarrativeBullets
            title="Principais pontos"
            bullets={conclusionBullets}
            emptyMessage="Sem leitura executiva para os filtros aplicados."
          />

          <p className="executive-print-conclusion-note">{EXECUTIVE_REPORT_PRINT_DATA_NOTE}</p>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutiveReportDocumentFooter generatedAt={report.generatedAt} />
    </div>
  );
}
