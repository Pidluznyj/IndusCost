import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, Loader2, X } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
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
import { canViewPortfolioReconciliationTechnicalTrace } from "@/src/lib/financePortfolioReconciliationPermissions";
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

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => String(v)).filter(Boolean);
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((n) => Number.isFinite(n));
}

/**
 * Drawer lateral de rastreabilidade — somente leitura.
 * Não edita dados; não altera Fluxo/AR/Faturamento/Comissões.
 */
export function PortfolioReconciliationOrderDrawer({
  open,
  salesOrderId,
  listFilters,
  onClose,
}: Props) {
  const auth = useAuth();
  const canSeeTechnicalTrace = canViewPortfolioReconciliationTechnicalTrace(auth);
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
  const order = detail?.order ?? detail?.header?.order ?? null;
  const managerNotes = detail?.managerNotes ?? [];
  const orderItems = detail?.orderItems ?? detail?.items ?? [];
  const documentLinks = detail?.documentLinks ?? detail?.linkedNfes ?? [];
  const allocations = detail?.allocations ?? detail?.allocatedItems ?? [];
  const receivableTitles = detail?.receivableTitles ?? [];
  const receivablesSummary = detail?.receivablesSummary ?? detail?.receivables;
  const timeline = detail?.timeline ?? [];
  const technical = detail?.technical;
  const primaryAlerts =
    detail?.header?.primaryAlerts ?? detail?.alertas?.slice(0, 5) ?? [];

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/30"
      data-testid="portfolio-reconciliation-order-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Rastreabilidade da conciliação do pedido"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Fechar detalhe"
        onClick={onClose}
      />
      <aside className="relative z-[81] flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-border bg-card shadow-xl sm:max-w-3xl">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Rastreabilidade paralela · somente leitura
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
              Carregando rastreabilidade…
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {error}
            </div>
          ) : null}

          {!loading && detail && order ? (
            <>
              {/* 1. Cabeçalho */}
              <section
                className="rounded-lg border border-border bg-muted/20 p-3 space-y-3"
                data-testid="portfolio-drawer-header"
              >
                <div className="flex flex-wrap gap-2">
                  <PortfolioStatusBadge status={order.status} />
                  <PortfolioConfidenceBadge level={order.confidenceLevel} />
                  <span className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-800">
                    Fonte: {formatPortfolioForecastSourceLabel(order.forecastSource)}
                  </span>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Field label="Pedido" value={order.pedido ?? "—"} />
                  <Field label="Cliente" value={order.cliente ?? "—"} />
                  <Field
                    label="Valor do pedido"
                    value={formatFinanceCurrency(order.valorPedido)}
                    hint="Soma dos itens do pedido"
                  />
                  <Field
                    label="Valor alocado"
                    value={formatFinanceCurrency(order.valorAlocado)}
                    hint="Preço do pedido × qtde alocada"
                  />
                  <Field label="CR" value={formatFinanceCurrency(order.valorCR)} />
                  <Field label="Recebido" value={formatFinanceCurrency(order.recebido)} />
                  <Field label="Saldo" value={formatFinanceCurrency(order.saldo)} />
                  <Field
                    label="Forecast"
                    value={`${formatFinanceDate(order.forecastDate)} · ${formatPortfolioForecastSourceLabel(order.forecastSource)}`}
                  />
                </dl>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                    Alertas principais
                  </p>
                  <PortfolioAlertsInline alerts={primaryAlerts} />
                </div>
              </section>

              {/* Notas do gestor */}
              {managerNotes.length > 0 ? (
                <section
                  className="rounded-lg border border-sky-200 bg-sky-50 p-3"
                  data-testid="portfolio-drawer-manager-notes"
                >
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-sky-950">
                    <Info className="h-4 w-4" />
                    Leitura executiva
                  </div>
                  <ul className="space-y-1.5 text-sm text-sky-950">
                    {managerNotes.map((note) => (
                      <li key={note} className="leading-snug">
                        • {note}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {/* 2. Itens do pedido */}
              <Section title="Itens do pedido" empty="Sem itens materializados." count={orderItems.length}>
                <div className="overflow-x-auto">
                  <table className="min-w-[720px] w-full text-left text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1">Produto</th>
                        <th className="px-2 py-1">Descrição</th>
                        <th className="px-2 py-1 text-right">Qtde pedido</th>
                        <th className="px-2 py-1 text-right">Unitário</th>
                        <th className="px-2 py-1 text-right">Total</th>
                        <th className="px-2 py-1 text-right">Qtde alocada</th>
                        <th className="px-2 py-1 text-right">Saldo</th>
                        <th className="px-2 py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map((item, idx) => (
                        <tr key={String(item.salesOrderItemId ?? idx)} className="border-t border-border/60">
                          <td className="px-2 py-1.5 font-medium">
                            {asString(item.productSku) ??
                              asString(item.externalProductId) ??
                              "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            {asString(item.productDescription) ??
                              asString(item.productNameSnapshot) ??
                              "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(item.orderQuantity) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(item.orderUnitPrice)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(item.orderItemValue)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(item.allocatedQuantity) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(item.remainingQuantity) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            <PortfolioStatusBadge
                              status={asString(item.status) ?? "ORDER_ONLY"}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* 3. NF/documentos */}
              <Section
                title="NF / documentos vinculados"
                empty="Sem NF ou documento vinculado."
                count={documentLinks.length}
              >
                <div className="space-y-2">
                  {documentLinks.map((row, idx) => (
                    <div
                      key={String(row.nfeExternalId ?? row.stockDocumentExternalId ?? idx)}
                      className="rounded-md border border-border/70 bg-muted/20 p-2.5 text-sm"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">
                          NF {asString(row.nfeNumber) ?? asString(row.nfeExternalId) ?? "—"}
                        </p>
                        {row.headerOnly ? (
                          <span className="rounded-md border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-900">
                            Só cabeçalho
                          </span>
                        ) : null}
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        <Field label="idNfe" value={asString(row.nfeExternalId) ?? "—"} />
                        <Field
                          label="Data"
                          value={formatFinanceDate(asString(row.nfeProcessedAt))}
                        />
                        <Field
                          label="Valor cabeçalho NF"
                          value={formatFinanceCurrency(row.nfeHeaderValue)}
                          hint="Cabeçalho da NF — não é o valor do pedido"
                        />
                        <Field
                          label="Documento estoque"
                          value={asString(row.stockDocumentExternalId) ?? "—"}
                        />
                        <Field
                          label="Valor alocado ao pedido"
                          value={formatFinanceCurrency(row.allocatedValueToOrder)}
                          hint="Preço do pedido × quantidade alocada"
                        />
                        <Field
                          label="Excedente / não alocado"
                          value={formatFinanceCurrency(row.surplusOrUnallocatedValue)}
                        />
                      </dl>
                      {asNumberArray(row.productsAllocated).length > 0 ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Produtos alocados: {asNumberArray(row.productsAllocated).join(", ")}
                        </p>
                      ) : null}
                      {asNumberArray(row.productsSurplus).length > 0 ? (
                        <p className="mt-1 text-xs text-orange-900">
                          Excedente (não consome saldo):{" "}
                          {asNumberArray(row.productsSurplus).join(", ")}
                        </p>
                      ) : null}
                      <div className="mt-2">
                        <PortfolioAlertsInline alerts={asStringArray(row.alerts)} />
                      </div>
                    </div>
                  ))}
                </div>
              </Section>

              {/* 4. Alocação por item */}
              <Section
                title="Alocação por item"
                empty="Sem alocação itemizada."
                count={allocations.length}
              >
                <div className="overflow-x-auto">
                  <table className="min-w-[900px] w-full text-left text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr>
                        <th className="px-2 py-1">Produto</th>
                        <th className="px-2 py-1">NF</th>
                        <th className="px-2 py-1 text-right">Qtde pedido</th>
                        <th className="px-2 py-1 text-right">Qtde doc.</th>
                        <th className="px-2 py-1 text-right">Qtde alocada</th>
                        <th className="px-2 py-1 text-right">Unit. pedido</th>
                        <th className="px-2 py-1 text-right">Unit. doc.</th>
                        <th className="px-2 py-1 text-right">Dif. unit.</th>
                        <th className="px-2 py-1 text-right">Dif. total</th>
                        <th className="px-2 py-1">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((row, idx) => (
                        <tr
                          key={String(row.factId ?? idx)}
                          className="border-t border-border/60 align-top"
                        >
                          <td className="px-2 py-1.5 font-medium">
                            {asString(row.productSku) ??
                              asString(row.externalProductId) ??
                              "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            {asString(row.nfeNumber) ?? asString(row.nfeExternalId) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(row.orderQuantity) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(row.documentQuantity) ??
                              asNumber(row.stockQuantity) ??
                              "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {asNumber(row.allocatedQuantity) ?? "—"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(row.orderUnitPrice)}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(
                              row.documentUnitPrice ?? row.stockUnitValue
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(
                              row.unitDifference ?? row.priceDifferenceUnit
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {formatFinanceCurrency(
                              row.totalDifference ?? row.priceDifferenceTotal
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <PortfolioStatusBadge
                              status={asString(row.status) ?? "ITEM_ALLOCATED"}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {/* 5. Contas a receber */}
              <Section
                title="Contas a receber"
                empty="Sem CR vinculado neste run."
                count={
                  receivableTitles.length > 0
                    ? receivableTitles.length
                    : receivablesSummary
                      ? 1
                      : 0
                }
              >
                {receivablesSummary ? (
                  <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <Field
                      label="Total CR"
                      value={formatFinanceCurrency(
                        (receivablesSummary as { receivableTotalValue?: unknown })
                          .receivableTotalValue
                      )}
                    />
                    <Field
                      label="Recebido"
                      value={formatFinanceCurrency(
                        (receivablesSummary as { receivedValue?: unknown }).receivedValue
                      )}
                    />
                    <Field
                      label="Aberto"
                      value={formatFinanceCurrency(
                        (receivablesSummary as { openReceivableValue?: unknown })
                          .openReceivableValue
                      )}
                    />
                    <Field
                      label="IDs"
                      value={
                        asNumberArray(
                          (receivablesSummary as { receivableIds?: unknown }).receivableIds
                        ).join(", ") || "—"
                      }
                    />
                  </dl>
                ) : null}
                {receivableTitles.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-[640px] w-full text-left text-xs">
                      <thead className="text-[10px] uppercase text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1">Título</th>
                          <th className="px-2 py-1 text-right">Valor</th>
                          <th className="px-2 py-1">Vencimento</th>
                          <th className="px-2 py-1">Baixa</th>
                          <th className="px-2 py-1 text-right">Recebido</th>
                          <th className="px-2 py-1 text-right">Aberto</th>
                          <th className="px-2 py-1">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receivableTitles.map((row, idx) => (
                          <tr
                            key={String(row.receivableId ?? idx)}
                            className="border-t border-border/60"
                          >
                            <td className="px-2 py-1.5">
                              {asString(row.label) ??
                                (row.receivableId != null
                                  ? `Título ${row.receivableId}`
                                  : "—")}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {row.amount != null
                                ? formatFinanceCurrency(row.amount)
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              {formatFinanceDate(asString(row.dueDate))}
                            </td>
                            <td className="px-2 py-1.5">
                              {formatFinanceDate(asString(row.settlementDate))}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {row.received != null
                                ? formatFinanceCurrency(row.received)
                                : "—"}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              {row.open != null ? formatFinanceCurrency(row.open) : "—"}
                            </td>
                            <td className="px-2 py-1.5">
                              {asString(row.status) ?? "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </Section>

              {/* 6. Linha do tempo */}
              <Section title="Linha do tempo" empty="Sem eventos." count={timeline.length}>
                <ol className="space-y-2">
                  {timeline.map((ev, idx) => (
                    <li
                      key={`${ev.kind}-${ev.at}-${idx}`}
                      className="flex gap-3 rounded-md bg-muted/30 px-2.5 py-2"
                    >
                      <div className="w-24 shrink-0 text-xs font-medium tabular-nums text-foreground">
                        {formatFinanceDate(ev.at)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{ev.label}</p>
                        <p className="text-[11px] text-muted-foreground">{ev.kind}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Section>

              {/* 7. Rastreabilidade técnica */}
              <section
                className="rounded-lg border border-border p-3"
                data-testid="portfolio-drawer-technical"
              >
                <h3 className="mb-2 text-sm font-semibold">Rastreabilidade técnica</h3>
                {technical ? (
                  <div className="space-y-3 text-sm">
                    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <Field
                        label="salesOrderId"
                        value={technical.salesOrderId ?? "—"}
                      />
                      <Field
                        label="externalSalesOrderId"
                        value={asString(technical.externalSalesOrderId) ?? "—"}
                      />
                      <Field
                        label="customerExternalId"
                        value={asString(technical.customerExternalId) ?? "—"}
                      />
                      <Field
                        label="NFs Nomus"
                        value={technical.nfeExternalIds.join(", ") || "—"}
                      />
                      <Field
                        label="Docs estoque"
                        value={technical.stockDocumentExternalIds.join(", ") || "—"}
                      />
                      <Field
                        label="CR IDs"
                        value={technical.receivableIds.join(", ") || "—"}
                      />
                    </dl>
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                        Links entre tabelas
                      </p>
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {technical.links.map((link, idx) => (
                          <li key={`${link.from}-${link.to}-${idx}`}>
                            {link.from} → {link.to}{" "}
                            <span className="text-foreground/80">({link.via})</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {canSeeTechnicalTrace ? (
                      <div data-testid="portfolio-drawer-trace-json">
                        <p className="mb-1 text-[10px] font-bold uppercase text-muted-foreground">
                          traceJson (admin · sanitizado)
                        </p>
                        {technical.sanitizedTraces.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Sem trace materializado.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {technical.sanitizedTraces.slice(0, 8).map((trace) => (
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
                      </div>
                    ) : (
                      <p
                        className="rounded-md border border-border bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground"
                        data-testid="portfolio-drawer-trace-restricted"
                      >
                        Trace técnico detalhado disponível apenas para administradores.
                        IDs e vínculos acima já explicam a origem dos números para gestão.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Sem metadados técnicos neste run.
                  </p>
                )}
              </section>

              <p className="text-[11px] text-muted-foreground">
                Esta tela não permite edição e não altera o fluxo de caixa oficial, contas a
                receber, faturamento nem comissões.
              </p>
            </>
          ) : null}
        </div>
      </aside>
    </div>,
    portalContainer
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium text-foreground" title={value}>
        {value}
      </dd>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Section({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">
        {title}
        <span className="ml-2 text-xs font-normal text-muted-foreground">({count})</span>
      </h3>
      {count === 0 ? <p className="text-sm text-muted-foreground">{empty}</p> : children}
    </section>
  );
}
