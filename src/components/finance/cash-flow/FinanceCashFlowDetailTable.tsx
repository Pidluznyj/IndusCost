import React, { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { FinanceCashFlowCriticalMovement } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiSectionClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";

function statusCaption(daysOverdue: number) {
  if (daysOverdue > 0) return `Vencido · ${daysOverdue}d`;
  return "Em aberto";
}

export function FinanceCashFlowDetailTable({
  inflows,
  outflows,
}: {
  inflows: FinanceCashFlowCriticalMovement[];
  outflows: FinanceCashFlowCriticalMovement[];
}) {
  const rows = useMemo(() => {
    const merged = [
      ...inflows.map((r) => ({ ...r, side: "inflow" as const })),
      ...outflows.map((r) => ({ ...r, side: "outflow" as const })),
    ];
    return merged.sort((a, b) => b.amount - a.amount).slice(0, 12);
  }, [inflows, outflows]);

  return (
    <div data-testid="cash-flow-detail-table" className={financeBiSectionClass}>
      <div className="px-5 py-4 border-b border-[#E5E7EB]">
        <h3 className="text-sm font-bold text-[#111827]">Detalhamento operacional</h3>
        <p className="text-[11px] text-[#6B7280] mt-0.5">
          Maiores movimentos e vencidos — apoio à leitura gerencial
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-xs text-[#6B7280]">
          Sem movimentos para os filtros aplicados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
              <tr>
                <th className="px-4 py-2.5 text-[10px] font-bold text-[#6B7280]">Tipo</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-[#6B7280]">Contraparte</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-[#6B7280]">Vencimento</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-[#6B7280]">Status</th>
                <th className="px-4 py-2.5 text-[10px] font-bold text-[#6B7280] text-right">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOut = row.side === "outflow";
                return (
                  <tr key={`${row.side}-${row.externalId}`} className="border-b border-[#F3F4F6]">
                    <td className="px-4 py-2">
                      {isOut ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#DC2626]" aria-label="Saída" />
                      ) : (
                        <ArrowDownLeft className="h-3.5 w-3.5 text-[#059669]" aria-label="Entrada" />
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-[#111827]">
                      {displayFinanceText(row.personName)}
                    </td>
                    <td className="px-4 py-2 text-[11px] text-[#6B7280]">
                      {row.dueDate ? new Date(row.dueDate).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-4 py-2 text-[10px] text-[#6B7280]">
                      {statusCaption(row.daysOverdue)}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-2 text-xs font-bold text-right tabular-nums",
                        isOut ? "text-[#DC2626]" : "text-[#059669]"
                      )}
                    >
                      {isOut ? "−" : "+"}
                      {formatFinanceCurrency(row.amount)}
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
