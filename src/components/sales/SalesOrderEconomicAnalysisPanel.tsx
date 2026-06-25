import React from "react";
import { AlertTriangle, DollarSign, Percent, Scale, TrendingUp, Wallet } from "lucide-react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import {
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
  formatSalesOrderMarkup,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderManagementMarginItemCounts } from "@/src/lib/salesOrderManagementMargin";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";

export function SalesOrderEconomicAnalysisPanel({
  summary,
  itemCounts,
  loading = false,
  scopeNote,
}: {
  summary?: SalesOrderMarginSummaryPayload | null;
  itemCounts?: SalesOrderManagementMarginItemCounts | null;
  loading?: boolean;
  scopeNote?: string;
}) {
  const counts = itemCounts ?? {
    itemsWithoutCost: 0,
    itemsWithoutProduct: 0,
    itemsWithNegativeMargin: 0,
  };

  return (
    <div className="space-y-3" data-testid="sales-order-economic-analysis">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Análise econômica
          </h3>
          {scopeNote ? (
            <p className="mt-1 text-[10px] text-muted-foreground max-w-2xl">{scopeNote}</p>
          ) : null}
        </div>
        {summary ? (
          <SalesOrderMarginStatusBadge
            label={summary.statusLabel}
            status={summary.status}
          />
        ) : (
          <SalesOrderMarginStatusBadge label="Indisponível" severity="neutral" />
        )}
      </div>

      <div className="indus-kpi-grid">
        <FinanceBiKpiCard
          icon={Wallet}
          label="Valor vendido"
          value={
            summary
              ? formatSalesOrderMarginMoney(summary.netRevenue)
              : loading
                ? "—"
                : "—"
          }
          loading={loading}
        />
        <FinanceBiKpiCard
          icon={Scale}
          label="Custo estimado"
          value={summary ? formatSalesOrderMarginMoney(summary.totalCost) : "—"}
          loading={loading}
        />
        <FinanceBiKpiCard
          icon={DollarSign}
          label="Margem R$"
          value={summary ? formatSalesOrderMarginMoney(summary.marginValue) : "—"}
          loading={loading}
        />
        <FinanceBiKpiCard
          icon={Percent}
          label="Margem %"
          value={summary ? formatSalesOrderMarginPercent(summary.marginPercent) : "—"}
          loading={loading}
        />
        <FinanceBiKpiCard
          icon={TrendingUp}
          label="Markup"
          value={summary ? formatSalesOrderMarkup(summary.markup) : "—"}
          loading={loading}
        />
      </div>

      {(counts.itemsWithoutCost > 0 ||
        counts.itemsWithoutProduct > 0 ||
        counts.itemsWithNegativeMargin > 0) && (
        <div className="flex flex-wrap gap-2" data-testid="sales-order-economic-item-alerts">
          {counts.itemsWithoutCost > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              <AlertTriangle className="h-3 w-3" />
              {counts.itemsWithoutCost} item(ns) sem custo
            </span>
          ) : null}
          {counts.itemsWithoutProduct > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
              <AlertTriangle className="h-3 w-3" />
              {counts.itemsWithoutProduct} item(ns) sem produto
            </span>
          ) : null}
          {counts.itemsWithNegativeMargin > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-900">
              <AlertTriangle className="h-3 w-3" />
              {counts.itemsWithNegativeMargin} item(ns) com margem negativa
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
