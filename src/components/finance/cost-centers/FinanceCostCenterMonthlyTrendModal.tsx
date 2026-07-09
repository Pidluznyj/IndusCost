import React, { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import {
  buildCostCenterMonthlyChartQuery,
  buildCostCenterMonthlyTrendSummary,
  formatCostCenterMonthlyChartPeriodLabel,
  type CostCenterMonthlyChartPayload,
} from "@/src/lib/financeCostCenterMonthlyChart.shared";
import { expenseMapCategoryLabel, type CostCenterExpenseMapCard } from "@/src/lib/financeCostCenterExpenseMap";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { CostCenterDialog } from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import { FinanceCostCenterMonthlyTrendChart } from "@/src/components/finance/cost-centers/FinanceCostCenterMonthlyTrendChart";
import { cn } from "@/src/lib/utils";

type Props = {
  card: CostCenterExpenseMapCard;
  appliedFilters: FinanceCostCentersUiFilters;
  onClose: () => void;
};

function trendDirectionLabel(direction: "up" | "down" | "stable"): string {
  if (direction === "up") return "Em alta";
  if (direction === "down") return "Em queda";
  return "Estável";
}

export function FinanceCostCenterMonthlyTrendModal({ card, appliedFilters, onClose }: Props) {
  const [payload, setPayload] = useState<CostCenterMonthlyChartPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const qs = buildCostCenterMonthlyChartQuery(appliedFilters, [card.costCenterId]);
        const data = await fetchJsonOk<CostCenterMonthlyChartPayload>(
          `/api/finance/cost-centers/monthly-chart?${qs}`,
          { credentials: "include" }
        );
        if (!cancelled) setPayload(data);
      } catch (e) {
        if (!cancelled) {
          setPayload(null);
          setError(
            buildFinanceTabLoadError("Não foi possível carregar a análise mensal do centro.", e)
              .message
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appliedFilters, card.costCenterId]);

  const summary = useMemo(() => {
    if (!payload) return null;
    return buildCostCenterMonthlyTrendSummary(payload.series, {
      titlesCount: card.titlesCount,
      highlightMonth: appliedFilters.month ?? payload.highlightMonth,
    });
  }, [appliedFilters.month, card.titlesCount, payload]);

  const periodLabel = formatCostCenterMonthlyChartPeriodLabel(
    appliedFilters.year ?? payload?.year ?? new Date().getFullYear(),
    null
  );

  return (
    <CostCenterDialog
      testId="finance-cc-monthly-trend-modal"
      title={`Análise mensal — ${card.name}`}
      subtitle="Valores agrupados por data de vencimento conforme filtros aplicados."
      onClose={onClose}
      closeDisabled={loading}
      maxWidthClass="max-w-4xl"
      footer={
        <p className="text-[10px] text-muted-foreground">
          Competência AP: data de vencimento · {periodLabel}
        </p>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground">
            {card.code}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-muted-foreground">
            {expenseMapCategoryLabel(card.category)}
          </span>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 font-semibold",
              card.status === "ACTIVE"
                ? "bg-emerald-100 text-emerald-800"
                : "bg-muted text-muted-foreground"
            )}
          >
            {card.status === "ACTIVE" ? "Ativo" : "Inativo"}
          </span>
        </div>

        {loading ? (
          <div
            className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"
            data-testid="finance-cc-monthly-trend-loading"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando análise mensal…
          </div>
        ) : error ? (
          <p className="text-sm text-rose-700" data-testid="finance-cc-monthly-trend-error">
            {error}
          </p>
        ) : summary && payload ? (
          <>
            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]"
              data-testid="finance-cc-monthly-trend-summary"
            >
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Total do período</p>
                <p className="font-bold text-base tabular-nums">{formatFinanceCurrency(summary.totalAmount)}</p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Média mensal</p>
                <p className="font-bold text-base tabular-nums">
                  {formatFinanceCurrency(summary.averageMonthlyAmount)}
                </p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Maior mês</p>
                <p className="font-bold">
                  {summary.maxMonth} · {formatFinanceCurrency(summary.maxMonthAmount)}
                </p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Menor mês</p>
                <p className="font-bold">
                  {summary.minMonth} · {formatFinanceCurrency(summary.minMonthAmount)}
                </p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Títulos (filtros atuais)</p>
                <p className="font-bold">{formatFinanceInteger(summary.titlesCount ?? 0)}</p>
              </div>
              <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2">
                <p className="text-muted-foreground">Tendência</p>
                <p className="font-bold">{trendDirectionLabel(summary.trendDirection)}</p>
                {summary.trendPercent != null ? (
                  <p className="text-[10px] text-muted-foreground">
                    {summary.trendPercent > 0 ? "+" : ""}
                    {formatFinancePercent(summary.trendPercent)}
                  </p>
                ) : null}
              </div>
              {summary.momChangePercent != null &&
              summary.momReferenceMonth &&
              summary.momComparisonMonth ? (
                <div className="rounded-lg border border-border/80 bg-muted/15 px-3 py-2 col-span-2">
                  <p className="text-muted-foreground">Variação mês a mês</p>
                  <p className="font-bold">
                    {summary.momReferenceMonth} vs {summary.momComparisonMonth}:{" "}
                    {summary.momChangePercent > 0 ? "+" : ""}
                    {formatFinancePercent(summary.momChangePercent)}
                  </p>
                </div>
              ) : null}
            </div>

            <p className="text-[10px] text-muted-foreground">{periodLabel}</p>

            <FinanceCostCenterMonthlyTrendChart
              series={payload.series}
              highlightMonth={payload.highlightMonth}
              empty={!payload.hasData}
            />

            <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
              <p>
                Vencido (card):{" "}
                <span className="font-semibold text-rose-700">
                  {formatFinanceCurrency(card.overdueAmount)}
                </span>
              </p>
              <p>
                A vencer (card):{" "}
                <span className="font-semibold text-sky-800">
                  {formatFinanceCurrency(card.upcomingAmount)}
                </span>
              </p>
              <p>
                Pago (card):{" "}
                <span className="font-semibold text-emerald-800">
                  {formatFinanceCurrency(card.paidAmount)}
                </span>
              </p>
            </div>
          </>
        ) : null}
      </div>
    </CostCenterDialog>
  );
}
