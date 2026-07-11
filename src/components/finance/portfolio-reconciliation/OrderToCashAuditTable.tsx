import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";
import type { OrderToCashAuditSortBy } from "@/src/lib/finance/orderToCashAuditApi";
import {
  ORDER_TO_CASH_AUDIT_BADGE_CLASS,
  ORDER_TO_CASH_AUDIT_PAGE_SIZE_OPTIONS,
  formatOrderToCashAuditQuantity,
  resolveOrderToCashAuditBadgeTone,
  type OrderToCashAuditUiFilters,
} from "@/src/lib/finance/orderToCashAuditClient";

type ColumnDef = {
  id: string;
  label: string;
  sortKey?: OrderToCashAuditSortBy;
  align?: "left" | "right";
  sticky?: boolean;
};

const COLUMNS: ColumnDef[] = [
  { id: "orderCode", label: "Pedido", sortKey: "orderCode", sticky: true },
  { id: "orderIssueDate", label: "Data pedido", sortKey: "orderIssueDate" },
  { id: "orderExpectedDeliveryDate", label: "Entrega estimada", sortKey: "orderExpectedDeliveryDate" },
  { id: "customerName", label: "Cliente", sortKey: "customerName" },
  { id: "sellerName", label: "Vendedor", sortKey: "sellerName" },
  { id: "productSku", label: "Produto/SKU", sortKey: "productCode" },
  { id: "orderedQuantity", label: "Item pedido - qtd", sortKey: "orderedQuantity", align: "right" },
  { id: "orderItemTotalValue", label: "Valor item pedido", sortKey: "orderItemTotalValue", align: "right" },
  { id: "stockDocumentExternalId", label: "Documento saída", sortKey: "stockDocumentExternalId" },
  { id: "stockDocumentDate", label: "Data doc. saída", sortKey: "stockDocumentDate" },
  { id: "stockDocumentItemQuantity", label: "Item doc. - qtd", align: "right" },
  { id: "quantityUsedForOrder", label: "Qtd usada no pedido", sortKey: "quantityUsedForOrder", align: "right" },
  { id: "excessQuantity", label: "Excedente", sortKey: "excessQuantity", align: "right" },
  { id: "outsideOrderQuantity", label: "Produto fora pedido", sortKey: "outsideOrderQuantity", align: "right" },
  { id: "nfeNumber", label: "NF", sortKey: "nfeNumber" },
  { id: "nfeIssueDate", label: "Data NF", sortKey: "nfeIssueDate" },
  { id: "nfeHeaderValue", label: "Valor cabeçalho NF", sortKey: "nfeHeaderValue", align: "right" },
  { id: "allocatedValueByOrderPrice", label: "Valor atribuído ao pedido", sortKey: "allocatedValueByOrderPrice", align: "right" },
  { id: "receivableTotalValue", label: "CR total", sortKey: "receivableTotalValue", align: "right" },
  { id: "receivableOpenValue", label: "CR aberto", sortKey: "receivableOpenValue", align: "right" },
  { id: "receivableReceivedValue", label: "Recebido", sortKey: "receivableReceivedValue", align: "right" },
  { id: "paymentDueDate", label: "Vencimento", sortKey: "paymentDueDate" },
  { id: "paymentSettlementDate", label: "Baixa", sortKey: "paymentSettlementDate" },
  { id: "paymentStatus", label: "Status pagamento", sortKey: "paymentStatus" },
  { id: "operationalStage", label: "Status operacional", sortKey: "operationalStage" },
  { id: "financialStage", label: "Status financeiro", sortKey: "financialStage" },
  { id: "orderToCashStage", label: "Estágio Pedido → Caixa", sortKey: "orderToCashStage" },
  { id: "temperature", label: "Temperatura", sortKey: "temperature" },
  { id: "confidenceLabel", label: "Confiança", sortKey: "confidenceScore" },
  { id: "alerts", label: "Alertas" },
  { id: "responsibleArea", label: "Responsável" },
  { id: "recommendedAction", label: "Ação recomendada" },
];

