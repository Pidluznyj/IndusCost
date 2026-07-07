import React from "react";
import { CheckCircle2, Clock, DollarSign, Layers, Percent } from "lucide-react";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import type { CostCenterExpenseMapAggregateTotals } from "@/src/lib/financeCostCenterExpenseMap";
import { formatFinanceInteger, formatFinancePercent } from "@/src/lib/financeAccountsReceivableFormat";
import { cn } from "@/src/lib/utils";

type Props = {
  totals: CostCenterExpenseMapAggregateTotals;
  hasSelection: boolean;
  onClearSelection?: () => void;
  loading?: boolean;
};

export function FinanceCostCenterExpenseMapExecutiveSummary({
  totals,
  hasSelection,
  onClearSelection,
  loading = false,
}: Props) {
  const headline = hasSelection
    ? `Resumo de ${formatFinanceInteger(totals.centersCount)} centro(s) selecionado(s)`
    : "Resumo geral dos centros filtrados";

  const scopeHint = hasSelection
    ? "Total dos centros selecionados"
    : `${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total · Total geral dos centros filtrados`;

  return (
    <div
      className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
      data-testid="finance-cc-expense-map-executive-summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {scopeHint}
          </p>
          <h3 className="text-sm font-bold text-foreground mt-0.5">{headline}</h3>
        </div>
        {hasSelection && onClearSelection ? (
          <button
            type="button"
            onClick={onClearSelection}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold text-foreground hover:bg-muted/50"
            data-testid="finance-cc-expense-map-clear-selection"
          >
            Limpar seleção
          </button>
        ) : null}
      </div>

      <MetricCardGrid minColumnWidth={180}>
        <MetricCard
          label="Centros"
          value={formatFinanceInteger(totals.centersCount)}
          subtitle="Centros considerados no resumo"
          variant="info"
          icon={<Layers className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Valor total"
          amount={totals.amount}
          amountFormat="currency"
          subtitle="Soma dos títulos vinculados"
          variant="money"
          icon={<DollarSign className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Vencido"
          amount={totals.overdueAmount}
          amountFormat="currency"
          subtitle="Títulos vencidos"
          variant="danger"
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="A vencer"
          amount={totals.upcomingAmount}
          amountFormat="currency"
          subtitle="Títulos ainda em aberto"
          variant="warning"
          icon={<Clock className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Pago"
          amount={totals.paidAmount}
          amountFormat="currency"
          subtitle="Títulos já pagos"
          variant="success"
          icon={<CheckCircle2 className="h-4 w-4" />}
          loading={loading}
        />
        <MetricCard
          label="Participação"
          formattedValue={formatFinancePercent(totals.participationPercent)}
          subtitle="Participação sobre o total filtrado"
          variant="neutral"
          icon={<Percent className="h-4 w-4" />}
          loading={loading}
        />
      </MetricCardGrid>

      <p
        className={cn(
          "text-[10px] text-muted-foreground",
          hasSelection && "text-primary/80 font-medium"
        )}
        data-testid="finance-cc-expense-map-summary-scope"
      >
        {hasSelection
          ? `${formatFinanceInteger(totals.centersCount)} centros selecionados · ${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total filtrado`
          : `${formatFinanceInteger(totals.totalFilteredCentersCount)} centros no total`}
      </p>
    </div>
  );
}
