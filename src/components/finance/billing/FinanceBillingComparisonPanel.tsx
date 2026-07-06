import React from "react";
import { AlertTriangle, CheckCircle2, Minus } from "lucide-react";
import type { FinanceBillingComparisonPayload } from "@/src/lib/financeBillingNfeComparison";
import { formatFinanceCurrency, formatFinancePercent } from "@/src/lib/financeAccountsPayableFormat";
import { FinanceBillingSourceBadge } from "@/src/components/finance/billing/FinanceBillingSourceBadge";
import { cn } from "@/src/lib/utils";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FINANCE_BILLING_COMPARISON_SCOPE } from "@/src/lib/financeFilterScope";

function comparisonStatus(
  salesOrder: number,
  nomusNfe: number
): "ok" | "small" | "divergent" | "no-nfe" {
  if (nomusNfe === 0 && salesOrder === 0) return "no-nfe";
  if (nomusNfe === 0) return "no-nfe";
  const diff = Math.abs(nomusNfe - salesOrder);
  const pct = salesOrder > 0 ? (diff / salesOrder) * 100 : 100;
  if (pct < 1) return "ok";
  if (pct < 10) return "small";
  return "divergent";
}

function StatusIcon({ status }: { status: ReturnType<typeof comparisonStatus> }) {
  if (status === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (status === "small") return <Minus className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "divergent") return <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
  return <Minus className="h-3.5 w-3.5 text-muted-foreground" />;
}

export function FinanceBillingComparisonPanel({
  comparison,
  loading,
  error,
  onRetry,
}: {
  comparison: FinanceBillingComparisonPayload | null;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (loading && !comparison && !error) {
    return (
      <div className="rounded-xl border border-[#E5E7EB] bg-white p-6 animate-pulse h-48" />
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-5 space-y-3">
        <p className="text-sm font-semibold text-[#991B1B]">Falha ao carregar comparativo</p>
        <p className="text-xs text-[#6B7280]">{error}</p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="text-xs font-semibold text-[#2563EB] hover:underline"
          >
            Tentar novamente
          </button>
        ) : null}
      </div>
    );
  }

  if (!comparison) return null;

  const nfeEmpty = comparison.yearTotalNomusNfe === 0;

  return (
    <div className="rounded-2xl border border-border/70 bg-white dark:bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border/50 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-foreground">
              Comparativo SalesOrder × NomusNfe ({comparison.year})
            </h3>
            <FinanceFilterScopeNote className="mt-0.5">
              {FINANCE_BILLING_COMPARISON_SCOPE}
            </FinanceFilterScopeNote>
            <p className="text-[11px] text-muted-foreground mt-0.5">{comparison.note}</p>
          </div>
          <FinanceBillingSourceBadge variant={nfeEmpty ? "warning" : "diagnostic"} />
        </div>
        {nfeEmpty ? (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            Sem NF-e sincronizada neste período. O dashboard fiscal usa NomusNfe — execute a
            sincronização de NF-e para comparar com SalesOrder.
          </p>
        ) : null}
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 text-left">
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                Mês
              </th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                SalesOrder
              </th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                NomusNfe
              </th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                Diferença
              </th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                %
              </th>
              <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/30">
            {comparison.months.map((row) => {
              const status = comparisonStatus(row.salesOrderTotal, row.nomusNfeTotal);
              return (
                <tr key={row.month} className="hover:bg-muted/20">
                  <td className="px-4 py-2 font-semibold">{row.month}</td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatFinanceCurrency(row.salesOrderTotal)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {formatFinanceCurrency(row.nomusNfeTotal)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2 text-right tabular-nums font-semibold",
                      row.difference > 0 ? "text-red-600" : row.difference < 0 ? "text-green-600" : ""
                    )}
                  >
                    {formatFinanceCurrency(row.difference)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {row.differencePercent != null
                      ? formatFinancePercent(row.differencePercent)
                      : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <StatusIcon status={status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-bold border-t border-border/50 bg-muted/20">
              <td className="px-4 py-2.5">Total {comparison.year}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatFinanceCurrency(comparison.yearTotalSalesOrder)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatFinanceCurrency(comparison.yearTotalNomusNfe)}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums">
                {formatFinanceCurrency(comparison.yearDifference)}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