type Props = {
  rows: OrderToCashAuditListRow[];
  filters: OrderToCashAuditUiFilters;
  totalRows: number;
  totalPages: number;
  onSort: (columnSortKey: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowClick: (row: OrderToCashAuditListRow) => void;
  selectedId: string | null;
};

function Badge({
  value,
  kind,
}: {
  value: string | null | undefined;
  kind: "payment" | "stage" | "temperature" | "confidence" | "alert";
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = resolveOrderToCashAuditBadgeTone({ kind, value });
  return (
    <span
      className={cn(
        "inline-flex max-w-[160px] truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        ORDER_TO_CASH_AUDIT_BADGE_CLASS[tone]
      )}
      title={value}
    >
      {value}
    </span>
  );
}

function money(value: number | null | undefined): string {
  if (value == null) return "—";
  return formatFinanceCurrency(value);
}

function cellContent(row: OrderToCashAuditListRow, columnId: string): React.ReactNode {
  switch (columnId) {
    case "orderCode":
      return row.orderCode ?? "—";
    case "orderIssueDate":
      return formatFinanceDate(row.orderIssueDate);
    case "orderExpectedDeliveryDate":
      return formatFinanceDate(row.orderExpectedDeliveryDate);
    case "customerName":
      return (
        <span className="block max-w-[160px] truncate" title={row.customerName ?? undefined}>
          {row.customerName ?? "—"}
        </span>
      );
    case "sellerName":
      return row.sellerName ?? "—";
    case "productSku":
      return (
        <span
          className="block max-w-[160px] truncate"
          title={[row.productCode, row.sku, row.productName].filter(Boolean).join(" · ")}
        >
          {[row.productCode, row.sku].filter(Boolean).join(" / ") || row.productName || "—"}
        </span>
      );
    case "orderedQuantity":
      return formatOrderToCashAuditQuantity(row.orderedQuantity);
    case "orderItemTotalValue":
      return money(row.orderItemTotalValue);
    case "stockDocumentExternalId":
      return row.stockDocumentExternalId ?? "—";
    case "stockDocumentDate":
      return formatFinanceDate(row.stockDocumentDate);
    case "stockDocumentItemQuantity":
      return formatOrderToCashAuditQuantity(row.stockDocumentItemQuantity);
    case "quantityUsedForOrder":
      return formatOrderToCashAuditQuantity(row.quantityUsedForOrder);
    case "excessQuantity":
      return formatOrderToCashAuditQuantity(row.excessQuantity);
    case "outsideOrderQuantity":
      return formatOrderToCashAuditQuantity(row.outsideOrderQuantity);
    case "nfeNumber":
      return row.nfeNumber ?? "—";
    case "nfeIssueDate":
      return formatFinanceDate(row.nfeIssueDate);
    case "nfeHeaderValue":
      return money(row.nfeHeaderValue);
    case "allocatedValueByOrderPrice":
      return money(row.allocatedValueByOrderPrice);
    case "receivableTotalValue":
      return money(row.receivableTotalValue);
    case "receivableOpenValue":
      return money(row.receivableOpenValue);
    case "receivableReceivedValue":
      return money(row.receivableReceivedValue);
    case "paymentDueDate":
      return formatFinanceDate(row.paymentDueDate);
    case "paymentSettlementDate":
      return formatFinanceDate(row.paymentSettlementDate);
    case "paymentStatus":
      return <Badge value={row.paymentStatus} kind="payment" />;
    case "operationalStage":
      return <Badge value={row.operationalStage} kind="stage" />;
    case "financialStage":
      return <Badge value={row.financialStage} kind="stage" />;
    case "orderToCashStage":
      return <Badge value={row.orderToCashStage} kind="stage" />;
    case "temperature":
      return <Badge value={row.temperature} kind="temperature" />;
    case "confidenceLabel":
      return (
        <Badge
          value={
            row.confidenceLabel ??
            (row.confidenceScore != null ? String(row.confidenceScore) : null)
          }
          kind="confidence"
        />
      );
    case "alerts":
      if (!row.alerts?.length) return "—";
      return (
        <div className="flex max-w-[220px] flex-wrap gap-1">
          {row.alerts.slice(0, 3).map((alert) => (
            <Badge key={alert} value={alert} kind="alert" />
          ))}
          {row.alerts.length > 3 ? (
            <span className="text-[10px] text-muted-foreground" title={row.alerts.join(", ")}>
              +{row.alerts.length - 3}
            </span>
          ) : null}
        </div>
      );
    case "responsibleArea":
      return (
        <span className="block max-w-[120px] truncate" title={row.responsibleArea ?? undefined}>
          {row.responsibleArea ?? "—"}
        </span>
      );
    case "recommendedAction":
      return (
        <span
          className="block max-w-[180px] truncate"
          title={row.recommendedAction ?? undefined}
        >
          {row.recommendedAction ?? "—"}
        </span>
      );
    default:
      return "—";
  }
}

export function OrderToCashAuditTable({
  rows,
  filters,
  totalRows,
  totalPages,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  selectedId,
}: Props) {
  const from = totalRows === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(filters.page * filters.pageSize, totalRows);

  return (
    <section
      className={cn(financeBiCardClass, "overflow-hidden")}
      data-testid="order-to-cash-audit-table"
    >
      <div className="overflow-x-auto">
        <table className="min-w-[2800px] w-full border-collapse text-left text-xs">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {COLUMNS.map((col) => {
                const sortable = Boolean(col.sortKey);
                const active = col.sortKey != null && filters.sortBy === col.sortKey;
                return (
                  <th
                    key={col.id}
                    className={cn(
                      "whitespace-nowrap px-2.5 py-2 font-semibold",
                      col.align === "right" ? "text-right" : "text-left",
                      sortable && "cursor-pointer select-none hover:text-foreground",
                      col.sticky && "sticky left-0 z-10 bg-muted/95"
                    )}
                    onClick={sortable ? () => onSort(col.sortKey!) : undefined}
                    title={sortable ? "Clique para ordenar" : undefined}
                    aria-sort={
                      active
                        ? filters.sortDirection === "asc"
                          ? "ascending"
                          : "descending"
                        : undefined
                    }
                    data-testid={
                      sortable ? `order-to-cash-audit-sort-${col.sortKey}` : undefined
                    }
                  >
                    <span className="inline-flex items-center gap-0.5">
                      {col.label}
                      {sortable ? (
                        active ? (
                          filters.sortDirection === "asc" ? (
                            <ArrowUp className="h-3 w-3" aria-hidden />
                          ) : (
                            <ArrowDown className="h-3 w-3" aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden />
                        )
                      ) : null}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  "border-t border-border/60 align-top hover:bg-muted/30",
                  selectedId === row.id && "bg-sky-50/70"
                )}
                onClick={() => onRowClick(row)}
                data-testid={`order-to-cash-audit-row-${row.id}`}
              >
                {COLUMNS.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-2.5 py-2 tabular-nums",
                      col.align === "right" ? "text-right" : "text-left",
                      col.sticky && "sticky left-0 z-[1] bg-card"
                    )}
                  >
                    {cellContent(row, col.id)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground"
        data-testid="order-to-cash-audit-pagination"
      >
        <p>
          Página {filters.page} de {Math.max(1, totalPages)} · {from}–{to} de {totalRows}{" "}
          registros
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1">
            <span>Por página</span>
            <select
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
              value={filters.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              data-testid="order-to-cash-audit-page-size"
            >
              {ORDER_TO_CASH_AUDIT_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={filters.page <= 1}
            onClick={() => onPageChange(filters.page - 1)}
            data-testid="order-to-cash-audit-prev"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Anterior
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 disabled:opacity-40"
            disabled={filters.page >= totalPages}
            onClick={() => onPageChange(filters.page + 1)}
            data-testid="order-to-cash-audit-next"
          >
            Próximo
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
}

export { COLUMNS as ORDER_TO_CASH_AUDIT_TABLE_COLUMNS };
