import React, { useMemo, useState } from "react";
import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";
import type { OrderToCashAuditUiFilters } from "@/src/lib/finance/orderToCashAuditClient";
import {
  ORDER_TO_CASH_AUDIT_COMPACT_HIDDEN_COLUMNS,
  ORDER_TO_CASH_AUDIT_ITEM_CHIPS,
  countOrderToCashAuditItemChips,
  filterOrderToCashAuditRowsByChip,
  type OrderToCashAuditItemChipId,
} from "@/src/lib/finance/orderToCashAuditItemsUi";
import { cn } from "@/src/lib/utils";
import { OrderToCashAuditTable } from "./OrderToCashAuditTable";

type Props = {
  rows: OrderToCashAuditListRow[];
  filters: OrderToCashAuditUiFilters;
  totalRows: number;
  totalPages: number;
  onSort: (columnSortKey: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRowClick?: (row: OrderToCashAuditListRow) => void;
  selectedId?: string | null;
  /** full = aba Auditoria; compact = drilldown Status Pedidos. */
  mode?: "full" | "compact";
  showChips?: boolean;
  /** Paginação server-side (Auditoria) vs filtro client-side nos chips (drilldown). */
  hidePagination?: boolean;
  testId?: string;
};

/**
 * Grid compartilhado item/evidência — Auditoria Pedido → Caixa e Status Pedidos.
 * Não recalcula; só exibe e filtra visualmente rows da API.
 */
export function OrderToCashAuditItemsGrid({
  rows,
  filters,
  totalRows,
  totalPages,
  onSort,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  selectedId = null,
  mode = "full",
  showChips = false,
  hidePagination,
  testId = "order-to-cash-audit-items-grid",
}: Props) {
  const [chip, setChip] = useState<OrderToCashAuditItemChipId>("");
  const compact = mode === "compact";
  const counts = useMemo(() => countOrderToCashAuditItemChips(rows), [rows]);
  const displayRows = useMemo(
    () => (showChips ? filterOrderToCashAuditRowsByChip(rows, chip) : rows),
    [rows, chip, showChips]
  );

  return (
    <div className="space-y-3" data-testid={testId}>
      {showChips ? (
        <div
          className="flex flex-wrap gap-2"
          data-testid="order-to-cash-audit-item-chips"
          role="group"
          aria-label="Filtros dos itens"
        >
          <button
            type="button"
            aria-pressed={chip === ""}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
              chip === ""
                ? "border-sky-300 bg-sky-50 text-sky-900 ring-2 ring-sky-400/35"
                : "border-[#E5E7EB] bg-white text-[#667085] hover:bg-[#F9FAFB]"
            )}
            onClick={() => setChip("")}
          >
            Todos
            <span className="tabular-nums opacity-80">{rows.length}</span>
          </button>
          {ORDER_TO_CASH_AUDIT_ITEM_CHIPS.map((c) => {
            const active = chip === c.id;
            const count = counts[c.id];
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                aria-label={`${c.label}: ${count}`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors",
                  c.tone,
                  active ? "ring-2 ring-sky-400/40 shadow-sm" : "opacity-90 hover:opacity-100"
                )}
                onClick={() => setChip(active ? "" : c.id)}
                data-testid={`order-to-cash-audit-item-chip-${c.id}`}
              >
                {c.label}
                <span className="tabular-nums opacity-80">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <OrderToCashAuditTable
        rows={displayRows}
        filters={filters}
        totalRows={showChips ? displayRows.length : totalRows}
        totalPages={showChips ? 1 : totalPages}
        onSort={onSort}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onRowClick={onRowClick ?? (() => undefined)}
        selectedId={selectedId}
        hideColumnIds={compact ? ORDER_TO_CASH_AUDIT_COMPACT_HIDDEN_COLUMNS : undefined}
        hidePagination={hidePagination ?? (showChips && compact)}
        testId={
          compact ? "order-status-order-items-table" : "order-to-cash-audit-table"
        }
      />
    </div>
  );
}
