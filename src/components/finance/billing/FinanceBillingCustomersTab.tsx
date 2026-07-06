import React from "react";
import type { BillingTopCustomerRow } from "@/src/lib/executiveDashboardTypes";
import {
  formatExecutiveCurrency,
  formatExecutiveInteger,
  formatExecutivePercent,
} from "@/src/lib/executiveDashboardFormatters";
import { FinanceFilterScopeNote } from "@/src/components/finance/FinanceFilterScopeBanner";
import { FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE } from "@/src/lib/financeFilterScope";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

export function FinanceBillingCustomersTab({
  rows,
  loading,
  yearLabel,
}: {
  rows: BillingTopCustomerRow[];
  loading?: boolean;
  yearLabel: string;
}) {
  const total = rows.reduce((s, r) => s + r.totalNetValue, 0);
  const ticketAvg =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.totalNetValue, 0) /
        rows.reduce((s, r) => s + r.orderCount, 0)
      : null;

  return (
    <div className={`${financeBiCardClass} overflow-hidden`}>
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h3 className="text-sm font-bold text-[#111827]">Ranking de clientes — {yearLabel}</h3>
        <FinanceFilterScopeNote className="mt-0.5">{FINANCE_BILLING_EXECUTIVE_YEAR_SCOPE}</FinanceFilterScopeNote>
        <p className="text-[11px] text-[#6B7280] mt-1">
          Participação e ticket médio por cliente no universo filtrado (fonte NF-e fiscal).
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-5 border-b border-[#E5E7EB] bg-[#F9FAFB]/50">
        <div>
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Clientes no ranking</p>
          <p className="text-lg font-black tabular-nums">{loading ? "…" : formatExecutiveInteger(rows.length)}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Faturamento ranking</p>
          <p className="text-lg font-black tabular-nums">
            {loading ? "…" : formatExecutiveCurrency(total)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Ticket médio (NF-e)</p>
          <p className="text-lg font-black tabular-nums">
            {loading ? "…" : ticketAvg != null ? formatExecutiveCurrency(ticketAvg) : "—"}
          </p>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Carregando clientes…</div>
      ) : rows.length === 0 ? (
        <div className="p-8 text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">Sem faturamento no período</p>
          <p className="text-xs text-muted-foreground">
            Ajuste ano/mês ou aguarde sincronização de NF-e.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-left">
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">#</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground">Cliente</th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  NF-e
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  Faturamento líquido
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  Participação
                </th>
                <th className="px-4 py-2.5 text-[10px] font-bold uppercase text-muted-foreground text-right">
                  Ticket médio
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {rows.map((row, idx) => {
                const share = total > 0 ? (row.totalNetValue / total) * 100 : 0;
                const ticket =
                  row.orderCount > 0 ? row.totalNetValue / row.orderCount : null;
                return (
                  <tr key={row.customerId} className="hover:bg-muted/20">
                    <td className="px-4 py-2 text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-2 font-semibold">{row.customerName}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatExecutiveInteger(row.orderCount)}
                    </td>
                    <td className="px-4 py-2 text-right font-bold tabular-nums">
                      {formatExecutiveCurrency(row.totalNetValue)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {formatExecutivePercent(share, 1)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {ticket != null ? formatExecutiveCurrency(ticket) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
