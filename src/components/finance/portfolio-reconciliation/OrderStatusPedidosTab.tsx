import React, { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import type { EntityAutocompleteSelection } from "@/src/components/common/CustomerAutocompleteFilter";
import {
  ORDER_STATUS_PEDIDOS_API_PATH,
  ORDER_STATUS_PEDIDOS_EMPTY_MESSAGE,
  ORDER_STATUS_PEDIDOS_EMPTY_NO_RUN_MESSAGE,
  ORDER_STATUS_PEDIDOS_ERROR_MESSAGE,
  ORDER_STATUS_PEDIDOS_HEAVY_WARNING,
  ORDER_STATUS_PEDIDOS_LOADING_MESSAGE,
  ORDER_STATUS_PEDIDOS_SELECT_MESSAGE,
  ORDER_STATUS_PEDIDOS_TAB_SUBTITLE,
  ORDER_STATUS_PEDIDOS_TAB_TITLE,
  buildOrderStatusPedidosListQuery,
  canSearchOrderStatusPedidos,
  createDefaultOrderStatusPedidosUiFilters,
  formatOrderStatusPedidosRunScope,
  nextOrderStatusPedidosSort,
  type OrderStatusPedidosListPayload,
  type OrderStatusPedidosUiFilters,
} from "@/src/lib/finance/orderStatusPedidosClient";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import { OrderStatusPedidosFilters } from "./OrderStatusPedidosFilters";
import { OrderStatusPedidosSummaryCards } from "./OrderStatusPedidosSummaryCards";
import { OrderStatusPedidosTable } from "./OrderStatusPedidosTable";
import { OrderStatusPedidosDrawer } from "./OrderStatusPedidosDrawer";

/**
 * Aba Status Pedidos — consolidado por Pedido de Venda.
 * Não carrega no mount; exige Ano + Pesquisar.
 */
export function OrderStatusPedidosTab() {
  const abortRef = useRef<AbortController | null>(null);
  const [draft, setDraft] = useState(() => createDefaultOrderStatusPedidosUiFilters());
  const [applied, setApplied] = useState<OrderStatusPedidosUiFilters | null>(null);
  const [customerSelection, setCustomerSelection] =
    useState<EntityAutocompleteSelection | null>(null);
  const [payload, setPayload] = useState<OrderStatusPedidosListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOrderKey, setDetailOrderKey] = useState<string | null>(null);
  const searched = applied != null;
  const canSearch = canSearchOrderStatusPedidos(draft);

  const load = useCallback(async (filters: OrderStatusPedidosUiFilters) => {
    if (!canSearchOrderStatusPedidos(filters)) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qs = buildOrderStatusPedidosListQuery(filters);
      const data = await fetchJsonOk<OrderStatusPedidosListPayload>(
        `${ORDER_STATUS_PEDIDOS_API_PATH}?${qs}`,
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setPayload(null);
      if (e instanceof HttpError) {
        setError(e.message || ORDER_STATUS_PEDIDOS_ERROR_MESSAGE);
      } else {
        setError(ORDER_STATUS_PEDIDOS_ERROR_MESSAGE);
      }
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!applied) return;
    void load(applied);
    return () => abortRef.current?.abort();
  }, [applied, load]);

  const handleSearch = () => {
    if (!canSearchOrderStatusPedidos(draft)) return;
    setApplied({ ...draft, page: 1 });
  };

  const handleClear = () => {
    abortRef.current?.abort();
    const next = createDefaultOrderStatusPedidosUiFilters();
    setDraft(next);
    setApplied(null);
    setCustomerSelection(null);
    setPayload(null);
    setError(null);
    setLoading(false);
    setDetailOrderKey(null);
  };

  const noRun = Boolean(
    payload?.message &&
      (payload.message.includes("run materializada") ||
        payload.message === ORDER_STATUS_PEDIDOS_EMPTY_NO_RUN_MESSAGE)
  );

  return (
    <div className="space-y-4" data-testid="order-status-pedidos-tab">
      <div className={cn(financeBiCardClass, "px-4 py-3")}>
        <h2 className="text-base font-semibold text-foreground">
          {ORDER_STATUS_PEDIDOS_TAB_TITLE}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {ORDER_STATUS_PEDIDOS_TAB_SUBTITLE}
        </p>
        <p className="mt-2 text-xs text-amber-800">{ORDER_STATUS_PEDIDOS_HEAVY_WARNING}</p>
      </div>

      <OrderStatusPedidosFilters
        draft={draft}
        onDraftChange={setDraft}
        customerSelection={customerSelection}
        onCustomerChange={setCustomerSelection}
        onSearch={handleSearch}
        onClear={handleClear}
        canSearch={canSearch}
      />

      {!searched && !loading ? (
        <FinanceModuleEmptyState
          title="Pronto para pesquisar"
          description={ORDER_STATUS_PEDIDOS_SELECT_MESSAGE}
        />
      ) : null}

      {loading ? (
        <FinanceModuleLoadingBlock label={ORDER_STATUS_PEDIDOS_LOADING_MESSAGE} />
      ) : null}

      {error ? <FinanceModuleErrorBanner message={error} /> : null}

      {searched && !loading && noRun ? (
        <FinanceModuleEmptyState
          title="Sem run materializada"
          description={ORDER_STATUS_PEDIDOS_EMPTY_NO_RUN_MESSAGE}
        />
      ) : null}

      {searched && !loading && !error && payload && !noRun ? (
        <>
          {payload.run ? (
            <p className="text-xs text-muted-foreground">
              {formatOrderStatusPedidosRunScope(payload.run)}
              {payload.run.finishedAt
                ? ` · atualizado ${formatFinanceDateTime(payload.run.finishedAt)}`
                : null}
              {payload.run.totalFacts != null
                ? ` · run com ${payload.run.totalFacts} evidências / ${payload.run.totalOrders} pedidos`
                : null}
            </p>
          ) : null}

          <OrderStatusPedidosSummaryCards summary={payload.summary} />

          {payload.rows.length === 0 ? (
            <FinanceModuleEmptyState
              title="Nenhum pedido"
              description={payload.message || ORDER_STATUS_PEDIDOS_EMPTY_MESSAGE}
            />
          ) : (
            <OrderStatusPedidosTable
              rows={payload.rows}
              page={payload.page}
              pageSize={payload.pageSize}
              totalOrders={payload.totalOrders}
              totalPages={payload.totalPages}
              sortBy={applied?.sortBy ?? "orderIssueDate"}
              sortDirection={applied?.sortDirection ?? "desc"}
              onSort={(column) => {
                if (!applied) return;
                setApplied(nextOrderStatusPedidosSort(applied, column));
              }}
              onPageChange={(page) => {
                if (!applied) return;
                setApplied({ ...applied, page });
              }}
              onOpenOrder={setDetailOrderKey}
            />
          )}
        </>
      ) : null}

      <OrderStatusPedidosDrawer
        open={Boolean(detailOrderKey)}
        orderKey={detailOrderKey}
        listFilters={applied ?? draft}
        onClose={() => setDetailOrderKey(null)}
      />
    </div>
  );
}
