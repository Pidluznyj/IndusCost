import React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  TABLE_HORIZONTAL_TOP_SCROLL_CLASS,
  useTableHorizontalScrollSync,
} from "./useTableHorizontalScrollSync";
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
  resolveOrderToCashAuditBadgeTone,
  type OrderToCashAuditUiFilters,
} from "@/src/lib/finance/orderToCashAuditClient";
import { pendingQuantityOfAuditRow } from "@/src/lib/finance/orderToCashAuditItemsUi";
import {
  formatOrderToCashConfidence,
  formatOrderToCashEvidenceLevel,
  formatOrderToCashFinancialStage,
  formatOrderToCashLineBilledSource,
  formatOrderToCashLineType,
  formatOrderToCashOperationalStage,
  formatOrderToCashPaymentStatus,
  formatOrderToCashStage,
  formatOrderToCashTemperature,
  formatOrderItemStatus,
  withRawTooltip,
} from "@/src/lib/finance/orderToCashAuditLabels";

type ColumnDef = {
  id: string;
  label: string;
  sortKey?: OrderToCashAuditSortBy;
  align?: "left" | "right";
  sticky?: boolean;
  tooltip?: string;
};

const COLUMNS: ColumnDef[] = [
  { id: "orderCode", label: "Pedido", sortKey: "orderCode", sticky: true },
  { id: "orderIssueDate", label: "Data pedido", sortKey: "orderIssueDate" },
  { id: "orderExpectedDeliveryDate", label: "Entrega estimada", sortKey: "orderExpectedDeliveryDate" },
  { id: "customerName", label: "Cliente", sortKey: "customerName" },
  { id: "sellerName", label: "Vendedor", sortKey: "sellerName" },
  { id: "productSku", label: "Produto/SKU", sortKey: "productCode" },
  { id: "lineType", label: "Tipo linha" },
  { id: "orderedQuantity", label: "Qtd pedida", align: "right" },
  { id: "quantityUsedForOrder", label: "Qtd atendida", align: "right" },
  { id: "pendingQuantity", label: "Qtd pendente", align: "right" },
  { id: "stockDocumentExternalId", label: "Documento saída", sortKey: "stockDocumentExternalId" },
  { id: "nfeNumber", label: "NF", sortKey: "nfeNumber" },
  {
    id: "orderItemTotalValue",
    label: "Valor item pedido",
    sortKey: "orderItemTotalValue",
    align: "right",
  },
  {
    id: "allocatedValueByOrderPrice",
    label: "Valor atribuído ao pedido",
    sortKey: "allocatedValueByOrderPrice",
    align: "right",
    tooltip:
      "Valor atribuído ao pedido respeitando o limite do item vendido. Não deixa cabeçalho de NF ou excedente inflar o pedido.",
  },
  {
    id: "lineBilledValue",
    label: "Valor cobrado linha",
    align: "right",
    tooltip:
      "Valor do item no documento de saída ou NF. Este é o valor usado para responder quanto foi cobrado daquele produto.",
  },
  {
    id: "lineBilledValueLabel",
    label: "Fonte valor cobrado",
  },
  {
    id: "receivableTotalValue",
    label: "CR total título",
    sortKey: "receivableTotalValue",
    align: "right",
    tooltip:
      "Valor total do título financeiro. Pode se repetir em várias linhas e não representa o valor individual do produto.",
  },
  { id: "receivableOpenValue", label: "CR aberto", sortKey: "receivableOpenValue", align: "right" },
  { id: "receivableReceivedValue", label: "Recebido", sortKey: "receivableReceivedValue", align: "right" },
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
  /** Oculta colunas por id (ex.: drilldown por pedido). */
  hideColumnIds?: readonly string[];
  /** Esconde paginação (quando o painel já pagina/filtra no cliente). */
  hidePagination?: boolean;
  /** data-testid da seção (default: order-to-cash-audit-table). */
  testId?: string;
};

type BadgeKind =
  | "payment"
  | "stage"
  | "operationalStage"
  | "financialStage"
  | "orderToCashStage"
  | "temperature"
  | "confidence"
  | "alert";

