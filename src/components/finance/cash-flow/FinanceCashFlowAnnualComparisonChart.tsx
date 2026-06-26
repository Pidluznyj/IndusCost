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
import { FinanceCashFlowChartShell } from "@/src/components/finance/cash-flow/FinanceCashFlowChartShell";
import {
  FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT,
  FinanceCashFlowAnnualComparisonChartView,
} from "@/src/components/finance/cash-flow/FinanceCashFlowAnnualComparisonChartView";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

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
    () =>
      buildAnnualComparisonSeriesLabels(payload?.year ?? new Date().getFullYear()),
    [payload?.year]
  );
  const empty = !payload || !annualComparisonHasChartData(payload);
  const year = payload?.year ?? new Date().getFullYear();
  const title = `Fluxo anual — Recebido, A Receber, Pago e A Pagar (${year})`;

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

  return (
    <FinanceCashFlowChartShell
      testId="cash-flow-annual-comparison"
      title={title}
      subtitle="Visão anual independente dos filtros da página, separando valores já realizados e valores ainda em aberto. Este gráfico sempre considera o ano corrente e não é afetado pelos filtros gerais da tela. Recebido e Pago seguem o motor do Fluxo de Caixa planejado (alocação por vencimento). A Receber e A Pagar usam vencimento dos títulos em aberto."
      empty={empty}
      emptyDescription="Sem movimentações Nomus para montar o fluxo anual."
      chartHeight={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT}
    >
      <FinanceCashFlowAnnualComparisonChartView
        data={chartData}
        labels={labels}
        showGoal={payload?.hasReceivableGoal ?? false}
        height={FINANCE_CASH_FLOW_ANNUAL_COMPARISON_CHART_HEIGHT}
      />
    </FinanceCashFlowChartShell>
  );
}
