import React from "react";
import { AlertTriangle } from "lucide-react";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import { SalesOrderMarginMetricGrid } from "@/src/components/sales/SalesOrderMarginMetricGrid";
import {
  buildSalesOrderItemCommercialMarginTooltipText,
  buildSalesOrderMarginAlerts,
  formatOfficialPriceTableReferenceLabel,
  formatProductTypeLabel,
  formatProductionCostReferenceLabel,
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
  resolveSalesOrderMarginRevenueLabel,
  resolveSalesOrderMarginSupportText,
  SALES_ORDER_COMMERCIAL_REFERENCE_STATUS_LABEL,
} from "@/src/lib/salesOrderMarginDisplay";
import { PRODUCTION_COST_DISPLAY_LABELS } from "@/src/lib/productionCostTablesUi";
import { SalesOrderMarginInfoTooltip } from "@/src/components/sales/SalesOrderMarginInfoTooltip";
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
  orderIssueDate,
}: {
  summary?: SalesOrderMarginSummaryPayload | null;
  items: SalesOrderMarginItemRow[];
  orderIssueDate?: string | null;
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
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Margem comercial da venda
              </h3>
              <SalesOrderMarginInfoTooltip
                summary={summary}
                itemMargins={items.map((it) => it.margin)}
                orderIssueDate={orderIssueDate}
                testId="sales-order-detail-margin-tooltip"
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground max-w-3xl">{supportText}</p>
          </div>
          {summary?.commercialMargin ? (
            <SalesOrderMarginStatusBadge
              label={
                summary.commercialMargin.isComplete
                  ? "Margem comercial calculada"
                  : summary.commercialMargin.itemsCalculated > 0
                    ? `Margem comercial parcial (${summary.commercialMargin.itemsCalculated}/${summary.commercialMargin.itemsActive})`
                    : "Margem comercial indisponível"
              }
              status={
                summary.commercialMargin.isComplete
                  ? "OK"
                  : summary.commercialMargin.itemsCalculated > 0
                    ? "PARTIAL"
                    : "SEM_CUSTO"
              }
            />
          ) : summary ? (
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
            revenueLabel={resolveSalesOrderMarginRevenueLabel(summary)}
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
          <table className="w-full text-left text-sm min-w-[1400px]">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 font-semibold">Item</th>
                <th className="p-3 font-semibold text-right">Qtd</th>
                <th className="p-3 font-semibold text-right">Preço vendido</th>
                <th className="p-3 font-semibold text-right">Preço tabela</th>
                <th className="p-3 font-semibold text-right">Desconto vs tabela</th>
                <th className="p-3 font-semibold text-right">Valor líquido</th>
                <th className="p-3 font-semibold text-right">
                  {PRODUCTION_COST_DISPLAY_LABELS.productionUnitCost}
                </th>
                <th className="p-3 font-semibold text-right">
                  {PRODUCTION_COST_DISPLAY_LABELS.productionTotalCost}
                </th>
                <th className="p-3 font-semibold text-right">Margem comercial R$</th>
                <th className="p-3 font-semibold text-right">Margem comercial %</th>
                <th className="p-3 font-semibold text-right">Margem tabela R$</th>
                <th className="p-3 font-semibold text-right">Vazamento margem</th>
                <th className="p-3 font-semibold">Referência</th>
                <th className="p-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-6 text-center text-muted-foreground">
                    Nenhum item no pedido.
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const margin = it.margin;
                  const ref = margin?.commercialReference;
                  return (
                    <tr key={it.id} data-testid={`sales-order-item-margin-${it.id}`}>
                      <td className="p-3">
                        <div className="font-mono text-xs text-muted-foreground">{it.skuSnapshot}</div>
                        <div className="max-w-[220px]">{it.productNameSnapshot}</div>
                        {ref?.productType ? (
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            {formatProductTypeLabel(ref.productType)}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatNumber(Number(it.quantity), 4)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {formatSalesOrderMarginMoney(ref?.soldUnitPrice ?? it.negotiatedPrice)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {ref?.referenceStatus === "SEM_PRECO_TABELA" ||
                        ref?.referenceStatus === "PRECO_INDISPONIVEL"
                          ? "—"
                          : formatSalesOrderMarginMoney(ref?.officialUnitPrice)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {ref?.discountVsOfficialPrice != null
                          ? `${formatSalesOrderMarginMoney(ref.discountVsOfficialPrice)}${
                              ref.discountPercentVsOfficialPrice != null
                                ? ` (${formatSalesOrderMarginPercent(ref.discountPercentVsOfficialPrice)})`
                                : ""
                            }`
                          : "—"}
                      </td>
                      <td className="p-3 text-right font-mono font-medium">
                        {margin
                          ? formatSalesOrderMarginMoney(margin.netRevenue)
                          : formatSalesOrderMarginMoney(it.totalNetValue)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {margin?.costSource === "MISSING_COST" || margin?.status === "SEM_CUSTO"
                          ? PRODUCTION_COST_DISPLAY_LABELS.costUnresolved
                          : formatSalesOrderMarginMoney(margin?.unitCost)}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {margin?.costSource === "MISSING_COST" || margin?.status === "SEM_CUSTO"
                          ? PRODUCTION_COST_DISPLAY_LABELS.costUnresolved
                          : formatSalesOrderMarginMoney(margin?.totalCost)}
                      </td>
                      <td
                        className="p-3 text-right font-mono"
                        title={buildSalesOrderItemCommercialMarginTooltipText(
                          margin?.commercialMargin
                        )}
                      >
                        {margin?.commercialMargin?.isComplete
                          ? formatSalesOrderMarginMoney(
                              margin.commercialMargin.commercialMarginValue
                            )
                          : margin?.commercialMargin
                            ? "Margem indisponível"
                            : margin?.status === "SEM_CUSTO" ||
                                margin?.costSource === "MISSING_COST"
                              ? "—"
                              : formatSalesOrderMarginMoney(
                                  ref?.realizedMarginAmount ?? margin?.marginValue
                                )}
                      </td>
                      <td
                        className="p-3 text-right font-mono"
                        title={buildSalesOrderItemCommercialMarginTooltipText(
                          margin?.commercialMargin
                        )}
                      >
                        {margin?.commercialMargin?.isComplete
                          ? formatSalesOrderMarginPercent(
                              margin.commercialMargin.commercialMarginPercent
                            )
                          : margin?.commercialMargin
                            ? "—"
                            : margin?.status === "SEM_CUSTO" ||
                                margin?.costSource === "MISSING_COST"
                              ? "—"
                              : formatSalesOrderMarginPercent(
                                  ref?.realizedMarginPercent ?? margin?.marginPercent
                                )}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {ref?.tableMarginAmount != null
                          ? formatSalesOrderMarginMoney(ref.tableMarginAmount)
                          : "—"}
                      </td>
                      <td className="p-3 text-right font-mono">
                        {ref?.marginLeakageAmount != null
                          ? formatSalesOrderMarginMoney(ref.marginLeakageAmount)
                          : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[180px]">
                        <div>
                          Custo: {formatProductionCostReferenceLabel(ref?.productionCost)}
                        </div>
                        <div>
                          Preço: {formatOfficialPriceTableReferenceLabel(ref?.officialPrice)}
                        </div>
                        {ref?.referenceStatus && ref.referenceStatus !== "OK" ? (
                          <div className="text-amber-700 dark:text-amber-300 mt-1">
                            {SALES_ORDER_COMMERCIAL_REFERENCE_STATUS_LABEL[ref.referenceStatus]}
                          </div>
                        ) : null}
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
