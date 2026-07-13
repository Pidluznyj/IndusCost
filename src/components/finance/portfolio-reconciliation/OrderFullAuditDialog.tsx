import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X, ExternalLink, Copy } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  buildOrderFullAuditUrl,
  ORDER_FULL_AUDIT_TABS,
  type OrderFullAuditAlert,
  type OrderFullAuditItem,
  type OrderFullAuditNfe,
  type OrderFullAuditPayload,
  type OrderFullAuditReceivable,
  type OrderFullAuditStockDocument,
  type OrderFullAuditSummary,
  type OrderFullAuditTabId,
  type OrderFullAuditTimelinePoint,
} from "@/src/lib/finance/orderFullAuditClient";
import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";
import { createDefaultOrderToCashAuditUiFilters } from "@/src/lib/finance/orderToCashAuditClient";
import {
  formatOrderToCashLineType,
  formatOrderItemStatus,
  formatOrderToCashConfidence,
} from "@/src/lib/finance/orderToCashAuditLabels";
import { OrderToCashAuditItemsGrid } from "./OrderToCashAuditItemsGrid";
import { cn } from "@/src/lib/utils";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  salesOrderId: string | null;
  orderCode: string | null;
  runId: string | null;
};

export function OrderFullAuditDialog({
  open,
  onOpenChange,
  salesOrderId,
  orderCode,
  runId,
}: Props): JSX.Element | null {
  const abortRef = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<OrderFullAuditPayload | null>(null);
  const [activeTab, setActiveTab] = useState<OrderFullAuditTabId>("summary");

  const load = useCallback(async () => {
    if (!open || !salesOrderId) {
      setPayload(null);
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<OrderFullAuditPayload>(
        buildOrderFullAuditUrl(salesOrderId, runId ?? undefined),
        { signal: ac.signal, credentials: "include" }
      );
      setPayload(data);
      setActiveTab("summary");
    } catch (e) {
      if ((e as { name?: string } | undefined)?.name === "AbortError") return;
      setPayload(null);
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar a auditoria do pedido."
      );
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [open, salesOrderId, runId]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={`Auditoria completa — ${orderCode ?? "pedido"}`}
      onClick={() => onOpenChange(false)}
      data-testid="order-full-audit-dialog"
    >
      <div
        className="w-full max-w-[1200px] my-4 mx-4 flex flex-col bg-white rounded-[16px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4 bg-white">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Financeiro · Conciliação de Carteira
            </p>
            <h2 className="text-base font-bold text-[#111827] truncate">
              Auditoria completa — {orderCode ?? "pedido"}
            </h2>
            <p className="text-[11px] text-[#6B7280]">
              Pedido → Documento de saída → NF-e → Contas a Receber → Baixas
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
            aria-label="Fechar auditoria"
          >
            <X className="h-3.5 w-3.5" /> Fechar
          </button>
        </header>

        <nav
          className="flex flex-wrap items-center gap-1 border-b border-[#E5E7EB] px-5 py-2 bg-[#F9FAFB]"
          role="tablist"
        >
          {ORDER_FULL_AUDIT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
                activeTab === tab.id
                  ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                  : "text-[#4B5563] hover:bg-[#F3F4F6]"
              )}
              data-testid={`order-full-audit-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando auditoria completa do pedido...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : !payload ? (
            <p className="text-sm text-muted-foreground">Sem dados.</p>
          ) : (
            <>
              {activeTab === "summary" && (
                <SummaryTab summary={payload.summary} timeline={payload.timeline} />
              )}
              {activeTab === "items" && (
                <ItemsTab
                  items={payload.items}
                  itemFacts={payload.itemFacts as unknown as OrderToCashAuditListRow[]}
                  runId={payload.runId}
                  orderCode={payload.orderCode}
                />
              )}
              {activeTab === "financial" && (
                <FinancialTab
                  receivables={payload.receivables}
                  totals={payload.receivablesTotal}
                />
              )}
              {activeTab === "documents" && (
                <StockDocumentsTab docs={payload.stockDocuments} />
              )}
              {activeTab === "nfes" && <NfesTab nfes={payload.nfes} />}
              {activeTab === "delivery" && <DeliveryTab summary={payload.summary} delivery={payload.delivery} />}
              {activeTab === "alerts" && <AlertsTab alerts={payload.alerts} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Resumo                                                          */
/* -------------------------------------------------------------------- */

function SummaryTab({
  summary,
  timeline,
}: {
  summary: OrderFullAuditSummary;
  timeline: OrderFullAuditTimelinePoint[];
}): JSX.Element {
  return (
    <div className="space-y-4" data-testid="order-full-audit-summary-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <Kpi label="Pedido" value={summary.orderCode ?? "—"} />
        <Kpi label="Cliente" value={summary.customerName ?? "—"} />
        <Kpi label="Empresa" value={summary.companyName ?? "—"} />
        <Kpi
          label="Data pedido"
          value={summary.orderIssueDate ? formatFinanceDate(summary.orderIssueDate) : "—"}
        />
        <Kpi
          label="Entrega estimada"
          value={
            summary.orderExpectedDeliveryDate
              ? formatFinanceDate(summary.orderExpectedDeliveryDate)
              : "—"
          }
        />
        <Kpi
          label="Responsável comercial"
          value={
            summary.commercialResponsibleName?.trim() || "Sem responsável comercial"
          }
        />
        <Kpi
          label="Vendedor do pedido"
          value={summary.orderSellerName?.trim() || "Sem vendedor informado"}
        />
        <Kpi label="Valor original" value={formatFinanceCurrency(summary.originalOrderValue)} />
        <Kpi
          label="Valor cancelado"
          value={
            summary.canceledOrderValue > 0.009
              ? formatFinanceCurrency(summary.canceledOrderValue)
              : "—"
          }
        />
        <Kpi
          label="Valor cortado"
          value={
            summary.cutOrderValue > 0.009
              ? formatFinanceCurrency(summary.cutOrderValue)
              : "—"
          }
        />
        <Kpi label="Valor ativo" value={formatFinanceCurrency(summary.activeOrderValue)} />
        <Kpi
          label="Valor atendido"
          value={formatFinanceCurrency(summary.allocatedOrderValue)}
        />
        <Kpi
          label="% atendido ativo"
          value={formatFinancePercent(summary.fulfillmentPercentActive)}
        />
        <Kpi
          label="Saldo pendente ativo"
          value={formatFinanceCurrency(summary.pendingActiveOrderValue)}
        />
        <Kpi
          label="CR total"
          value={formatFinanceCurrency(summary.receivableTotalValue)}
        />
        <Kpi
          label="CR aberto"
          value={formatFinanceCurrency(summary.receivableOpenValue)}
        />
        <Kpi
          label="Recebido"
          value={formatFinanceCurrency(summary.receivableReceivedValue)}
        />
        <Kpi
          label="Status operacional"
          value={summary.operationalStage ?? "—"}
        />
        <Kpi label="Status financeiro" value={summary.financialStage ?? "—"} />
        <Kpi label="Temperatura" value={summary.temperature ?? "—"} />
      </div>

      <section className="rounded-[14px] border border-[#E5E7EB] bg-white p-4">
        <h3 className="text-sm font-bold text-[#111827] mb-2">Linha do tempo</h3>
        <ol className="flex flex-wrap gap-3">
          {timeline.map((t) => (
            <li
              key={t.key}
              className={cn(
                "flex-1 min-w-[160px] rounded-[10px] border px-3 py-2",
                t.active
                  ? "border-[#B2DDFF] bg-[#EFF8FF]"
                  : "border-[#E5E7EB] bg-[#F9FAFB]"
              )}
            >
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  t.active ? "text-[#175CD3]" : "text-[#6B7280]"
                )}
              >
                {t.label}
              </p>
              <p className="mt-0.5 text-[12px] font-bold text-[#111827]">
                {t.date ? formatFinanceDate(t.date) : "—"}
              </p>
              {t.detail ? (
                <p className="text-[10px] text-[#6B7280]">{t.detail}</p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-bold tabular-nums text-[#111827]" title={value}>
        {value}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Itens                                                           */
/* -------------------------------------------------------------------- */

function ItemsTab({
  items,
  itemFacts,
  runId,
  orderCode,
}: {
  items: OrderFullAuditItem[];
  itemFacts: OrderToCashAuditListRow[];
  runId: string | null;
  orderCode: string | null;
}): JSX.Element {
  const filters = useMemo(
    () =>
      createDefaultOrderToCashAuditUiFilters({
        orderCode: orderCode ?? "",
        runId: runId ?? "",
        page: 1,
        pageSize: 500,
        sortBy: "productCode",
        sortDirection: "asc",
      }),
    [orderCode, runId]
  );

  const [chip, setChip] = useState<string>("all");

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      switch (chip) {
        case "canceled":
          return item.nomusIsCanceled || item.nomusIsStale;
        case "cut":
          return item.nomusIsCut;
        case "active":
          return !item.nomusIsCanceled && !item.nomusIsCut && !item.nomusIsStale;
        default:
          return true;
      }
    });
  }, [items, chip]);

  return (
    <div className="space-y-4" data-testid="order-full-audit-items-tab">
      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", label: `Todos (${items.length})` },
          {
            id: "active",
            label: `Ativos (${items.filter((i) => !i.nomusIsCanceled && !i.nomusIsCut && !i.nomusIsStale).length})`,
          },
          {
            id: "canceled",
            label: `Cancelados / Stale (${items.filter((i) => i.nomusIsCanceled || i.nomusIsStale).length})`,
          },
          {
            id: "cut",
            label: `Atendidos com corte (${items.filter((i) => i.nomusIsCut).length})`,
          },
        ].map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              chip === c.id
                ? "border-sky-300 bg-sky-50 text-sky-900"
                : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]"
            )}
            onClick={() => setChip(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhum item no filtro atual.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">#</th>
                <th className="py-1.5 pr-2 font-semibold">Produto / SKU</th>
                <th className="py-1.5 pr-2 font-semibold">Status Nomus</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd pedida</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd atendida</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd pendente</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor item</th>
                <th className="py-1.5 pr-2 font-semibold">Match</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.salesOrderItemId} className="border-b border-[#F3F4F6]">
                  <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                    {item.itemSequence ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 max-w-[220px] truncate" title={item.productName ?? undefined}>
                    <strong className="text-[#111827]">{item.productCode ?? "—"}</strong>
                    <span className="text-[#6B7280]"> · {item.productName ?? "—"}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                        item.nomusIsCanceled
                          ? "border-red-200 bg-red-50 text-red-800"
                          : item.nomusIsCut
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : item.nomusIsStale
                              ? "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]"
                              : "border-emerald-200 bg-emerald-50 text-emerald-800"
                      )}
                    >
                      {formatOrderItemStatus(
                        item.itemStatus ?? item.nomusItemStatusNormalized
                      )}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.quantity != null ? formatFinanceInteger(item.quantity) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.nomusQuantityFulfilled != null
                      ? formatFinanceInteger(item.nomusQuantityFulfilled)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.nomusQuantityPending != null
                      ? formatFinanceInteger(item.nomusQuantityPending)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(item.totalNetValue ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span className="text-[10px] uppercase text-[#6B7280]">
                      {formatOrderToCashConfidence(item.matchConfidence)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {itemFacts.length > 0 ? (
        <section className="rounded-[14px] border border-[#E5E7EB] bg-[#FAFAFA] p-3">
          <h4 className="text-[12px] font-bold text-[#111827] mb-2">
            Evidência item × documento × NF × CR
          </h4>
          <OrderToCashAuditItemsGrid
            mode="compact"
            showChips
            rows={itemFacts}
            filters={filters}
            totalRows={itemFacts.length}
            totalPages={1}
            onSort={() => undefined}
            onPageChange={() => undefined}
            onPageSizeChange={() => undefined}
            hidePagination
            testId="order-full-audit-items-grid"
          />
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Financeiro / Títulos e baixas                                   */
/* -------------------------------------------------------------------- */

function FinancialTab({
  receivables,
  totals,
}: {
  receivables: OrderFullAuditReceivable[];
  totals: OrderFullAuditPayload["receivablesTotal"];
}): JSX.Element {
  const [feedback, setFeedback] = useState<string | null>(null);

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFeedback("Referência copiada.");
      setTimeout(() => setFeedback(null), 2000);
    } catch {
      setFeedback("Não foi possível copiar.");
    }
  }, []);

  return (
    <div className="space-y-3" data-testid="order-full-audit-financial-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Total em títulos" value={formatFinanceCurrency(totals.totalAmount)} />
        <Kpi label="Total aberto" value={formatFinanceCurrency(totals.openAmount)} />
        <Kpi label="Total recebido" value={formatFinanceCurrency(totals.receivedAmount)} />
        <Kpi label="Vencidos" value={String(totals.overdueCount)} />
        <Kpi
          label="Próximo vencimento"
          value={totals.nextDueDate ? formatFinanceDate(totals.nextDueDate) : "—"}
        />
        <Kpi label="Maior título" value={formatFinanceCurrency(totals.maxAmount)} />
      </div>

      {feedback ? (
        <p className="text-[11px] text-emerald-700">{feedback}</p>
      ) : null}

      {receivables.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhum título de Contas a Receber vinculado ao pedido.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Referência</th>
                <th className="py-1.5 pr-2 font-semibold">Cliente</th>
                <th className="py-1.5 pr-2 font-semibold">NF</th>
                <th className="py-1.5 pr-2 font-semibold">Vencimento</th>
                <th className="py-1.5 pr-2 font-semibold">Baixa</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Aberto</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Recebido</th>
                <th className="py-1.5 pr-2 font-semibold">Forma</th>
                <th className="py-1.5 pr-2 font-semibold">Status</th>
                <th className="py-1.5 pr-2 font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.receivableExternalId} className="border-b border-[#F3F4F6]">
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                    {r.receivableExternalId}
                  </td>
                  <td className="py-1.5 pr-2 max-w-[180px] truncate" title={r.personName ?? undefined}>
                    {r.personName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    {r.sourceInvoiceNumber ?? r.sourceInvoiceId ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {r.dueDate ? formatFinanceDate(r.dueDate) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {r.settlementDate ? formatFinanceDate(r.settlementDate) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(r.amountReceivable ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(r.balanceReceivable ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(r.amountReceived ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2 max-w-[140px] truncate" title={r.paymentMethodName ?? undefined}>
                    {r.paymentMethodName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <ReceivableStatusBadge status={r.status} />
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap flex gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                      onClick={() => void copy(String(r.receivableExternalId))}
                      title="Copiar referência do título"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <a
                      href={`/finance/accounts-receivable?search=${encodeURIComponent(String(r.receivableExternalId))}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                      title="Abrir no Contas a Receber"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReceivableStatusBadge({
  status,
}: {
  status: OrderFullAuditReceivable["status"];
}): JSX.Element {
  const label: Record<OrderFullAuditReceivable["status"], string> = {
    RECEIVED: "Recebido",
    PARTIALLY_RECEIVED: "Parcial",
    OVERDUE: "Vencido",
    OPEN: "Em aberto",
    UNKNOWN: "—",
  };
  const tone: Record<OrderFullAuditReceivable["status"], string> = {
    RECEIVED: "border-emerald-200 bg-emerald-50 text-emerald-800",
    PARTIALLY_RECEIVED: "border-sky-200 bg-sky-50 text-sky-800",
    OVERDUE: "border-red-200 bg-red-50 text-red-800",
    OPEN: "border-amber-200 bg-amber-50 text-amber-800",
    UNKNOWN: "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]",
  };
  return (
    <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", tone[status])}>
      {label[status]}
    </span>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Documentos de saída                                             */
/* -------------------------------------------------------------------- */

function StockDocumentsTab({
  docs,
}: {
  docs: OrderFullAuditStockDocument[];
}): JSX.Element {
  const totalDocs = docs.length;
  const totalValue = docs.reduce((s, d) => s + d.totalValue, 0);
  const allocatedValue = docs.reduce((s, d) => s + d.allocatedValue, 0);
  const excess = docs.reduce((s, d) => s + d.excessQuantity, 0);
  const outsideValue = docs.reduce((s, d) => s + d.outsideOrderValue, 0);

  return (
    <div className="space-y-3" data-testid="order-full-audit-documents-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Documentos" value={String(totalDocs)} />
        <Kpi label="Valor total" value={formatFinanceCurrency(totalValue)} />
        <Kpi label="Alocado ao pedido" value={formatFinanceCurrency(allocatedValue)} />
        <Kpi label="Qtd excedente" value={formatFinanceInteger(excess)} />
        <Kpi label="Valor fora do pedido" value={formatFinanceCurrency(outsideValue)} />
      </div>
      {docs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Sem documento de saída vinculado.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Documento</th>
                <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                <th className="py-1.5 pr-2 font-semibold">Data</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd doc.</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd pedido</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Excedente</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor total</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Alocado</th>
                <th className="py-1.5 pr-2 font-semibold">NF</th>
                <th className="py-1.5 pr-2 font-semibold">Alertas</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.stockDocumentExternalId} className="border-b border-[#F3F4F6]">
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                    {d.stockDocumentExternalId}
                  </td>
                  <td className="py-1.5 pr-2 text-[#6B7280]">
                    {d.tipoDocumentoEstoque ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {d.dataDocumento ? formatFinanceDate(d.dataDocumento) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceInteger(d.quantityDocument)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceInteger(d.quantityUsedForOrder)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceInteger(d.excessQuantity)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(d.totalValue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(d.allocatedValue)}
                  </td>
                  <td className="py-1.5 pr-2">{d.idNfe ?? "—"}</td>
                  <td className="py-1.5 pr-2 flex flex-wrap gap-1">
                    {d.hasExcess ? (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-800">
                        Excedente
                      </span>
                    ) : null}
                    {d.hasOutside ? (
                      <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] font-semibold text-red-800">
                        Fora do pedido
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: NF-e                                                            */
/* -------------------------------------------------------------------- */

function NfesTab({ nfes }: { nfes: OrderFullAuditNfe[] }): JSX.Element {
  const totalValue = nfes.reduce((s, n) => s + (n.valorTotal ?? 0), 0);
  const totalAllocated = nfes.reduce((s, n) => s + n.allocatedValueToOrder, 0);
  const withoutCr = nfes.filter((n) => !n.hasReceivable).length;
  return (
    <div className="space-y-3" data-testid="order-full-audit-nfes-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="NFs vinculadas" value={String(nfes.length)} />
        <Kpi label="Valor NF total" value={formatFinanceCurrency(totalValue)} />
        <Kpi label="Alocado ao pedido" value={formatFinanceCurrency(totalAllocated)} />
        <Kpi label="NF sem CR" value={String(withoutCr)} />
      </div>
      {nfes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Sem NF-e vinculada.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Número</th>
                <th className="py-1.5 pr-2 font-semibold">Série</th>
                <th className="py-1.5 pr-2 font-semibold">Emissão</th>
                <th className="py-1.5 pr-2 font-semibold">Processamento</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor NF</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Alocado</th>
                <th className="py-1.5 pr-2 font-semibold">Chave</th>
                <th className="py-1.5 pr-2 font-semibold">Alertas</th>
              </tr>
            </thead>
            <tbody>
              {nfes.map((n) => (
                <tr key={n.nfeExternalId} className="border-b border-[#F3F4F6]">
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">{n.numero ?? "—"}</td>
                  <td className="py-1.5 pr-2">{n.serie ?? "—"}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {n.dataEmissao ? formatFinanceDate(n.dataEmissao) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {n.dataProcessamento ? formatFinanceDate(n.dataProcessamento) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(n.valorTotal ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(n.allocatedValueToOrder)}
                  </td>
                  <td className="py-1.5 pr-2 max-w-[180px] truncate" title={n.chave ?? undefined}>
                    {n.chave ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 flex flex-wrap gap-1">
                    {n.headerGreaterThanOrder ? (
                      <span className="rounded border border-amber-200 bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-800">
                        NF &gt; pedido
                      </span>
                    ) : null}
                    {!n.hasReceivable ? (
                      <span className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] font-semibold text-red-800">
                        Sem CR
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Entrega / Frete                                                 */
/* -------------------------------------------------------------------- */

function DeliveryTab({
  summary,
  delivery,
}: {
  summary: OrderFullAuditSummary;
  delivery: OrderFullAuditPayload["delivery"];
}): JSX.Element {
  return (
    <div className="space-y-3" data-testid="order-full-audit-delivery-tab">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <Kpi
          label="Entrega estimada"
          value={
            delivery.expectedDeliveryDate
              ? formatFinanceDate(delivery.expectedDeliveryDate)
              : summary.orderExpectedDeliveryDate
                ? formatFinanceDate(summary.orderExpectedDeliveryDate)
                : "—"
          }
        />
        <Kpi
          label="Último documento saída"
          value={
            delivery.lastStockDocumentDate
              ? formatFinanceDate(delivery.lastStockDocumentDate)
              : "—"
          }
        />
        <Kpi
          label="Última NF-e"
          value={delivery.lastNfeDate ? formatFinanceDate(delivery.lastNfeDate) : "—"}
        />
        <Kpi
          label="Última baixa"
          value={
            delivery.lastReceivableSettlement
              ? formatFinanceDate(delivery.lastReceivableSettlement)
              : "—"
          }
        />
        <Kpi label="Condição de frete" value={delivery.freightCondition ?? "—"} />
        <Kpi label="Condição de pagamento" value={delivery.paymentTerms ?? "—"} />
        <Kpi label="Forma de pagamento" value={delivery.paymentMethod ?? "—"} />
        <Kpi label="Setor operacional" value={summary.operationalResponsibleArea ?? "—"} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Alertas                                                         */
/* -------------------------------------------------------------------- */

function AlertsTab({ alerts }: { alerts: OrderFullAuditAlert[] }): JSX.Element {
  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
        Nenhum alerta neste pedido.
      </p>
    );
  }
  const severityRank: Record<OrderFullAuditAlert["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const sorted = [...alerts].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity]
  );
  return (
    <div className="space-y-2" data-testid="order-full-audit-alerts-tab">
      {sorted.map((a, idx) => (
        <div
          key={`${a.code}-${idx}`}
          className={cn(
            "rounded-[12px] border px-3 py-2",
            a.severity === "critical"
              ? "border-red-200 bg-red-50"
              : a.severity === "warning"
                ? "border-amber-200 bg-amber-50"
                : "border-[#E5E7EB] bg-white"
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-[#111827]">
                {a.title}
                <span className="ml-2 text-[10px] uppercase tracking-wide text-[#6B7280]">
                  {a.origin}
                </span>
              </p>
              <p className="text-[11px] text-[#4B5563]">{a.description}</p>
              <p className="text-[10px] text-[#6B7280] mt-0.5">Ação: {a.action}</p>
            </div>
            <div className="text-right">
              <p
                className={cn(
                  "text-[10px] font-bold uppercase",
                  a.severity === "critical"
                    ? "text-red-700"
                    : a.severity === "warning"
                      ? "text-amber-700"
                      : "text-[#6B7280]"
                )}
              >
                {a.severity === "critical"
                  ? "Crítico"
                  : a.severity === "warning"
                    ? "Atenção"
                    : "Informativo"}
              </p>
              {a.financialImpact != null ? (
                <p className="text-[11px] font-bold tabular-nums text-[#111827] mt-0.5">
                  {formatFinanceCurrency(a.financialImpact)}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Referencia formatOrderToCashLineType para manter import consistente com labels PT-BR
void formatOrderToCashLineType;
