import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchCashFlowSessionJson } from "@/src/lib/finance/cashFlowPerfClient";
import { noteDevPerfRender } from "@/src/lib/devPerfBaselineClient";
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
import { FinanceBiChartExpandButton } from "@/src/components/finance/bi/FinanceBiChartExpandButton";
import {
  FinanceBiChartExpandModal,
  useFinanceBiExpandedChartHeight,
} from "@/src/components/finance/bi/FinanceBiChartExpandModal";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { MetricCard } from "@/src/components/ui/MetricCard";
import { MetricCardGrid } from "@/src/components/ui/MetricCardGrid";
import { useSectionVisible } from "@/src/hooks/useSectionVisible";

/**
 * Gráfico anual independente dos filtros da página — busca endpoint dedicado.
 * Carrega só quando a seção entra na viewport (abaixo da dobra).
 */
export function FinanceCashFlowAnnualComparisonChart() {
  noteDevPerfRender("FinanceCashFlowAnnualComparisonChart");
  const { ref: sectionRef, visible } = useSectionVisible<HTMLDivElement>();
  const abortRef = useRef<AbortController | null>(null);
  const [payload, setPayload] = useState<FinanceCashFlowAnnualComparisonPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const expandedHeight = useFinanceBiExpandedChartHeight(560);
  const openExpand = useCallback(() => setExpanded(true), []);
  const closeExpand = useCallback(() => setExpanded(false), []);

  const load = useCallback(async () => {
    if (!visible) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCashFlowSessionJson<FinanceCashFlowAnnualComparisonPayload>(
        "/api/finance/cash-flow/annual-comparison",
        { signal: controller.signal },
        "annual"
      );
      if (controller.signal.aborted) return;
      setPayload(data);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError(buildFinanceTabLoadError("Não foi possível carregar o fluxo anual.", e));
      setPayload(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [visible]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
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
    "Mesma base do fluxo de caixa planejado. Entradas mostram Recebido + A Receber; Saídas mostram Pago + A Pagar; o saldo é a diferença mensal.";

  if (!visible || (loading && !payload)) {
    return (
      <div
        ref={sectionRef}
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
        ref={sectionRef}
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
      <div ref={sectionRef}>
        <FinanceBiEmptyState
          title={title}
          description="Sem movimentações Nomus para montar o fluxo anual."
        />
      </div>
    );
  }

  const totals = payload!.totals;

  const renderSummaryCards = (gridTestId: string) => (
    <MetricCardGrid data-testid={gridTestId}>
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
        subtitle="Entradas − Saídas"
        variant={totals.netCashAmount >= 0 ? "success" : "danger"}
      />
    </MetricCardGrid>
  );

  return (
    <>
      <div
        ref={sectionRef}
        data-testid="cash-flow-annual-comparison"
        className={`${financeBiCardClass} p-5 space-y-3 flex flex-col`}
      >
        <div className="flex items-start justify-between gap-2">
          <FinanceCashFlowBlockTitle
            title={title}
            subtitle={subtitle}
            testId="cash-flow-annual-comparison"
            className="min-w-0 flex-1"
          />
          <FinanceBiChartExpandButton
            onClick={openExpand}
            testId="cash-flow-annual-comparison-expand"
          />
        </div>
        {renderSummaryCards("cash-flow-annual-comparison-summary")}
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
      <FinanceBiChartExpandModal
        open={expanded}
        title={title}
        subtitle={subtitle}
        onClose={closeExpand}
        testId="cash-flow-annual-comparison-expand-modal"
      >
        <div className="space-y-4">
          {renderSummaryCards("cash-flow-annual-comparison-summary-expanded")}
          <div style={{ width: "100%", height: expandedHeight }}>
            <FinanceCashFlowAnnualComparisonChartView
              data={chartData}
              labels={labels}
              year={year}
              showGoal={false}
              height={expandedHeight}
            />
          </div>
        </div>
      </FinanceBiChartExpandModal>
    </>
  );
}
