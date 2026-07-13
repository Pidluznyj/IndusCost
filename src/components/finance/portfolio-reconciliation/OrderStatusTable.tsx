import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  ORDER_STATUS_STATUS_LABEL,
} from "@/src/lib/finance/portfolioOrderStatusClient";
import type {
  PortfolioOrderStatusConsolidated,
  PortfolioOrderStatusRow,
} from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";

type Props = {
  rows: PortfolioOrderStatusRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  sortBy: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
};

const STATUS_CLASS: Record<PortfolioOrderStatusConsolidated, string> = {
  COMPLETO_RECEBIDO: "bg-emerald-50 text-emerald-800 border-emerald-200",
  COMPLETO_CR_ABERTO: "bg-sky-50 text-sky-800 border-sky-200",
  COMPLETO_SEM_CR: "bg-amber-50 text-amber-900 border-amber-200",
  PARCIAL_RECEBIDO: "bg-emerald-50/80 text-emerald-900 border-emerald-200",
  PARCIAL_CR_ABERTO: "bg-amber-50 text-amber-900 border-amber-200",
  PARCIAL_SEM_CR: "bg-orange-50 text-orange-900 border-orange-200",
  SEM_ATENDIMENTO_FUTURO: "bg-slate-50 text-slate-700 border-slate-200",
  SEM_ATENDIMENTO_ATRASADO: "bg-slate-100 text-slate-800 border-slate-300",
  NF_SEM_CR: "bg-orange-50 text-orange-900 border-orange-200",
  BLOQUEADO_REVISAO: "bg-rose-50 text-rose-800 border-rose-200",
  CANCELADO: "bg-slate-100 text-slate-600 border-slate-300",
};

function SortTh({
  label,
  column,
  sortBy,
  sortDirection,
  onSort,
  align = "left",
}: {
  label: string;
  column: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  align?: "left" | "right";
}) {
  const active = sortBy === column;
  return (
    <th
      className={cn(
        "px-3 py-2 font-semibold",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-[#111827]"
        onClick={() => onSort(column)}
      >
        {label}
        {active ? (sortDirection === "asc" ? " ↑" : " ↓") : null}
      </button>
    </th>
  );
}

export function OrderStatusTable({
  rows,
  page,
  pageSize,
  totalRows,
  totalPages,
  sortBy,
  sortDirection,
  onSort,
  onPageChange,
}: Props) {
  const from = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalRows);

  return (
    <section
      className="overflow-hidden rounded-[14px] border border-[#E5E7EB] bg-white shadow-sm"
      data-testid="order-status-table"
    >
      <div className="border-b border-[#E5E7EB] px-4 py-3">
        <h2 className="text-sm font-semibold text-[#111827]">Pedidos</h2>
        <p className="text-xs text-[#6B7280]">
          Uma linha por Pedido de Venda. CR agregado 1× por título.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
          <thead className="bg-[#F9FAFB] text-[11px] uppercase tracking-wide text-[#6B7280]">
            <tr>
              <SortTh
                label="Pedido"
                column="orderCode"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Cliente"
                column="customerName"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Emissão"
                column="orderIssueDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Valor pedido"
                column="totalOrderValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Alocado"
                column="allocatedOrderValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="% Atend."
                column="fulfillmentPercent"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="CR aberto"
                column="receivableOpenValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Recebido"
                column="receivableReceivedValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Status"
                column="consolidatedOrderStatus"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-3 py-2 font-semibold">Temperatura</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.orderKey}
                className={cn(
                  "border-t border-[#E5E7EB] align-top",
                  row.hasPendingItems || row.hasDivergences
                    ? "bg-amber-50/30"
                    : "bg-white"
                )}
              >
                <td className="px-3 py-2.5 font-medium text-[#111827]">
                  {row.orderCode ?? "—"}
                </td>
                <td className="px-3 py-2.5 text-[#6B7280]">
                  {row.customerName ?? "—"}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-[#6B7280]">
                  {row.orderIssueDate
                    ? formatFinanceDate(row.orderIssueDate.slice(0, 10))
                    : "—"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatFinanceCurrency(row.totalOrderValue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatFinanceCurrency(row.allocatedOrderValue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {row.fulfillmentPercent.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                  %
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatFinanceCurrency(row.receivableOpenValue)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {formatFinanceCurrency(row.receivableReceivedValue)}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                      STATUS_CLASS[row.consolidatedOrderStatus]
                    )}
                  >
                    {ORDER_STATUS_STATUS_LABEL[row.consolidatedOrderStatus] ??
                      row.consolidatedOrderStatus}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-xs text-[#6B7280]">
                  {row.temperature ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-[#E5E7EB] px-4 py-3 text-xs text-[#6B7280]">
        <span>
          {from}–{to} de {totalRows} pedidos
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <span>
            Página {page} / {totalPages}
          </span>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}
