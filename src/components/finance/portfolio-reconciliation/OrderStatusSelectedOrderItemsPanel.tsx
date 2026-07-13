import React, { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  formatFinanceCurrency,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  ORDER_STATUS_STATUS_LABEL,
  formatOrderStatusFinancialLabel,
  formatOrderStatusOperationalLabel,
} from "@/src/lib/finance/portfolioOrderStatusClient";
import type { PortfolioOrderStatusRow } from "@/src/lib/finance/portfolioOrderStatusService";
import type {
  OrderToCashAuditListRow,
  OrderToCashAuditSortBy,
} from "@/src/lib/finance/orderToCashAuditApi";
import {
  ORDER_TO_CASH_AUDIT_API_PATH,
  ORDER_TO_CASH_AUDIT_ERROR_MESSAGE,
  buildOrderToCashAuditListQuery,
  createDefaultOrderToCashAuditUiFilters,
  type OrderToCashAuditListPayload,
  type OrderToCashAuditUiFilters,
} from "@/src/lib/finance/orderToCashAuditClient";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { cn } from "@/src/lib/utils";
import { ORDER_STATUS_BADGE_CLASS, orderStatusDash } from "./orderStatusUi";
import { OrderToCashAuditItemsGrid } from "./OrderToCashAuditItemsGrid";

type Props = {
  order: PortfolioOrderStatusRow | null;
  year: string;
  runId: string | null;
  onClear: () => void;
  onOpenSummary: () => void;
};

const EMPTY_MESSAGE =
  "Selecione um pedido na tabela para ver os itens atendidos, pendentes e divergentes.";

function sortAuditRows(
  rows: OrderToCashAuditListRow[],
  sortBy: OrderToCashAuditSortBy,
  sortDirection: "asc" | "desc"
): OrderToCashAuditListRow[] {
  const dir = sortDirection === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sortBy];
    const bv = (b as unknown as Record<string, unknown>)[sortBy];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "pt-BR") * dir;
  });
}

/**
 * Painel abaixo da tabela Status Pedidos — itens via API Auditoria Pedido → Caixa.
 */
