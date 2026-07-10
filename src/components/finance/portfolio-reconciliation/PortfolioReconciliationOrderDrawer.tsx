import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildPortfolioReconciliationListQuery,
  type PortfolioReconciliationOrderDetailPayload,
  type PortfolioReconciliationUiFilters,
} from "@/src/lib/financePortfolioReconciliationClient";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  PortfolioAlertsInline,
  PortfolioConfidenceBadge,
  PortfolioStatusBadge,
  formatPortfolioForecastSourceLabel,
} from "./PortfolioReconciliationBadges";

type Props = {
  open: boolean;
  salesOrderId: string | null;
  listFilters: PortfolioReconciliationUiFilters;
  onClose: () => void;
};

export function PortfolioReconciliationOrderDrawer({
  open,
  salesOrderId,
  listFilters,
  onClose,
}: Props) {
  const portalContainer = usePortalContainer();
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<PortfolioReconciliationOrderDetailPayload | null>(
    null
  );

  useEffect(() => {
    if (!open || !salesOrderId) {
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

    const query = buildPortfolioReconciliationListQuery({
      ...listFilters,
      page: 1,
      pageSize: 1,
    });

    void (async () => {
      try {
        const data = await fetchJsonOk<PortfolioReconciliationOrderDetailPayload>(
          `/api/finance/portfolio-reconciliation/orders/${encodeURIComponent(salesOrderId)}?${query}`,
          { signal: ac.signal, credentials: "include" }
        );
        if (!data.ok || !data.detail) {
          setPayload(data);
          setError(
            data.message ?? "Pedido não encontrado na conciliação materializada."
          );
          return;
        }
        setPayload(data);
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        if (e instanceof HttpError && e.status === 404) {
          setError(e.message || "Pedido não encontrado na conciliação materializada.");
          setPayload(null);
          return;
        }
        setError(
          buildFinanceTabLoadError("Não foi possível carregar o detalhe do pedido.", e)
        );
        setPayload(null);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [open, salesOrderId, listFilters]);

  if (!open || !salesOrderId || !portalContainer) return null;

  const detail = payload?.detail ?? null;
  const order = detail?.order ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      data-testid="portfolio-reconciliation-order-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe da conciliação do pedido"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fechar detalhe"
        onClick={onClose}
      />
      <aside className="relative z-[81] flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Detalhe paralelo
            </p>
            <h2 className="truncate text-base font-semibold text-foreground">
              {order?.pedido ?? "Pedido"}
            </h2>
            <p className="truncate text-sm text-muted-foreground">
              {order?.cliente ?? "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border p-1.5 hover:bg-muted/60"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando detalhe…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {!loading && detail && order ? (
            <>
              <section className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  <PortfolioStatusBadge status={order.status} />
                  <PortfolioConfidenceBadge level={order.confidenceLevel} />
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">Valor pedido</dt>
                    <dd className="font-medium">{formatFinanceCurrency(order.valorPedido)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">Alocado</dt>
                    <dd className="font-medium">{formatFinanceCurrency(order.valorAlocado)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">CR</dt>
                    <dd className="font-medium">{formatFinanceCurrency(order.valorCR)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">Recebido</dt>
                    <dd className="font-medium">{formatFinanceCurrency(order.recebido)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">Saldo</dt>
                    <dd className="font-medium">{formatFinanceCurrency(order.saldo)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase text-muted-foreground">Forecast</dt>
                    <dd className="font-medium">
                      {formatFinanceDate(order.forecastDate)} ·{" "}
                      {formatPortfolioForecastSourceLabel(order.forecastSource)}
                    </dd>
                  </div>
                </dl>
                <div>
                  <p className="mb-1 text-[10px] uppercase text-muted-foreground">Alertas</p>
                  <PortfolioAlertsInline alerts={detail.alertas} />
                </div>
              </section>

              <DetailList
                title="Itens do pedido"
                empty="Sem itens materializados."
                items={detail.items.map((item, idx) => ({
                  key: String(item.salesOrderItemId ?? idx),
                  primary:
                    String(item.productNameSnapshot ?? item.productSkuSnapshot ?? "Item"),
                  secondary: `Qtd ${String(item.orderQuantity ?? "—")} · ${formatFinanceCurrency(item.orderItemValue)}`,
                }))}
              />

              <DetailList
                title="NFs vinculadas"
                empty="Sem NF vinculada."
                items={detail.linkedNfes.map((nfe, idx) => ({
                  key: String(nfe.nfeExternalId ?? idx),
                  primary: `NF ${String(nfe.nfeNumber ?? nfe.nfeExternalId ?? "—")}`,
                  secondary: [
                    nfe.headerOnly ? "Só cabeçalho" : "Com documento",
                    nfe.nfeHeaderValue != null
                      ? formatFinanceCurrency(nfe.nfeHeaderValue)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                }))}
              />

              <DetailList
                title="Documentos de estoque"
                empty="Sem documento de estoque."
                items={detail.stockDocuments.map((doc, idx) => ({
                  key: String(doc.stockDocumentExternalId ?? doc.stockDocumentId ?? idx),
                  primary: `Doc. ${String(doc.stockDocumentExternalId ?? "—")}`,
                  secondary: formatFinanceDate(
                    typeof doc.stockDocumentDate === "string"
                      ? doc.stockDocumentDate
                      : null
                  ),
                }))}
              />

              <DetailList
                title="Itens alocados"
                empty="Sem alocação itemizada."
                items={detail.allocatedItems.map((row, idx) => ({
                  key: String(row.factId ?? idx),
                  primary: String(
                    row.productSkuSnapshot ?? row.externalProductId ?? "Alocação"
                  ),
                  secondary: `Qtd ${String(row.allocatedQuantity ?? "—")} · Pedido ${formatFinanceCurrency(row.allocatedValueByOrderPrice)} · Doc ${formatFinanceCurrency(row.allocatedValueByStockPrice)}`,
                }))}
              />

              <section className="rounded-lg border border-border p-3">
                <h3 className="mb-2 text-sm font-semibold">Contas a receber</h3>
                {detail.receivables ? (
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-[10px] uppercase text-muted-foreground">Total CR</dt>
                      <dd>{formatFinanceCurrency(detail.receivables.receivableTotalValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase text-muted-foreground">Recebido</dt>
                      <dd>{formatFinanceCurrency(detail.receivables.receivedValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase text-muted-foreground">Em aberto</dt>
                      <dd>{formatFinanceCurrency(detail.receivables.openReceivableValue)}</dd>
                    </div>
                    <div>
                      <dt className="text-[10px] uppercase text-muted-foreground">IDs</dt>
                      <dd className="text-xs">
                        {Array.isArray(detail.receivables.receivableIds)
                          ? (detail.receivables.receivableIds as number[]).join(", ") || "—"
                          : "—"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem CR vinculado neste run.</p>
                )}
              </section>

              <DetailList
                title="Linha do tempo"
                empty="Sem eventos."
                items={detail.timeline.map((ev, idx) => ({
                  key: `${ev.kind}-${ev.at}-${idx}`,
                  primary: ev.label,
                  secondary: `${formatFinanceDate(ev.at)} · ${ev.kind}`,
                }))}
              />

              <section className="rounded-lg border border-border p-3">
                <h3 className="mb-2 text-sm font-semibold">Trace técnico (controlado)</h3>
                {detail.traces.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem trace materializado.</p>
                ) : (
                  <div className="space-y-2">
                    {detail.traces.slice(0, 8).map((trace) => (
                      <pre
                        key={trace.factId}
                        className="overflow-x-auto rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed text-foreground"
                      >
                        {JSON.stringify(
                          {
                            factId: trace.factId,
                            status: trace.status,
                            confidenceLevel: trace.confidenceLevel,
                            trace: trace.trace,
                          },
                          null,
                          2
                        )}
                      </pre>
                    ))}
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </aside>
    </div>,
    portalContainer
  );
}

function DetailList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; primary: string; secondary: string }>;
}) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.key} className="rounded-md bg-muted/30 px-2.5 py-2">
              <p className="text-sm font-medium text-foreground">{item.primary}</p>
              <p className="text-xs text-muted-foreground">{item.secondary}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
