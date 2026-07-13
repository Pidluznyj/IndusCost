import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  ORDER_STATUS_PEDIDOS_API_PATH,
  ORDER_STATUS_PEDIDOS_ERROR_MESSAGE,
  buildOrderStatusPedidosListQuery,
  type OrderStatusPedidosUiFilters,
} from "@/src/lib/finance/orderStatusPedidosClient";
import {
  ORDER_STATUS_PEDIDOS_STATUS_HINT,
  ORDER_STATUS_PEDIDOS_STATUS_LABEL,
  type OrderStatusPedidosDetailPayload,
} from "@/src/lib/finance/orderStatusPedidosApi";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  orderKey: string | null;
  listFilters: OrderStatusPedidosUiFilters;
  onClose: () => void;
};

/**
 * Drawer de evidências do pedido — somente leitura.
 * Itens PENDING não exibem NF/CR de item; CR título é só rastreabilidade.
 */
export function OrderStatusPedidosDrawer({
  open,
  orderKey,
  listFilters,
  onClose,
}: Props) {
  const portalContainer = usePortalContainer();
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OrderStatusPedidosDetailPayload | null>(
    null
  );

  useEffect(() => {
    if (!open || !orderKey) {
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
    const qs = buildOrderStatusPedidosListQuery({ ...listFilters, page: 1 });
    void (async () => {
      try {
        const data = await fetchJsonOk<OrderStatusPedidosDetailPayload>(
          `${ORDER_STATUS_PEDIDOS_API_PATH}/orders/${encodeURIComponent(orderKey)}?${qs}`,
          { signal: ac.signal, credentials: "include" }
        );
        setPayload(data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setPayload(null);
        setError(
          e instanceof HttpError
            ? e.message || ORDER_STATUS_PEDIDOS_ERROR_MESSAGE
            : ORDER_STATUS_PEDIDOS_ERROR_MESSAGE
        );
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [open, orderKey, listFilters]);

  if (!open || !portalContainer) return null;

  const order = payload?.order;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      role="dialog"
      aria-modal="true"
      data-testid="order-status-pedidos-drawer"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-xl flex-col border-l border-border bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Detalhe do pedido
            </p>
            <h2 className="text-lg font-semibold text-foreground">
              {order?.orderCode ?? orderKey ?? "Pedido"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {order?.customerName ?? "—"}
            </p>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 hover:bg-muted"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando evidências…
            </div>
          ) : null}
          {error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {error}
            </p>
          ) : null}

          {order ? (
            <div className="mb-4 space-y-3">
              <div
                className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
                title={ORDER_STATUS_PEDIDOS_STATUS_HINT[order.orderStatus]}
              >
                <span className="font-semibold">
                  {ORDER_STATUS_PEDIDOS_STATUS_LABEL[order.orderStatus]}
                </span>
                <span className="text-muted-foreground">
                  {" "}
                  · {order.pendingItemCount} pendente(s) · {order.allocatedItemCount}{" "}
                  alocado(s)
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Valor pedido
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatFinanceCurrency(order.orderNetValue)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    Alocado
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatFinanceCurrency(order.allocatedValue)}
                  </dd>
                </div>
                <div title="CR do título — 1× por pedido; não é valor de produto">
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    CR total título
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatFinanceCurrency(order.receivableTotalValue)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase text-muted-foreground">
                    CR aberto
                  </dt>
                  <dd className="font-semibold tabular-nums">
                    {formatFinanceCurrency(order.receivableOpenValue)}
                  </dd>
                </div>
              </dl>
            </div>
          ) : null}

          <h3 className="mb-2 text-sm font-semibold">Itens / evidências</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            Valor cobrado da linha só vem de evidência de item/documento. Item pendente
            não herda NF nem CR do título.
          </p>
          <div className="space-y-2">
            {(payload?.items ?? []).map((item) => {
              const pending = item.lineType === "ORDER_ITEM_PENDING";
              return (
                <div
                  key={item.id}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm",
                    pending
                      ? "border-amber-200 bg-amber-50/60"
                      : "border-border bg-white"
                  )}
                  data-testid={`order-status-pedidos-item-${item.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {item.productCode ?? item.sku ?? "Item"}
                        {item.productName ? (
                          <span className="font-normal text-muted-foreground">
                            {" "}
                            · {item.productName}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.lineType ?? "—"}
                        {pending ? " · Não faturado nesta NF" : null}
                      </p>
                    </div>
                    <div className="text-right text-xs">
                      <p
                        className="font-semibold tabular-nums"
                        title={item.lineBilledValueLabel}
                      >
                        {item.lineBilledValue != null
                          ? formatFinanceCurrency(item.lineBilledValue)
                          : "—"}
                      </p>
                      <p className="text-muted-foreground">Valor cobrado linha</p>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                    <div>
                      <span className="block uppercase">NF item</span>
                      <span className="text-foreground">
                        {pending ? "—" : item.nfeNumber ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="block uppercase">Doc.</span>
                      <span className="text-foreground">
                        {pending
                          ? "—"
                          : item.stockDocumentExternalId ?? "—"}
                      </span>
                    </div>
                    <div>
                      <span className="block uppercase">Emissão</span>
                      <span className="text-foreground">
                        {item.orderIssueDate
                          ? formatFinanceDate(item.orderIssueDate.slice(0, 10))
                          : "—"}
                      </span>
                    </div>
                  </div>
                  {pending && item.titleReceivableTotalValue != null ? (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      CR total título (rastreabilidade):{" "}
                      {formatFinanceCurrency(item.titleReceivableTotalValue)} — não é
                      valor deste produto.
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!loading && payload && payload.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {payload.message ?? "Sem evidências para este pedido."}
              </p>
            ) : null}
          </div>
        </div>
      </aside>
    </div>,
    portalContainer
  );
}
