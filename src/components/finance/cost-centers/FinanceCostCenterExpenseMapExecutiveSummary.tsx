import React, { useMemo } from "react";
import { CheckCircle2, Clock, DollarSign, Layers, Percent, X } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import type { CostCenterExpenseMapAggregateTotals } from "@/src/lib/financeCostCenterExpenseMap";
import { formatCostCenterExpenseMapSummaryCurrency } from "@/src/lib/financeCostCenterExpenseMap";
import { formatFinanceInteger, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";
import "./finance-cc-expense-map-executive-summary.css";

type Props = {
  totals: CostCenterExpenseMapAggregateTotals;
  hasSelection: boolean;
  onClearSelection?: () => void;
  loading?: boolean;
  titleOverride?: string;
  eyebrowOverride?: string;
  footerOverride?: string;
};

export function FinanceCostCenterExpenseMapExecutiveSummary({
  totals,
  hasSelection,
  onClearSelection,
  loading = false,
  titleOverride,
  eyebrowOverride,
  footerOverride,
}: Props) {
  const headline = titleOverride
    ? titleOverride
    : hasSelection
      ? `Resumo de ${formatFinanceInteger(totals.centersCount)} centro(s) selecionado(s)`
      : "Resumo geral dos centros filtrados";

  const scopeHint = eyebrowOverride
    ? eyebrowOverride
    : hasSelection
      ? "Total dos centros selecionados"
      : `${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total · Total geral dos centros filtrados`;

  const amountDisplay = useMemo(
    () => formatCostCenterExpenseMapSummaryCurrency(totals.amount),
    [totals.amount]
  );
  const overdueDisplay = useMemo(
    () => formatCostCenterExpenseMapSummaryCurrency(totals.overdueAmount),
    [totals.overdueAmount]
  );
  const upcomingDisplay = useMemo(
    () => formatCostCenterExpenseMapSummaryCurrency(totals.upcomingAmount),
    [totals.upcomingAmount]
  );
  const paidDisplay = useMemo(
    () => formatCostCenterExpenseMapSummaryCurrency(totals.paidAmount),
    [totals.paidAmount]
  );

  return (
    <ExecutiveSummarySection
      title={headline}
      eyebrow={scopeHint}
      testId="finance-cc-expense-map-executive-summary"
      actions={
        hasSelection && onClearSelection ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/50"
            data-testid="finance-cc-expense-map-clear-selection"
          >
            <X className="h-3.5 w-3.5" />
            Limpar seleção ({formatFinanceInteger(totals.centersCount)})
          </button>
        ) : undefined
      }
      footer={
        <p
          className={cn(hasSelection && "text-primary/80 font-medium")}
          data-testid="finance-cc-expense-map-summary-scope"
        >
          {footerOverride
            ? footerOverride
            : hasSelection
              ? `${formatFinanceInteger(totals.centersCount)} centros selecionados · ${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total filtrado`
              : `${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total`}
        </p>
      }
    >
      <SummaryKpiGrid minColumnWidth={168} className="finance-cc-expense-map-metric-grid">
        <MetricCard
          label="Centros"
          value={formatFinanceInteger(totals.centersCount)}
          subtitle="Centros considerados no resumo"
          variant="info"
          icon={<Layers className="h-3.5 w-3.5" />}
          loading={loading}
          className="finance-cc-expense-map-metric-card--short"
        />
        <MetricCard
          label="Valor total"
          formattedValue={amountDisplay.display}
          fullValue={amountDisplay.fullValue}
          subtitle="Soma dos títulos vinculados"
          variant="money"
          icon={<DollarSign className="h-3.5 w-3.5" />}
          loading={loading}
        />
        <MetricCard
          label="Vencido"
          formattedValue={overdueDisplay.display}
          fullValue={overdueDisplay.fullValue}
          subtitle="Títulos vencidos"
          variant="danger"
          icon={<Clock className="h-3.5 w-3.5" />}
          loading={loading}
        />
        <MetricCard
          label="A vencer"
          formattedValue={upcomingDisplay.display}
          fullValue={upcomingDisplay.fullValue}
          subtitle="Títulos ainda em aberto"
          variant="warning"
          icon={<Clock className="h-3.5 w-3.5" />}
          loading={loading}
        />
        <MetricCard
          label="Pago"
          formattedValue={paidDisplay.display}
          fullValue={paidDisplay.fullValue}
          subtitle="Títulos já pagos"
          variant="success"
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          loading={loading}
        />
        <MetricCard
          label="Participação"
          formattedValue={formatFinancePercent(totals.participationPercent)}
          subtitle="Participação sobre o total filtrado"
          variant="neutral"
          icon={<Percent className="h-3.5 w-3.5" />}
          loading={loading}
          className="finance-cc-expense-map-metric-card--short"
        />
      </SummaryKpiGrid>
    </ExecutiveSummarySection>
  );
}
