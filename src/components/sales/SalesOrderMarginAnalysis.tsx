import React from "react";
import { AlertTriangle } from "lucide-react";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import { SalesOrderMarginMetricGrid } from "@/src/components/sales/SalesOrderMarginMetricGrid";
import {
  buildSalesOrderMarginAlerts,
  formatSalesOrderCostSourceLabel,
  formatSalesOrderMarginMoney,
  resolveSalesOrderMarginSupportText,
} from "@/src/lib/salesOrderMarginDisplay";
import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "@/src/lib/salesOrderMarginTypes";
import { formatNumber } from "@/src/lib/utils";

export type SalesOrderMarginItemRow = {
  id: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  quantity: unknown;
  unit: string | null;
  negotiatedPrice: unknown;
  totalNetValue: unknown;
  margin?: SalesOrderItemMarginPayload;
};

export { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";

export function SalesOrderMarginAnalysisSection({
  summary,
  items,
}: {
  summary?: SalesOrderMarginSummaryPayload | null;
  items: SalesOrderMarginItemRow[];
}) {
  const alerts = buildSalesOrderMarginAlerts(summary);
  const supportText = resolveSalesOrderMarginSupportText(
    summary,
    items.map((it) => it.margin)
  );

  return (
    <div className="space-y-4" data-testid="sales-order-margin-analysis">
      <div className="rounded-xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Análise de Margem
            </h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-3xl">{supportText}</p>
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

        {summary ? (
          <SalesOrderMarginMetricGrid
            summary={summary}
            revenueLabel="Receita líquida"
            testId="sales-order-margin-metric-grid"
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Margem ainda não calculada para este pedido. Os dados comerciais abaixo permanecem
            disponíveis.
          </p>
        )}
      </div>

      {alerts.length > 0 ? (
        <div className="space-y-2" data-testid="sales-order-margin-alerts">
          {alerts.map((message) => (
            <div
              key={message}
              className="flex items-start gap-2 rounded-lg border border-amber-300/80 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border bg-accent/30">
          <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Itens — margem
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm min-w-[1100px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 font-semibold">Produto</th>
                <th className="p-3 font-semibold text-right">Qtd</th>
                <th className="p-3 font-semibold text-right">Preço líquido unit.</th>
                <th className="p-3 font-semibold text-right">Valor líquido</th>
                <th className="p-3 font-semibold text-right">Custo unit.</th>
                <th className="p-3 font-semibold text-right">Custo total</th>
                <th className="p-3 font-semibold text-right">Margem R$</th>
                <th className="p-3 font-semibold text-right">Margem %</th>
                <th className="p-3 font-semibold text-right">Markup</th>
                <th className="p-3 font-semibold">Fonte custo</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-6 text-center text-muted-foreground">
                    Nenhum item no pedido.
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const margin = it.margin;
                  return (
                    <tr key={it.id} data-testid={`sales-order-item-margin-${it.id}`}>
                      <td className="p-3">
                        <div className="font-mono text-xs text-muted-foreground">{it.skuSnapshot}</div>
                        <div className="max-w-[220px]">{it.productNameSnapshot}</div>
                      </td>
                      <td className="p-3 text-right font-mono">{formatNumber(it.quantity, 4)}</td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginMoney(it.negotiatedPrice)}
                      </td>
                      <td className="p-3 text-right font-mono font-medium">
                        {margin
                          ? formatSalesOrderMarginMoney(margin.netRevenue)
                          : formatSalesOrderMarginMoney(it.totalNetValue)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginMoney(margin?.unitCost)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginMoney(margin?.totalCost)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginMoney(margin?.marginValue)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginPercent(margin?.marginPercent)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarkup(margin?.markup)}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {formatSalesOrderCostSourceLabel(margin?.costSource)}
                      </td>
                      <td className="p-3">
                        {margin ? (
                          <SalesOrderMarginStatusBadge
                            label={margin.statusLabel}
                            severity={margin.statusSeverity}
                          />
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
