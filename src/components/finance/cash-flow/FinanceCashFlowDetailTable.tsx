import React, { useMemo } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { FinanceCashFlowCriticalMovement } from "@/src/lib/financeCashFlowDashboardTypes";
import {
  displayFinanceText,
  formatFinanceCurrency,
} from "@/src/lib/financeAccountsReceivableFormat";
import { controlRoomCardClass } from "@/src/lib/financeControlRoomTheme";
import { cn } from "@/src/lib/utils";

function statusPill(daysOverdue: number) {
  if (daysOverdue > 0) {
    return (
      <span className="font-mono rounded-full border border-[#D07722]/35 bg-[#FBF3E8] px-1.5 py-0.5 text-[9px] text-[#D07722]">
        Vencido
      </span>
    );
  }
  return (
    <span className="font-mono rounded-full border border-[#D6D3D1] bg-[#F5F5F4] px-1.5 py-0.5 text-[9px] text-[#57534E]">
      Aberto
    </span>
  );
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
    <div data-testid="cash-flow-detail-table" className={cn(controlRoomCardClass, "overflow-hidden")}>
      <div className="px-3.5 py-2.5 border-b border-[#E7E5E4]">
        <h3 className="font-ui text-sm font-semibold text-[#1C1917]">Títulos críticos consolidados</h3>
        <p className="font-mono text-[10px] text-[#57534E]">
          Maiores movimentos e vencidos — AR e AP
        </p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3.5 py-6 font-ui text-xs text-[#57534E]">
          Sem movimentos para os filtros aplicados.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="sticky top-0 bg-[#F5F5F4] border-b border-[#E7E5E4]">
              <tr>
                <th className="font-ui px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#57534E]">
                  Tipo
                </th>
                <th className="font-ui px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#57534E]">
                  Contraparte
                </th>
                <th className="font-ui px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#57534E]">
                  Vencimento
                </th>
                <th className="font-ui px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#57534E]">
                  Status
                </th>
                <th className="font-ui px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-[#57534E] text-right">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isOut = row.side === "outflow";
                return (
                  <tr
                    key={`${row.side}-${row.externalId}`}
                    className="border-b border-[#E7E5E4]/80 hover:bg-[#F5F5F4]/60"
                  >
                    <td className="px-3 py-1.5">
                      {isOut ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#B64230]" aria-label="Saída" />
                      ) : (
                        <ArrowDownLeft className="h-3.5 w-3.5 text-[#2C5530]" aria-label="Entrada" />
                      )}
                    </td>
                    <td className="font-ui px-3 py-1.5 text-xs text-[#1C1917]">
                      {displayFinanceText(row.personName)}
                    </td>
                    <td className="font-mono px-3 py-1.5 text-[10px] text-[#57534E]">
                      {row.dueDate ? new Date(row.dueDate).toLocaleDateString("pt-BR") : "—"}
                    </td>
                    <td className="px-3 py-1.5">{statusPill(row.daysOverdue)}</td>
                    <td
                      className={cn(
                        "font-mono px-3 py-1.5 text-xs font-semibold text-right tabular-nums",
                        isOut ? "text-[#B64230]" : "text-[#2C5530]"
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
