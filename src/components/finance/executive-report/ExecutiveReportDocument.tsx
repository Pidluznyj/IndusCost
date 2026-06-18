import React from "react";
import type { BrandingSettingsDTO } from "@/src/types/branding";
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
import { ExecutiveReportPrintCover } from "@/src/components/finance/executive-report/ExecutiveReportPrintCover";
import { ExecutivePrintPageShell } from "@/src/components/finance/executive-report/ExecutivePrintPageShell";
import { ExecutivePrintDataQualityNote } from "@/src/components/finance/executive-report/ExecutivePrintDataQualityNote";
import { ExecutiveReportSection } from "@/src/components/finance/executive-report/ExecutiveReportSection";
import { ExecutiveKpiCard } from "@/src/components/finance/executive-report/ExecutiveKpiCard";
import { ExecutiveKpiGrid } from "@/src/components/finance/executive-report/ExecutiveKpiGrid";
import { ExecutiveNarrativeBox } from "@/src/components/finance/executive-report/ExecutiveNarrativeBox";
import { ExecutiveNarrativeBullets } from "@/src/components/finance/executive-report/ExecutiveNarrativeBullets";
import { ExecutiveBarComparisonChart } from "@/src/components/finance/executive-report/charts/ExecutiveBarComparisonChart";
import { ExecutiveRealizedProjectedChart } from "@/src/components/finance/executive-report/charts/ExecutiveRealizedProjectedChart";
import { ExecutiveScheduleChart } from "@/src/components/finance/executive-report/charts/ExecutiveScheduleChart";
import { ExecutiveCashFlowChart } from "@/src/components/finance/executive-report/charts/ExecutiveCashFlowChart";
import { ExecutiveSalesOrdersChart } from "@/src/components/finance/executive-report/charts/ExecutiveSalesOrdersChart";
import { ExecutiveReportDocumentFooter } from "@/src/components/finance/executive-report/ExecutiveReportDocumentFooter";
import {
  EXECUTIVE_REPORT_SECTION_INTROS,
  EXECUTIVE_REPORT_SECTION_SUBTITLES,
  formatExecutiveReportBillingYearsSubtitle,
  formatExecutiveReportGeneratedFooter,
  getExecutiveReportKpiHint,
  presentExecutiveReportNarrativeBullets,
} from "@/src/lib/financeExecutiveReportUxCopy";

