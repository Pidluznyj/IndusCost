import React from "react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";

type CrRow = NonNullable<
  import("@/src/lib/financePortfolioReconciliationClient").PortfolioIntelligenceOrderDetail["fulfillmentMap"]
>["receivablesCoverage"][number];

function crStatus(row: CrRow): string {
  const open = row.openValue ?? 0;
  const received = row.receivedValue ?? 0;
  if (open <= 0.01 && received > 0.01) return "Recebido";
  if (open > 0.01 && received > 0.01) return "Parcial";
  if (open > 0.01) return "Aberto";
  return "—";
}

export function PortfolioFulfillmentReceivablesGrid({
  rows,
}: {
  rows: CrRow[];
}) {
  if (rows.length === 0) {
    return (
      <p
        className="rounded-xl border border-dashed border-[#EAECF0] bg-[#F9FAFB] px-3 py-4 text-center text-xs text-[#667085]"
        data-testid="portfolio-fulfillment-receivables-empty"
      >
        Nenhum Contas a Receber encontrado para este pedido.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="portfolio-fulfillment-receivables-grid">
      <table className="min-w-[720px] w-full border-collapse text-left text-xs">
        <thead>
          <tr className="text-[11px] font-semibold uppercase tracking-wide text-[#667085]">
            <th className="py-2 pr-2">Título/ID</th>
            <th className="py-2 pr-2">NF origem</th>
            <th className="py-2 pr-2">Vencimento</th>
            <th className="py-2 pr-2">Baixa</th>
            <th className="py-2 pr-2 text-right">Valor</th>
            <th className="py-2 pr-2 text-right">Recebido</th>
            <th className="py-2 pr-2 text-right">Aberto</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr
              key={`${r.receivableId ?? r.receivableIds?.join("-") ?? idx}`}
              className="border-t border-[#EAECF0] text-[14px] font-semibold text-[#344054]"
            >
              <td className="py-2 pr-2 tabular-nums">
                {r.receivableId ??
                  (r.receivableIds && r.receivableIds.length
                    ? r.receivableIds.join(", ")
                    : "—")}
              </td>
              <td className="py-2 pr-2 tabular-nums">{r.sourceNfe ?? "—"}</td>
              <td className="py-2 pr-2 tabular-nums text-[12px] font-normal">
                {r.dueDate ? formatFinanceDate(r.dueDate) : "—"}
              </td>
              <td className="py-2 pr-2 tabular-nums text-[12px] font-normal">
                {r.settlementDate ? formatFinanceDate(r.settlementDate) : "—"}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {formatFinanceCurrency(r.totalValue)}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {formatFinanceCurrency(r.receivedValue)}
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">
                {formatFinanceCurrency(r.openValue)}
              </td>
              <td className="py-2 text-[12px] font-semibold">{crStatus(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
