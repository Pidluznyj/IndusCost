import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  annualComparisonHasChartData,
  buildAnnualComparisonSeriesLabels,
  mapAnnualComparisonChartRows,
  type FinanceCashFlowAnnualComparisonPayload,
} from "@/src/lib/financeCashFlowAnnualComparison";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT,
  FinanceCashFlowAnnualComparisonChartView,
} from "@/src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView";
import { FinanceCashFlowBlockTitle } from "@/src/components/finance/cash-flow/FinanceCashFlowBlockTitle";
import { FinanceBiEmptyState } from "@/src/components/finance/bi/FinanceBiEmptyState";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";

/**
 * Gráfico anual independente dos filtros da página — busca endpoint dedicado.
 */
export function FinanceCashFlowAnnualComparisonChart() {
  const [payload, setPayload] = useState<FinanceCashFlowAnnualComparisonPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<FinanceCashFlowAnnualComparisonPayload>(
        "/api/finance/cash-flow/annual-comparison"
      );
      setPayload(data);
    } catch (e: unknown) {
      setError(buildFinanceTabLoadError(e, "Não foi possível carregar o fluxo anual."));
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(
    () => (payload ? mapAnnualComparisonChartRows(payload) : []),
    [payload]
  );
  const labels = useMemo(
    () => buildAnnualComparisonSeriesLabels(payload?.year ?? new Date().getFullYear()),
    [payload?.year]
  );
  const empty = !payload || !annualComparisonHasChartData(payload);
  const year = payload?.year ?? new Date().getFullYear();
  const title = `Fluxo anual — Entradas, Saídas e Saldo (${year})`;
  const subtitle =
    "Visão anual independente dos filtros da página. Entradas somam Recebido + A Receber; Saídas somam Pago + A Pagar. O saldo mostra a diferença entre entradas e saídas do mês.";

  if (loading && !payload) {
    return (
      <div
        className={`${financeBiCardClass} flex min-h-[420px] items-center justify-center gap-2 p-8 text-sm text-[#6B7280]`}
        data-testid="cash-flow-annual-comparison-loading"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        Carregando fluxo anual…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`${financeBiCardClass} space-y-3 p-5`}
        data-testid="cash-flow-annual-comparison-error"
      >
        <p className="text-sm font-semibold text-[#111827]">{title}</p>
        <p className="text-sm text-[#DC2626]">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-[#E5E7EB] px-3 py-1.5 text-sm text-[#111827] hover:bg-[#F9FAFB]"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (empty) {
    return (
      <FinanceBiEmptyState
        title={title}
        description="Sem movimentações Nomus para montar o fluxo anual."
      />
    );
  }

  const totals = payload!.totals;

  return (
    <div
      data-testid="cash-flow-annual-comparison"
      className={`${financeBiCardClass} p-5 space-y-3 flex flex-col`}
    >
      <FinanceCashFlowBlockTitle
        title={title}
        subtitle={subtitle}
        testId="cash-flow-annual-comparison"
      />
      <MetricCardGrid data-testid="cash-flow-annual-comparison-summary">
        <MetricCard
          label="Total entradas no ano"
          formattedValue={formatFinanceCurrency(totals.cashInTotalAmount)}
          subtitle={`Recebido ${formatFinanceCurrency(totals.receivedAmount)} · A receber ${formatFinanceCurrency(totals.receivableOpenAmount)}`}
          variant="success"
        />
        <MetricCard
          label="Total saídas no ano"
          formattedValue={formatFinanceCurrency(totals.cashOutTotalAmount)}
          subtitle={`Pago ${formatFinanceCurrency(totals.paidAmount)} · A pagar ${formatFinanceCurrency(totals.payableOpenAmount)}`}
          variant="danger"
        />
        <MetricCard
          label="Saldo anual"
          formattedValue={formatFinanceCurrency(totals.netCashAmount)}
          variant={totals.netCashAmount >= 0 ? "success" : "danger"}
        />
      </MetricCardGrid>
      <div style={{ width: "100%", height: FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT }}>
        <FinanceCashFlowAnnualComparisonChartView
          data={chartData}
          labels={labels}
          year={year}
          showGoal={false}
          height={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT}
        />
      </div>
    </div>
  );
}