export function OrderStatusSelectedOrderItemsPanel({
  order,
  year,
  runId,
  onClear,
  onOpenSummary,
}: Props) {
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OrderToCashAuditListPayload | null>(null);
  const [itemFilters, setItemFilters] = useState<OrderToCashAuditUiFilters>(() =>
    createDefaultOrderToCashAuditUiFilters({ pageSize: 200 })
  );

  useEffect(() => {
    if (!order?.orderCode?.trim() || !year.trim()) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);

    const filters = createDefaultOrderToCashAuditUiFilters({
      year: year.trim(),
      orderCode: order.orderCode.trim(),
      runId: runId?.trim() ?? "",
      page: 1,
      pageSize: 200,
      sortBy: "productCode",
      sortDirection: "asc",
    });
    setItemFilters(filters);

    void (async () => {
      try {
        const qs = buildOrderToCashAuditListQuery(filters);
        const data = await fetchJsonOk<OrderToCashAuditListPayload>(
          `${ORDER_TO_CASH_AUDIT_API_PATH}?${qs}`,
          { signal: ac.signal, credentials: "include" }
        );
        setPayload(data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPayload(null);
        setError(
          e instanceof HttpError
            ? e.message || ORDER_TO_CASH_AUDIT_ERROR_MESSAGE
            : ORDER_TO_CASH_AUDIT_ERROR_MESSAGE
        );
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [order?.orderKey, order?.orderCode, year, runId]);

  const rows = useMemo(
    () =>
      sortAuditRows(
        payload?.rows ?? [],
        itemFilters.sortBy,
        itemFilters.sortDirection
      ),
    [payload?.rows, itemFilters.sortBy, itemFilters.sortDirection]
  );

  if (!order) {
    return (
      <section
        className="rounded-[14px] border border-dashed border-[#D0D5DD] bg-white px-4 py-8 shadow-sm"
        data-testid="order-status-order-items-panel-empty"
      >
        <h3 className="text-sm font-semibold text-[#101828]">
          Itens do pedido selecionado
        </h3>
        <p className="mt-1 text-xs text-[#667085]">
          Detalhamento item a item usando a mesma auditoria Pedido → Caixa.
        </p>
        <div className="mt-4">
          <FinanceModuleEmptyState
            title="Nenhum pedido selecionado"
            description={EMPTY_MESSAGE}
          />
        </div>
      </section>
    );
  }

  const statusLabel =
    ORDER_STATUS_STATUS_LABEL[order.consolidatedOrderStatus] ??
    order.consolidatedOrderStatus;

  return (
    <section
      className="space-y-3 rounded-[14px] border border-[#E5E7EB] bg-white p-4 shadow-sm sm:p-5"
      data-testid="order-status-order-items-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#101828]">
            Itens do pedido selecionado
          </h3>
          <p className="mt-0.5 text-xs text-[#667085]">
            Detalhamento item a item usando a mesma auditoria Pedido → Caixa.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[11px] font-semibold text-[#344054] hover:bg-[#F9FAFB] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
            onClick={onOpenSummary}
            aria-label="Abrir resumo do pedido"
            data-testid="order-status-open-summary"
          >
            Resumo do pedido
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#667085] hover:bg-[#F9FAFB] focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70"
            onClick={onClear}
            aria-label="Limpar seleção do pedido"
            data-testid="order-status-clear-selection"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Limpar
          </button>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7"
        data-testid="order-status-order-items-summary"
      >
        <SummaryTile label="Pedido" value={orderStatusDash(order.orderCode)} />
        <SummaryTile label="Cliente" value={orderStatusDash(order.customerName)} />
        <SummaryTile
          label="Status"
          value={statusLabel}
          badgeClass={ORDER_STATUS_BADGE_CLASS[order.consolidatedOrderStatus]}
        />
        <SummaryTile
          label="Valor pedido"
          value={formatFinanceCurrency(order.totalOrderValue)}
        />
        <SummaryTile
          label="% atendido"
          value={formatFinancePercent(order.fulfillmentPercent)}
          title="Calculado sobre os itens ativos do pedido. Itens cancelados não entram como pendência."
        />
        <SummaryTile
          label="Saldo pendente"
          value={formatFinanceCurrency(order.pendingOrderValue)}
          title="Saldo de itens ativos ainda não atendidos. Itens cancelados são exibidos separadamente."
        />
        <SummaryTile
          label="Valor cancelado"
          value={
            order.canceledOrderValue > 0.009
              ? formatFinanceCurrency(order.canceledOrderValue)
              : "—"
          }
          title="Valor dos itens cancelados no pedido de venda."
        />
      </div>

      <p className="text-[11px] text-[#667085]">
        {formatOrderStatusOperationalLabel(order.operationalStatus)} ·{" "}
        {formatOrderStatusFinancialLabel(order.financialStatus)}
        {` · ${order.allocatedItemCount} item(ns) atendido(s)`}
        {` · ${order.pendingItemCount} pendente(s) ativo(s)`}
        {order.canceledItemsCount > 0
          ? ` · ${order.canceledItemsCount} cancelado(s)`
          : ""}
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-[#667085]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando itens do pedido…
        </div>
      ) : null}

      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {!loading && !error && rows.length === 0 ? (
        <FinanceModuleEmptyState
          title="Sem itens neste pedido"
          description="A auditoria não retornou evidências item a item para o pedido selecionado."
        />
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <OrderToCashAuditItemsGrid
          mode="compact"
          showChips
          rows={rows}
          filters={itemFilters}
          totalRows={rows.length}
          totalPages={1}
          onSort={(column) =>
            setItemFilters((prev) => ({
              ...prev,
              sortBy: column as OrderToCashAuditSortBy,
              sortDirection:
                prev.sortBy === column && prev.sortDirection === "asc"
                  ? "desc"
                  : "asc",
            }))
          }
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          hidePagination
          testId="order-status-order-items-grid"
        />
      ) : null}
    </section>
  );
}

function SummaryTile({
  label,
  value,
  badgeClass,
  title,
}: {
  label: string;
  value: string;
  badgeClass?: string;
  title?: string;
}) {
  return (
    <div
      className="rounded-[12px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2"
      title={title}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#667085]">
        {label}
      </p>
      {badgeClass ? (
        <span
          className={cn(
            "mt-1 inline-flex max-w-full truncate rounded-md border px-2 py-0.5 text-[11px] font-semibold",
            badgeClass
          )}
          title={value}
        >
          {value}
        </span>
      ) : (
        <p
          className="mt-1 truncate text-sm font-semibold tabular-nums text-[#101828]"
          title={value}
        >
          {value}
        </p>
      )}
    </div>
  );
}
