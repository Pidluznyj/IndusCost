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
import type { PortfolioOrderStatusRow } from "@/src/lib/finance/portfolioOrderStatusService";
import { cn } from "@/src/lib/utils";
import {
  ORDER_STATUS_ALERT_SEVERITY_CLASS,
  ORDER_STATUS_BADGE_CLASS,
  ORDER_STATUS_TEMP_BADGE_CLASS,
  orderStatusAlertSeverity,
  orderStatusDash,
} from "./orderStatusUi";

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
  title,
}: {
  label: string;
  column?: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = Boolean(column && sortBy === column);
  return (
    <th
      className={cn(
        "px-3 py-2.5 font-semibold whitespace-nowrap",
        align === "right" ? "text-right" : "text-left"
      )}
      scope="col"
      title={title}
      aria-sort={
        active
          ? sortDirection === "asc"
            ? "ascending"
            : "descending"
          : column
            ? "none"
            : undefined
      }
    >
      {column ? (
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70",
            active ? "text-[#101828]" : "hover:text-[#101828]"
          )}
          aria-label={
            active
              ? `Ordenar por ${label} (${sortDirection === "asc" ? "crescente" : "decrescente"})`
              : `Ordenar por ${label}`
          }
          onClick={() => onSort(column)}
        >
          {label}
          <span className="tabular-nums text-[10px] text-[#98A2B3]" aria-hidden>
            {active ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
          </span>
        </button>
      ) : (
        <span>{label}</span>
      )}
    </th>
  );
}

function AlertBadges({ alerts }: { alerts: string[] }) {
  if (!alerts.length) return <span className="text-[#98A2B3]">—</span>;
  const shown = alerts.slice(0, 3);
  const rest = alerts.length - shown.length;
  const full = alerts.map(formatOrderStatusAlertLabel).join(", ");
  return (
    <div className="flex max-w-[220px] flex-wrap gap-1" title={full}>
      {shown.map((a) => {
        const severity = orderStatusAlertSeverity(a);
        return (
          <span
            key={a}
            className={cn(
              "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold",
              ORDER_STATUS_ALERT_SEVERITY_CLASS[severity]
            )}
          >
            {formatOrderStatusAlertLabel(a)}
          </span>
        );
      })}
      {rest > 0 ? (
        <span className="text-[10px] font-semibold text-[#667085]">+{rest}</span>
      ) : null}
    </div>
  );
}

