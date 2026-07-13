import React from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  ORDER_STATUS_PEDIDOS_STATUS_HINT,
  ORDER_STATUS_PEDIDOS_STATUS_LABEL,
  type OrderStatusPedidosOrderRow,
  type OrderStatusPedidosStatus,
} from "@/src/lib/finance/orderStatusPedidosApi";
import { cn } from "@/src/lib/utils";

type Props = {
  rows: OrderStatusPedidosOrderRow[];
  page: number;
  pageSize: number;
  totalOrders: number;
  totalPages: number;
  sortBy: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
  onOpenOrder: (orderKey: string) => void;
};

const STATUS_CLASS: Record<OrderStatusPedidosStatus, string> = {
  RECEBIDO: "bg-emerald-50 text-emerald-800 border-emerald-200",
  CR_ABERTO: "bg-sky-50 text-sky-800 border-sky-200",
  PARCIAL: "bg-amber-50 text-amber-900 border-amber-200",
  SEM_ATENDIMENTO: "bg-slate-50 text-slate-700 border-slate-200",
  DIVERGENCIA: "bg-orange-50 text-orange-900 border-orange-200",
  BLOQUEADO: "bg-rose-50 text-rose-800 border-rose-200",
};

function StatusBadge({ status }: { status: OrderStatusPedidosStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        STATUS_CLASS[status]
      )}
      title={ORDER_STATUS_PEDIDOS_STATUS_HINT[status]}
    >
      {ORDER_STATUS_PEDIDOS_STATUS_LABEL[status]}
    </span>
  );
}

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
        className="inline-flex items-center gap-1 hover:text-foreground"
        onClick={() => onSort(column)}
      >
        {label}
        {active ? (sortDirection === "asc" ? " ↑" : " ↓") : null}
      </button>
    </th>
  );
}

export function OrderStatusPedidosTable({
  rows,
  page,
  pageSize,
  totalOrders,
  totalPages,
  sortBy,
  sortDirection,
  onSort,
  onPageChange,
  onOpenOrder,
}: Props) {
  const from = totalOrders === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalOrders);

  return (
    <section
      className={cn(financeBiCardClass, "overflow-hidden")}
      data-testid="order-status-pedidos-table"
    >
      <div className="border-b border-border/70 px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">Pedidos</h2>
        <p className="text-xs text-muted-foreground">
          Uma linha por Pedido de Venda. CR e NF de título não são valor de item.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1100px] w-full border-collapse text-left text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
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
                column="orderNetValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Alocado"
                column="allocatedValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="CR título"
                column="receivableTotalValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Aberto"
                column="receivableOpenValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Status"
                column="orderStatus"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <th className="px-3 py-2 font-semibold">Sinais</th>
              <th className="px-3 py-2 font-semibold">NF</th>
              <th className="px-3 py-2 font-semibold">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.orderKey}
                className={cn(
                  "border-t border-border/60 align-top",
                  row.hasPendingItems || row.hasDivergences
                    ? "bg-amber-50/30"
                    : "bg-card"
                )}
              >
                <td className="px-3 py-2 font-medium text-foreground">
                  {row.orderCode ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.customerName ?? "—"}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {row.orderIssueDate
                    ? formatFinanceDate(row.orderIssueDate.slice(0, 10))
                    : "—"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatFinanceCurrency(row.orderNetValue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatFinanceCurrency(row.allocatedValue)}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  title="CR do título (1× por pedido) — não é valor de produto"
                >
                  {formatFinanceCurrency(row.receivableTotalValue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatFinanceCurrency(row.receivableOpenValue)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={row.orderStatus} />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {row.hasPendingItems ? (
                      <span
                        className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
                        title="Há item do pedido sem evidência de faturamento/alocação"
                      >
                        Item pendente
                      </span>
                    ) : null}
                    {row.hasOpenCr ? (
                      <span
                        className="rounded border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-900"
                        title="Contas a Receber com saldo aberto"
                      >
                        CR aberto
                      </span>
                    ) : null}
                    {row.hasDivergences ? (
                      <span
                        className="rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-900"
                        title="Excedente, produto fora do pedido, preço ou NF divergente"
                      >
                        Divergência
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.nfeNumbers.length ? row.nfeNumbers.join(", ") : "—"}
                </td>
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-semibold hover:bg-muted/50"
                    onClick={() => onOpenOrder(row.orderKey)}
                    data-testid={`order-status-pedidos-open-${row.orderKey}`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    Detalhe
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-xs text-muted-foreground">
        <span>
          {from}–{to} de {totalOrders} pedidos
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40"
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
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40"
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
