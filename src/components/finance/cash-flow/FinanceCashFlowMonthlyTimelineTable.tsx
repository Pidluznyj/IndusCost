import React from "react";
import type { FinanceCashFlowExecutiveMonthlyRow } from "@/src/lib/financeCashFlowExecutiveSummary";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

export function FinanceCashFlowMonthlyTimelineTable({
  rows,
  year,
}: {
  rows: FinanceCashFlowExecutiveMonthlyRow[];
  year: number;
}) {
  return (
    <section
      data-testid="cash-flow-monthly-timeline"
      className={financeBiSectionClass}
    >
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h3 className="text-sm font-bold text-[#111827]">Linha do tempo mensal — {year}</h3>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          Recebido/pago realizados + saldos em aberto por vencimento. Estimativas por mês
          independentes do modo Previsto/Realizado do período filtrado.
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-xs text-[#6B7280]">Sem dados para o ano selecionado.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <tr>
                <th className="px-3 py-2 font-bold text-[#6B7280]">Mês</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Recebido</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">A receber</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Entradas est.</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Pago</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">A pagar</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Saídas est.</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Saldo líq.</th>
                <th className="px-3 py-2 font-bold text-[#6B7280] text-right">Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const netPositive = row.netFlow >= 0;
                return (
                  <tr key={`${row.year}-${row.month}`} className="border-b border-[#F3F4F6]">
                    <td className="px-3 py-2 font-medium text-[#111827]">{row.monthLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#059669]">
                      {formatFinanceCurrency(row.received)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#059669]/80">
                      {formatFinanceCurrency(row.receivableOpenDue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#059669]">
                      {formatFinanceCurrency(row.estimatedInflow)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#DC2626]">
                      {formatFinanceCurrency(row.paid)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-[#DC2626]/80">
                      {formatFinanceCurrency(row.payableOpenDue)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-[#DC2626]">
                      {formatFinanceCurrency(row.estimatedOutflow)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums font-bold",
                        netPositive ? "text-[#059669]" : "text-[#DC2626]"
                      )}
                    >
                      {formatFinanceCurrency(row.netFlow)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-[#111827]">
                      {formatFinanceCurrency(row.accumulatedNet)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
