import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  ORDER_STATUS_PAGE_SIZE_OPTIONS,
  ORDER_STATUS_STATUS_LABEL,
  formatOrderStatusAlertLabel,
  formatOrderStatusFinancialLabel,
  formatOrderStatusOperationalLabel,
  formatOrderStatusTemperatureLabel,
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
  selectedOrderKey: string | null;
  onSort: (column: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowClick: (row: PortfolioOrderStatusRow) => void;
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

const TEMP_CLASS: Record<string, string> = {
  QUENTE: "bg-rose-50 text-rose-800 border-rose-200",
  MORNO: "bg-amber-50 text-amber-900 border-amber-200",
  FRIO: "bg-sky-50 text-sky-800 border-sky-200",
  CONGELADO: "bg-slate-100 text-slate-700 border-slate-300",
};

function dash(value: string | null | undefined): string {
  const s = value?.trim();
  return s ? s : "—";
}

function formatDateCell(iso: string | null | undefined): string {
  if (!iso) return "—";
  return formatFinanceDate(iso.slice(0, 10)) || "—";
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
  column?: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  align?: "left" | "right";
}) {
  const active = Boolean(column && sortBy === column);
  return (
    <th
      className={cn(
        "px-3 py-2 font-semibold whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {column ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-[#111827]"
          onClick={() => onSort(column)}
        >
          {label}
          {active ? (sortDirection === "asc" ? " ↑" : " ↓") : null}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

function AlertBadges({ alerts }: { alerts: string[] }) {
  if (!alerts.length) return <span className="text-[#9CA3AF]">—</span>;
  const shown = alerts.slice(0, 3);
  const rest = alerts.length - shown.length;
  return (
    <div className="flex max-w-[220px] flex-wrap gap-1" title={alerts.join(", ")}>
      {shown.map((a) => (
        <span
          key={a}
          className="inline-flex rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-900"
        >
          {formatOrderStatusAlertLabel(a)}
        </span>
      ))}
      {rest > 0 ? (
        <span className="text-[10px] font-semibold text-[#6B7280]">+{rest}</span>
      ) : null}
    </div>
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
  selectedOrderKey,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
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
          Uma linha por Pedido de Venda. CR agregado 1× por título. Clique para
          abrir o resumo.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1680px] w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-20 bg-[#F9FAFB]/95 text-[11px] uppercase tracking-wide text-[#6B7280] shadow-[0_1px_0_0_#E5E7EB]">
            <tr>
              <SortTh
                label="Pedido"
                column="orderCode"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Data pedido"
                column="orderIssueDate"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Entrega estimada"
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
                label="Responsável comercial"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Vendedor pedido"
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
                label="Valor atendido"
                column="allocatedOrderValue"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="% atendido"
                column="fulfillmentPercent"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
              />
              <SortTh
                label="Saldo pendente"
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
                label="Status operacional"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Status financeiro"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Status consolidado"
                column="consolidatedOrderStatus"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Temperatura"
                column="temperature"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Alertas"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh
                label="Ação recomendada"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedOrderKey === row.orderKey;
              const temp = formatOrderStatusTemperatureLabel(row.temperature);
              return (
                <tr
                  key={row.orderKey}
                  role="button"
                  tabIndex={0}
                  onClick={() => onRowClick(row)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick(row);
                    }
                  }}
                  className={cn(
                    "cursor-pointer border-t border-[#E5E7EB] align-top transition-colors",
                    selected
                      ? "bg-sky-50/80"
                      : row.hasPendingItems || row.hasDivergences
                        ? "bg-amber-50/30 hover:bg-amber-50/50"
                        : "bg-white hover:bg-[#F9FAFB]"
                  )}
                  data-testid={`order-status-row-${row.orderKey}`}
                >
                  <td className="px-3 py-2.5 font-medium text-[#111827]">
                    {dash(row.orderCode)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[#6B7280]">
                    {formatDateCell(row.orderIssueDate)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-[#6B7280]">
                    {formatDateCell(row.orderExpectedDeliveryDate)}
                  </td>
                  <td className="px-3 py-2.5 text-[#6B7280]">
                    {dash(row.customerName)}
                  </td>
                  <td className="px-3 py-2.5 text-[#6B7280]">
                    {dash(row.commercialResponsibleName)}
                  </td>
                  <td className="px-3 py-2.5 text-[#6B7280]">
                    {dash(row.orderSellerName)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinanceCurrency(row.totalOrderValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinanceCurrency(row.allocatedOrderValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinancePercent(row.fulfillmentPercent)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinanceCurrency(row.pendingOrderValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinanceCurrency(row.receivableOpenValue)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[#111827]">
                    {formatFinanceCurrency(row.receivableReceivedValue)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#6B7280]">
                    {formatOrderStatusOperationalLabel(row.operationalStatus)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#6B7280]">
                    {formatOrderStatusFinancialLabel(row.financialStatus)}
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
                  <td className="px-3 py-2.5">
                    {temp === "—" ? (
                      <span className="text-[#9CA3AF]">—</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                          TEMP_CLASS[temp] ??
                            "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]"
                        )}
                      >
                        {temp}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <AlertBadges alerts={row.alerts} />
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[#6B7280]">
                    {dash(row.recommendedAction)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] px-4 py-3 text-xs text-[#6B7280]"
        data-testid="order-status-pagination"
      >
        <span>
          {from}–{to} de {totalRows} pedidos · página {page} / {totalPages}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1">
            <span>Por página</span>
            <select
              className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-xs"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              data-testid="order-status-page-size"
            >
              {ORDER_STATUS_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            data-testid="order-status-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            data-testid="order-status-next"
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}