function badgeLabel(value: string, kind: BadgeKind): string {
  switch (kind) {
    case "payment":
      return formatOrderToCashPaymentStatus(value);
    case "operationalStage":
      return formatOrderToCashOperationalStage(value);
    case "financialStage":
      return formatOrderToCashFinancialStage(value);
    case "orderToCashStage":
      return formatOrderToCashStage(value);
    case "temperature":
      return formatOrderToCashTemperature(value);
    case "confidence":
      return formatOrderToCashConfidence(value);
    // "stage" genérico e "alert" mantêm o valor bruto (alertas já são traduzidos
    // no chamador; "stage" genérico é fallback quando o kind exato é desconhecido).
    default:
      return value;
  }
}

function Badge({
  value,
  kind,
}: {
  value: string | null | undefined;
  kind: BadgeKind;
}) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  const tone = resolveOrderToCashAuditBadgeTone({
    kind: kind === "operationalStage" || kind === "financialStage" || kind === "orderToCashStage"
      ? "stage"
      : kind,
    value,
  });
  const display = badgeLabel(value, kind);
  const { title } = withRawTooltip(display, value);
  return (
    <span
      className={cn(
        "inline-flex max-w-[160px] truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold",
        ORDER_TO_CASH_AUDIT_BADGE_CLASS[tone]
      )}
      title={title}
    >
      {display}
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
    case "lineType": {
      const raw = row.lineType ?? null;
      if (!raw) return "—";
      const label = formatOrderToCashLineType(raw);
      const { title } = withRawTooltip(label, raw);
      return (
        <span className="block max-w-[180px] truncate" title={title}>
          {label}
        </span>
      );
    }
    case "orderedQuantity":
      return row.orderedQuantity == null ? "—" : String(row.orderedQuantity);
    case "quantityUsedForOrder":
      if (row.lineType === "ORDER_ITEM_PENDING") return "—";
      return row.quantityUsedForOrder == null ? "—" : String(row.quantityUsedForOrder);
    case "pendingQuantity": {
      if (
        row.itemFulfillmentStatus === "CANCELADO" ||
        (row.orderItemStatus ?? "").toUpperCase().includes("CANCEL")
      ) {
        return "0";
      }
      const pending = pendingQuantityOfAuditRow(row);
      return pending == null ? "—" : String(pending);
    }
    case "stockDocumentExternalId":
      if (row.lineType === "ORDER_ITEM_PENDING") {
        return (
          <span className="text-muted-foreground" title="Item pendente — sem documento de saída do item">
            —
          </span>
        );
      }
      return row.stockDocumentExternalId ?? "—";
    case "orderItemTotalValue":
      return money(row.orderItemTotalValue);
    case "allocatedValueByOrderPrice":
      return money(row.allocatedValueByOrderPrice);
    case "lineBilledValue":
      return row.lineBilledValue == null ? (
        <span className="text-muted-foreground" title={row.lineBilledValueLabel}>
          {row.lineBilledValueLabel || "Não identificado"}
        </span>
      ) : (
        money(row.lineBilledValue)
      );
    case "lineBilledValueLabel": {
      const sourceLabel = formatOrderToCashLineBilledSource(row.lineBilledValueSource);
      // Preferir o label vindo do backend quando existir; senão usa a tabela PT-BR
      // e mantém o valor bruto no tooltip.
      const display = row.lineBilledValueLabel?.trim() || sourceLabel;
      const { title } = withRawTooltip(display, row.lineBilledValueSource ?? undefined);
      return (
        <span
          className={cn(
            "inline-flex max-w-[160px] truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold",
            row.lineBilledValueSource === "NOT_IDENTIFIED" ||
              row.lineBilledValueSource === "NOT_BILLED"
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-sky-200 bg-sky-50 text-sky-900"
          )}
          title={title}
        >
          {display}
        </span>
      );
    }
    case "receivableTotalValue":
      return money(row.titleReceivableTotalValue ?? row.receivableTotalValue);
    case "nfeNumber":
      if (row.lineType === "ORDER_ITEM_PENDING") {
        return (
          <span
            className="text-muted-foreground"
            title={
              row.titleNfeNumber
                ? `NF do título (não do item): ${row.titleNfeNumber}`
                : "Sem NF no item"
            }
          >
            —
          </span>
        );
      }
      return row.nfeNumber ?? "—";
    case "receivableOpenValue":
      return money(row.receivableOpenValue);
    case "receivableReceivedValue":
      return money(row.receivableReceivedValue);
    case "paymentStatus":
      return <Badge value={row.paymentStatus} kind="payment" />;
    case "operationalStage":
      if (
        row.itemFulfillmentStatus === "CANCELADO" ||
        (row.orderItemStatus ?? "").toUpperCase().includes("CANCEL")
      ) {
        return <Badge value="CANCELADO" kind="operationalStage" />;
      }
      return <Badge value={row.operationalStage} kind="operationalStage" />;
    case "financialStage":
      return <Badge value={row.financialStage} kind="financialStage" />;
    case "orderToCashStage":
      return <Badge value={row.orderToCashStage} kind="orderToCashStage" />;
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

const AUDIT_TABLE_MIN_WIDTH = 2800;

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
  hideColumnIds,
  hidePagination,
  testId = "order-to-cash-audit-table",
}: Props) {
  const hidden = new Set(hideColumnIds ?? []);
  const visibleColumns = COLUMNS.filter((c) => !hidden.has(c.id));
  const from = totalRows === 0 ? 0 : (filters.page - 1) * filters.pageSize + 1;
  const to = Math.min(filters.page * filters.pageSize, totalRows);

  const {
    topScrollRef,
    mainScrollRef,
    tableRef,
    handleTopScroll,
    handleMainScroll,
    scrollContentWidth,
  } = useTableHorizontalScrollSync({
    minWidth: AUDIT_TABLE_MIN_WIDTH,
    deps: [rows],
  });

  return (
    <section
      className={cn(financeBiCardClass, "min-w-0 max-w-full overflow-hidden")}
      data-testid={testId}
    >
      <div
        ref={topScrollRef}
        className={TABLE_HORIZONTAL_TOP_SCROLL_CLASS}
        onScroll={handleTopScroll}
        data-testid="order-to-cash-audit-scroll-top"
        aria-label="Rolagem horizontal da tabela (topo)"
        role="scrollbar"
        aria-orientation="horizontal"
        aria-controls="order-to-cash-audit-scroll-main"
      >
        <div style={{ width: scrollContentWidth, height: 12 }} aria-hidden />
      </div>
      <div
        id="order-to-cash-audit-scroll-main"
        ref={mainScrollRef}
        className="max-h-[min(70vh,720px)] min-w-0 max-w-full overflow-auto"
        onScroll={handleMainScroll}
        data-testid="order-to-cash-audit-scroll-main"
      >
        <table
          ref={tableRef}
          className="min-w-[2800px] w-full border-collapse text-left text-xs"
        >
          <thead className="sticky top-0 z-20 bg-muted/95 text-[10px] uppercase tracking-wide text-muted-foreground shadow-[0_1px_0_0_hsl(var(--border))]">
            <tr>
              {visibleColumns.map((col) => {
                const sortable = Boolean(col.sortKey);
                const active = col.sortKey != null && filters.sortBy === col.sortKey;
                return (
                  <th
                    key={col.id}
                    className={cn(
                      "whitespace-nowrap px-2.5 py-2 font-semibold",
                      col.align === "right" ? "text-right" : "text-left",
                      sortable && "cursor-pointer select-none hover:text-foreground",
                      col.sticky && "sticky left-0 z-30 bg-muted/95"
                    )}
                    onClick={sortable ? () => onSort(col.sortKey!) : undefined}
                    title={
                      col.tooltip
                        ? col.tooltip
                        : sortable
                          ? "Clique para ordenar"
                          : undefined
                    }
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
                {visibleColumns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-2.5 py-2 tabular-nums",
                      col.align === "right" ? "text-right" : "text-left",
                      col.sticky && "sticky left-0 z-[1] bg-card",
                      col.sticky && selectedId === row.id && "bg-sky-50/70"
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

      {!hidePagination ? (
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
      ) : null}
    </section>
  );
}

export { COLUMNS as ORDER_TO_CASH_AUDIT_TABLE_COLUMNS };