function kpiHint(label: string): string | undefined {
  return getExecutiveReportKpiHint(label);
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
  const projectionTab = report.billingProjection.tab;
  const arCards = report.accountsReceivable.payload.cards;
  const apCards = report.accountsPayable.payload.cards;
  const cashCards = report.cashFlow.payload.cards;
  const salesTab = report.salesOrders.tab;
  const month = report.month ?? billingPayload.currentMonth;
  const targetsDerived = report.dataQuality.targetsDerived;

  const printHeader = {
    branding,
    periodLabel: report.cover.periodLabel,
    reportDateLabel: report.cover.reportDateLabel,
    companyLabel: report.cover.companyLabel ?? "Consolidado",
  };

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

  const summaryBullets = presentExecutiveReportNarrativeBullets({
    highlights: report.executiveSummary.highlights,
    narrative: report.executiveNarrative,
    warnings: report.dataQuality.warnings,
  });

  const conclusionBullets = presentExecutiveReportNarrativeBullets({
    narrative: report.executiveNarrative,
    warnings: report.dataQuality.warnings,
  });

  return (
    <div
      className="executive-report-print-root finance-executive-report-document"
      data-testid="executive-report-document"
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
            {billingByYear.map((row) => (
              <div key={row.year}>
                <ExecutiveKpiCard
                  label={`Faturamento mês — ${row.year}`}
                  value={row.formatted}
                  sub={`Ano ${row.year}`}
                  hint={kpiHint(`Faturamento mês — ${row.year}`)}
                  tooltip={kpiHint(`Faturamento mês — ${row.year}`)}
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
              hint={kpiHint("Atingimento meta mês")}
              tooltip={kpiHint("Atingimento meta mês")}
              accent
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
        pageId="billing-comparison"
        pageNumber={3}
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
              label="Realizado mês"
              value={formatExecutiveReportPresentationCurrency(billingTab.target.actual)}
              hint={kpiHint("Realizado mês")}
              tooltip={kpiHint("Realizado mês")}
              highlight
            />
            <ExecutiveKpiCard
              label="Projetado mês"
              value={formatExecutiveReportPresentationCurrency(projectionTab.projection.projectedMonth)}
              hint={kpiHint("Projetado mês")}
              tooltip={kpiHint("Projetado mês")}
            />
            <ExecutiveKpiCard
              label="Meta mês"
              value={billingTab.target.formatted.target}
              hint={billingTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : kpiHint("Meta mês")}
              tooltip={kpiHint("Meta mês")}
            />
            <ExecutiveKpiCard
              label="YTD"
              value={formatExecutiveReportPresentationCurrency(billingTab.yearComparison.yearToDateCurrent)}
              sub={`Ano ${billingPayload.selectedYear}`}
              hint={kpiHint("YTD")}
              tooltip={kpiHint("YTD")}
            />
          </ExecutiveKpiGrid>

          <div className="mt-6">
            <ExecutiveBarComparisonChart
              title="Faturamento mês a mês"
              subtitle={formatExecutiveReportBillingYearsSubtitle(
                billingComparison.years.map((y) => y.year)
              )}
              years={billingComparison.years}
              rows={billingComparison.rows}
              empty={!billingComparison.hasData}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="billing-projection"
        pageNumber={4}
        header={printHeader}
        generatedAt={report.generatedAt}
      >
        <ExecutiveReportSection
          id="billing-projection"
          eyebrow="Projeção"
          title="Realizado vs Projetado"
          subtitle={EXECUTIVE_REPORT_SECTION_SUBTITLES["billing-projection"]}
          intro={EXECUTIVE_REPORT_SECTION_INTROS["billing-projection"]}
        >
          <ExecutiveKpiGrid columns={5}>
            <ExecutiveKpiCard
              label="Média diária"
              value={projectionTab.projection.formatted.dailyAverage}
              hint={kpiHint("Média diária")}
              tooltip={kpiHint("Média diária")}
            />
            <ExecutiveKpiCard
              label="Faturado"
              value={projectionTab.realizedVsProjected.formatted.realized}
              hint={kpiHint("Faturado")}
              tooltip={kpiHint("Faturado")}
              highlight
            />
            <ExecutiveKpiCard
              label="Projetado"
              value={projectionTab.realizedVsProjected.formatted.projected}
              hint={kpiHint("Projetado")}
              tooltip={kpiHint("Projetado")}
            />
            <ExecutiveKpiCard
              label="Meta do ano"
              value={billingTab.yearComparison.formatted.annualTarget}
              hint={billingTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : kpiHint("Meta do ano")}
              tooltip={kpiHint("Meta do ano")}
            />
            <ExecutiveKpiCard
              label="Atingimento"
              value={
                billingTab.target.achievementPercent != null
                  ? formatExecutiveReportPresentationPercent(billingTab.target.achievementPercent, 2)
                  : "—"
              }
              hint={kpiHint("Atingimento")}
              tooltip={kpiHint("Atingimento")}
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
              label="A receber"
              value={formatExecutiveReportPresentationCurrency(arCards.totalAmountReceivable)}
              hint={kpiHint("A receber")}
              tooltip={kpiHint("A receber")}
            />
            <ExecutiveKpiCard
              label="Recebido"
              value={formatExecutiveReportPresentationCurrency(arCards.totalReceivedAmount)}
              hint={kpiHint("Recebido")}
              tooltip={kpiHint("Recebido")}
              tone="positive"
            />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(arCards.totalOpenAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Atrasados"
              value={formatExecutiveReportPresentationCurrency(arCards.overdueAmount)}
              hint={kpiHint("Atrasados")}
              tooltip={kpiHint("Atrasados")}
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

          <ExecutivePrintDataQualityNote
            title="Observações — Contas a Receber"
            dataQuality={report.dataQuality}
            domain="ar"
          />
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
              label="A pagar total"
              value={formatExecutiveReportPresentationCurrency(apCards.totalPayableAmount)}
              hint={kpiHint("A pagar total")}
              tooltip={kpiHint("A pagar total")}
            />
            <ExecutiveKpiCard
              label="Pago"
              value={formatExecutiveReportPresentationCurrency(
                apCards.totalPayableAmount - apCards.totalOpenAmount
              )}
              hint={kpiHint("Pago")}
              tooltip={kpiHint("Pago")}
              tone="positive"
            />
            <ExecutiveKpiCard
              label="Em aberto"
              value={formatExecutiveReportPresentationCurrency(apCards.totalOpenAmount)}
              hint={kpiHint("Em aberto")}
              tooltip={kpiHint("Em aberto")}
            />
            <ExecutiveKpiCard
              label="Vencidos"
              value={formatExecutiveReportPresentationCurrency(apCards.overdueAmount)}
              hint={kpiHint("Vencidos")}
              tooltip={kpiHint("Vencidos")}
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

          <ExecutivePrintDataQualityNote
            title="Observações — Contas a Pagar"
            dataQuality={report.dataQuality}
            domain="ap"
          />
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
          <ExecutiveKpiGrid columns={4}>
            <ExecutiveKpiCard
              label="Entradas previstas"
              value={formatExecutiveReportPresentationCurrency(cashCards.inflowAmount)}
              hint={kpiHint("Entradas previstas")}
              tooltip={kpiHint("Entradas previstas")}
              tone="positive"
            />
            <ExecutiveKpiCard
              label="Saídas previstas"
              value={formatExecutiveReportPresentationCurrency(cashCards.outflowAmount)}
              hint={kpiHint("Saídas previstas")}
              tooltip={kpiHint("Saídas previstas")}
              tone="negative"
            />
            <ExecutiveKpiCard
              label="Saldo líquido"
              value={formatExecutiveReportPresentationCurrency(cashCards.netFlowAmount)}
              hint={kpiHint("Saldo líquido")}
              tooltip={kpiHint("Saldo líquido")}
              tone={cashCards.netFlowAmount < 0 ? "negative" : "positive"}
            />
            <ExecutiveKpiCard
              label="Saldo acumulado"
              value={formatExecutiveReportPresentationCurrency(cashCards.accumulatedBalance)}
              hint={kpiHint("Saldo acumulado")}
              tooltip={kpiHint("Saldo acumulado")}
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

          <div className="mt-6">
            <ExecutiveCashFlowChart
              title="Fluxo de caixa planejado"
              rows={cashFlowChart.rows}
              empty={!cashFlowChart.hasData}
            />
          </div>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="sales-orders"
        pageNumber={8}
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
          <ExecutiveKpiGrid columns={5}>
            <ExecutiveKpiCard
              label="Vendido no mês"
              value={salesTab.target?.formatted.actual ?? "—"}
              sub={
                salesTab.periodLabel
                  ? `Pedidos registrados em ${salesTab.periodLabel}.`
                  : "Total de pedidos registrados no mês."
              }
              hint={kpiHint("Vendido no mês")}
              tooltip={kpiHint("Vendido no mês")}
              highlight
            />
            <ExecutiveKpiCard
              label="Meta mês"
              value={salesTab.target?.formatted.target ?? "—"}
              hint={salesTargetMissing ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE : kpiHint("Meta mês")}
              tooltip={kpiHint("Meta mês")}
            />
            <ExecutiveKpiCard
              label="Atingimento"
              value={
                salesTargetMissing ? "—" : (salesTab.target?.formatted.achievementPercent ?? "—")
              }
              hint={
                salesTargetMissing
                  ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE
                  : kpiHint("Atingimento mês pedidos")
              }
              tooltip={
                salesTargetMissing
                  ? EXECUTIVE_REPORT_NO_TARGET_MESSAGE
                  : kpiHint("Atingimento mês pedidos")
              }
            />
            <ExecutiveKpiCard
              label="Projeção mês"
              value={salesTab.projection?.formatted.monthlyProjection ?? "—"}
              hint={kpiHint("Projeção mês")}
              tooltip={kpiHint("Projeção mês")}
            />
            <ExecutiveKpiCard
              label="Realizado YTD"
              value={salesTab.summaryCards.find((c) => c.id === "realized-ytd")?.formatted ?? "—"}
              sub="Total de pedidos acumulado no ano."
              hint={kpiHint("Realizado YTD")}
              tooltip={kpiHint("Realizado YTD")}
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
      </ExecutivePrintPageShell>

      <ExecutivePrintPageShell
        pageId="conclusion"
        pageNumber={9}
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

          {report.dataQuality.warnings.length > 0 ? (
            <div className="mt-6 executive-alerts-panel">
              <h3 className="executive-alerts-title">Principais alertas</h3>
              <ul className="executive-alerts-list">
                {presentExecutiveReportNarrativeBullets({
                  warnings: report.dataQuality.warnings,
                  max: 3,
                }).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <ExecutivePrintDataQualityNote
            title="Observações sobre os dados"
            dataQuality={report.dataQuality}
            domain="general"
          />

          <p className="executive-print-generated-at">
            {formatExecutiveReportGeneratedFooter(report.generatedAt)}
          </p>
        </ExecutiveReportSection>
      </ExecutivePrintPageShell>

      <ExecutiveReportDocumentFooter generatedAt={report.generatedAt} />
    </div>
  );
}