function TextCell({
  children,
  className,
  title,
}: {
  children: React.ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <td
      className={cn("max-w-[160px] truncate px-3 py-2.5 text-[#475467]", className)}
      title={title}
    >
      {children}
    </td>
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
      <div className="border-b border-[#E5E7EB] px-4 py-3.5">
        <h2 className="text-sm font-semibold text-[#101828]">Pedidos</h2>
        <p className="mt-0.5 text-xs text-[#667085]">
          Uma linha por Pedido de Venda. Clique na linha para abrir o resumo.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[1680px] w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-20 bg-[#F9FAFB]/95 text-[11px] uppercase tracking-wide text-[#667085] shadow-[0_1px_0_0_#E5E7EB]">
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
              <SortTh label="Entrega estimada" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
              <SortTh
                label="Cliente"
                column="customerName"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
              />
              <SortTh label="Responsável comercial" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
              <SortTh label="Vendedor pedido" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
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
                title="Calculado sobre os itens ativos do pedido. Itens cancelados não entram como pendência."
              />
              <SortTh
                label="Saldo pendente"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
                title="Saldo de itens ativos ainda não atendidos. Itens cancelados são exibidos separadamente."
              />
              <SortTh
                label="Valor cancelado"
                sortBy={sortBy}
                sortDirection={sortDirection}
                onSort={onSort}
                align="right"
                title="Valor dos itens cancelados no pedido de venda."
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
              <SortTh label="Status operacional" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
              <SortTh label="Status financeiro" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
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
              <SortTh label="Alertas" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
              <SortTh label="Ação recomendada" sortBy={sortBy} sortDirection={sortDirection} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = selectedOrderKey === row.orderKey;
              const temp = formatOrderStatusTemperatureLabel(row.temperature);
              const statusLabel =
                ORDER_STATUS_STATUS_LABEL[row.consolidatedOrderStatus] ??
                row.consolidatedOrderStatus;
              return (
                <tr
                  key={row.orderKey}
                  role="button"
                  tabIndex={0}
                  aria-label={`Abrir resumo do pedido ${orderStatusDash(row.orderCode)}`}
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
                      ? "bg-sky-50/90 ring-1 ring-inset ring-sky-200"
                      : row.hasPendingItems || row.hasDivergences
                        ? "bg-amber-50/25 hover:bg-amber-50/45"
                        : "bg-white hover:bg-[#F9FAFB]"
                  )}
                  data-testid={`order-status-row-${row.orderKey}`}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-[#101828]">
                    {orderStatusDash(row.orderCode)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#667085]">
                    {formatDateCell(row.orderIssueDate)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-[#667085]">
                    {formatDateCell(row.orderExpectedDeliveryDate)}
                  </td>
                  <TextCell title={orderStatusDash(row.customerName)}>
                    {orderStatusDash(row.customerName)}
                  </TextCell>
                  <TextCell title={orderStatusDash(row.commercialResponsibleName)}>
                    {orderStatusDash(row.commercialResponsibleName)}
                  </TextCell>
                  <TextCell title={orderStatusDash(row.orderSellerName)}>
                    {orderStatusDash(row.orderSellerName)}
                  </TextCell>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]">
                    {formatFinanceCurrency(row.totalOrderValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]">
                    {formatFinanceCurrency(row.allocatedOrderValue)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]"
                    title="Calculado sobre os itens ativos do pedido. Itens cancelados não entram como pendência."
                  >
                    {formatFinancePercent(row.fulfillmentPercent)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]"
                    title="Saldo de itens ativos ainda não atendidos. Itens cancelados são exibidos separadamente."
                  >
                    {formatFinanceCurrency(row.pendingOrderValue)}
                  </td>
                  <td
                    className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]"
                    title="Valor dos itens cancelados no pedido de venda."
                  >
                    {row.canceledOrderValue > 0.009
                      ? formatFinanceCurrency(row.canceledOrderValue)
                      : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]">
                    {formatFinanceCurrency(row.receivableOpenValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-[#101828]">
                    {formatFinanceCurrency(row.receivableReceivedValue)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#667085]">
                    {formatOrderStatusOperationalLabel(row.operationalStatus)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-[#667085]">
                    {formatOrderStatusFinancialLabel(row.financialStatus)}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-flex max-w-[180px] truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                        ORDER_STATUS_BADGE_CLASS[row.consolidatedOrderStatus]
                      )}
                      title={statusLabel}
                    >
                      {statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {temp === "—" ? (
                      <span className="text-[#98A2B3]">—</span>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold",
                          ORDER_STATUS_TEMP_BADGE_CLASS[temp] ??
                            "border-[#E5E7EB] bg-[#F9FAFB] text-[#667085]"
                        )}
                      >
                        {temp}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <AlertBadges alerts={row.alerts} />
                  </td>
                  <TextCell
                    className="max-w-[200px] text-xs"
                    title={orderStatusDash(row.recommendedAction)}
                  >
                    {orderStatusDash(row.recommendedAction)}
                  </TextCell>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E5E7EB] px-4 py-3 text-xs text-[#667085]"
        data-testid="order-status-pagination"
      >
        <span>
          {from}–{to} de {totalRows} pedidos · página {page} / {totalPages}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5">
            <span>Por página</span>
            <select
              className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Pedidos por página"
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
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 font-medium disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Página anterior"
            data-testid="order-status-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Anterior
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 font-medium disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Próxima página"
            data-testid="order-status-next"
          >
            Próxima
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
