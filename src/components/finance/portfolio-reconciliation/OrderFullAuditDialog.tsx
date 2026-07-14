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
  type OrderFullAuditCommissionBlock,
  type OrderFullAuditDivergenceBlock,
  type OrderFullAuditFreightBlock,
  type OrderFullAuditItem,
  type OrderFullAuditMarginPricingBlock,
  type OrderFullAuditNfe,
  type OrderFullAuditNfeItem,
  type OrderFullAuditPayload,
  type OrderFullAuditProposalBlock,
  type OrderFullAuditProposalOrderComparison,
  type OrderFullAuditPlannedReceivable,
  type OrderFullAuditPlannedReceivablesTotal,
  type OrderFullAuditReceipt,
  type OrderFullAuditReceivable,
  type OrderFullAuditSalesOrderBlock,
  type OrderFullAuditStockDocument,
  type OrderFullAuditStockDocumentItem,
  type OrderFullAuditSummary,
  type OrderFullAuditTabId,
  type OrderFullAuditTechnicalAuditBlock,
  type OrderFullAuditTechnicalRule,
  type OrderFullAuditTechnicalSource,
  type OrderFullAuditTimelinePoint,
} from "@/src/lib/finance/orderFullAuditClient";
import type { OrderToCashAuditListRow } from "@/src/lib/finance/orderToCashAuditApi";
import { createDefaultOrderToCashAuditUiFilters } from "@/src/lib/finance/orderToCashAuditClient";
import {
  formatOrderToCashFinancialStage,
  formatOrderToCashLineType,
  formatOrderItemStatus,
  formatOrderToCashOperationalStage,
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
      aria-label={`Auditoria 360º do Pedido — ${orderCode ?? "pedido"}`}
      onClick={() => onOpenChange(false)}
      data-testid="order-full-audit-dialog"
    >
      <div
        className="w-full max-w-[1400px] my-4 mx-4 flex flex-col bg-white rounded-[16px] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="border-b border-[#E5E7EB] px-5 py-4 bg-white"
          data-testid="order-full-audit-header"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
                Financeiro · Conciliação de Carteira
              </p>
              <h2
                className="text-base font-bold text-[#111827] truncate"
                data-testid="order-full-audit-title"
              >
                Auditoria 360º — {orderCode ?? "pedido"}
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
              data-testid="order-full-audit-close"
            >
              <X className="h-3.5 w-3.5" /> Fechar
            </button>
          </div>
          {payload ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-0.5">
                <span className="text-[#6B7280] uppercase text-[9px] tracking-wide">
                  Cliente
                </span>
                <strong className="text-[#111827]">
                  {payload.summary.customerName ?? "—"}
                </strong>
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900"
                title="Status operacional consolidado"
              >
                <span className="uppercase text-[9px] tracking-wide">
                  Operacional
                </span>
                <strong>
                  {formatOrderToCashOperationalStage(
                    payload.summary.operationalStatus ??
                      payload.summary.operationalStage
                  )}
                </strong>
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-emerald-900"
                title="Status financeiro consolidado"
              >
                <span className="uppercase text-[9px] tracking-wide">
                  Financeiro
                </span>
                <strong>
                  {formatOrderToCashFinancialStage(
                    payload.summary.financialStatus ??
                      payload.summary.financialStage
                  )}
                </strong>
              </span>
              {payload.summary.alertCount > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-900"
                  title="Total de alertas identificados"
                >
                  <span className="uppercase text-[9px] tracking-wide">Alertas</span>
                  <strong>{payload.summary.alertCount}</strong>
                </span>
              ) : null}
              {payload.runMeta.orderToCashFinishedAt ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[#4B5563]"
                  title="Última run OrderToCashAudit consumida"
                >
                  <span className="uppercase text-[9px] tracking-wide">Run</span>
                  <strong>
                    {formatFinanceDate(payload.runMeta.orderToCashFinishedAt)}
                  </strong>
                </span>
              ) : null}
            </div>
          ) : null}
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

        <div
          className="flex-1 overflow-auto px-5 py-4"
          data-testid="order-full-audit-content"
        >
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando auditoria 360º do pedido...
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Não foi possível carregar a auditoria do pedido.
              <p className="mt-1 text-[11px] text-red-700/80">{error}</p>
            </div>
          ) : !payload ? (
            <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-6 text-sm text-[#6B7280]">
              Pedido não encontrado.
            </div>
          ) : (
            <>
              {activeTab === "summary" && (
                <SummaryTab
                  summary={payload.summary}
                  timeline={payload.timeline}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "proposal" && (
                <ProposalTab
                  proposal={payload.proposal}
                  comparisons={payload.proposalVsOrderComparisons}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "salesOrder" && (
                <SalesOrderTab
                  salesOrder={payload.salesOrder}
                  summary={payload.summary}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "items" && (
                <ItemsTab
                  items={payload.items}
                  itemFacts={payload.itemFacts as unknown as OrderToCashAuditListRow[]}
                  runId={payload.runId}
                  orderCode={payload.orderCode}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "documents" && (
                <StockDocumentsTab
                  docs={payload.stockDocuments}
                  docItems={payload.stockDocumentItems}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "nfes" && (
                <NfesTab
                  nfes={payload.nfes}
                  nfeItems={payload.nfeItems}
                  activeOrderValue={payload.summary.activeOrderValue}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "financial" && (
                <FinancialTab
                  receivables={payload.receivables}
                  totals={payload.receivablesTotal}
                  plannedReceivables={payload.plannedReceivables}
                  plannedTotals={payload.plannedReceivablesTotal}
                  receipts={payload.receipts}
                  alerts={payload.alerts}
                  orderCode={payload.orderCode}
                />
              )}
              {activeTab === "delivery" && (
                <DeliveryTab
                  summary={payload.summary}
                  delivery={payload.delivery}
                  freight={payload.freight}
                  items={payload.items}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "marginPricing" && (
                <MarginPricingTab
                  marginPricing={payload.marginPricing}
                  alerts={payload.alerts}
                />
              )}
              {activeTab === "commissions" && (
                <CommissionsTab
                  commissions={payload.commissions}
                  alerts={payload.alerts}
                  orderCode={payload.orderCode}
                  orderSellerName={payload.summary.orderSellerName}
                />
              )}
              {activeTab === "divergences" && (
                <DivergencesTab
                  divergences={payload.divergences}
                  onOpenTab={(tab) => setActiveTab(tab)}
                />
              )}
              {activeTab === "technicalAudit" && (
                <TechnicalAuditTab technicalAudit={payload.technicalAudit} />
              )}
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
  alerts,
}: {
  summary: OrderFullAuditSummary;
  timeline: OrderFullAuditTimelinePoint[];
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const temperatureLabel = TEMPERATURE_LABEL[summary.temperature ?? ""] ??
    summary.temperature ??
    "—";
  return (
    <div className="space-y-4" data-testid="order-full-audit-summary-tab">
      {/* Seção 1 — Identificação e status */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-summary-section-identification"
      >
        <SectionHeader
          title="Identificação e status"
          subtitle="Pedido, cliente, responsáveis e status consolidado."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi label="Pedido" value={summary.orderCode ?? "—"} />
          <Kpi label="Cliente" value={summary.customerName ?? "—"} />
          <Kpi label="Empresa" value={summary.companyName ?? "—"} />
          <Kpi
            label="Data do pedido"
            value={
              summary.orderIssueDate ? formatFinanceDate(summary.orderIssueDate) : "—"
            }
          />
          <Kpi
            label="Entrega prevista"
            value={
              summary.orderExpectedDeliveryDate
                ? formatFinanceDate(summary.orderExpectedDeliveryDate)
                : "—"
            }
          />
          <Kpi
            label="Responsável comercial"
            value={
              summary.commercialResponsible?.displayName?.trim() ||
              summary.commercialResponsibleName?.trim() ||
              "Sem responsável comercial"
            }
          />
          <Kpi
            label="Vendedor do pedido"
            value={
              summary.orderSeller?.displayName?.trim() ||
              summary.orderSellerName?.trim() ||
              "Sem vendedor informado"
            }
          />
          <Kpi
            label="Status operacional"
            value={formatOrderToCashOperationalStage(
              summary.operationalStatus ?? summary.operationalStage
            )}
          />
          <Kpi
            label="Status financeiro"
            value={formatOrderToCashFinancialStage(
              summary.financialStatus ?? summary.financialStage
            )}
          />
          <Kpi
            label="Temperatura / risco"
            value={temperatureLabel}
            tone={
              summary.temperature === "HOT"
                ? "danger"
                : summary.temperature === "WARM"
                  ? "warning"
                  : summary.temperature === "COLD"
                    ? "muted"
                    : "neutral"
            }
          />
        </div>
      </section>

      {/* Seção 2 — Valores oficiais (pedido) */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-summary-section-order-values"
      >
        <SectionHeader
          title="Valores do pedido"
          subtitle="Original × cancelado × cortado × ativo × atendido — nunca misturados."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="Valor original"
            value={formatFinanceCurrency(summary.originalOrderValue)}
          />
          <Kpi
            label="Valor cancelado"
            value={formatFinanceCurrency(summary.canceledOrderValue)}
            tone={summary.canceledOrderValue > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="Valor cortado"
            value={formatFinanceCurrency(summary.cutOrderValue)}
            tone={summary.cutOrderValue > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="Valor ativo"
            value={formatFinanceCurrency(summary.activeOrderValue)}
            tone="highlight"
          />
          <Kpi
            label="Valor atendido"
            value={formatFinanceCurrency(summary.allocatedOrderValue)}
          />
          <Kpi
            label="% atendimento ativo"
            value={formatFinancePercent(summary.fulfillmentPercentActive)}
            tone={
              summary.fulfillmentPercentActive >= 99.99
                ? "success"
                : summary.fulfillmentPercentActive > 0
                  ? "info"
                  : "muted"
            }
          />
          <Kpi
            label="Saldo pendente ativo"
            value={formatFinanceCurrency(summary.pendingActiveOrderValue)}
            tone={
              summary.pendingActiveOrderValue > 0.009 ? "warning" : "success"
            }
          />
        </div>
      </section>

      {/* Seção 3 — Documentos, NF-e e Financeiro */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-summary-section-downstream-values"
      >
        <SectionHeader
          title="Documentos, NF-e e financeiro"
          subtitle="Valores oficiais deduplicados por documento / NF / título."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="Documento de saída"
            value={formatFinanceCurrency(summary.stockDocumentsTotalValue)}
            help={`Alocado ao pedido: ${formatFinanceCurrency(summary.stockDocumentsAllocatedValue)}`}
          />
          <Kpi
            label="NF-e válida (faturamento)"
            value={formatFinanceCurrency(summary.nfeValidValue ?? summary.nfeAllocatedValue)}
            help={`Histórico (todas): ${formatFinanceCurrency(summary.nfeTotalValueAll ?? summary.nfeTotalValue)} · Alocado válido: ${formatFinanceCurrency(summary.nfeAllocatedValue)}${(summary.canceledNfeCount ?? 0) > 0 ? ` · ${summary.canceledNfeCount} cancelada(s)` : ""}`}
          />
          <Kpi
            label="CR total"
            value={formatFinanceCurrency(summary.receivableTotalValue)}
          />
          <Kpi
            label="CR aberto"
            value={formatFinanceCurrency(summary.receivableOpenValue)}
            tone={summary.receivableOpenValue > 0.009 ? "info" : "muted"}
          />
          <Kpi
            label="Recebido"
            value={formatFinanceCurrency(summary.receivableReceivedValue)}
            tone={
              summary.receivableReceivedValue > 0.009 ? "success" : "muted"
            }
          />
          <Kpi
            label="Vencido"
            value={formatFinanceCurrency(summary.receivableOverdueValue)}
            tone={summary.receivableOverdueValue > 0.009 ? "danger" : "muted"}
          />
        </div>
      </section>

      {/* Seção 4 — Comparativos */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-summary-section-diffs"
      >
        <SectionHeader
          title="Comparativos"
          subtitle="Positivo = pedido maior que a fonte; negativo = fonte externa maior."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <DiffKpi
            label="Pedido × Documento"
            value={summary.diffs.orderVsStockDocument}
          />
          <DiffKpi label="Pedido × NF" value={summary.diffs.orderVsNfe} />
          <DiffKpi
            label="Pedido × CR"
            value={summary.diffs.orderVsReceivable}
          />
          <DiffKpi
            label="Ativo × CR"
            value={summary.diffs.activeVsReceivable}
          />
          <DiffKpi
            label="Atendido × CR"
            value={summary.diffs.allocatedVsReceivable}
          />
        </div>
      </section>

      {/* Seção 5 — Timeline */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-4"
        data-testid="order-full-audit-summary-section-timeline"
      >
        <SectionHeader
          title="Linha do tempo"
          subtitle="Proposta → Pedido → Documento → NF-e → CR gerado → Vencimento → Baixa."
        />
        <ol className="flex flex-wrap gap-3">
          {timeline.map((t) => (
            <li
              key={t.key}
              className={cn(
                "flex-1 min-w-[170px] rounded-[10px] border px-3 py-2",
                t.alert
                  ? "border-amber-300 bg-amber-50/70"
                  : t.active
                    ? "border-[#B2DDFF] bg-[#EFF8FF]"
                    : "border-[#E5E7EB] bg-[#F9FAFB]"
              )}
              data-testid={`order-full-audit-summary-timeline-${t.key.toLowerCase()}`}
            >
              <p
                className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  t.alert
                    ? "text-amber-800"
                    : t.active
                      ? "text-[#175CD3]"
                      : "text-[#6B7280]"
                )}
              >
                {t.label}
              </p>
              <p className="mt-0.5 text-[12px] font-bold text-[#111827]">
                {t.date ? formatFinanceDate(t.date) : "—"}
              </p>
              {t.amount != null ? (
                <p className="text-[11px] font-semibold tabular-nums text-[#111827]">
                  {formatFinanceCurrency(t.amount)}
                </p>
              ) : null}
              {t.detail ? (
                <p className="text-[10px] text-[#6B7280]">{t.detail}</p>
              ) : null}
              {t.alert ? (
                <p className="mt-0.5 text-[10px] font-semibold text-amber-800">
                  ⚠ {t.alert}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      {/* Seção 6 — Top alertas / divergências */}
      <SummaryAlertsPanel alerts={alerts} />
    </div>
  );
}

const TEMPERATURE_LABEL: Record<string, string> = {
  HOT: "Quente",
  WARM: "Morno",
  COLD: "Frio",
  UNKNOWN: "—",
};

/**
 * Códigos de alerta que devem aparecer no topo do Resumo Executivo,
 * na ordem oficial exigida pelo produto.
 */
const SUMMARY_ALERT_CODE_ORDER: string[] = [
  "RECEIVABLE_OVERDUE",
  "RECEIPT_GREATER_THAN_RECEIVABLE",
  "RECEIVABLE_GREATER_THAN_ACTIVE_ORDER",
  "RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE",
  "PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE",
  "RECEIVABLE_WITHOUT_NFE",
  "RECEIVABLE_WITHOUT_DUE_DATE",
  "RECEIVABLE_OPEN",
  "RECEIVABLE_DUPLICATED_BY_ITEM_FACTS",
  "DELIVERY_DATE_OVERDUE",
  "DELIVERY_OVERDUE_WITHOUT_DOCUMENT",
  "ACTIVE_ITEM_OVERDUE_WITHOUT_NFE",
  "CANCELED_ITEM_MARKED_AS_OVERDUE",
  "CUT_ITEM_MARKED_AS_PENDING",
  "PRODUCTION_QUANTITY_LESS_THAN_INVOICED",
  "READY_BALANCE_NOT_INVOICED",
  "FREIGHT_CONDITION_MISMATCH",
  "NEGATIVE_MARGIN",
  "CANCELED_ITEM_GENERATING_NO_MARGIN",
  "STALE_ITEM_GENERATING_MARGIN",
  "PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE",
  "PRICE_TABLE_NOT_FOUND",
  "COST_NOT_FOUND",
  "ORDER_PRICE_DIFFERS_FROM_DOCUMENT",
  "DOCUMENT_PRICE_DIFFERS_FROM_NFE",
  "ORDER_PRICE_BELOW_TABLE",
  "NO_MARGIN",
  "COMMISSION_PAID_WITH_DIVERGENCE",
  "COMMISSION_RELEASED_WITHOUT_RECEIPT",
  "CANCELED_ITEM_GENERATING_COMMISSION",
  "RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER",
  "COMMISSION_WITHOUT_SELLER",
  "COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE",
  "CUSTOMER_COMMISSION_EXCEPTION",
  "NFE_HEADER_GREATER_THAN_ORDER",
  "NFE_VALUE_GREATER_THAN_ACTIVE_ORDER",
  "DOCUMENT_WITH_EXCESS",
  "ORDER_HEADER_ITEMS_TOTAL_MISMATCH",
  "DOCUMENT_PRICE_MISMATCH",
  "NFE_PRICE_MISMATCH",
  "DOCUMENT_EXTRA_ITEM",
  "NFE_EXTRA_ITEM",
  "DOCUMENT_WITHOUT_ORDER_ITEM",
  "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM",
  "DOCUMENT_WITHOUT_NFE",
  "NFE_WITHOUT_DOCUMENT",
  "NFE_WITHOUT_CR",
  "DOCUMENT_ALLOCATED_BY_HEADER_ONLY",
  "NFE_ALLOCATED_BY_HEADER_ONLY",
  "DOCUMENT_QUANTITY_MISMATCH",
  "ORDER_WITHOUT_ITEMS",
  "ORDER_ITEM_OVER_FULFILLED",
  "ORDER_ITEM_CANCELED",
  "ORDER_ITEM_CUT",
  "ORDER_ITEM_STALE",
  "ORDER_ITEM_STATUS_UNKNOWN",
  "REPEATED_SKU_WITH_DIFFERENT_STATUS",
  "ITEM_STATUS_MATCH_AMBIGUOUS",
  "ORDER_ITEM_ACTIVE_PENDING",
  "PAYMENT_TERM_MISSING",
  "SELLER_NOT_INFORMED",
  "COMMERCIAL_RESPONSIBLE_MISSING",
  "OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE",
  "ORDER_STATUS_UNKNOWN",
];

function SummaryAlertsPanel({
  alerts,
}: {
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const byCode = new Map<string, OrderFullAuditAlert[]>();
  for (const alert of alerts) {
    const arr = byCode.get(alert.code) ?? [];
    arr.push(alert);
    byCode.set(alert.code, arr);
  }
  const ranked = SUMMARY_ALERT_CODE_ORDER.flatMap((code) => byCode.get(code) ?? [])
    .concat(
      alerts.filter((a) => !SUMMARY_ALERT_CODE_ORDER.includes(a.code))
    )
    .slice(0, 8);

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;
  const infoCount = alerts.filter((a) => a.severity === "info").length;

  return (
    <section
      className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
      data-testid="order-full-audit-summary-section-alerts"
    >
      <SectionHeader
        title="Top alertas e divergências"
        subtitle={
          alerts.length === 0
            ? "Nenhum alerta identificado."
            : `${alerts.length} alerta(s) — crítico ${criticalCount} · atenção ${warningCount} · info ${infoCount}`
        }
      />
      {ranked.length === 0 ? (
        <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
          Nenhuma divergência identificada.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ranked.map((a, idx) => (
            <li
              key={`${a.code}-${idx}`}
              className={cn(
                "rounded-[10px] border px-3 py-2",
                a.severity === "critical"
                  ? "border-red-200 bg-red-50"
                  : a.severity === "warning"
                    ? "border-amber-200 bg-amber-50"
                    : "border-[#E5E7EB] bg-[#F9FAFB]"
              )}
              data-testid={`order-full-audit-summary-alert-${a.code.toLowerCase()}`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12px] font-bold text-[#111827]">
                  {a.title}
                </p>
                <span
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                    a.severity === "critical"
                      ? "border-red-300 text-red-800 bg-white"
                      : a.severity === "warning"
                        ? "border-amber-300 text-amber-800 bg-white"
                        : "border-[#D0D5DD] text-[#4B5563] bg-white"
                  )}
                >
                  {a.severity === "critical"
                    ? "Crítico"
                    : a.severity === "warning"
                      ? "Atenção"
                      : "Info"}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[#4B5563]">
                {a.description}
              </p>
              {a.financialImpact != null && a.financialImpact !== 0 ? (
                <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                  {formatFinanceCurrency(a.financialImpact)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): JSX.Element {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h3 className="text-[13px] font-bold text-[#111827]">{title}</h3>
      {subtitle ? (
        <p className="hidden text-[10px] uppercase tracking-wide text-[#6B7280] sm:block">
          {subtitle}
        </p>
      ) : null}
    </div>
  );
}

type KpiTone = "neutral" | "highlight" | "info" | "success" | "warning" | "danger" | "muted";

function DiffKpi({ label, value }: { label: string; value: number }): JSX.Element {
  const isNeutral = Math.abs(value) <= 0.01;
  const tone: KpiTone = isNeutral ? "success" : value > 0 ? "warning" : "danger";
  const prefix = isNeutral ? "" : value > 0 ? "+" : "−";
  const absValue = Math.abs(value);
  const help = isNeutral
    ? "Alinhado"
    : value > 0
      ? "Pedido maior que a fonte"
      : "Fonte externa maior";
  return (
    <Kpi
      label={label}
      value={`${prefix}${formatFinanceCurrency(absValue).replace("-", "")}`.trim()}
      tone={tone}
      help={help}
    />
  );
}

function Kpi({
  label,
  value,
  tone = "neutral",
  help,
}: {
  label: string;
  value: string;
  tone?: KpiTone;
  help?: string;
}): JSX.Element {
  const toneClass: Record<KpiTone, string> = {
    neutral: "border-[#E5E7EB] bg-white text-[#111827]",
    highlight: "border-sky-200 bg-sky-50 text-sky-900",
    info: "border-sky-200 bg-white text-[#111827]",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    danger: "border-red-200 bg-red-50 text-red-900",
    muted: "border-[#E5E7EB] bg-[#F9FAFB] text-[#4B5563]",
  };
  return (
    <div
      className={cn(
        "rounded-[10px] border px-3 py-2 transition-colors",
        toneClass[tone]
      )}
      title={help ? `${value} — ${help}` : value}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[13px] font-bold tabular-nums">
        {value}
      </p>
      {help ? (
        <p className="mt-0.5 text-[10px] opacity-70 truncate" title={help}>
          {help}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Itens                                                           */
/* -------------------------------------------------------------------- */

/**
 * Códigos oficiais de divergência dessa aba. Usados por:
 *  - filtragem do painel "Divergências desta aba"
 *  - badge por linha na tabela
 */
const ITEMS_ALERT_CODES = new Set([
  "ORDER_ITEM_CANCELED",
  "ORDER_ITEM_CUT",
  "ORDER_ITEM_STALE",
  "ORDER_ITEM_STATUS_UNKNOWN",
  "REPEATED_SKU_WITH_DIFFERENT_STATUS",
  "ITEM_STATUS_MATCH_AMBIGUOUS",
  "ORDER_ITEM_ACTIVE_PENDING",
  "ORDER_ITEM_OVER_FULFILLED",
]);

type ItemsChipId =
  | "all"
  | "fulfilled"
  | "activePending"
  | "canceled"
  | "cut"
  | "partial"
  | "overFulfilled"
  | "outsideOrder"
  | "openReceivable"
  | "received"
  | "noDocument"
  | "priceMismatch";

function ItemsTab({
  items,
  itemFacts,
  runId,
  orderCode,
  alerts,
}: {
  items: OrderFullAuditItem[];
  itemFacts: OrderToCashAuditListRow[];
  runId: string | null;
  orderCode: string | null;
  alerts: OrderFullAuditAlert[];
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

  const [chip, setChip] = useState<ItemsChipId>("all");

  // Índices auxiliares por linha do pedido — cruzam com `itemFacts` (evidência do audit-full).
  // Observação: `itemFacts` é `OrderToCashAuditFactRecord[]` no servidor (tem `salesOrderItemId`),
  // mas está tipado como `OrderToCashAuditListRow[]` no cliente por compat. Fazemos cast leve.
  type ItemFactShape = OrderToCashAuditListRow &
    Partial<{ salesOrderItemId: string | null }>;

  const factsBySalesOrderItemId = useMemo(() => {
    const m = new Map<string, ItemFactShape[]>();
    for (const raw of itemFacts as ItemFactShape[]) {
      const id = raw.salesOrderItemId ?? null;
      if (!id) continue;
      const arr = m.get(id) ?? [];
      arr.push(raw);
      m.set(id, arr);
    }
    return m;
  }, [itemFacts]);

  const derivedFacts = useMemo(() => {
    const withOverdueCR = new Set<string>();
    const withOpenReceivable = new Set<string>();
    const withReceived = new Set<string>();
    const withoutDocument = new Set<string>();
    const withExcess = new Set<string>();
    const outsideOrder = new Set<string>();
    const priceMismatch = new Set<string>();
    for (const it of items) {
      const rows = factsBySalesOrderItemId.get(it.salesOrderItemId) ?? [];
      if (rows.length === 0) {
        if (
          !it.nomusIsCanceled &&
          !it.nomusIsStale &&
          it.linkedStockDocumentExternalIds.length === 0 &&
          it.linkedNfeExternalIds.length === 0
        ) {
          withoutDocument.add(it.salesOrderItemId);
        }
        continue;
      }
      let hasDoc = false;
      for (const r of rows) {
        if (r.stockDocumentExternalId != null || r.nfeNumber) hasDoc = true;
        if (r.hasOverdueReceivable) withOverdueCR.add(it.salesOrderItemId);
        const openAmount = Number(r.receivableOpenValue ?? 0);
        if (openAmount > 0.009) withOpenReceivable.add(it.salesOrderItemId);
        const receivedAmount = Number(r.receivableReceivedValue ?? 0);
        if (receivedAmount > 0.009) withReceived.add(it.salesOrderItemId);
        if (r.hasExcessQuantity === true) withExcess.add(it.salesOrderItemId);
        if (r.hasProductOutsideOrder === true) outsideOrder.add(it.salesOrderItemId);
        if (r.hasPriceMismatch === true) priceMismatch.add(it.salesOrderItemId);
      }
      if (!hasDoc && it.linkedStockDocumentExternalIds.length === 0 &&
        it.linkedNfeExternalIds.length === 0 &&
        !it.nomusIsCanceled &&
        !it.nomusIsStale
      ) {
        withoutDocument.add(it.salesOrderItemId);
      }
    }
    return {
      withOverdueCR,
      withOpenReceivable,
      withReceived,
      withoutDocument,
      withExcess,
      outsideOrder,
      priceMismatch,
    };
  }, [items, factsBySalesOrderItemId]);

  const counters = useMemo(() => {
    const active = items.filter(
      (i) =>
        !i.nomusIsCanceled &&
        !i.nomusIsCut &&
        !i.nomusIsStale
    );
    const canceled = items.filter((i) => i.nomusIsCanceled || i.nomusIsStale);
    const cut = items.filter((i) => i.nomusIsCut);
    const fulfilled = items.filter((i) => {
      const status = (i.nomusItemStatusNormalized ?? "").toUpperCase();
      return status.startsWith("FULFILLED");
    });
    const activePending = active.filter(
      (i) => (i.activePendingQuantity ?? 0) > 0.0001
    );
    const partial = items.filter((i) => {
      const status = (i.nomusItemStatusNormalized ?? "").toUpperCase();
      return status === "PARTIAL" || status === "PARTIALLY_FULFILLED";
    });
    const overFulfilled = items.filter((i) =>
      i.alerts.includes("ORDER_ITEM_OVER_FULFILLED")
    );
    return {
      all: items.length,
      fulfilled: fulfilled.length,
      activePending: activePending.length,
      canceled: canceled.length,
      cut: cut.length,
      partial: partial.length,
      overFulfilled: overFulfilled.length,
      outsideOrder: derivedFacts.outsideOrder.size,
      openReceivable: derivedFacts.withOpenReceivable.size,
      received: derivedFacts.withReceived.size,
      noDocument: derivedFacts.withoutDocument.size,
      priceMismatch: derivedFacts.priceMismatch.size,
    };
  }, [items, derivedFacts]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      switch (chip) {
        case "fulfilled":
          return (
            (item.nomusItemStatusNormalized ?? "")
              .toUpperCase()
              .startsWith("FULFILLED") && !item.nomusIsCanceled
          );
        case "activePending":
          return (
            !item.nomusIsCanceled &&
            !item.nomusIsCut &&
            !item.nomusIsStale &&
            (item.activePendingQuantity ?? 0) > 0.0001
          );
        case "canceled":
          return item.nomusIsCanceled || item.nomusIsStale;
        case "cut":
          return item.nomusIsCut;
        case "partial": {
          const st = (item.nomusItemStatusNormalized ?? "").toUpperCase();
          return st === "PARTIAL" || st === "PARTIALLY_FULFILLED";
        }
        case "overFulfilled":
          return item.alerts.includes("ORDER_ITEM_OVER_FULFILLED");
        case "outsideOrder":
          return derivedFacts.outsideOrder.has(item.salesOrderItemId);
        case "openReceivable":
          return derivedFacts.withOpenReceivable.has(item.salesOrderItemId);
        case "received":
          return derivedFacts.withReceived.has(item.salesOrderItemId);
        case "noDocument":
          return derivedFacts.withoutDocument.has(item.salesOrderItemId);
        case "priceMismatch":
          return derivedFacts.priceMismatch.has(item.salesOrderItemId);
        default:
          return true;
      }
    });
  }, [items, chip, derivedFacts]);

  const chipsConfig: { id: ItemsChipId; label: string; count: number }[] = [
    { id: "all", label: "Todos", count: counters.all },
    { id: "fulfilled", label: "Atendidos", count: counters.fulfilled },
    {
      id: "activePending",
      label: "Pendentes ativos",
      count: counters.activePending,
    },
    { id: "canceled", label: "Cancelados", count: counters.canceled },
    { id: "cut", label: "Com corte", count: counters.cut },
    { id: "partial", label: "Parcialmente atendidos", count: counters.partial },
    {
      id: "overFulfilled",
      label: "Com excedente",
      count: counters.overFulfilled + counters.outsideOrder,
    },
    {
      id: "outsideOrder",
      label: "Produto fora do pedido",
      count: counters.outsideOrder,
    },
    {
      id: "openReceivable",
      label: "Com CR aberto",
      count: counters.openReceivable,
    },
    { id: "received", label: "Recebidos", count: counters.received },
    { id: "noDocument", label: "Sem documento", count: counters.noDocument },
    {
      id: "priceMismatch",
      label: "Divergência de preço",
      count: counters.priceMismatch,
    },
  ];

  const tabAlerts = alerts.filter((a) => ITEMS_ALERT_CODES.has(a.code));

  return (
    <div className="space-y-4" data-testid="order-full-audit-items-tab">
      <div
        className="flex flex-wrap gap-2"
        data-testid="order-full-audit-items-chips"
      >
        {chipsConfig.map((c) => (
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
            data-testid={`order-full-audit-items-chip-${c.id}`}
          >
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      {filteredItems.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-[#E5E7EB]">
          Nenhum item no filtro atual.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="min-w-[2800px] w-full text-left text-[11px]"
            data-testid="order-full-audit-items-table"
          >
            <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Seq</th>
                <th className="py-1.5 pr-2 font-semibold">ID item Nomus</th>
                <th className="py-1.5 pr-2 font-semibold">Produto / SKU</th>
                <th className="py-1.5 pr-2 font-semibold">ID produto Nomus</th>
                <th className="py-1.5 pr-2 font-semibold">Descrição</th>
                <th className="py-1.5 pr-2 font-semibold">Un</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd pedida</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd ativa</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd atendida</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd pendente ativa</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd cancelada</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd cortada</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Preço un.</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor item</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor ativo</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor cancelado</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Valor cortado</th>
                <th className="py-1.5 pr-2 font-semibold">Data entrega</th>
                <th className="py-1.5 pr-2 font-semibold">Status bruto</th>
                <th className="py-1.5 pr-2 font-semibold">Status normalizado</th>
                <th className="py-1.5 pr-2 font-semibold">Atendido produção?</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd produzida</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Qtd faturada</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Saldo a faturar</th>
                <th className="py-1.5 pr-2 font-semibold text-right">Saldo pronto</th>
                <th className="py-1.5 pr-2 font-semibold">Tipo mov.</th>
                <th className="py-1.5 pr-2 font-semibold">CFOP</th>
                <th className="py-1.5 pr-2 font-semibold">Documentos</th>
                <th className="py-1.5 pr-2 font-semibold">NF</th>
                <th className="py-1.5 pr-2 font-semibold">CR</th>
                <th className="py-1.5 pr-2 font-semibold">Alertas</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr
                  key={item.salesOrderItemId}
                  className={cn(
                    "border-b border-[#F3F4F6]",
                    item.nomusIsCanceled && "bg-red-50/30",
                    item.nomusIsStale && !item.nomusIsCanceled && "bg-[#F3F4F6]/50",
                    item.nomusIsCut && !item.nomusIsCanceled && "bg-amber-50/30"
                  )}
                  data-testid={`order-full-audit-items-row-${item.salesOrderItemId}`}
                >
                  <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                    {item.itemSequence ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                    {item.externalSalesOrderItemId ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                    {item.productCode ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                    {item.productExternalId ?? "—"}
                  </td>
                  <td
                    className="py-1.5 pr-2 max-w-[240px] truncate"
                    title={item.productName ?? undefined}
                  >
                    {item.productName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2">{item.unit ?? "—"}</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.quantity != null ? formatFinanceInteger(item.quantity) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.activeQuantity != null
                      ? formatFinanceInteger(item.activeQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.nomusQuantityFulfilled != null
                      ? formatFinanceInteger(item.nomusQuantityFulfilled)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.activePendingQuantity != null
                      ? formatFinanceInteger(item.activePendingQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.canceledQuantity != null && item.canceledQuantity > 0
                      ? formatFinanceInteger(item.canceledQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.cutQuantity != null && item.cutQuantity > 0
                      ? formatFinanceInteger(item.cutQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.unitPrice != null
                      ? formatFinanceCurrency(item.unitPrice)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                    {formatFinanceCurrency(item.totalNetValue ?? 0)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.activeValue != null
                      ? formatFinanceCurrency(item.activeValue)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-red-800">
                    {item.canceledValue != null && item.canceledValue > 0.009
                      ? formatFinanceCurrency(item.canceledValue)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-amber-800">
                    {item.cutValue != null && item.cutValue > 0.009
                      ? formatFinanceCurrency(item.cutValue)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {item.expectedDeliveryDate
                      ? formatFinanceDate(item.expectedDeliveryDate)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                    {item.nomusItemStatusRaw ?? "—"}
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
                  <td className="py-1.5 pr-2">
                    {item.productionQuantity != null &&
                    item.quantity != null &&
                    item.productionQuantity >= item.quantity - 0.0001
                      ? "Sim"
                      : item.productionQuantity != null &&
                          item.productionQuantity > 0
                        ? "Parcial"
                        : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.productionQuantity != null
                      ? formatFinanceInteger(item.productionQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.invoicedQuantity != null
                      ? formatFinanceInteger(item.invoicedQuantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.saldoAFaturar != null
                      ? formatFinanceInteger(item.saldoAFaturar)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {item.saldoPronto != null
                      ? formatFinanceInteger(item.saldoPronto)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-[10px]">
                    {item.movementType ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 tabular-nums text-[10px]">
                    {item.cfop ?? "—"}
                  </td>
                  <td
                    className="py-1.5 pr-2 max-w-[120px] truncate text-[10px]"
                    title={item.linkedStockDocumentExternalIds.join(", ")}
                  >
                    {item.linkedStockDocumentExternalIds.length > 0
                      ? item.linkedStockDocumentExternalIds
                          .slice(0, 3)
                          .join(", ") +
                        (item.linkedStockDocumentExternalIds.length > 3
                          ? ` (+${item.linkedStockDocumentExternalIds.length - 3})`
                          : "")
                      : "—"}
                  </td>
                  <td
                    className="py-1.5 pr-2 max-w-[120px] truncate text-[10px]"
                    title={item.linkedNfeExternalIds.join(", ")}
                  >
                    {item.linkedNfeExternalIds.length > 0
                      ? item.linkedNfeExternalIds.slice(0, 3).join(", ") +
                        (item.linkedNfeExternalIds.length > 3
                          ? ` (+${item.linkedNfeExternalIds.length - 3})`
                          : "")
                      : "—"}
                  </td>
                  <td
                    className="py-1.5 pr-2 max-w-[120px] truncate text-[10px]"
                    title={item.linkedReceivableExternalIds.join(", ")}
                  >
                    {item.linkedReceivableExternalIds.length > 0
                      ? item.linkedReceivableExternalIds
                          .slice(0, 3)
                          .join(", ") +
                        (item.linkedReceivableExternalIds.length > 3
                          ? ` (+${item.linkedReceivableExternalIds.length - 3})`
                          : "")
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {item.alerts.length === 0 ? (
                        <span className="text-[10px] text-[#6B7280]">—</span>
                      ) : (
                        item.alerts.map((code) => (
                          <span
                            key={code}
                            className={cn(
                              "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                              code === "ORDER_ITEM_CANCELED" ||
                                code === "ORDER_ITEM_OVER_FULFILLED"
                                ? "border-red-200 bg-red-50 text-red-800"
                                : code === "DELIVERY_DATE_OVERDUE" ||
                                    code === "ORDER_ITEM_STALE" ||
                                    code === "ORDER_ITEM_STATUS_UNKNOWN"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-[#D0D5DD] bg-white text-[#4B5563]"
                            )}
                            title={code}
                          >
                            {code.replace(/^ORDER_ITEM_/, "").replace(/_/g, " ")}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Painel de evidência — reusa componente do grid Order→Cash. */}
      {itemFacts.length > 0 ? (
        <section
          className="rounded-[14px] border border-[#E5E7EB] bg-[#FAFAFA] p-3"
          data-testid="order-full-audit-items-evidence"
        >
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

      {/* Divergências oficiais da aba. */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-items-section-divergences"
      >
        <SectionHeader
          title="Divergências dos itens"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência por linha."
              : `${tabAlerts.length} divergência(s) por linha.`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 20).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-items-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">{a.title}</p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Financeiro / Títulos e baixas                                   */
/* -------------------------------------------------------------------- */

const RECEIVABLE_ALERT_CODES = new Set([
  "RECEIVABLE_OPEN",
  "RECEIVABLE_OVERDUE",
  "RECEIVABLE_GREATER_THAN_ACTIVE_ORDER",
  "RECEIVABLE_LESS_THAN_DOCUMENTED_VALUE",
  "RECEIVABLE_DUPLICATED_BY_ITEM_FACTS",
  "RECEIVABLE_WITHOUT_NFE",
  "RECEIVABLE_WITHOUT_DUE_DATE",
  "PAYMENT_TERM_MISSING",
  "RECEIPT_GREATER_THAN_RECEIVABLE",
  "PARTIAL_RECEIPT_WITH_INCONSISTENT_BALANCE",
  "PLANNED_RECEIVABLE_WITHOUT_REAL_CR",
  "PLANNED_RECEIVABLE_OVERDUE_WITHOUT_REAL_CR",
  "PLANNED_RECEIVABLE_REPLACED_BY_REAL_CR",
  "CANCELED_NFE_WITH_RECEIVABLE",
  "RECEIVED_CR_LINKED_TO_CANCELED_NFE",
]);

/**
 * Badge visual (padrão executivo) para status de recebível planejado.
 * Reaproveita a paleta do `ReceivableStatusBadge` para consistência.
 */
function PlannedReceivableStatusBadge({
  status,
}: {
  status: OrderFullAuditPlannedReceivable["statusLabel"];
}): JSX.Element {
  const cls =
    status === "Vencido"
      ? "border-red-200 bg-red-50 text-red-800"
      : status === "Vence hoje"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : status === "A vencer"
          ? "border-sky-200 bg-sky-50 text-sky-800"
          : "border-[#E5E7EB] bg-[#F9FAFB] text-[#6B7280]";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        cls
      )}
    >
      {status}
    </span>
  );
}

/**
 * Badge "Tipo" — indica CR real x Planejado pelo pedido nas tabelas.
 * Design pareado com o padrão executivo IndusCost (branded como AR titles).
 */
function ReceivableTypeBadge({
  type,
}: {
  type: "REAL_CR" | "PLANNED";
}): JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        type === "REAL_CR"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-indigo-200 bg-indigo-50 text-indigo-800"
      )}
    >
      {type === "REAL_CR" ? "CR real" : "Planejado pelo pedido"}
    </span>
  );
}

/**
 * Rota oficial do Contas a Receber com filtro por referência (deep-link).
 * O `FinanceAccountsReceivableTitlesTab` lê `search` via `useSearchParams`
 * e aplica em `personName`/`sourceInvoiceNumber`/`sourceInvoiceId`/`externalId`.
 */
function buildAccountsReceivableSearchUrl(reference: string): string {
  return `/finance/accounts-receivable?search=${encodeURIComponent(reference)}`;
}

function FinancialTab({
  receivables,
  totals,
  plannedReceivables = [],
  plannedTotals,
  receipts = [],
  alerts = [],
  orderCode,
}: {
  receivables: OrderFullAuditReceivable[];
  totals: OrderFullAuditPayload["receivablesTotal"];
  plannedReceivables?: OrderFullAuditPlannedReceivable[];
  plannedTotals?: OrderFullAuditPlannedReceivablesTotal;
  receipts?: OrderFullAuditReceipt[];
  alerts?: OrderFullAuditAlert[];
  orderCode?: string | null;
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

  const totalOverdueAmount = receivables
    .filter((r) => r.status === "OVERDUE")
    .reduce((s, r) => s + (r.balanceReceivable ?? 0), 0);
  const totalPartialAmount = receivables
    .filter((r) => r.status === "PARTIALLY_RECEIVED")
    .reduce((s, r) => s + (r.amountReceived ?? 0), 0);
  const maxDaysOverdue = receivables.reduce(
    (max, r) => (r.daysOverdue != null && r.daysOverdue > max ? r.daysOverdue : max),
    0
  );

  const tabAlerts = alerts.filter((a) => RECEIVABLE_ALERT_CODES.has(a.code));

  // Verifica se soma amountReceivable bate com o card `totals.totalAmount`.
  const sumAmountReceivable = round2Local(
    receivables.reduce((s, r) => s + (r.amountReceivable ?? 0), 0)
  );
  const cardDiff = Math.abs(sumAmountReceivable - round2Local(totals.totalAmount));

  // Snapshot de recebíveis planejados (fallback quando não há CR real).
  const plannedTotalsSafe: OrderFullAuditPlannedReceivablesTotal = plannedTotals ?? {
    totalCount: 0,
    totalExpected: 0,
    openExpected: 0,
    overdueExpected: 0,
    overdueCount: 0,
    dueTodayExpected: 0,
    dueTodayCount: 0,
    upcomingCount: 0,
    nextDueDate: null,
    replacedCount: 0,
    replacedAmount: 0,
    netPlannedOpen: 0,
  };
  const activePlanned = plannedReceivables.filter((p) => !p.replacedByRealCr);
  const hasPlanned = activePlanned.length > 0;
  const hasRealCr = receivables.length > 0;
  const hasAnyFinancialRow = hasRealCr || hasPlanned;
  const totalFinancialValue =
    round2Local(totals.totalAmount) + round2Local(plannedTotalsSafe.totalExpected);
  const totalFinancialOpen =
    round2Local(totals.openAmount) + round2Local(plannedTotalsSafe.openExpected);
  const nextDueCandidates = [totals.nextDueDate, plannedTotalsSafe.nextDueDate]
    .filter((d): d is string => Boolean(d))
    .sort();
  const nextDueDateAny = nextDueCandidates[0] ?? null;

  return (
    <div className="space-y-4" data-testid="order-full-audit-financial-tab">
      {/* Top cards — Resumo executivo (CR real + planejado) */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-financial-cards"
      >
        <SectionHeader
          title="Resumo financeiro do pedido"
          subtitle="CR real (Contas a Receber oficial) + Recebíveis planejados pelo pedido. CR real prevalece."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-9">
          <Kpi
            label="Total financeiro"
            value={formatFinanceCurrency(totalFinancialValue)}
            tone="highlight"
            help="Soma de CR real + planejado pelo pedido, sem duplicar parcelas cobertas."
          />
          <Kpi
            label="CR real"
            value={formatFinanceCurrency(totals.totalAmount)}
            tone={totals.totalAmount > 0.009 ? "success" : "muted"}
            help="NomusAccountsReceivable — origem oficial. Prevalece sobre forecast."
          />
          <Kpi
            label="Planejado pelo pedido"
            value={formatFinanceCurrency(plannedTotalsSafe.totalExpected)}
            tone={plannedTotalsSafe.totalExpected > 0.009 ? "info" : "muted"}
            help="Parcelas previstas pela condição de pagamento (fallback quando não há CR real)."
          />
          <Kpi
            label="Aberto (real + planejado)"
            value={formatFinanceCurrency(totalFinancialOpen)}
            tone={totalFinancialOpen > 0.009 ? "info" : "muted"}
          />
          <Kpi
            label="Total vencido (CR)"
            value={formatFinanceCurrency(totalOverdueAmount)}
            tone={totalOverdueAmount > 0.009 ? "danger" : "muted"}
          />
          <Kpi
            label="Total recebido"
            value={formatFinanceCurrency(totals.receivedAmount)}
            tone={totals.receivedAmount > 0.009 ? "success" : "muted"}
          />
          <Kpi
            label="Parcial recebido"
            value={formatFinanceCurrency(totalPartialAmount)}
            tone={totalPartialAmount > 0.009 ? "info" : "muted"}
          />
          <Kpi
            label="Próximo vencimento"
            value={nextDueDateAny ? formatFinanceDate(nextDueDateAny) : "—"}
          />
          <Kpi
            label="Títulos/parcelas"
            value={`${totals.totalCount} real / ${plannedTotalsSafe.totalCount} planej.`}
            help="Quantidade de títulos reais vs parcelas planejadas."
          />
        </div>
        {cardDiff > 0.01 ? (
          <p
            className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
            data-testid="order-full-audit-financial-card-mismatch"
          >
            ⚠ Soma dos títulos ({formatFinanceCurrency(sumAmountReceivable)}) diverge
            do card "CR real" ({formatFinanceCurrency(totals.totalAmount)}).
          </p>
        ) : null}
        {!hasAnyFinancialRow ? (
          <p
            className="mt-2 rounded-[8px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-2 py-1 text-[11px] text-[#6B7280]"
            data-testid="order-full-audit-financial-empty-all"
          >
            Nenhum CR real e nenhum recebível planejado disponível para este pedido.
          </p>
        ) : null}
      </section>

      {feedback ? (
        <p
          className="text-[11px] text-emerald-700"
          data-testid="order-full-audit-financial-copy-feedback"
        >
          {feedback}
        </p>
      ) : null}

      {/* Tabela de títulos */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-financial-section-titles"
      >
        <SectionHeader
          title="Títulos reais de Contas a Receber"
          subtitle="Status financeiro (CR) ≠ status fiscal (NF). CR oficial recebido permanece; alerta se a NF vinculada estiver cancelada."
        />
        {receivables.some((r) => r.hasCanceledNfeLink) ? (
          <p
            className="mb-2 rounded-[10px] border border-rose-200 bg-rose-50/80 px-3 py-2 text-[11px] text-rose-900"
            data-testid="order-full-audit-financial-canceled-nfe-banner"
          >
            Há CR vinculado a NF cancelada. O recebimento financeiro é exibido, mas não deve
            ser tratado como faturamento fiscal normal sem revisão.
          </p>
        ) : null}
        {receivables.length === 0 ? (
          <div
            className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280] space-y-1"
            data-testid="order-full-audit-financial-real-empty"
          >
            <p>Nenhum título real de Contas a Receber vinculado ao pedido.</p>
            {plannedReceivables.filter((p) => !p.replacedByRealCr).length > 0 ? (
              <p className="text-[11px] text-indigo-700">
                Existe(m) recebível(is) planejado(s) pelo Pedido de Venda — ver seção abaixo.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[2480px] w-full text-left text-[11px]"
              data-testid="order-full-audit-financial-titles-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                  <th className="py-1.5 pr-2 font-semibold">Referência</th>
                  <th className="py-1.5 pr-2 font-semibold">ID interno</th>
                  <th className="py-1.5 pr-2 font-semibold">ID externo</th>
                  <th className="py-1.5 pr-2 font-semibold">Documento/NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Número NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Parcela</th>
                  <th className="py-1.5 pr-2 font-semibold">Emissão</th>
                  <th className="py-1.5 pr-2 font-semibold">Vencimento</th>
                  <th className="py-1.5 pr-2 font-semibold">Competência</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor original</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Aberto</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Recebido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Baixado</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Saldo</th>
                  <th className="py-1.5 pr-2 font-semibold">Status financeiro</th>
                  <th className="py-1.5 pr-2 font-semibold">Status NF vinculada</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Dias vencidos</th>
                  <th className="py-1.5 pr-2 font-semibold">Condição pgto</th>
                  <th className="py-1.5 pr-2 font-semibold">Forma pgto</th>
                  <th className="py-1.5 pr-2 font-semibold">Cliente</th>
                  <th className="py-1.5 pr-2 font-semibold">Empresa</th>
                  <th className="py-1.5 pr-2 font-semibold">Observação</th>
                  <th className="py-1.5 pr-2 font-semibold">Origem vínculo</th>
                  <th className="py-1.5 pr-2 font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {receivables.map((r) => {
                  const settlementValue = round2Local(
                    (r.amountReceivable ?? 0) - (r.balanceReceivable ?? 0)
                  );
                  const zeroValue =
                    (r.amountReceivable ?? 0) < 0.005 &&
                    (r.balanceReceivable ?? 0) < 0.005;
                  const canceledNfeLink = Boolean(r.hasCanceledNfeLink || r.linkedNfeIsCanceled);
                  return (
                    <tr
                      key={r.receivableExternalId}
                      className={cn(
                        "border-b border-[#F3F4F6]",
                        canceledNfeLink && "bg-rose-50/50",
                        !canceledNfeLink && r.status === "OVERDUE" && "bg-red-50/40",
                        !canceledNfeLink &&
                          r.status === "PARTIALLY_RECEIVED" &&
                          "bg-sky-50/40",
                        r.alerts.includes("RECEIPT_GREATER_THAN_RECEIVABLE") &&
                          "bg-red-50/60"
                      )}
                      data-testid={`order-full-audit-financial-row-${r.receivableExternalId}`}
                    >
                      <td className="py-1.5 pr-2">
                        <ReceivableTypeBadge type="REAL_CR" />
                      </td>
                      <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                        {r.searchReference}
                      </td>
                      <td
                        className="py-1.5 pr-2 font-mono text-[10px] text-[#6B7280] max-w-[120px] truncate"
                        title={r.receivableId ?? undefined}
                      >
                        {r.receivableId ? r.receivableId.slice(0, 8) + "…" : "—"}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {r.receivableExternalId}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {r.sourceInvoiceId ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 font-semibold">
                        {r.sourceInvoiceNumber ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        {r.installmentNumber != null && r.totalInstallments != null
                          ? `${r.installmentNumber}/${r.totalInstallments}`
                          : r.installmentNumber != null
                            ? String(r.installmentNumber)
                            : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {r.issueDate ? formatFinanceDate(r.issueDate) : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap font-semibold">
                        {r.dueDate ? formatFinanceDate(r.dueDate) : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {r.competenceDate
                          ? formatFinanceDate(r.competenceDate)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                        {formatFinanceCurrency(r.amountReceivable ?? 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatFinanceCurrency(r.balanceReceivable ?? 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-emerald-800">
                        {formatFinanceCurrency(r.amountReceived ?? 0)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-[#6B7280]">
                        {settlementValue > 0.009
                          ? formatFinanceCurrency(settlementValue)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatFinanceCurrency(r.balanceReceivable ?? 0)}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap items-center gap-1">
                          <ReceivableStatusBadge status={r.status} />
                          {canceledNfeLink ? (
                            <span
                              className="inline-flex rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-800"
                              data-testid={`order-full-audit-financial-nfe-canceled-badge-${r.receivableExternalId}`}
                              title="Status fiscal da NF vinculada — independente do status financeiro do CR"
                            >
                              NF cancelada
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">
                        {canceledNfeLink ? (
                          <span className="inline-flex rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-800">
                            {r.linkedNfeStatusLabel || "Cancelada"}
                          </span>
                        ) : r.linkedNfeStatusLabel ? (
                          <span className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800">
                            {r.linkedNfeStatusLabel}
                          </span>
                        ) : (
                          <span className="text-[10px] text-[#6B7280]">—</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex max-w-[220px] flex-wrap gap-1">
                          {canceledNfeLink &&
                          (r.receivableIsReceived ||
                            r.status === "RECEIVED" ||
                            r.status === "PARTIALLY_RECEIVED") ? (
                            <span
                              className="rounded border border-rose-300 bg-rose-100 px-1 py-0.5 text-[9px] font-semibold text-rose-900"
                              title="CR recebido vinculado a NF cancelada"
                              data-testid={`order-full-audit-financial-received-canceled-alert-${r.receivableExternalId}`}
                            >
                              CR recebido c/ NF cancelada
                            </span>
                          ) : canceledNfeLink ? (
                            <span className="rounded border border-rose-200 bg-rose-50 px-1 py-0.5 text-[9px] font-semibold text-rose-800">
                              CR c/ NF cancelada
                            </span>
                          ) : r.alerts.length === 0 ? (
                            <span className="text-[10px] text-[#6B7280]">—</span>
                          ) : (
                            r.alerts.slice(0, 2).map((code) => (
                              <span
                                key={code}
                                className="rounded border border-[#D0D5DD] bg-white px-1 py-0.5 text-[9px] font-semibold text-[#4B5563]"
                                title={code}
                              >
                                {code.replace(/_/g, " ")}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {r.daysOverdue != null && r.daysOverdue > 0
                          ? String(r.daysOverdue)
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[120px] truncate"
                        title={r.paymentTermsText ?? undefined}
                      >
                        {r.paymentTermsText ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[120px] truncate"
                        title={r.paymentMethodName ?? undefined}
                      >
                        {r.paymentMethodName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[140px] truncate"
                        title={r.personName ?? undefined}
                      >
                        {r.personName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[140px] truncate"
                        title={r.companyName ?? undefined}
                      >
                        {r.companyName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[180px] truncate"
                        title={r.comments ?? r.description ?? undefined}
                      >
                        {r.comments ?? r.description ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold",
                            r.linkOrigin === "ITEM_EVIDENCE"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : r.linkOrigin === "SOURCE_INVOICE"
                                ? "border-sky-200 bg-sky-50 text-sky-800"
                                : r.linkOrigin === "HEADER_ONLY"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-[#D0D5DD] bg-white text-[#4B5563]"
                          )}
                        >
                          {r.linkOrigin}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-semibold hover:bg-[#F9FAFB]",
                              zeroValue
                                ? "text-[#9CA3AF] cursor-not-allowed"
                                : "text-[#374151]"
                            )}
                            onClick={() =>
                              !zeroValue && void copy(r.searchReference)
                            }
                            title={
                              zeroValue
                                ? "Título zerado — copiar desabilitado"
                                : "Copiar referência do título"
                            }
                            aria-label="Copiar referência"
                            disabled={zeroValue}
                            data-testid={`order-full-audit-financial-copy-${r.receivableExternalId}`}
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                          {zeroValue ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-semibold text-[#9CA3AF]"
                              title="Título zerado — abertura desabilitada"
                              aria-label="Abrir Contas a Receber (desabilitado)"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </span>
                          ) : (
                            <a
                              href={buildAccountsReceivableSearchUrl(
                                r.searchReference
                              )}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-1.5 py-0.5 text-[10px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                              title={`Abrir no Contas a Receber com filtro=${r.searchReference}`}
                              aria-label="Abrir Contas a Receber"
                              data-testid={`order-full-audit-financial-open-${r.receivableExternalId}`}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recebíveis planejados pelo pedido (forecast) */}
      {hasPlanned ? (
        <section
          className="rounded-[14px] border border-indigo-200 bg-indigo-50/40 p-3"
          data-testid="order-full-audit-financial-section-planned"
        >
          <SectionHeader
            title={`Recebíveis planejados pelo pedido (${activePlanned.length})`}
            subtitle="Parcelas previstas pela condição de pagamento do pedido. Aparecem quando ainda não há NF/CR real. CR real sempre prevalece."
          />
          <div className="mt-2 mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi
              label="Total planejado"
              value={formatFinanceCurrency(plannedTotalsSafe.totalExpected)}
              tone="info"
            />
            <Kpi
              label="Aberto planejado"
              value={formatFinanceCurrency(plannedTotalsSafe.openExpected)}
              tone={plannedTotalsSafe.openExpected > 0.009 ? "info" : "muted"}
            />
            <Kpi
              label="Vencido planejado"
              value={formatFinanceCurrency(plannedTotalsSafe.overdueExpected)}
              tone={plannedTotalsSafe.overdueExpected > 0.009 ? "danger" : "muted"}
            />
            <Kpi
              label="Parcelas"
              value={String(activePlanned.length)}
              help="Parcelas planejadas ativas (excluindo as já cobertas por CR real)."
            />
            <Kpi
              label="Próximo vencimento"
              value={
                plannedTotalsSafe.nextDueDate
                  ? formatFinanceDate(plannedTotalsSafe.nextDueDate)
                  : "—"
              }
            />
          </div>
          <div className="overflow-x-auto">
            <table
              className="min-w-[1400px] w-full text-left text-[11px]"
              data-testid="order-full-audit-financial-planned-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-indigo-200">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                  <th className="py-1.5 pr-2 font-semibold">Referência</th>
                  <th className="py-1.5 pr-2 font-semibold">Documento/NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Parcela</th>
                  <th className="py-1.5 pr-2 font-semibold">Vencimento</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor previsto</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Aberto previsto</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Recebido</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 font-semibold">Condição</th>
                  <th className="py-1.5 pr-2 font-semibold">Forma</th>
                  <th className="py-1.5 pr-2 font-semibold">NF emitida</th>
                  <th className="py-1.5 pr-2 font-semibold">Origem</th>
                  <th className="py-1.5 pr-2 font-semibold">Observação</th>
                  <th className="py-1.5 pr-2 font-semibold">Ação</th>
                </tr>
              </thead>
              <tbody>
                {activePlanned.map((p) => (
                  <tr
                    key={p.key}
                    className={cn(
                      "border-b border-indigo-100/70",
                      p.statusLabel === "Vencido" && "bg-red-50/40"
                    )}
                    data-testid={`order-full-audit-financial-planned-row-${p.installmentNumber}`}
                  >
                    <td className="py-1.5 pr-2">
                      <ReceivableTypeBadge type="PLANNED" />
                    </td>
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {p.reference}
                    </td>
                    <td className="py-1.5 pr-2 text-[#9CA3AF]">—</td>
                    <td className="py-1.5 pr-2 tabular-nums">
                      {p.installmentNumber}/{p.totalInstallments}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap font-semibold">
                      {p.dueDate ? formatFinanceDate(p.dueDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                      {formatFinanceCurrency(p.expectedAmount)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-indigo-800">
                      {formatFinanceCurrency(p.openAmount)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[#9CA3AF]">
                      {formatFinanceCurrency(0)}
                    </td>
                    <td className="py-1.5 pr-2">
                      <PlannedReceivableStatusBadge status={p.statusLabel} />
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[180px] truncate"
                      title={p.paymentConditionLabel}
                    >
                      {p.paymentConditionLabel}
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[140px] truncate"
                      title={p.paymentMethodLabel ?? undefined}
                    >
                      {p.paymentMethodLabel ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="inline-flex items-center rounded border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold text-[#6B7280]">
                        Não
                      </span>
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[180px] truncate"
                      title={p.origin}
                    >
                      {p.origin}
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[220px] truncate"
                      title={p.note}
                    >
                      {p.note}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <a
                        href={buildAccountsReceivableSearchUrl(
                          orderCode ?? p.orderCode
                        )}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-indigo-800 hover:bg-indigo-50"
                        title={`Localizar "${p.reference}" no Contas a Receber`}
                        aria-label="Abrir Contas a Receber pelo pedido"
                        data-testid={`order-full-audit-financial-planned-open-${p.installmentNumber}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-indigo-200 bg-indigo-100/40 text-[11px] font-semibold">
                  <td colSpan={5} className="py-1.5 pr-2">
                    Total planejado (aberto)
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(plannedTotalsSafe.totalExpected)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatFinanceCurrency(plannedTotalsSafe.openExpected)}
                  </td>
                  <td colSpan={8} />
                </tr>
              </tfoot>
            </table>
          </div>
          {plannedTotalsSafe.replacedCount > 0 ? (
            <p
              className="mt-2 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900"
              data-testid="order-full-audit-financial-planned-replaced"
            >
              ✓ {plannedTotalsSafe.replacedCount} parcela(s) planejada(s) já
              coberta(s) por CR real ({formatFinanceCurrency(plannedTotalsSafe.replacedAmount)})
              — ocultadas para evitar duplicidade.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Tabela de baixas/recebimentos */}
      {receipts.length > 0 ? (
        <section
          className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
          data-testid="order-full-audit-financial-section-receipts"
        >
          <SectionHeader
            title={`Baixas registradas (${receipts.length})`}
            subtitle="Cronologia oficial das baixas dos CRs — CR real do Nomus prevalece."
          />
          <div className="overflow-x-auto">
            <table
              className="min-w-[1400px] w-full text-left text-[11px]"
              data-testid="order-full-audit-financial-receipts-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Título</th>
                  <th className="py-1.5 pr-2 font-semibold">Data baixa</th>
                  <th className="py-1.5 pr-2 font-semibold">Data receb.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor recebido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Juros</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Desconto</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Multa</th>
                  <th className="py-1.5 pr-2 font-semibold">Forma receb.</th>
                  <th className="py-1.5 pr-2 font-semibold">Banco/Conta</th>
                  <th className="py-1.5 pr-2 font-semibold">Histórico</th>
                  <th className="py-1.5 pr-2 font-semibold">ID externo</th>
                  <th className="py-1.5 pr-2 font-semibold">Usuário/Sistema</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((r, idx) => (
                  <tr
                    key={`${r.receivableExternalId}-${idx}`}
                    className="border-b border-[#F3F4F6]"
                  >
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {r.receivableExternalId}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {r.settlementDate ? formatFinanceDate(r.settlementDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {r.paymentDate ? formatFinanceDate(r.paymentDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-semibold text-emerald-800">
                      {formatFinanceCurrency(r.amountReceived)}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {r.interest != null && r.interest > 0.009
                        ? formatFinanceCurrency(r.interest)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-amber-800">
                      {r.discount != null && r.discount > 0.009
                        ? formatFinanceCurrency(r.discount)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-red-800">
                      {r.lateFee != null && r.lateFee > 0.009
                        ? formatFinanceCurrency(r.lateFee)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2">{r.paymentMethodName ?? "—"}</td>
                    <td className="py-1.5 pr-2">{r.bankAccountName ?? "—"}</td>
                    <td
                      className="py-1.5 pr-2 max-w-[220px] truncate"
                      title={r.history ?? undefined}
                    >
                      {r.history ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {r.externalReceiptId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px]">
                      {r.userOrSystem ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {/* Divergências oficiais desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-financial-section-divergences"
      >
        <SectionHeader
          title="Divergências financeiras"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência de CR."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 20).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-financial-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function round2Local(v: number): number {
  return Math.round(v * 100) / 100;
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

const DOCUMENT_ALERT_CODES = new Set([
  "DOCUMENT_WITH_EXCESS",
  "DOCUMENT_EXTRA_ITEM",
  "DOCUMENT_WITHOUT_ORDER_ITEM",
  "DOCUMENT_WITHOUT_NFE",
  "DOCUMENT_PRICE_MISMATCH",
  "DOCUMENT_QUANTITY_MISMATCH",
  "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM",
  "DOCUMENT_ALLOCATED_BY_HEADER_ONLY",
]);

function StockDocumentsTab({
  docs,
  docItems,
  alerts,
}: {
  docs: OrderFullAuditStockDocument[];
  docItems: OrderFullAuditStockDocumentItem[];
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const [docFilter, setDocFilter] = useState<number | "all">("all");

  const totalDocs = docs.length;
  const totalValue = docs.reduce((s, d) => s + d.totalValue, 0);
  const allocatedValue = docs.reduce((s, d) => s + d.allocatedValue, 0);
  const outsideValue = docs.reduce((s, d) => s + d.outsideOrderValue, 0);
  const excessQtyTotal = docs.reduce((s, d) => s + d.excessQuantity, 0);
  const outsideItemsCount = docs.filter((d) => d.hasOutside).length;
  const withoutNfeCount = docs.filter((d) => d.idNfe == null).length;
  const withPriceMismatchCount = new Set(
    docItems
      .filter((i) => i.alerts.includes("DOCUMENT_PRICE_MISMATCH"))
      .map((i) => i.stockDocumentExternalId)
  ).size;

  const filteredItems =
    docFilter === "all"
      ? docItems
      : docItems.filter((i) => i.stockDocumentExternalId === docFilter);

  const tabAlerts = alerts.filter((a) => DOCUMENT_ALERT_CODES.has(a.code));

  return (
    <div className="space-y-4" data-testid="order-full-audit-documents-tab">
      {/* Top cards */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-documents-cards"
      >
        <SectionHeader
          title="Resumo dos documentos de saída"
          subtitle="Cabeçalhos deduplicados por documento; valores não inflam o pedido sem alerta."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Total documentos" value={String(totalDocs)} />
          <Kpi
            label="Valor total"
            value={formatFinanceCurrency(totalValue)}
            tone="highlight"
          />
          <Kpi
            label="Alocado ao pedido"
            value={formatFinanceCurrency(allocatedValue)}
          />
          <Kpi
            label="Valor excedente"
            value={formatFinanceCurrency(outsideValue)}
            tone={outsideValue > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="Qtd excedente"
            value={formatFinanceInteger(excessQtyTotal)}
            tone={excessQtyTotal > 0.0001 ? "warning" : "muted"}
          />
          <Kpi
            label="Produtos fora do pedido"
            value={String(outsideItemsCount)}
            tone={outsideItemsCount > 0 ? "danger" : "muted"}
          />
          <Kpi
            label="Sem NF"
            value={String(withoutNfeCount)}
            tone={withoutNfeCount > 0 ? "warning" : "muted"}
          />
          <Kpi
            label="Divergência de preço"
            value={String(withPriceMismatchCount)}
            tone={withPriceMismatchCount > 0 ? "warning" : "muted"}
          />
        </div>
      </section>

      {/* Tabela de documentos */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-documents-section-headers"
      >
        <SectionHeader
          title="Documentos de saída vinculados"
          subtitle="Clique em um documento para filtrar os itens abaixo."
        />
        {docs.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Sem documento de saída vinculado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[1400px] w-full text-left text-[11px]"
              data-testid="order-full-audit-documents-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Documento</th>
                  <th className="py-1.5 pr-2 font-semibold">ID externo</th>
                  <th className="py-1.5 pr-2 font-semibold">Tipo</th>
                  <th className="py-1.5 pr-2 font-semibold">Data emissão</th>
                  <th className="py-1.5 pr-2 font-semibold">Data movim.</th>
                  <th className="py-1.5 pr-2 font-semibold">Cliente</th>
                  <th className="py-1.5 pr-2 font-semibold">Empresa</th>
                  <th className="py-1.5 pr-2 font-semibold">NF vinculada</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor total</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Alocado</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Excedente</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 font-semibold">Origem vínculo</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => {
                  const isSelected = docFilter === d.stockDocumentExternalId;
                  return (
                    <tr
                      key={d.stockDocumentExternalId}
                      className={cn(
                        "border-b border-[#F3F4F6] cursor-pointer transition-colors",
                        isSelected
                          ? "bg-sky-50/80 ring-1 ring-inset ring-sky-200"
                          : d.hasOutside
                            ? "bg-red-50/40 hover:bg-red-50/70"
                            : d.hasExcess
                              ? "bg-amber-50/40 hover:bg-amber-50/70"
                              : "hover:bg-[#F9FAFB]"
                      )}
                      onClick={() =>
                        setDocFilter(
                          isSelected ? "all" : d.stockDocumentExternalId
                        )
                      }
                      data-testid={`order-full-audit-documents-row-${d.stockDocumentExternalId}`}
                      title="Clique para filtrar os itens deste documento abaixo"
                    >
                      <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                        {d.stockDocumentExternalId}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {d.stockDocumentExternalId}
                      </td>
                      <td className="py-1.5 pr-2 text-[#6B7280]">
                        {d.tipoDocumentoEstoque ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {d.dataDocumento ? formatFinanceDate(d.dataDocumento) : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {d.dataMovimentacao
                          ? formatFinanceDate(d.dataMovimentacao)
                          : d.dataDocumento
                            ? formatFinanceDate(d.dataDocumento)
                            : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[160px] truncate"
                        title={d.customerName ?? undefined}
                      >
                        {d.customerName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[140px] truncate"
                        title={d.companyName ?? undefined}
                      >
                        {d.companyName ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {d.idNfe ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                        {formatFinanceCurrency(d.totalValue)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatFinanceCurrency(d.allocatedValue)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-amber-800">
                        {d.outsideOrderValue > 0.009
                          ? formatFinanceCurrency(d.outsideOrderValue)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[10px] text-[#4B5563]">
                          {d.status ?? "—"}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[9px] uppercase tracking-wide font-semibold",
                            d.linkOrigin === "ITEM_EVIDENCE"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : d.linkOrigin === "SALES_ORDER_NFE_LINK"
                                ? "border-sky-200 bg-sky-50 text-sky-800"
                                : d.linkOrigin === "HEADER_ONLY"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-[#D0D5DD] bg-white text-[#4B5563]"
                          )}
                        >
                          {d.linkOrigin}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {d.alerts.length === 0 ? (
                            <span className="text-[10px] text-[#6B7280]">—</span>
                          ) : (
                            d.alerts.map((code) => (
                              <span
                                key={code}
                                className={cn(
                                  "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                  code === "DOCUMENT_EXTRA_ITEM" ||
                                    code === "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : code === "DOCUMENT_WITH_EXCESS" ||
                                        code === "DOCUMENT_WITHOUT_NFE" ||
                                        code === "DOCUMENT_PRICE_MISMATCH"
                                      ? "border-amber-200 bg-amber-50 text-amber-800"
                                      : "border-[#D0D5DD] bg-white text-[#4B5563]"
                                )}
                                title={code}
                              >
                                {code.replace(/^DOCUMENT_/, "").replace(/_/g, " ")}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tabela de itens do documento */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-documents-section-items"
      >
        <SectionHeader
          title="Itens dos documentos"
          subtitle={
            docFilter === "all"
              ? "Todas as linhas dos documentos vinculados. Comparação preço unitário doc × pedido."
              : `Filtrado por documento ${docFilter}. Clique novamente na linha para limpar o filtro.`
          }
        />
        {filteredItems.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Sem itens de documento.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[2100px] w-full text-left text-[11px]"
              data-testid="order-full-audit-documents-items-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Doc</th>
                  <th className="py-1.5 pr-2 font-semibold">Item doc.</th>
                  <th className="py-1.5 pr-2 font-semibold">Produto / SKU</th>
                  <th className="py-1.5 pr-2 font-semibold">ID produto</th>
                  <th className="py-1.5 pr-2 font-semibold">Descrição</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtd doc.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtd usada</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Excedente</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Vlr un. doc.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Vlr total doc.</th>
                  <th className="py-1.5 pr-2 font-semibold">Pedido</th>
                  <th className="py-1.5 pr-2 font-semibold">Item pedido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Preço un. pedido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Δ Preço un.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Δ Preço %</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Impacto R$</th>
                  <th className="py-1.5 pr-2 font-semibold">NF</th>
                  <th className="py-1.5 pr-2 font-semibold">CR</th>
                  <th className="py-1.5 pr-2 font-semibold">Tipo linha</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((i) => (
                  <tr
                    key={`${i.stockDocumentExternalId}-${i.stockDocumentItemId}`}
                    className={cn(
                      "border-b border-[#F3F4F6]",
                      i.alerts.includes("DOCUMENT_EXTRA_ITEM") &&
                        "bg-red-50/30",
                      i.alerts.includes("DOCUMENT_WITH_EXCESS") &&
                        !i.alerts.includes("DOCUMENT_EXTRA_ITEM") &&
                        "bg-amber-50/30",
                      i.alerts.includes("DOCUMENT_PRICE_MISMATCH") &&
                        !i.alerts.includes("DOCUMENT_EXTRA_ITEM") &&
                        "bg-amber-50/30"
                    )}
                  >
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {i.stockDocumentExternalId}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.externalItemId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {i.productSku ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.productExternalId ?? "—"}
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[200px] truncate"
                      title={i.productName ?? undefined}
                    >
                      {i.productName ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.quantityDocument != null
                        ? formatFinanceInteger(i.quantityDocument)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.quantityUsedForOrder != null
                        ? formatFinanceInteger(i.quantityUsedForOrder)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-amber-800">
                      {i.excessQuantity != null && i.excessQuantity > 0.0001
                        ? formatFinanceInteger(i.excessQuantity)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.unitValue != null
                        ? formatFinanceCurrency(i.unitValue)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.totalValue != null
                        ? formatFinanceCurrency(i.totalValue)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {i.linkedOrderCode ?? "—"}
                    </td>
                    <td
                      className="py-1.5 pr-2 font-mono text-[10px] text-[#4B5563] max-w-[120px] truncate"
                      title={i.linkedSalesOrderItemId ?? undefined}
                    >
                      {i.linkedSalesOrderItemId
                        ? `#${i.linkedOrderItemSequence ?? "?"} · ${i.linkedSalesOrderItemId.slice(0, 8)}…`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.orderUnitPrice != null
                        ? formatFinanceCurrency(i.orderUnitPrice)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.priceDiffAbsolute != null
                        ? formatSignedCurrency(i.priceDiffAbsolute)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.priceDiffPercent != null
                        ? formatFinancePercent(i.priceDiffPercent)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.financialImpact != null
                        ? formatSignedCurrency(i.financialImpact)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.nfeNumber ?? i.nfeExternalId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.receivableExternalId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-[10px]">
                      {i.lineType ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {i.alerts.length === 0 ? (
                          <span className="text-[10px] text-[#6B7280]">—</span>
                        ) : (
                          i.alerts.map((code) => (
                            <span
                              key={code}
                              className={cn(
                                "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                code === "DOCUMENT_EXTRA_ITEM" ||
                                  code === "DOCUMENT_ALLOCATED_TO_CANCELED_ITEM"
                                  ? "border-red-200 bg-red-50 text-red-800"
                                  : code === "DOCUMENT_WITH_EXCESS" ||
                                      code === "DOCUMENT_WITHOUT_NFE" ||
                                      code === "DOCUMENT_PRICE_MISMATCH"
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-[#D0D5DD] bg-white text-[#4B5563]"
                              )}
                              title={code}
                            >
                              {code.replace(/^DOCUMENT_/, "").replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Divergências oficiais desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-documents-section-divergences"
      >
        <SectionHeader
          title="Divergências dos documentos"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência de documento."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 20).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-documents-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: NF-e                                                            */
/* -------------------------------------------------------------------- */

const NFE_ALERT_CODES = new Set([
  "NFE_HEADER_GREATER_THAN_ORDER",
  "NFE_WITHOUT_DOCUMENT",
  "NFE_WITHOUT_CR",
  "NFE_EXTRA_ITEM",
  "NFE_PRICE_MISMATCH",
  "NFE_ALLOCATED_BY_HEADER_ONLY",
  "NFE_VALUE_GREATER_THAN_ACTIVE_ORDER",
  "NFE_CANCELED_LINKED_TO_ORDER",
  "CANCELED_NFE_INCLUDED_IN_BILLING_VALUE",
  "CANCELED_NFE_WITH_RECEIVABLE",
  "DOCUMENT_LINKED_TO_CANCELED_NFE",
  "NFE_STATUS_UNKNOWN",
]);

function NfeStatusBadge({ nfe }: { nfe: OrderFullAuditNfe }): JSX.Element {
  if (nfe.isCanceled || nfe.statusNormalized === "CANCELED") {
    return (
      <span
        className="inline-flex rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-rose-800"
        data-testid={`order-full-audit-nfe-badge-canceled-${nfe.nfeExternalId}`}
        title={`Status bruto: ${nfe.statusRaw ?? nfe.status ?? "—"}`}
      >
        Cancelada
      </span>
    );
  }
  if (nfe.statusNormalized === "AUTHORIZED" || nfe.isValidForBilling) {
    return (
      <span
        className="inline-flex rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800"
        data-testid={`order-full-audit-nfe-badge-valid-${nfe.nfeExternalId}`}
        title={`Status bruto: ${nfe.statusRaw ?? nfe.status ?? "—"}`}
      >
        {nfe.statusNormalized === "AUTHORIZED" ? "Autorizada" : nfe.statusLabel || "Válida"}
      </span>
    );
  }
  return (
    <span
      className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-900"
      data-testid={`order-full-audit-nfe-badge-unknown-${nfe.nfeExternalId}`}
      title={`Status bruto: ${nfe.statusRaw ?? nfe.status ?? "—"}`}
    >
      Status desconhecido
    </span>
  );
}

function NfesTab({
  nfes,
  nfeItems,
  activeOrderValue,
  alerts,
}: {
  nfes: OrderFullAuditNfe[];
  nfeItems: OrderFullAuditNfeItem[];
  activeOrderValue: number;
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const [nfeFilter, setNfeFilter] = useState<number | "all">("all");

  const totalNfes = nfes.length;
  const validNfes = nfes.filter((n) => n.isValidForBilling && !n.isCanceled);
  const canceledNfes = nfes.filter((n) => n.isCanceled);
  const totalValueAll = nfes.reduce((s, n) => s + (n.valorTotal ?? 0), 0);
  const totalValidValue = validNfes.reduce((s, n) => s + (n.valorTotal ?? 0), 0);
  const totalAllocatedValid = validNfes.reduce((s, n) => s + n.allocatedValueToOrder, 0);
  const withoutCr = validNfes.filter((n) => !n.hasReceivable).length;
  const greaterThanOrder = validNfes.filter(
    (n) => n.headerGreaterThanOrder || (n.valorTotal ?? 0) - activeOrderValue > 0.009
  ).length;

  const filteredItems =
    nfeFilter === "all"
      ? nfeItems
      : nfeItems.filter((i) => i.nfeExternalId === nfeFilter);

  const tabAlerts = alerts.filter((a) => NFE_ALERT_CODES.has(a.code));

  return (
    <div className="space-y-4" data-testid="order-full-audit-nfes-tab">
      {/* Top cards */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-nfes-cards"
      >
        <SectionHeader
          title="Resumo das NF-e vinculadas"
          subtitle="Canceladas aparecem para auditoria, mas não compõem faturamento válido."
        />
        {canceledNfes.length > 0 ? (
          <p className="mb-2 rounded-[10px] border border-rose-200 bg-rose-50/70 px-3 py-2 text-[11px] text-rose-900">
            NF cancelada exibida apenas para auditoria. Não compõe faturamento válido.
          </p>
        ) : null}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Total NF-e" value={String(totalNfes)} />
          <Kpi
            label="Válidas"
            value={String(validNfes.length)}
            tone="success"
          />
          <Kpi
            label="Canceladas"
            value={String(canceledNfes.length)}
            tone={canceledNfes.length > 0 ? "danger" : "muted"}
          />
          <Kpi
            label="Valor histórico"
            value={formatFinanceCurrency(totalValueAll)}
            help="Soma de todas as NFs vinculadas, inclusive canceladas."
          />
          <Kpi
            label="Faturamento válido"
            value={formatFinanceCurrency(totalValidValue)}
            tone="highlight"
            help="Somente NFs com isValidForBilling (não canceladas)."
          />
          <Kpi
            label="Atribuído válido"
            value={formatFinanceCurrency(totalAllocatedValid)}
            help="Alocação ao pedido apenas de NFs válidas."
          />
          <Kpi
            label="NF sem CR"
            value={String(withoutCr)}
            tone={withoutCr > 0 ? "warning" : "muted"}
          />
          <Kpi
            label="NF maior que pedido"
            value={String(greaterThanOrder)}
            tone={greaterThanOrder > 0 ? "warning" : "muted"}
          />
        </div>
      </section>

      {/* Tabela de NF-e */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-nfes-section-headers"
      >
        <SectionHeader
          title="NF-e vinculadas"
          subtitle="Clique em uma NF para filtrar os itens abaixo."
        />
        {nfes.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Sem NF-e vinculada.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[1600px] w-full text-left text-[11px]"
              data-testid="order-full-audit-nfes-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Número</th>
                  <th className="py-1.5 pr-2 font-semibold">Série</th>
                  <th className="py-1.5 pr-2 font-semibold">ID externo</th>
                  <th className="py-1.5 pr-2 font-semibold">Chave</th>
                  <th className="py-1.5 pr-2 font-semibold">Emissão</th>
                  <th className="py-1.5 pr-2 font-semibold">Processamento</th>
                  <th className="py-1.5 pr-2 font-semibold">Cliente</th>
                  <th className="py-1.5 pr-2 font-semibold">Empresa</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 font-semibold">Cancelada?</th>
                  <th className="py-1.5 pr-2 font-semibold">Data canc.</th>
                  <th className="py-1.5 pr-2 font-semibold">Motivo canc.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Valor NF</th>
                  <th
                    className="py-1.5 pr-2 font-semibold text-right"
                    title="Somente NF válida. Cancelada = R$ 0,00 no faturamento válido."
                  >
                    Atrib. válido
                  </th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Itens dentro</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Itens fora</th>
                  <th className="py-1.5 pr-2 font-semibold">Doc. saída</th>
                  <th className="py-1.5 pr-2 font-semibold">CR</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {nfes.map((n) => {
                  const isSelected = nfeFilter === n.nfeExternalId;
                  const canceled = Boolean(n.isCanceled);
                  return (
                    <tr
                      key={n.nfeExternalId}
                      className={cn(
                        "border-b border-[#F3F4F6] cursor-pointer transition-colors",
                        isSelected
                          ? "bg-sky-50/80 ring-1 ring-inset ring-sky-200"
                          : canceled
                            ? "bg-rose-50/30 text-[#6B7280] hover:bg-rose-50/50"
                            : n.hasExtraItems
                              ? "bg-red-50/40 hover:bg-red-50/70"
                              : n.headerGreaterThanOrder
                                ? "bg-amber-50/40 hover:bg-amber-50/70"
                                : "hover:bg-[#F9FAFB]"
                      )}
                      onClick={() =>
                        setNfeFilter(isSelected ? "all" : n.nfeExternalId)
                      }
                      data-testid={`order-full-audit-nfes-row-${n.nfeExternalId}`}
                      title="Clique para filtrar os itens desta NF abaixo"
                    >
                      <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                        {n.numero ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2">{n.serie ?? "—"}</td>
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {n.nfeExternalId > 0 ? n.nfeExternalId : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[160px] truncate font-mono text-[10px]"
                        title={n.chave ?? undefined}
                      >
                        {n.chave ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {n.dataEmissao ? formatFinanceDate(n.dataEmissao) : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {n.dataProcessamento
                          ? formatFinanceDate(n.dataProcessamento)
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[160px] truncate"
                        title={n.customerName ?? undefined}
                      >
                        {n.customerName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[140px] truncate"
                        title={n.companyName ?? undefined}
                      >
                        {n.companyName ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <NfeStatusBadge nfe={n} />
                      </td>
                      <td className="py-1.5 pr-2 text-[11px]">
                        {canceled ? "Sim" : "Não"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap text-[11px]">
                        {n.cancellationDate
                          ? formatFinanceDate(n.cancellationDate)
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[160px] truncate text-[11px]"
                        title={n.cancellationReason ?? undefined}
                      >
                        {n.cancellationReason ?? "—"}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums font-semibold",
                          canceled && "line-through opacity-70"
                        )}
                      >
                        {formatFinanceCurrency(n.valorTotal ?? 0)}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums",
                          canceled && "text-rose-800 font-semibold"
                        )}
                        title={
                          canceled
                            ? "NF cancelada exibida apenas para auditoria. Não compõe faturamento válido."
                            : undefined
                        }
                      >
                        {formatFinanceCurrency(
                          canceled ? 0 : n.allocatedValueToOrder
                        )}
                        {canceled ? (
                          <span className="mt-0.5 block text-[9px] font-normal text-rose-700">
                            só auditoria
                          </span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatFinanceCurrency(n.insideOrderItemsValue)}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-red-800">
                        {n.outsideOrderItemsValue > 0.009
                          ? formatFinanceCurrency(n.outsideOrderItemsValue)
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 tabular-nums text-[#6B7280] max-w-[100px] truncate"
                        title={n.linkedStockDocumentExternalIds.join(", ")}
                      >
                        {n.linkedStockDocumentExternalIds.length > 0
                          ? n.linkedStockDocumentExternalIds.slice(0, 3).join(", ") +
                            (n.linkedStockDocumentExternalIds.length > 3
                              ? ` (+${n.linkedStockDocumentExternalIds.length - 3})`
                              : "")
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 tabular-nums text-[#6B7280] max-w-[100px] truncate"
                        title={n.linkedReceivableExternalIds.join(", ")}
                      >
                        {n.linkedReceivableExternalIds.length > 0
                          ? n.linkedReceivableExternalIds.slice(0, 3).join(", ") +
                            (n.linkedReceivableExternalIds.length > 3
                              ? ` (+${n.linkedReceivableExternalIds.length - 3})`
                              : "")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {n.alerts.length === 0 ? (
                            <span className="text-[10px] text-[#6B7280]">—</span>
                          ) : (
                            n.alerts.map((code) => (
                              <span
                                key={code}
                                className={cn(
                                  "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                  code === "NFE_EXTRA_ITEM"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : code === "NFE_HEADER_GREATER_THAN_ORDER" ||
                                        code ===
                                          "NFE_VALUE_GREATER_THAN_ACTIVE_ORDER" ||
                                        code === "NFE_WITHOUT_CR" ||
                                        code === "NFE_WITHOUT_DOCUMENT" ||
                                        code === "NFE_PRICE_MISMATCH"
                                      ? "border-amber-200 bg-amber-50 text-amber-800"
                                      : "border-[#D0D5DD] bg-white text-[#4B5563]"
                                )}
                                title={code}
                              >
                                {code.replace(/^NFE_/, "").replace(/_/g, " ")}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Tabela de itens da NF */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-nfes-section-items"
      >
        <SectionHeader
          title="Itens das NF-e"
          subtitle={
            nfeFilter === "all"
              ? "Todos os itens das NFs. Comparação NF × pedido × documento."
              : `Filtrado por NF ${nfeFilter}. Clique novamente na linha para limpar o filtro.`
          }
        />
        {filteredItems.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Sem itens de NF disponíveis (payload sem itens e sem evidência item × NF).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[2100px] w-full text-left text-[11px]"
              data-testid="order-full-audit-nfes-items-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Item NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Produto / SKU</th>
                  <th className="py-1.5 pr-2 font-semibold">Descrição</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtd NF</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Vlr un. NF</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Vlr total NF</th>
                  <th className="py-1.5 pr-2 font-semibold">Item pedido</th>
                  <th className="py-1.5 pr-2 font-semibold">Doc. saída</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Preço un. pedido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Preço un. doc.</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Δ NF × pedido</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Δ NF × doc.</th>
                  <th className="py-1.5 pr-2 font-semibold">CFOP</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Impostos</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((i) => (
                  <tr
                    key={`${i.nfeExternalId}-${i.nfeItemIndex ?? "?"}-${i.productSku ?? i.productExternalId ?? ""}`}
                    className={cn(
                      "border-b border-[#F3F4F6]",
                      i.alerts.includes("NFE_EXTRA_ITEM") && "bg-red-50/30",
                      i.alerts.includes("NFE_PRICE_MISMATCH") &&
                        !i.alerts.includes("NFE_EXTRA_ITEM") &&
                        "bg-amber-50/30"
                    )}
                  >
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {i.nfeNumber ?? i.nfeExternalId}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.nfeItemIndex ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                      {i.productSku ?? i.productExternalId ?? "—"}
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[200px] truncate"
                      title={i.productName ?? undefined}
                    >
                      {i.productName ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.quantityNfe != null
                        ? formatFinanceInteger(i.quantityNfe)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.unitValueNfe != null
                        ? formatFinanceCurrency(i.unitValueNfe)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.totalValueNfe != null
                        ? formatFinanceCurrency(i.totalValueNfe)
                        : "—"}
                    </td>
                    <td
                      className="py-1.5 pr-2 font-mono text-[10px] text-[#4B5563] max-w-[120px] truncate"
                      title={i.linkedSalesOrderItemId ?? undefined}
                    >
                      {i.linkedSalesOrderItemId
                        ? `#${i.linkedOrderItemSequence ?? "?"} · ${i.linkedSalesOrderItemId.slice(0, 8)}…`
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                      {i.linkedStockDocumentExternalId ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.orderUnitPrice != null
                        ? formatFinanceCurrency(i.orderUnitPrice)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.documentUnitPrice != null
                        ? formatFinanceCurrency(i.documentUnitPrice)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.priceDiffNfeVsOrderAbsolute != null
                        ? formatSignedCurrency(i.priceDiffNfeVsOrderAbsolute)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">
                      {i.priceDiffNfeVsDocumentAbsolute != null
                        ? formatSignedCurrency(i.priceDiffNfeVsDocumentAbsolute)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 tabular-nums text-[10px]">
                      {i.cfop ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[#6B7280]">
                      {i.taxes != null ? formatFinanceCurrency(i.taxes) : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <div className="flex flex-wrap gap-1">
                        {i.alerts.length === 0 ? (
                          <span className="text-[10px] text-[#6B7280]">—</span>
                        ) : (
                          i.alerts.map((code) => (
                            <span
                              key={code}
                              className={cn(
                                "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                code === "NFE_EXTRA_ITEM"
                                  ? "border-red-200 bg-red-50 text-red-800"
                                  : code === "NFE_PRICE_MISMATCH"
                                    ? "border-amber-200 bg-amber-50 text-amber-800"
                                    : "border-[#D0D5DD] bg-white text-[#4B5563]"
                              )}
                              title={code}
                            >
                              {code.replace(/^NFE_/, "").replace(/_/g, " ")}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Divergências oficiais desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-nfes-section-divergences"
      >
        <SectionHeader
          title="Divergências das NF-e"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência de NF."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 20).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-nfes-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Entrega / Frete                                                 */
/* -------------------------------------------------------------------- */

const DELIVERY_ALERT_CODES = new Set([
  "DELIVERY_OVERDUE_WITHOUT_DOCUMENT",
  "ACTIVE_ITEM_OVERDUE_WITHOUT_NFE",
  "PRODUCTION_QUANTITY_LESS_THAN_INVOICED",
  "READY_BALANCE_NOT_INVOICED",
  "CANCELED_ITEM_MARKED_AS_OVERDUE",
  "CUT_ITEM_MARKED_AS_PENDING",
  "FREIGHT_CONDITION_MISMATCH",
  "DELIVERY_DATE_OVERDUE",
]);

function DeliveryTab({
  summary,
  delivery,
  freight,
  items,
  alerts,
}: {
  summary: OrderFullAuditSummary;
  delivery: OrderFullAuditPayload["delivery"];
  freight?: OrderFullAuditFreightBlock;
  items: OrderFullAuditItem[];
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const tabAlerts = alerts.filter((a) => DELIVERY_ALERT_CODES.has(a.code));
  const nowMs = Date.now();

  const isItemOverdue = (item: OrderFullAuditItem): boolean => {
    if (item.nomusIsCanceled || item.nomusIsStale) return false;
    if (item.nomusIsCut) return false;
    if ((item.activePendingQuantity ?? 0) <= 0) return false;
    if (!item.expectedDeliveryDate) return false;
    return new Date(item.expectedDeliveryDate).getTime() < nowMs;
  };

  const itemDelayDays = (item: OrderFullAuditItem): number | null => {
    if (!item.expectedDeliveryDate) return null;
    if (item.nomusIsCanceled || item.nomusIsStale || item.nomusIsCut) return null;
    const expected = new Date(item.expectedDeliveryDate).getTime();
    if (Number.isNaN(expected)) return null;
    return Math.max(0, Math.floor((nowMs - expected) / (1000 * 60 * 60 * 24)));
  };

  const isProducedFully = (item: OrderFullAuditItem): boolean => {
    if (item.quantity == null || item.productionQuantity == null) return false;
    return item.productionQuantity >= item.quantity - 0.0001;
  };

  return (
    <div className="space-y-4" data-testid="order-full-audit-delivery-tab">
      {/* Seção 1 — Entrega consolidada */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-delivery-section-delivery"
      >
        <SectionHeader
          title="Entrega consolidada"
          subtitle="Datas oficiais, lead times e status operacional do pedido."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="Data entrega padrão"
            value={
              delivery.expectedDeliveryDate
                ? formatFinanceDate(delivery.expectedDeliveryDate)
                : "—"
            }
            tone="highlight"
          />
          <Kpi
            label="Data emissão pedido"
            value={
              delivery.orderIssueDate
                ? formatFinanceDate(delivery.orderIssueDate)
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
            value={
              delivery.lastNfeDate
                ? formatFinanceDate(delivery.lastNfeDate)
                : "—"
            }
          />
          <Kpi
            label="Última baixa"
            value={
              delivery.lastReceivableSettlement
                ? formatFinanceDate(delivery.lastReceivableSettlement)
                : "—"
            }
          />
          <Kpi
            label="Lead time prometido"
            value={
              delivery.leadTimePromisedDays != null
                ? `${delivery.leadTimePromisedDays} dias`
                : "—"
            }
          />
          <Kpi
            label="Lead time real"
            value={
              delivery.leadTimeRealDays != null
                ? `${delivery.leadTimeRealDays} dias`
                : "—"
            }
          />
          <Kpi
            label="Atraso"
            value={
              delivery.delayDays != null
                ? `${delivery.delayDays} dias`
                : "—"
            }
            tone={
              delivery.delayDays != null && delivery.delayDays > 0
                ? "danger"
                : delivery.delayDays != null && delivery.delayDays < 0
                  ? "success"
                  : "muted"
            }
          />
          <Kpi
            label="Previsão futura"
            value={
              delivery.forecastNextDeliveryDate
                ? formatFinanceDate(delivery.forecastNextDeliveryDate)
                : "—"
            }
          />
          <Kpi
            label="Status operacional"
            value={formatOrderToCashOperationalStage(
              delivery.operationalStatus ?? summary.operationalStatus
            )}
          />
        </div>
      </section>

      {/* Seção 2 — Produção / atendimento */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-delivery-section-production"
      >
        <SectionHeader
          title="Produção e atendimento"
          subtitle="Quantidades consolidadas (item cancelado / cut nunca conta como pendente)."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi label="Itens totais" value={String(delivery.itemCounts.total)} />
          <Kpi
            label="Itens ativos"
            value={String(delivery.itemCounts.active)}
            tone="info"
          />
          <Kpi
            label="Atendidos"
            value={String(delivery.itemCounts.fulfilled)}
            tone={delivery.itemCounts.fulfilled > 0 ? "success" : "muted"}
          />
          <Kpi
            label="Pendentes ativos"
            value={String(delivery.itemCounts.pendingActive)}
            tone={
              delivery.itemCounts.pendingActive > 0 ? "warning" : "success"
            }
          />
          <Kpi
            label="Vencidos"
            value={String(delivery.itemCounts.overdue)}
            tone={delivery.itemCounts.overdue > 0 ? "danger" : "muted"}
          />
          <Kpi
            label="Cancelados"
            value={String(delivery.itemCounts.canceled)}
            tone="muted"
          />
          <Kpi
            label="Com corte"
            value={String(delivery.itemCounts.cut)}
            tone="muted"
          />
          <Kpi
            label="Pronto não faturado"
            value={String(delivery.itemCounts.readyNotInvoiced)}
            tone={
              delivery.itemCounts.readyNotInvoiced > 0 ? "warning" : "muted"
            }
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Kpi
            label="Qtd pedida"
            value={formatFinanceInteger(delivery.totals.quantityOrdered)}
          />
          <Kpi
            label="Qtd produzida"
            value={formatFinanceInteger(delivery.totals.quantityProduced)}
          />
          <Kpi
            label="Qtd faturada"
            value={formatFinanceInteger(delivery.totals.quantityInvoiced)}
          />
          <Kpi
            label="Saldo a faturar"
            value={formatFinanceInteger(delivery.totals.saldoAFaturar)}
          />
          <Kpi
            label="Saldo pronto"
            value={formatFinanceInteger(delivery.totals.saldoPronto)}
          />
        </div>
      </section>

      {/* Seção 3 — Frete */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-delivery-section-freight"
      >
        <SectionHeader
          title="Frete e transporte"
          subtitle="Modalidade, transportadora, condição e responsável pelo frete."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi
            label="Modalidade de transporte"
            value={freight?.transportMode ?? "—"}
          />
          <Kpi
            label="Condição de frete"
            value={freight?.freightCondition ?? delivery.freightCondition ?? "—"}
          />
          <Kpi
            label="Responsável pelo frete"
            value={freight?.responsibleForFreight ?? "—"}
          />
          <Kpi
            label="Valor frete"
            value={
              freight?.freightAmount != null
                ? formatFinanceCurrency(freight.freightAmount)
                : "—"
            }
          />
          <Kpi label="Transportadora" value={freight?.carrierName ?? "—"} />
          <Kpi
            label="ID transportadora"
            value={
              freight?.carrierExternalId != null
                ? String(freight.carrierExternalId)
                : "—"
            }
          />
          <Kpi
            label="Local de entrega"
            value={freight?.deliveryLocation ?? "—"}
          />
          <Kpi
            label="Condição de pagamento"
            value={delivery.paymentTerms ?? "—"}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Endereço entrega
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#111827]">
              {freight?.deliveryAddress?.trim() || "—"}
            </p>
          </div>
          <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Observações entrega
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#111827]">
              {freight?.deliveryNotes?.trim() || "—"}
            </p>
          </div>
          <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Observações internas
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#111827]">
              {freight?.internalNotes?.trim() || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Seção 4 — Tabela por item */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-delivery-section-items"
      >
        <SectionHeader
          title="Situação por item"
          subtitle="Datas de entrega, produção, faturamento e alertas por linha."
        />
        {items.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Sem itens no pedido.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[1800px] w-full text-left text-[11px]"
              data-testid="order-full-audit-delivery-items-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Item</th>
                  <th className="py-1.5 pr-2 font-semibold">Produto</th>
                  <th className="py-1.5 pr-2 font-semibold">Data entrega prevista</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtde pedida</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtde produzida</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Qtde faturada</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Saldo a faturar</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Saldo pronto</th>
                  <th className="py-1.5 pr-2 font-semibold">Atendido produção?</th>
                  <th className="py-1.5 pr-2 font-semibold">Documento saída</th>
                  <th className="py-1.5 pr-2 font-semibold">NF</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Atraso (dias)</th>
                  <th className="py-1.5 pr-2 font-semibold">Alertas</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const overdue = isItemOverdue(it);
                  const delayDays = itemDelayDays(it);
                  const producedFull = isProducedFully(it);
                  const readyNotInvoiced =
                    it.saldoPronto != null &&
                    it.saldoPronto > 0.0001 &&
                    it.invoicedQuantity != null &&
                    it.quantity != null &&
                    it.invoicedQuantity < it.quantity - 0.0001 &&
                    !it.nomusIsCanceled &&
                    !it.nomusIsStale;
                  const deliveryAlerts = it.alerts.filter((c) =>
                    DELIVERY_ALERT_CODES.has(c)
                  );
                  const showAlerts: string[] = [];
                  for (const c of deliveryAlerts) showAlerts.push(c);
                  if (overdue && it.linkedStockDocumentExternalIds.length === 0) {
                    showAlerts.push("DELIVERY_OVERDUE_WITHOUT_DOCUMENT");
                  }
                  if (overdue && it.linkedNfeExternalIds.length === 0) {
                    showAlerts.push("ACTIVE_ITEM_OVERDUE_WITHOUT_NFE");
                  }
                  if (readyNotInvoiced) {
                    showAlerts.push("READY_BALANCE_NOT_INVOICED");
                  }
                  if (
                    it.productionQuantity != null &&
                    it.invoicedQuantity != null &&
                    it.invoicedQuantity - it.productionQuantity > 0.0001
                  ) {
                    showAlerts.push("PRODUCTION_QUANTITY_LESS_THAN_INVOICED");
                  }
                  const uniqueAlerts = [...new Set(showAlerts)];
                  return (
                    <tr
                      key={it.salesOrderItemId}
                      className={cn(
                        "border-b border-[#F3F4F6]",
                        it.nomusIsCanceled && "bg-red-50/25",
                        it.nomusIsStale && !it.nomusIsCanceled && "bg-[#F3F4F6]/50",
                        overdue && "bg-red-50/40",
                        readyNotInvoiced &&
                          !overdue &&
                          !it.nomusIsCanceled &&
                          "bg-amber-50/30"
                      )}
                      data-testid={`order-full-audit-delivery-row-${it.salesOrderItemId}`}
                    >
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {it.itemSequence ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                        <div className="flex flex-col">
                          <span>{it.productCode ?? "—"}</span>
                          <span
                            className="text-[10px] text-[#6B7280] max-w-[240px] truncate"
                            title={it.productName ?? undefined}
                          >
                            {it.productName ?? ""}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {it.expectedDeliveryDate
                          ? formatFinanceDate(it.expectedDeliveryDate)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            it.nomusIsCanceled
                              ? "border-red-200 bg-red-50 text-red-800"
                              : it.nomusIsCut
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : it.nomusIsStale
                                  ? "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]"
                                  : overdue
                                    ? "border-red-300 bg-red-100 text-red-900"
                                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                          )}
                        >
                          {formatOrderItemStatus(
                            it.itemStatus ?? it.nomusItemStatusNormalized
                          )}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {it.quantity != null
                          ? formatFinanceInteger(it.quantity)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {it.productionQuantity != null
                          ? formatFinanceInteger(it.productionQuantity)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {it.invoicedQuantity != null
                          ? formatFinanceInteger(it.invoicedQuantity)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {it.saldoAFaturar != null
                          ? formatFinanceInteger(it.saldoAFaturar)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-amber-800">
                        {it.saldoPronto != null
                          ? formatFinanceInteger(it.saldoPronto)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        {it.nomusIsCanceled || it.nomusIsStale
                          ? "—"
                          : producedFull
                            ? "Sim"
                            : it.productionQuantity != null &&
                                it.productionQuantity > 0
                              ? "Parcial"
                              : "Não"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[120px] truncate text-[10px]"
                        title={it.linkedStockDocumentExternalIds.join(", ")}
                      >
                        {it.linkedStockDocumentExternalIds.length > 0
                          ? it.linkedStockDocumentExternalIds.slice(0, 3).join(", ") +
                            (it.linkedStockDocumentExternalIds.length > 3
                              ? ` (+${it.linkedStockDocumentExternalIds.length - 3})`
                              : "")
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[120px] truncate text-[10px]"
                        title={it.linkedNfeExternalIds.join(", ")}
                      >
                        {it.linkedNfeExternalIds.length > 0
                          ? it.linkedNfeExternalIds.slice(0, 3).join(", ") +
                            (it.linkedNfeExternalIds.length > 3
                              ? ` (+${it.linkedNfeExternalIds.length - 3})`
                              : "")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {delayDays != null && delayDays > 0
                          ? String(delayDays)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <div className="flex flex-wrap gap-1">
                          {uniqueAlerts.length === 0 ? (
                            <span className="text-[10px] text-[#6B7280]">—</span>
                          ) : (
                            uniqueAlerts.map((code) => (
                              <span
                                key={code}
                                className={cn(
                                  "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                  code === "DELIVERY_OVERDUE_WITHOUT_DOCUMENT" ||
                                    code === "ACTIVE_ITEM_OVERDUE_WITHOUT_NFE" ||
                                    code === "CANCELED_ITEM_MARKED_AS_OVERDUE" ||
                                    code === "PRODUCTION_QUANTITY_LESS_THAN_INVOICED"
                                    ? "border-red-200 bg-red-50 text-red-800"
                                    : "border-amber-200 bg-amber-50 text-amber-800"
                                )}
                                title={code}
                              >
                                {code
                                  .replace(/^DELIVERY_|^ACTIVE_ITEM_|^READY_|^PRODUCTION_|^CANCELED_ITEM_|^CUT_ITEM_/, "")
                                  .replace(/_/g, " ")}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Divergências oficiais desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-delivery-section-divergences"
      >
        <SectionHeader
          title="Divergências de entrega e produção"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência operacional."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 20).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-delivery-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6B7280]">
                  Ação: {a.action}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Proposta / Origem Comercial (placeholder)                       */
/* -------------------------------------------------------------------- */

const PROPOSAL_ALERT_LABELS: Record<string, { title: string; tone: KpiTone }> = {
  PROPOSAL_NOT_FOUND: {
    title: "Proposta não encontrada",
    tone: "warning",
  },
  PROPOSAL_ORDER_VALUE_MISMATCH: {
    title: "Valor Proposta × Pedido divergente",
    tone: "warning",
  },
  PROPOSAL_ITEM_NOT_CONVERTED: {
    title: "Item da proposta sem conversão",
    tone: "info",
  },
  ORDER_ITEM_WITHOUT_PROPOSAL_ITEM: {
    title: "Item do pedido sem item de proposta",
    tone: "info",
  },
  PROPOSAL_PRICE_MISMATCH: {
    title: "Preço unitário divergente",
    tone: "warning",
  },
  PROPOSAL_QUANTITY_MISMATCH: {
    title: "Quantidade divergente",
    tone: "info",
  },
  PROPOSAL_PAYMENT_TERM_MISMATCH: {
    title: "Condição de pagamento divergente",
    tone: "info",
  },
  PROPOSAL_FREIGHT_MISMATCH: {
    title: "Frete divergente",
    tone: "info",
  },
};

function ProposalTab({
  proposal,
  comparisons,
  alerts,
}: {
  proposal: OrderFullAuditProposalBlock;
  comparisons: OrderFullAuditProposalOrderComparison | null;
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  if (!proposal.present) {
    const emptyMessage =
      proposal.emptyReason === "PROPOSAL_NOT_FOUND"
        ? "Pedido referencia uma proposta que não foi encontrada no IndusCost."
        : proposal.emptyReason === "PROPOSAL_LOAD_ERROR"
          ? "Não foi possível carregar a proposta vinculada."
          : "Este pedido não possui proposta vinculada no IndusCost.";
    return (
      <div
        className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-6 text-sm text-[#6B7280]"
        data-testid="order-full-audit-proposal-tab"
      >
        <p
          className="text-[13px] font-semibold text-[#111827]"
          data-testid="order-full-audit-proposal-empty-state"
        >
          {emptyMessage}
        </p>
        <p className="mt-1 text-[11px]">
          A aba <strong>Proposta / Origem Comercial</strong> só é populada quando o
          Pedido de Venda foi criado a partir de uma proposta comercial oficial.
        </p>
      </div>
    );
  }

  const proposalAlerts = alerts.filter((a) =>
    Object.keys(PROPOSAL_ALERT_LABELS).includes(a.code)
  );

  return (
    <div
      className="space-y-4"
      data-testid="order-full-audit-proposal-tab"
      data-proposal-present="true"
    >
      {/* Aviso oficial: Proposta ≠ fonte de faturamento */}
      <div
        className="rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900"
        data-testid="order-full-audit-proposal-disclaimer"
      >
        <strong>Proposta é origem comercial e auditável.</strong>{" "}
        Não substitui o Pedido de Venda como fonte oficial de faturamento,
        financeiro ou comissão.
      </div>

      {/* Seção 1 — Identificação e status */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-proposal-section-identification"
      >
        <SectionHeader
          title="Identificação"
          subtitle="Origem comercial da negociação (auditável, não altera financeiro)."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi
            label="Nº proposta"
            value={proposal.proposalNumber ?? "—"}
            help={proposal.externalProposalCode ?? undefined}
          />
          <Kpi label="ID interno" value={proposal.proposalId ?? "—"} />
          <Kpi label="Título" value={proposal.title ?? "—"} />
          <Kpi label="Empresa" value={proposal.companyIssuer ?? "—"} />
          <Kpi
            label="Responsável comercial"
            value={proposal.responsible ?? "—"}
          />
          <Kpi
            label="Vendedor externo"
            value={
              proposal.externalSellerId != null
                ? String(proposal.externalSellerId)
                : "—"
            }
          />
          <Kpi label="Status" value={proposal.status ?? "—"} />
          <Kpi
            label="Data da proposta"
            value={
              proposal.createdAt ? formatFinanceDate(proposal.createdAt) : "—"
            }
          />
          <Kpi
            label="Data de aprovação"
            value={
              proposal.approvedAt ? formatFinanceDate(proposal.approvedAt) : "—"
            }
            tone={proposal.approvedAt ? "success" : "muted"}
          />
          <Kpi
            label="Validade"
            value={
              proposal.validUntil
                ? formatFinanceDate(proposal.validUntil)
                : proposal.validityDays != null
                  ? `${proposal.validityDays} dias`
                  : "—"
            }
          />
        </div>
      </section>

      {/* Seção 2 — Condições comerciais */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-proposal-section-conditions"
      >
        <SectionHeader
          title="Condições comerciais"
          subtitle="Comparadas contra o Pedido de Venda (fonte oficial)."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <ComparisonKpi
            label="Condição de pagamento"
            proposalValue={proposal.paymentTerms}
            orderValue={comparisons?.paymentTerms.salesOrder ?? null}
            matches={comparisons?.paymentTerms.matches ?? true}
          />
          <ComparisonKpi
            label="Forma de pagamento"
            proposalValue={proposal.paymentMethod}
            orderValue={comparisons?.paymentMethod.salesOrder ?? null}
            matches={comparisons?.paymentMethod.matches ?? true}
          />
          <ComparisonKpi
            label="Frete"
            proposalValue={proposal.freightCondition}
            orderValue={comparisons?.freightCondition.salesOrder ?? null}
            matches={comparisons?.freightCondition.matches ?? true}
          />
        </div>
      </section>

      {/* Seção 3 — Valores oficiais */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-proposal-section-values"
      >
        <SectionHeader
          title="Valores oficiais"
          subtitle="Total proposto × aprovado × convertido em pedido."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="Valor total proposto"
            value={formatMoneyOrDash(proposal.derivedValues.proposalTotalValue)}
            tone="highlight"
          />
          <Kpi
            label="Valor aprovado"
            value={formatMoneyOrDash(proposal.derivedValues.approvedTotalValue)}
            tone={
              proposal.derivedValues.approvedTotalValue != null
                ? "success"
                : "muted"
            }
          />
          <Kpi
            label="Convertido em pedido"
            value={formatMoneyOrDash(
              proposal.derivedValues.convertedToOrderValue
            )}
          />
          <Kpi
            label="Diferença Proposta × Pedido"
            value={formatMoneyOrDash(
              comparisons?.totalNetValue.diff ??
                proposal.derivedValues.proposalVsOrderDiff
            )}
            tone={
              comparisons?.totalNetValue.matches === false
                ? "warning"
                : "success"
            }
            help={
              comparisons?.totalNetValue.matches === false
                ? "Renegociação após proposta"
                : "Alinhado"
            }
          />
          <Kpi
            label="Custo total"
            value={formatMoneyOrDash(proposal.totals.totalCost)}
          />
          <Kpi
            label="Margem R$"
            value={formatMoneyOrDash(proposal.totals.totalMarginValue)}
          />
          <Kpi
            label="Margem %"
            value={
              proposal.totals.totalMarginPerc != null
                ? formatFinancePercent(proposal.totals.totalMarginPerc)
                : "—"
            }
          />
          <Kpi
            label="Desconto"
            value={formatMoneyOrDash(proposal.totals.totalDiscount)}
          />
          <Kpi
            label="Comissão prevista"
            value={formatMoneyOrDash(proposal.totals.totalCommission)}
          />
          <Kpi
            label="Frete"
            value={formatMoneyOrDash(proposal.totals.totalFreight)}
          />
        </div>
      </section>

      {/* Seção 4 — Itens da proposta */}
      <ProposalItemsSection proposal={proposal} />

      {/* Seção 5 — Divergências */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-proposal-section-divergences"
      >
        <SectionHeader
          title="Divergências relacionadas"
          subtitle={
            proposalAlerts.length === 0
              ? "Nenhuma divergência entre proposta e pedido."
              : `${proposalAlerts.length} divergência(s) identificada(s).`
          }
        />
        {proposalAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência entre proposta e pedido.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {proposalAlerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-proposal-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ProposalItemsSection({
  proposal,
}: {
  proposal: OrderFullAuditProposalBlock;
}): JSX.Element {
  if (proposal.items.length === 0) {
    return (
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-proposal-section-items"
      >
        <SectionHeader title="Itens da proposta" />
        <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
          Proposta sem itens cadastrados.
        </p>
      </section>
    );
  }
  return (
    <section
      className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
      data-testid="order-full-audit-proposal-section-items"
    >
      <SectionHeader
        title="Itens da proposta"
        subtitle="Comparados linha a linha com o Pedido de Venda."
      />
      <div className="overflow-x-auto">
        <table
          className="min-w-[1400px] w-full text-left text-[12px]"
          data-testid="order-full-audit-proposal-items-table"
        >
          <thead className="text-[10px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
            <tr>
              <th className="py-1.5 pr-2 font-semibold">SKU</th>
              <th className="py-1.5 pr-2 font-semibold">Descrição</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Qtd</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Preço un.</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Desconto</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Total</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Custo</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Margem R$</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Margem %</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Comissão</th>
              <th className="py-1.5 pr-2 font-semibold">Virou pedido?</th>
              <th className="py-1.5 pr-2 font-semibold">Item pedido</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Δ Qtd</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Δ Preço</th>
              <th className="py-1.5 pr-2 font-semibold text-right">Δ Total</th>
              <th className="py-1.5 pr-2 font-semibold">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {proposal.items.map((pi) => {
              const c = pi.convertedToSalesOrderItem;
              const converted = c != null;
              return (
                <tr
                  key={pi.proposalItemId}
                  className={cn(
                    "border-b border-[#F3F4F6]",
                    !converted && "bg-amber-50/40"
                  )}
                >
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                    {pi.productSku ?? "—"}
                  </td>
                  <td
                    className="py-1.5 pr-2 max-w-[220px] truncate"
                    title={pi.productName ?? undefined}
                  >
                    {pi.productName ?? "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {pi.quantity != null
                      ? formatFinanceInteger(pi.quantity)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {pi.negotiatedPrice != null
                      ? formatFinanceCurrency(pi.negotiatedPrice)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {pi.discountValue != null && pi.discountValue > 0.009
                      ? formatFinanceCurrency(pi.discountValue)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                    {formatMoneyOrDash(pi.totalNetValue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-[#6B7280]">
                    {formatMoneyOrDash(pi.unitCost)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatMoneyOrDash(pi.marginValue)}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {pi.marginPerc != null
                      ? formatFinancePercent(pi.marginPerc)
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatMoneyOrDash(pi.commissionValue)}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                        converted
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-800"
                      )}
                    >
                      {converted ? "Sim" : "Não"}
                    </span>
                  </td>
                  <td
                    className="py-1.5 pr-2 font-mono text-[10px] text-[#4B5563] max-w-[140px] truncate"
                    title={c?.salesOrderItemId}
                  >
                    {c?.salesOrderItemId
                      ? c.salesOrderItemId.slice(0, 8) + "…"
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {c ? formatSignedInteger(c.quantityDiff) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {c ? formatSignedCurrency(c.negotiatedPriceDiff) : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {c ? formatSignedCurrency(c.totalNetValueDiff) : "—"}
                  </td>
                  <td className="py-1.5 pr-2">
                    <div className="flex flex-wrap gap-1">
                      {pi.alerts.map((code) => (
                        <span
                          key={code}
                          className={cn(
                            "rounded border px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                            (PROPOSAL_ALERT_LABELS[code]?.tone ?? "warning") ===
                              "warning"
                              ? "border-amber-300 bg-amber-50 text-amber-800"
                              : "border-[#D0D5DD] bg-white text-[#4B5563]"
                          )}
                          title={PROPOSAL_ALERT_LABELS[code]?.title ?? code}
                        >
                          {code.replace(/^PROPOSAL_/, "")}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComparisonKpi({
  label,
  proposalValue,
  orderValue,
  matches,
}: {
  label: string;
  proposalValue: string | null;
  orderValue: string | null;
  matches: boolean;
}): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-[10px] border px-3 py-2 transition-colors",
        matches
          ? "border-[#E5E7EB] bg-white"
          : "border-amber-200 bg-amber-50"
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
        {label}
      </p>
      <div className="mt-0.5 grid grid-cols-2 gap-1 text-[11px]">
        <span className="truncate" title={proposalValue ?? undefined}>
          <span className="text-[9px] font-semibold uppercase text-[#6B7280]">
            Proposta
          </span>
          <br />
          <strong className="text-[#111827]">{proposalValue ?? "—"}</strong>
        </span>
        <span className="truncate" title={orderValue ?? undefined}>
          <span className="text-[9px] font-semibold uppercase text-[#6B7280]">
            Pedido
          </span>
          <br />
          <strong className="text-[#111827]">{orderValue ?? "—"}</strong>
        </span>
      </div>
      {!matches ? (
        <p className="mt-1 text-[10px] font-semibold text-amber-800">
          ⚠ Divergente
        </p>
      ) : null}
    </div>
  );
}

function formatMoneyOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return formatFinanceCurrency(value);
}
function formatSignedCurrency(value: number): string {
  if (Math.abs(value) < 0.01) return formatFinanceCurrency(0);
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatFinanceCurrency(Math.abs(value))}`;
}
function formatSignedInteger(value: number): string {
  if (Math.abs(value) < 0.5) return "0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}${formatFinanceInteger(Math.abs(value))}`;
}

/* -------------------------------------------------------------------- */
/*  Tab: Pedido de Venda (placeholder)                                   */
/* -------------------------------------------------------------------- */

const SALES_ORDER_ALERT_CODES = new Set([
  "SELLER_NOT_INFORMED",
  "SELLER_ALIAS_NOT_MAPPED",
  "SELLER_MISSING_IN_SALES_ORDER_BUT_PRESENT_IN_SNAPSHOT",
  "SELLER_SOURCE_MISMATCH",
  "SELLER_SOURCE_FROM_COMMISSION_SNAPSHOT",
  "COMMERCIAL_RESPONSIBLE_MISSING",
  "PAYMENT_TERM_MISSING",
  "DELIVERY_DATE_OVERDUE",
  "ORDER_STATUS_UNKNOWN",
  "ORDER_WITHOUT_ITEMS",
  "ORDER_HEADER_ITEMS_TOTAL_MISMATCH",
  "OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE",
]);

function SalesOrderTab({
  salesOrder,
  summary,
  alerts,
}: {
  salesOrder: OrderFullAuditSalesOrderBlock;
  summary: OrderFullAuditSummary;
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const commercialName =
    salesOrder.commercialResponsible?.displayName?.trim() ||
    salesOrder.commercialResponsibleName?.trim() ||
    "";
  const sellerName =
    salesOrder.orderSeller?.displayName?.trim() ||
    salesOrder.orderSellerName?.trim() ||
    "";
  const sellerExternalId =
    salesOrder.orderSellerExternalId ??
    (salesOrder.orderSeller?.rawExternalId != null
      ? Number(salesOrder.orderSeller.rawExternalId)
      : null);
  const operationalName = salesOrder.operationalResponsibleName?.trim() ?? "";
  const sectorName = salesOrder.operationalSector?.trim() ?? "";
  const tabAlerts = alerts.filter((a) => SALES_ORDER_ALERT_CODES.has(a.code));

  const c = salesOrder.itemCounts;

  return (
    <div className="space-y-4" data-testid="order-full-audit-sales-order-tab">
      {/* Cards no topo — resumo dos itens do pedido */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-cards"
      >
        <SectionHeader
          title="Resumo do pedido"
          subtitle="Contagens oficiais dos itens — não misturam ativo com cancelado."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi
            label="Valor pedido"
            value={formatMoneyOrDash(
              salesOrder.totals.netValue ?? summary.originalOrderValue
            )}
            tone="highlight"
          />
          <Kpi label="Itens totais" value={String(c.total)} />
          <Kpi
            label="Itens ativos"
            value={String(c.active)}
            tone={c.active > 0 ? "info" : "muted"}
          />
          <Kpi
            label="Cancelados"
            value={String(c.canceled)}
            tone={c.canceled > 0 ? "warning" : "muted"}
          />
          <Kpi
            label="Com corte"
            value={String(c.cut)}
            tone={c.cut > 0 ? "warning" : "muted"}
          />
          <Kpi label="Atendidos" value={String(c.fulfilled)} />
          <Kpi
            label="Pendentes ativos"
            value={String(c.pendingActive)}
            tone={c.pendingActive > 0 ? "warning" : "success"}
          />
          <Kpi
            label="% atendimento ativo"
            value={formatFinancePercent(c.fulfillmentPercentActive)}
            tone={
              c.fulfillmentPercentActive >= 99.99
                ? "success"
                : c.fulfillmentPercentActive > 0
                  ? "info"
                  : "muted"
            }
          />
        </div>
      </section>

      {/* Seção 1 — Identificação */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-identification"
      >
        <SectionHeader
          title="Identificação"
          subtitle="Cabeçalho oficial do Pedido de Venda."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi label="Pedido" value={salesOrder.orderCode ?? "—"} />
          <Kpi
            label="ID externo Nomus"
            value={
              salesOrder.identifiers.externalSalesOrderId != null
                ? String(salesOrder.identifiers.externalSalesOrderId)
                : "—"
            }
          />
          <Kpi
            label="Código externo Nomus"
            value={salesOrder.identifiers.externalSalesOrderCode ?? "—"}
          />
          <Kpi
            label="Cliente"
            value={salesOrder.customer.name ?? "—"}
            help={salesOrder.customer.document ?? undefined}
          />
          <Kpi
            label="ID externo cliente"
            value={
              salesOrder.identifiers.externalCustomerId != null
                ? String(salesOrder.identifiers.externalCustomerId)
                : "—"
            }
          />
          <Kpi
            label="Empresa emissora"
            value={salesOrder.companyName ?? "—"}
          />
          <Kpi
            label="ID empresa emissora"
            value={
              salesOrder.identifiers.externalCompanyId != null
                ? String(salesOrder.identifiers.externalCompanyId)
                : "—"
            }
          />
          <Kpi
            label="Data de emissão"
            value={
              salesOrder.issueDate
                ? formatFinanceDate(salesOrder.issueDate)
                : "—"
            }
          />
          <Kpi
            label="Data de entrega padrão"
            value={
              salesOrder.expectedDeliveryDate
                ? formatFinanceDate(salesOrder.expectedDeliveryDate)
                : "—"
            }
          />
          <Kpi
            label="Status do pedido"
            value={salesOrder.status ?? summary.consolidatedStatus ?? "—"}
            tone={
              !salesOrder.status || salesOrder.status.toUpperCase() === "UNKNOWN"
                ? "warning"
                : "neutral"
            }
          />
          <Kpi label="Tipo de pedido" value={salesOrder.orderType ?? "—"} />
          <Kpi
            label="Tipo de movimentação"
            value={salesOrder.movementType ?? "—"}
          />
          <Kpi
            label="Sistema origem"
            value={salesOrder.sourceSystem ?? "—"}
          />
        </div>
      </section>

      {/* Seção 2 — Comercial */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-commercial"
      >
        <SectionHeader
          title="Comercial"
          subtitle="Responsável Comercial (CRM) × Vendedor Pedido (Nomus). Nunca são o mesmo campo."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi
            label="Responsável Comercial (CRM)"
            value={
              commercialName ||
              (isOperationalSectorNameClient(operationalName)
                ? "Sem responsável comercial"
                : "Sem responsável comercial")
            }
            tone={commercialName ? "neutral" : "warning"}
            help="Vem do cadastro/carteira do cliente no CRM. Nunca é setor."
          />
          <Kpi
            label="Vendedor Pedido (Nomus)"
            value={sellerName || "Sem vendedor informado"}
            tone={
              sellerName && sellerName !== "Vendedor não mapeado"
                ? "neutral"
                : "warning"
            }
            help={
              sellerExternalId != null
                ? `Nomus externalSellerId=${sellerExternalId}`
                : "Deve vir do Pedido de Venda no Nomus."
            }
          />
          <Kpi
            label="ID externo vendedor"
            value={sellerExternalId != null ? String(sellerExternalId) : "—"}
          />
          <Kpi label="Setor / Responsável operacional" value={sectorName || "—"} />
        </div>
        {isOperationalSectorNameClient(operationalName) && !commercialName ? (
          <p
            className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
            data-testid="order-full-audit-sales-order-operational-as-commercial-warning"
          >
            ⚠ <strong>{operationalName}</strong> é setor operacional e{" "}
            <em>não</em> pode ser exibido como Responsável Comercial.
            Configure o responsável do cliente no CRM.
          </p>
        ) : null}
      </section>

      {/* Seção 3 — Operacional */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-operational"
      >
        <SectionHeader
          title="Operacional"
          subtitle="Setor de saída, frete e entrega. Sem interferência no comercial."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi label="Setor de saída" value={sectorName || "—"} />
          <Kpi label="Modalidade de transporte" value={salesOrder.freightMode ?? "—"} />
          <Kpi label="Condição de frete" value={salesOrder.freightCondition ?? "—"} />
          <Kpi label="Local de entrega" value={salesOrder.deliveryLocation ?? "—"} />
          <Kpi
            label="Envio p/ Nomus"
            value={
              salesOrder.sentToNomusAt
                ? formatFinanceDate(salesOrder.sentToNomusAt)
                : "—"
            }
          />
          <Kpi
            label="Última sincronização"
            value={
              salesOrder.lastSyncedAt
                ? formatFinanceDate(salesOrder.lastSyncedAt)
                : "—"
            }
          />
          <Kpi
            label="Criado no IndusCost"
            value={
              salesOrder.createdAt
                ? formatFinanceDate(salesOrder.createdAt)
                : "—"
            }
          />
          <Kpi
            label="Modificado no IndusCost"
            value={
              salesOrder.updatedAt
                ? formatFinanceDate(salesOrder.updatedAt)
                : "—"
            }
          />
        </div>
      </section>

      {/* Seção 4 — Financeiro do Pedido */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-financial"
      >
        <SectionHeader
          title="Financeiro do pedido"
          subtitle="Totais do cabeçalho — o valor oficial de faturamento continua vindo do CR/NF-e."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          <Kpi
            label="Condição de pagamento"
            value={salesOrder.paymentTerms ?? "—"}
            tone={
              !salesOrder.paymentTerms && !salesOrder.paymentMethod
                ? "warning"
                : "neutral"
            }
            help={salesOrder.paymentTermsText ?? undefined}
          />
          <Kpi
            label="Texto condição"
            value={salesOrder.paymentTermsText ?? "—"}
          />
          <Kpi
            label="Forma de pagamento"
            value={salesOrder.paymentMethod ?? "—"}
          />
          <Kpi
            label="Valor bruto"
            value={formatMoneyOrDash(salesOrder.totals.grossValue)}
          />
          <Kpi
            label="Valor líquido"
            value={formatMoneyOrDash(salesOrder.totals.netValue)}
            tone="highlight"
          />
          <Kpi
            label="Desconto"
            value={formatMoneyOrDash(salesOrder.totals.discount)}
          />
          <Kpi
            label="Frete"
            value={formatMoneyOrDash(salesOrder.totals.freight)}
          />
          <Kpi
            label="Seguro"
            value={formatMoneyOrDash(salesOrder.totals.insurance)}
          />
          <Kpi
            label="Outras despesas"
            value={formatMoneyOrDash(salesOrder.totals.otherExpenses)}
          />
          <Kpi
            label="Impostos"
            value={formatMoneyOrDash(salesOrder.totals.taxes)}
          />
          <Kpi
            label="Soma dos itens"
            value={formatMoneyOrDash(salesOrder.totals.itemsSummedNetValue)}
            tone={
              salesOrder.totals.headerVsItemsDiff != null &&
              Math.abs(salesOrder.totals.headerVsItemsDiff) > 0.01
                ? "warning"
                : "neutral"
            }
          />
          <Kpi
            label="Δ cabeçalho × itens"
            value={
              salesOrder.totals.headerVsItemsDiff != null
                ? formatSignedCurrency(salesOrder.totals.headerVsItemsDiff)
                : "—"
            }
            tone={
              salesOrder.totals.headerVsItemsDiff != null &&
              Math.abs(salesOrder.totals.headerVsItemsDiff) > 0.01
                ? "warning"
                : "success"
            }
          />
        </div>
      </section>

      {/* Seção 5 — Observações */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-notes"
      >
        <SectionHeader
          title="Observações"
          subtitle="Notas do pedido (externas × internas)."
        />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Observações
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#111827]">
              {salesOrder.notes?.trim() || "—"}
            </p>
          </div>
          <div className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Observações internas
            </p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12px] text-[#111827]">
              {salesOrder.internalNotes?.trim() || "—"}
            </p>
          </div>
        </div>
      </section>

      {/* Divergências desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-sales-order-section-divergences"
      >
        <SectionHeader
          title="Divergências do Pedido de Venda"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência no cabeçalho do pedido."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-sales-order-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                <p className="mt-0.5 text-[10px] text-[#6B7280]">
                  Ação: {a.action}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-[#6B7280]">
        Cabeçalho oficial do pedido. Itens detalhados na aba{" "}
        <strong>Itens do Pedido</strong>. Diferenças com a proposta na aba{" "}
        <strong>Proposta / Origem Comercial</strong>.
      </p>
    </div>
  );
}

/**
 * Palavras que sinalizam nome de setor (mirror simples do backend).
 * Usadas apenas para renderizar o warning inline; a divergência oficial é
 * emitida em `alerts` via `OPERATIONAL_RESPONSIBLE_USED_AS_COMMERCIAL_RESPONSIBLE`.
 */
function isOperationalSectorNameClient(value: string | null | undefined): boolean {
  if (!value) return false;
  const upper = value.trim().toUpperCase();
  return [
    "FATURAMENTO",
    "FINANCEIRO",
    "EXPEDICAO",
    "EXPEDIÇÃO",
    "PRODUCAO",
    "PRODUÇÃO",
    "COMPRAS",
    "PCP",
    "ALMOXARIFADO",
    "LOGISTICA",
    "LOGÍSTICA",
  ].some((k) => upper === k || upper.startsWith(k));
}

/* -------------------------------------------------------------------- */
/*  Tab: Margem, Preço e Custo (placeholder)                             */
/* -------------------------------------------------------------------- */

const MARGIN_ALERT_CODES = new Set([
  "NO_MARGIN",
  "PRICE_TABLE_NOT_FOUND",
  "COST_NOT_FOUND",
  "ORDER_PRICE_BELOW_TABLE",
  "ORDER_PRICE_DIFFERS_FROM_DOCUMENT",
  "DOCUMENT_PRICE_DIFFERS_FROM_NFE",
  "NEGATIVE_MARGIN",
  "CANCELED_ITEM_GENERATING_NO_MARGIN",
  "STALE_ITEM_GENERATING_MARGIN",
  "PRICE_TABLE_NOT_FOUND_FOR_ORDER_DATE",
]);

function MarginPricingTab({
  marginPricing,
  alerts,
}: {
  marginPricing: OrderFullAuditMarginPricingBlock;
  alerts: OrderFullAuditAlert[];
}): JSX.Element {
  const tabAlerts = alerts.filter((a) => MARGIN_ALERT_CODES.has(a.code));
  const isEmpty =
    marginPricing.source === "NONE" && marginPricing.items.length === 0;

  return (
    <div className="space-y-4" data-testid="order-full-audit-margin-pricing-tab">
      {/* Top cards */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-margin-cards"
      >
        <SectionHeader
          title="Margem, preço e custo — resumo"
          subtitle="Totais apenas dos itens ativos. Cancelado/cortado/stale não entra em margem."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <Kpi
            label="Receita ativa"
            value={
              marginPricing.totals.totalNetRevenue != null
                ? formatFinanceCurrency(marginPricing.totals.totalNetRevenue)
                : "—"
            }
            tone="highlight"
          />
          <Kpi
            label="Custo total ativo"
            value={
              marginPricing.totals.totalCost != null
                ? formatFinanceCurrency(marginPricing.totals.totalCost)
                : "—"
            }
          />
          <Kpi
            label="Margem R$"
            value={
              marginPricing.totals.marginValue != null
                ? formatFinanceCurrency(marginPricing.totals.marginValue)
                : "—"
            }
            tone={
              (marginPricing.totals.marginValue ?? 0) < 0
                ? "danger"
                : (marginPricing.totals.marginValue ?? 0) > 0
                  ? "success"
                  : "muted"
            }
          />
          <Kpi
            label="Margem %"
            value={
              marginPricing.totals.marginPerc != null
                ? formatFinancePercent(marginPricing.totals.marginPerc)
                : "—"
            }
            tone={
              marginPricing.totals.marginPerc != null &&
              marginPricing.totals.marginPerc < 0
                ? "danger"
                : marginPricing.totals.marginPerc != null &&
                    marginPricing.totals.marginPerc > 0
                  ? "success"
                  : "muted"
            }
          />
          <Kpi
            label="Valor cancelado"
            value={formatFinanceCurrency(marginPricing.totals.canceledValue)}
            tone={
              marginPricing.totals.canceledValue > 0.009 ? "warning" : "muted"
            }
          />
          <Kpi
            label="Valor cortado"
            value={formatFinanceCurrency(marginPricing.totals.cutValue)}
            tone={marginPricing.totals.cutValue > 0.009 ? "warning" : "muted"}
          />
          <Kpi
            label="Valor sem margem"
            value={formatFinanceCurrency(marginPricing.totals.noMarginValue)}
            tone={
              marginPricing.totals.noMarginValue > 0.009 ? "warning" : "muted"
            }
          />
          <Kpi
            label="Itens NO_MARGIN"
            value={String(marginPricing.counts.noMarginItems)}
            tone={
              marginPricing.counts.noMarginItems > 0 ? "warning" : "muted"
            }
          />
          <Kpi
            label="Ignorados (cancelado/cut/stale)"
            value={String(
              marginPricing.counts.canceledItems +
                marginPricing.counts.cutItems +
                marginPricing.counts.staleItems
            )}
            tone="muted"
          />
          <Kpi
            label="Δ pedido × tabela"
            value={formatFinanceCurrency(
              marginPricing.totals.priceOrderVsTableDelta
            )}
            tone={
              marginPricing.totals.priceOrderVsTableDelta > 0.009
                ? "warning"
                : "muted"
            }
          />
          <Kpi
            label="Δ pedido × documento"
            value={formatFinanceCurrency(
              marginPricing.totals.priceOrderVsDocumentDelta
            )}
            tone={
              marginPricing.totals.priceOrderVsDocumentDelta > 0.009
                ? "warning"
                : "muted"
            }
          />
          <Kpi label="Fonte" value={marginPricing.source} />
        </div>
      </section>

      {isEmpty ? (
        <div className="rounded-[12px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-6 text-sm text-[#6B7280]">
          Nenhum dado de margem disponível para este pedido (serviço de margem
          indisponível ou pedido sem itens).
        </div>
      ) : (
        <>
          {/* Tabela por item */}
          <section
            className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
            data-testid="order-full-audit-margin-section-items"
          >
            <SectionHeader
              title="Margem, preço e custo — item a item"
              subtitle="Comparação pedido × tabela × documento × NF por linha (casamento por evidência)."
            />
            <div className="overflow-x-auto">
              <table
                className="min-w-[2600px] w-full text-left text-[11px]"
                data-testid="order-full-audit-margin-items-table"
              >
                <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                  <tr>
                    <th className="py-1.5 pr-2 font-semibold">Item</th>
                    <th className="py-1.5 pr-2 font-semibold">Produto / SKU</th>
                    <th className="py-1.5 pr-2 font-semibold">Status</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Qtd ativa</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Preço un. pedido</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Preço un. tabela</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Preço un. documento</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Preço un. NF</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Δ pedido × tabela</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Δ pedido × documento</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Δ documento × NF</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Custo un.</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Custo total</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Margem R$</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Margem %</th>
                    <th className="py-1.5 pr-2 font-semibold">Regra fiscal</th>
                    <th className="py-1.5 pr-2 font-semibold">Tabela</th>
                    <th className="py-1.5 pr-2 font-semibold">Vigência tabela</th>
                    <th className="py-1.5 pr-2 font-semibold text-right">Comissão prev.</th>
                    <th className="py-1.5 pr-2 font-semibold">Status margem</th>
                    <th className="py-1.5 pr-2 font-semibold">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {marginPricing.items.map((i) => (
                    <tr
                      key={i.salesOrderItemId}
                      className={cn(
                        "border-b border-[#F3F4F6]",
                        i.isCanceled && "bg-red-50/25",
                        i.isStale && !i.isCanceled && "bg-[#F3F4F6]/50",
                        i.isCut && !i.isCanceled && "bg-amber-50/25",
                        i.alerts.includes("NEGATIVE_MARGIN") && "bg-red-100/60",
                        i.alerts.includes("NO_MARGIN") &&
                          !i.alerts.includes("NEGATIVE_MARGIN") &&
                          i.isActive &&
                          "bg-amber-50/40"
                      )}
                      data-testid={`order-full-audit-margin-row-${i.salesOrderItemId}`}
                    >
                      <td className="py-1.5 pr-2 tabular-nums text-[#6B7280]">
                        {i.itemSequence ?? "—"}
                      </td>
                      <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                        <div className="flex flex-col">
                          <span>{i.productCode ?? "—"}</span>
                          <span
                            className="text-[10px] text-[#6B7280] max-w-[220px] truncate"
                            title={i.productName ?? undefined}
                          >
                            {i.productName ?? ""}
                          </span>
                        </div>
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            i.isCanceled
                              ? "border-red-200 bg-red-50 text-red-800"
                              : i.isCut
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : i.isStale
                                  ? "border-[#E5E7EB] bg-[#F3F4F6] text-[#4B5563]"
                                  : "border-emerald-200 bg-emerald-50 text-emerald-800"
                          )}
                        >
                          {i.itemStatus}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.activeQuantity != null
                          ? formatFinanceInteger(i.activeQuantity)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.orderUnitPrice != null
                          ? formatFinanceCurrency(i.orderUnitPrice)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.officialTableUnitPrice != null
                          ? formatFinanceCurrency(i.officialTableUnitPrice)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.documentUnitPrice != null
                          ? formatFinanceCurrency(i.documentUnitPrice)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.nfeUnitPrice != null
                          ? formatFinanceCurrency(i.nfeUnitPrice)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.priceDiffOrderVsTableAbs != null
                          ? formatSignedCurrency(i.priceDiffOrderVsTableAbs)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.priceDiffOrderVsDocumentAbs != null
                          ? formatSignedCurrency(i.priceDiffOrderVsDocumentAbs)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.priceDiffDocumentVsNfeAbs != null
                          ? formatSignedCurrency(i.priceDiffDocumentVsNfeAbs)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.unitCost != null
                          ? formatFinanceCurrency(i.unitCost)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.totalCost != null
                          ? formatFinanceCurrency(i.totalCost)
                          : "—"}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums font-semibold",
                          i.marginValue != null && i.marginValue < -0.005
                            ? "text-red-700"
                            : i.marginValue != null && i.marginValue > 0.005
                              ? "text-emerald-800"
                              : "text-[#4B5563]"
                        )}
                      >
                        {i.marginValue != null
                          ? formatFinanceCurrency(i.marginValue)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {i.marginPercent != null
                          ? formatFinancePercent(i.marginPercent)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-[10px]">
                        {i.fiscalRule ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[100px] truncate"
                        title={i.priceTableCode ?? undefined}
                      >
                        {i.priceTableCode
                          ? `${i.priceTableCode}${i.priceTableVersion ? ` v${i.priceTableVersion}` : ""}`
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">
                        {i.priceTableEffectiveDate
                          ? formatFinanceDate(i.priceTableEffectiveDate)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-[#6B7280]">
                        {i.commissionEstimated != null
                          ? formatFinanceCurrency(i.commissionEstimated)
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            i.marginStatus === "OK"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : i.marginStatus === "MARGEM_NEGATIVA"
                                ? "border-red-200 bg-red-50 text-red-800"
                                : i.marginStatus === "SEM_CUSTO" ||
                                    i.marginStatus === "CUSTO_ZERO"
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-[#D0D5DD] bg-white text-[#4B5563]"
                          )}
                        >
                          {i.marginStatusLabel || i.marginStatus}
                        </span>
                      </td>
                      <td
                        className="py-1.5 pr-2 max-w-[220px] truncate text-[10px]"
                        title={i.reason ?? undefined}
                      >
                        {i.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* Divergências oficiais desta aba */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-margin-section-divergences"
      >
        <SectionHeader
          title="Divergências de margem, preço e custo"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 30).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-margin-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Comissões (placeholder)                                         */
/* -------------------------------------------------------------------- */

const COMMISSION_ALERT_CODES = new Set([
  "SELLER_NOT_INFORMED",
  "COMMISSION_WITHOUT_SELLER",
  "CANCELED_ITEM_GENERATING_COMMISSION",
  "COMMISSION_RELEASED_WITHOUT_RECEIPT",
  "COMMISSION_PAID_WITH_DIVERGENCE",
  "CUSTOMER_COMMISSION_EXCEPTION",
  "COMMISSION_BASE_GREATER_THAN_RECEIVED_VALUE",
  "RESPONSIBLE_COMMERCIAL_USED_AS_COMMISSION_SELLER",
  "RECEIVED_CR_LINKED_TO_CANCELED_NFE",
  "CANCELED_NFE_WITH_RECEIVABLE",
]);

function formatQtyOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", {
    maximumFractionDigits: 3,
  });
}

function CommissionsTab({
  commissions,
  alerts,
  orderCode,
  orderSellerName,
}: {
  commissions: OrderFullAuditCommissionBlock;
  alerts: OrderFullAuditAlert[];
  orderCode: string | null;
  orderSellerName?: string | null;
}): JSX.Element {
  const tabAlerts = alerts.filter((a) => COMMISSION_ALERT_CODES.has(a.code));
  const orderSellerLabel =
    orderSellerName?.trim() ||
    commissions.rawSellerName?.trim() ||
    null;
  const sellerAvailable = Boolean(
    commissions.canonicalSellerName?.trim() ||
      commissions.rawSellerName?.trim() ||
      orderSellerLabel
  );
  const hasCanceledNfeCrRisk = alerts.some(
    (a) =>
      a.code === "RECEIVED_CR_LINKED_TO_CANCELED_NFE" ||
      a.code === "CANCELED_NFE_WITH_RECEIVABLE"
  );

  return (
    <div className="space-y-4" data-testid="order-full-audit-commissions-tab">
      {/* Aviso oficial: read-only */}
      <div
        className="rounded-[10px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-sky-900"
        data-testid="order-full-audit-commissions-readonly"
      >
        <strong>Read-only.</strong> Esta aba mostra apenas o snapshot oficial da
        comissão (fonte: <code>CommissionOrderSnapshot</code>). Comissão paga
        nunca é alterada aqui. Vendedor comissionável vem do Pedido de Venda/Nomus.
      </div>
      {hasCanceledNfeCrRisk ? (
        <div
          className="rounded-[10px] border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900"
          data-testid="order-full-audit-commissions-canceled-nfe-review"
        >
          Há CR vinculado a NF cancelada neste pedido. Não tratar automaticamente
          como comissão normal sem auditoria. Comissão paga não foi alterada.
        </div>
      ) : null}

      {/* Top cards */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-commissions-cards"
      >
        <SectionHeader
          title="Resumo de comissão"
          subtitle="Apenas itens ativos entram na base comissionável. Cancelado / cut / stale nunca gera comissão."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi
            label="Comissão prevista"
            value={formatMoneyOrDash(
              commissions.totals.totalFinalCommissionAmount
            )}
            tone="highlight"
          />
          <Kpi
            label="Comissão confirmada"
            value={formatMoneyOrDash(commissions.totals.totalConfirmedAmount)}
          />
          <Kpi
            label="Comissão liberada"
            value={formatMoneyOrDash(commissions.totals.totalReleasedAmount)}
            tone={
              (commissions.totals.totalReleasedAmount ?? 0) > 0.009
                ? "info"
                : "muted"
            }
          />
          <Kpi
            label="Comissão paga"
            value={formatMoneyOrDash(commissions.totals.totalPaidAmount)}
            tone={
              (commissions.totals.totalPaidAmount ?? 0) > 0.009
                ? "success"
                : "muted"
            }
          />
          <Kpi
            label="Comissão bloqueada"
            value={formatMoneyOrDash(commissions.totals.totalBlockedAmount)}
            tone={
              (commissions.totals.totalBlockedAmount ?? 0) > 0.009
                ? "danger"
                : "muted"
            }
          />
          <Kpi
            label="Base comissionável"
            value={formatMoneyOrDash(commissions.totals.commissionableBase)}
          />
          <Kpi
            label="Base ignorada"
            value={formatMoneyOrDash(commissions.totals.ignoredBase)}
            tone={
              (commissions.totals.ignoredBase ?? 0) > 0.009 ? "warning" : "muted"
            }
            help="Σ dos cancelados/cortados/stale (não geram comissão)."
          />
          <Kpi
            label="Vendedor comissionável"
            value={
              commissions.canonicalSellerName ??
              commissions.rawSellerName ??
              "Sem vendedor informado"
            }
            tone={sellerAvailable ? "neutral" : "warning"}
            help={
              commissions.rawSellerId != null
                ? `Nomus rawSellerId=${commissions.rawSellerId}`
                : "Vem do Pedido de Venda no Nomus (nomusSellerName)."
            }
          />
        </div>
      </section>

      {/* Exceções de cliente */}
      {commissions.customerExceptions.length > 0 ? (
        <section
          className="rounded-[14px] border border-amber-200 bg-amber-50/50 p-3"
          data-testid="order-full-audit-commissions-section-exceptions"
        >
          <SectionHeader
            title="Exceções de cliente"
            subtitle="Regras de exclusão/exceção cadastradas para o cliente deste pedido."
          />
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {commissions.customerExceptions.map((e) => (
              <li
                key={e.id}
                className={cn(
                  "rounded-[10px] border px-3 py-2 text-[11px]",
                  e.active
                    ? "border-amber-300 bg-white"
                    : "border-[#D0D5DD] bg-white/60 opacity-70"
                )}
              >
                <p className="font-semibold text-[#111827]">
                  {e.reason}
                  {e.active ? null : (
                    <span className="ml-1 text-[10px] font-normal text-[#6B7280]">
                      (inativa)
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[#4B5563]">
                  {e.startDate ? formatFinanceDate(e.startDate) : "?"} →{" "}
                  {e.endDate ? formatFinanceDate(e.endDate) : "sem fim"} ·{" "}
                  {e.productCode ? `Produto ${e.productCode} · ` : ""}
                  {e.commissionPersonName ?? "todos os vendedores"}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Tabela por item */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-commissions-section-items"
      >
        <SectionHeader
          title="Comissão por item"
          subtitle="Snapshot oficial (CommissionOrderItemSnapshot). Read-only."
        />
        {!commissions.present || commissions.items.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            {commissions.present
              ? "Snapshot sem itens de comissão."
              : "Nenhum snapshot ACTIVE de comissão encontrado para este pedido."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[980px] w-full table-fixed text-left text-[11px]"
              data-testid="order-full-audit-commissions-items-table"
            >
              <colgroup>
                <col className="w-[52px]" />
                <col className="w-[18%]" />
                <col className="w-[56px]" />
                <col className="w-[88px]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[12%]" />
                <col className="w-[88px]" />
                <col className="w-[56px]" />
                <col className="w-[88px]" />
                <col className="w-[72px]" />
                <col />
              </colgroup>
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-1.5 font-semibold">Item</th>
                  <th className="py-1.5 pr-1.5 font-semibold">Produto / SKU</th>
                  <th className="py-1.5 pr-1.5 font-semibold text-right">Qtd</th>
                  <th className="py-1.5 pr-1.5 font-semibold text-right">
                    Vlr. unit.
                  </th>
                  <th
                    className="py-1.5 pr-1.5 font-semibold"
                    title="Vendedor do pedido (SalesOrder / Nomus)"
                  >
                    Vendedor do pedido
                  </th>
                  <th className="py-1.5 pr-1.5 font-semibold">
                    Pessoa comissionada
                  </th>
                  <th className="py-1.5 pr-1.5 font-semibold">Regra</th>
                  <th className="py-1.5 pr-1.5 font-semibold text-right">Base</th>
                  <th className="py-1.5 pr-1.5 font-semibold text-right">%</th>
                  <th
                    className="py-1.5 pr-1.5 font-semibold text-right"
                    title="Valor previsto (bruto no tooltip)"
                  >
                    Previsto
                  </th>
                  <th className="py-1.5 pr-1.5 font-semibold">Status</th>
                  <th className="py-1.5 pr-1.5 font-semibold">Motivo / Alertas</th>
                </tr>
              </thead>
              <tbody>
                {commissions.items.map((i) => {
                  const ruleTip = [
                    i.ruleName,
                    i.ruleBaseType,
                    i.ruleReleaseRule,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  const alertTip =
                    i.alerts.length > 0 ? i.alerts.join(", ") : undefined;
                  const motivoAlertasTip = [
                    i.exclusionReason,
                    alertTip,
                  ]
                    .filter(Boolean)
                    .join(" | ");
                  return (
                    <tr
                      key={i.salesOrderItemId}
                      className={cn(
                        "border-b border-[#F3F4F6]",
                        i.isCanceled && "bg-red-50/25",
                        i.isStale && !i.isCanceled && "bg-[#F3F4F6]/50",
                        i.alerts.includes(
                          "CANCELED_ITEM_GENERATING_COMMISSION"
                        ) && "bg-red-100/60"
                      )}
                      data-testid={`order-full-audit-commissions-row-${i.salesOrderItemId}`}
                    >
                      <td
                        className="py-1.5 pr-1.5 tabular-nums text-[#6B7280]"
                        title={orderCode ? `Pedido ${orderCode}` : undefined}
                      >
                        {i.itemSequence ?? "—"}
                      </td>
                      <td className="py-1.5 pr-1.5 font-semibold text-[#111827]">
                        <div className="min-w-0">
                          <div className="truncate">{i.productCode ?? "—"}</div>
                          <div
                            className="truncate text-[10px] font-normal text-[#6B7280]"
                            title={i.productName ?? undefined}
                          >
                            {i.productName ?? ""}
                          </div>
                        </div>
                      </td>
                      <td className="py-1.5 pr-1.5 text-right tabular-nums whitespace-nowrap">
                        {formatQtyOrDash(i.quantity)}
                      </td>
                      <td className="py-1.5 pr-1.5 text-right tabular-nums whitespace-nowrap">
                        {formatMoneyOrDash(i.unitPrice)}
                      </td>
                      <td
                        className="py-1.5 pr-1.5 truncate"
                        title={orderSellerLabel ?? undefined}
                      >
                        {orderSellerLabel ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-1.5 truncate"
                        title={commissions.canonicalSellerName ?? undefined}
                      >
                        {commissions.canonicalSellerName ?? "—"}
                      </td>
                      <td
                        className="py-1.5 pr-1.5 truncate"
                        title={ruleTip || undefined}
                      >
                        {i.ruleName ?? "—"}
                      </td>
                      <td className="py-1.5 pr-1.5 text-right tabular-nums whitespace-nowrap">
                        {formatMoneyOrDash(i.commissionBase)}
                      </td>
                      <td className="py-1.5 pr-1.5 text-right tabular-nums whitespace-nowrap">
                        {i.commissionRatePercent != null
                          ? formatFinancePercent(i.commissionRatePercent)
                          : "—"}
                      </td>
                      <td
                        className="py-1.5 pr-1.5 text-right tabular-nums font-semibold whitespace-nowrap"
                        title={
                          i.grossCommissionAmount != null
                            ? `Bruto: ${formatMoneyOrDash(i.grossCommissionAmount)}`
                            : undefined
                        }
                      >
                        {formatMoneyOrDash(i.finalCommissionAmount)}
                      </td>
                      <td className="py-1.5 pr-1.5">
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold",
                            i.status === "ACTIVE"
                              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                              : i.status === "EXCLUDED"
                                ? "border-red-200 bg-red-50 text-red-800"
                                : "border-[#D0D5DD] bg-white text-[#4B5563]"
                          )}
                        >
                          {i.status ?? "—"}
                        </span>
                      </td>
                      <td
                        className="py-1.5 pr-1.5"
                        title={motivoAlertasTip || undefined}
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-[10px] text-[#6B7280]">
                            {i.exclusionReason ?? "—"}
                          </span>
                          {i.alerts.length > 0 ? (
                            <div className="flex flex-wrap gap-0.5">
                              {i.alerts.map((code) => (
                                <span
                                  key={code}
                                  className="rounded border border-red-200 bg-red-50 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-800"
                                  title={code}
                                >
                                  {code
                                    .replace(/^COMMISSION_|^CANCELED_ITEM_/, "")
                                    .replace(/_/g, " ")}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Cronograma × baixas */}
      {commissions.receivableSchedule.length + commissions.receipts.length > 0 ? (
        <section
          className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
          data-testid="order-full-audit-commissions-section-schedule"
        >
          <SectionHeader
            title="Cronograma × baixas"
            subtitle="Comissão liberada segue as baixas oficiais do CR. Nunca alterar comissão paga."
          />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1">
                Cronograma (CommissionReceivableSchedule)
              </p>
              {commissions.receivableSchedule.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[11px] text-[#6B7280]">
                  Sem cronograma vinculado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[680px] w-full text-left text-[11px]">
                    <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                      <tr>
                        <th className="py-1 pr-2 font-semibold">CR</th>
                        <th className="py-1 pr-2 font-semibold">Parcela</th>
                        <th
                          className="py-1 pr-2 font-semibold whitespace-nowrap"
                          title="Data de vencimento da parcela do Contas a Receber."
                        >
                          Vencimento CR
                        </th>
                        <th className="py-1 pr-2 font-semibold text-right">Nominal</th>
                        <th className="py-1 pr-2 font-semibold text-right">Share %</th>
                        <th className="py-1 pr-2 font-semibold text-right">Comissão prev.</th>
                        <th className="py-1 pr-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.receivableSchedule.map((s, idx) => (
                        <tr
                          key={`${s.receivableExternalId}-${idx}`}
                          className="border-b border-[#F3F4F6]"
                        >
                          <td className="py-1 pr-2 font-semibold">
                            {s.receivableExternalId ?? "—"}
                          </td>
                          <td className="py-1 pr-2 tabular-nums">
                            {s.installmentNumber ?? "—"}
                          </td>
                          <td
                            className="py-1 pr-2 whitespace-nowrap tabular-nums"
                            title="Data de vencimento da parcela do Contas a Receber."
                          >
                            {s.receivableDueDateFormatted ?? "—"}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {formatMoneyOrDash(s.receivableNominalAmount)}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {s.receivableSharePercent != null
                              ? formatFinancePercent(s.receivableSharePercent)
                              : "—"}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums font-semibold">
                            {formatMoneyOrDash(s.scheduledCommissionAmount)}
                          </td>
                          <td className="py-1 pr-2 text-[10px]">{s.status ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280] mb-1">
                Baixas (CommissionReceiptLedgerLine)
              </p>
              {commissions.receipts.length === 0 ? (
                <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[11px] text-[#6B7280]">
                  Sem baixas de comissão ainda.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-[700px] w-full text-left text-[11px]">
                    <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                      <tr>
                        <th className="py-1 pr-2 font-semibold">CR</th>
                        <th className="py-1 pr-2 font-semibold">Data baixa</th>
                        <th className="py-1 pr-2 font-semibold text-right">Liberada</th>
                        <th className="py-1 pr-2 font-semibold text-right">Paga</th>
                        <th className="py-1 pr-2 font-semibold text-right">Bloqueada</th>
                        <th className="py-1 pr-2 font-semibold">Data pgto</th>
                        <th className="py-1 pr-2 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commissions.receipts.map((r) => (
                        <tr
                          key={r.ledgerLineKey}
                          className="border-b border-[#F3F4F6]"
                        >
                          <td className="py-1 pr-2 font-semibold">
                            {r.receivableExternalId ?? r.receivableNumber ?? "—"}
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {r.settlementDate
                              ? formatFinanceDate(r.settlementDate)
                              : "—"}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums">
                            {formatMoneyOrDash(r.releasedCommissionAmount)}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-emerald-800 font-semibold">
                            {formatMoneyOrDash(r.paidCommissionAmount)}
                          </td>
                          <td className="py-1 pr-2 text-right tabular-nums text-red-800">
                            {formatMoneyOrDash(r.blockedCommissionAmount)}
                          </td>
                          <td className="py-1 pr-2 whitespace-nowrap">
                            {r.paymentDate ? formatFinanceDate(r.paymentDate) : "—"}
                          </td>
                          <td className="py-1 pr-2 text-[10px]">
                            {r.paymentStatus ?? r.status ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {/* Divergências */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-commissions-section-divergences"
      >
        <SectionHeader
          title="Divergências de comissão"
          subtitle={
            tabAlerts.length === 0
              ? "Nenhuma divergência."
              : `${tabAlerts.length} divergência(s) identificada(s).`
          }
        />
        {tabAlerts.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[12px] text-[#6B7280]">
            Nenhuma divergência.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {tabAlerts.slice(0, 30).map((a, idx) => (
              <li
                key={`${a.code}-${idx}`}
                className={cn(
                  "rounded-[10px] border px-3 py-2",
                  a.severity === "critical"
                    ? "border-red-200 bg-red-50"
                    : a.severity === "warning"
                      ? "border-amber-200 bg-amber-50"
                      : "border-[#E5E7EB] bg-[#F9FAFB]"
                )}
                data-testid={`order-full-audit-commissions-alert-${a.code.toLowerCase()}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-bold text-[#111827]">
                    {a.title}
                  </p>
                  <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#4B5563]">
                    {a.code}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[#4B5563]">
                  {a.description}
                </p>
                {a.financialImpact != null && a.financialImpact !== 0 ? (
                  <p className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#111827]">
                    Impacto: {formatFinanceCurrency(a.financialImpact)}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Divergências (reaproveita renderização de alertas)              */
/* -------------------------------------------------------------------- */

const DIVERGENCE_CATEGORY_LABEL: Record<
  OrderFullAuditAlert["category"],
  string
> = {
  COMMERCIAL: "Comercial",
  ORDER: "Pedido",
  ORDER_ITEM: "Item",
  STOCK_DOCUMENT: "Documento saída",
  NFE: "NF-e",
  RECEIVABLE: "Financeiro/CR",
  RECEIPT: "Recebimento/Baixa",
  DELIVERY: "Entrega",
  FREIGHT: "Frete",
  MARGIN_PRICING: "Margem/Preço",
  COMMISSION: "Comissão",
  INTEGRATION_NOMUS: "Integração/Nomus",
  REGISTRATION: "Cadastro",
};

const DIVERGENCE_TAB_LABEL: Record<
  NonNullable<OrderFullAuditAlert["linkedTab"]>,
  string
> = {
  summary: "Resumo Executivo",
  proposal: "Proposta",
  salesOrder: "Pedido de Venda",
  items: "Itens do Pedido",
  documents: "Documentos de Saída",
  nfes: "NF-e",
  financial: "Financeiro",
  delivery: "Entrega / Frete",
  marginPricing: "Margem, Preço e Custo",
  commissions: "Comissões",
  divergences: "Divergências",
  technicalAudit: "Auditoria Técnica",
};

type DivergenceFilterId =
  | "all"
  | "critical"
  | "financial"
  | "documents"
  | "nfes"
  | "pricing"
  | "commission"
  | "delivery"
  | "registration";

function DivergencesTab({
  divergences,
  onOpenTab,
}: {
  divergences: OrderFullAuditDivergenceBlock;
  onOpenTab: (tab: OrderFullAuditTabId) => void;
}): JSX.Element {
  const [filter, setFilter] = useState<DivergenceFilterId>("all");

  const filtered = useMemo(() => {
    return divergences.alerts.filter((a) => {
      switch (filter) {
        case "critical":
          return a.severity === "critical" || a.severity === "high";
        case "financial":
          return a.category === "RECEIVABLE" || a.category === "RECEIPT";
        case "documents":
          return a.category === "STOCK_DOCUMENT";
        case "nfes":
          return a.category === "NFE";
        case "pricing":
          return a.category === "MARGIN_PRICING";
        case "commission":
          return a.category === "COMMISSION";
        case "delivery":
          return a.category === "DELIVERY" || a.category === "FREIGHT";
        case "registration":
          return (
            a.category === "REGISTRATION" ||
            a.category === "INTEGRATION_NOMUS"
          );
        default:
          return true;
      }
    });
  }, [divergences.alerts, filter]);

  const chipConfig: {
    id: DivergenceFilterId;
    label: string;
    count: number;
  }[] = [
    { id: "all", label: "Todas", count: divergences.alerts.length },
    {
      id: "critical",
      label: "Críticas",
      count: divergences.counts.critical + divergences.counts.high,
    },
    {
      id: "financial",
      label: "Financeiras",
      count:
        (divergences.byCategory.RECEIVABLE ?? 0) +
        (divergences.byCategory.RECEIPT ?? 0),
    },
    {
      id: "documents",
      label: "Documentos",
      count: divergences.byCategory.STOCK_DOCUMENT ?? 0,
    },
    { id: "nfes", label: "NF-e", count: divergences.byCategory.NFE ?? 0 },
    {
      id: "pricing",
      label: "Preço/margem",
      count: divergences.byCategory.MARGIN_PRICING ?? 0,
    },
    {
      id: "commission",
      label: "Comissão",
      count: divergences.byCategory.COMMISSION ?? 0,
    },
    {
      id: "delivery",
      label: "Entrega",
      count:
        (divergences.byCategory.DELIVERY ?? 0) +
        (divergences.byCategory.FREIGHT ?? 0),
    },
    {
      id: "registration",
      label: "Cadastro",
      count:
        (divergences.byCategory.REGISTRATION ?? 0) +
        (divergences.byCategory.INTEGRATION_NOMUS ?? 0),
    },
  ];

  return (
    <div className="space-y-4" data-testid="order-full-audit-divergences-tab">
      {/* Top cards */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-divergences-cards"
      >
        <SectionHeader
          title="Divergências e alertas — visão consolidada"
          subtitle="Central de auditoria. Cada divergência tem descrição, impacto, ação e atalho para a aba oficial."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
          <Kpi
            label="Críticas"
            value={String(divergences.counts.critical)}
            tone={divergences.counts.critical > 0 ? "danger" : "muted"}
          />
          <Kpi
            label="Altas"
            value={String(divergences.counts.high)}
            tone={divergences.counts.high > 0 ? "danger" : "muted"}
          />
          <Kpi
            label="Médias"
            value={String(divergences.counts.medium + divergences.counts.warning)}
            tone={
              divergences.counts.medium + divergences.counts.warning > 0
                ? "warning"
                : "muted"
            }
          />
          <Kpi
            label="Informativas"
            value={String(divergences.counts.info)}
            tone={divergences.counts.info > 0 ? "info" : "muted"}
          />
          <Kpi
            label="Impacto financeiro"
            value={formatFinanceCurrency(
              divergences.metrics.financialImpactTotal
            )}
            tone={
              divergences.metrics.financialImpactTotal > 0.009
                ? "warning"
                : "muted"
            }
            help="Σ |financialImpact| das divergências."
          />
          <Kpi
            label="Itens afetados"
            value={String(divergences.metrics.affectedItems)}
          />
          <Kpi
            label="Títulos afetados"
            value={String(divergences.metrics.affectedTitles)}
          />
          <Kpi
            label="Documentos afetados"
            value={String(divergences.metrics.affectedDocuments)}
          />
        </div>
      </section>

      {/* Filtros */}
      <div
        className="flex flex-wrap gap-2"
        data-testid="order-full-audit-divergences-chips"
      >
        {chipConfig.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cn(
              "rounded-full border px-3 py-1 text-[11px] font-semibold",
              filter === c.id
                ? "border-sky-300 bg-sky-50 text-sky-900"
                : "border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F9FAFB]"
            )}
            onClick={() => setFilter(c.id)}
            data-testid={`order-full-audit-divergences-chip-${c.id}`}
          >
            {c.label} ({c.count})
          </button>
        ))}
      </div>

      {/* Tabela */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-divergences-section-table"
      >
        {filtered.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-3 py-6 text-center text-[12px] text-[#6B7280]">
            Nenhuma divergência no filtro atual.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="min-w-[1600px] w-full text-left text-[11px]"
              data-testid="order-full-audit-divergences-table"
            >
              <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
                <tr>
                  <th className="py-1.5 pr-2 font-semibold">Severidade</th>
                  <th className="py-1.5 pr-2 font-semibold">Código</th>
                  <th className="py-1.5 pr-2 font-semibold">Categoria</th>
                  <th className="py-1.5 pr-2 font-semibold">Descrição</th>
                  <th className="py-1.5 pr-2 font-semibold">Entidade</th>
                  <th className="py-1.5 pr-2 font-semibold">Referência</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Impacto R$</th>
                  <th className="py-1.5 pr-2 font-semibold text-right">Impacto qtd</th>
                  <th className="py-1.5 pr-2 font-semibold">Data</th>
                  <th className="py-1.5 pr-2 font-semibold">Status</th>
                  <th className="py-1.5 pr-2 font-semibold">Ação recomendada</th>
                  <th className="py-1.5 pr-2 font-semibold">Aba</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, idx) => (
                  <tr
                    key={`${a.code}-${idx}`}
                    className={cn(
                      "border-b border-[#F3F4F6]",
                      a.severity === "critical" && "bg-red-50/40",
                      a.severity === "high" && "bg-red-50/25",
                      a.severity === "medium" && "bg-amber-50/25"
                    )}
                    data-testid={`order-full-audit-divergences-row-${a.code.toLowerCase()}-${idx}`}
                  >
                    <td className="py-1.5 pr-2">
                      <span
                        className={cn(
                          "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          a.severity === "critical"
                            ? "border-red-300 bg-red-100 text-red-900"
                            : a.severity === "high"
                              ? "border-red-200 bg-red-50 text-red-800"
                              : a.severity === "medium" ||
                                  a.severity === "warning"
                                ? "border-amber-200 bg-amber-50 text-amber-800"
                                : "border-[#D0D5DD] bg-white text-[#4B5563]"
                        )}
                      >
                        {a.severity === "critical"
                          ? "Crítica"
                          : a.severity === "high"
                            ? "Alta"
                            : a.severity === "medium" || a.severity === "warning"
                              ? "Média"
                              : "Info"}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="font-mono text-[10px] font-bold text-[#111827]">
                        {a.code}
                      </span>
                    </td>
                    <td className="py-1.5 pr-2 text-[10px] text-[#4B5563]">
                      {DIVERGENCE_CATEGORY_LABEL[a.category] ?? a.category}
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[300px]"
                      title={a.description}
                    >
                      <p className="font-semibold text-[#111827]">{a.title}</p>
                      <p className="text-[10px] text-[#6B7280] truncate">
                        {a.description}
                      </p>
                    </td>
                    <td className="py-1.5 pr-2 text-[10px] text-[#6B7280]">
                      {a.entityType ?? "—"}
                    </td>
                    <td className="py-1.5 pr-2 font-mono text-[10px] text-[#4B5563]">
                      {a.reference ?? "—"}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-2 text-right tabular-nums",
                        a.financialImpact != null && a.financialImpact !== 0
                          ? "font-semibold text-[#111827]"
                          : "text-[#6B7280]"
                      )}
                    >
                      {a.financialImpact != null && a.financialImpact !== 0
                        ? formatFinanceCurrency(a.financialImpact)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-[#6B7280]">
                      {a.quantityImpact != null
                        ? formatFinanceInteger(a.quantityImpact)
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      {a.alertDate ? formatFinanceDate(a.alertDate) : "—"}
                    </td>
                    <td className="py-1.5 pr-2">
                      <span className="rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#4B5563]">
                        {a.status}
                      </span>
                    </td>
                    <td
                      className="py-1.5 pr-2 max-w-[240px]"
                      title={a.action}
                    >
                      <p className="text-[11px] text-[#4B5563]">{a.action}</p>
                    </td>
                    <td className="py-1.5 pr-2">
                      {a.linkedTab && a.linkedTab !== "divergences" ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-100"
                          onClick={() =>
                            onOpenTab(a.linkedTab as OrderFullAuditTabId)
                          }
                          title={`Abrir aba ${DIVERGENCE_TAB_LABEL[a.linkedTab]}`}
                          data-testid={`order-full-audit-divergences-link-${a.linkedTab}`}
                        >
                          {DIVERGENCE_TAB_LABEL[a.linkedTab]}
                        </button>
                      ) : (
                        <span className="text-[10px] text-[#6B7280]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------- */
/*  Tab: Auditoria Técnica (placeholder)                                 */
/* -------------------------------------------------------------------- */

const TECHNICAL_SOURCE_CATEGORY_LABEL: Record<
  OrderFullAuditTechnicalSource["category"],
  string
> = {
  SALES_ORDER: "Pedido de Venda",
  PROPOSAL: "Proposta",
  NOMUS_STOCK_DOCUMENT: "Documento Nomus",
  NOMUS_NFE: "NF-e Nomus",
  NOMUS_RECEIVABLE: "Contas a Receber Nomus",
  AUDIT_FACT: "Auditoria (facts)",
  COMMISSION: "Comissão",
  PRICING: "Preço / Custo",
  CRM: "CRM / Cadastro",
};

const TECHNICAL_RULE_CATEGORY_LABEL: Record<
  OrderFullAuditTechnicalRule["category"],
  string
> = {
  ORDER_ITEM: "Item do pedido",
  DOCUMENT_ALLOCATION: "Alocação documento → pedido",
  NFE: "NF-e",
  RECEIVABLE: "Contas a Receber",
  COMMISSION: "Comissão",
  MARGIN: "Margem",
  COMMERCIAL: "Comercial",
};

function TechnicalAuditAccordion({
  title,
  count,
  disabled,
  disabledMessage,
  children,
  testId,
}: {
  title: string;
  count?: number | null;
  disabled?: boolean;
  disabledMessage?: string;
  children: React.ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <details
      className="group rounded-[10px] border border-[#E5E7EB] bg-white"
      data-testid={testId}
    >
      <summary
        className={cn(
          "cursor-pointer list-none rounded-[10px] px-3 py-2 text-[12px] font-semibold text-[#111827] hover:bg-[#F9FAFB]",
          disabled && "cursor-not-allowed opacity-70"
        )}
        onClick={(e) => {
          if (disabled) e.preventDefault();
        }}
      >
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-[#6B7280] group-open:bg-sky-500 transition-colors" />
          <span>{title}</span>
          {count != null ? (
            <span className="rounded-full border border-[#E5E7EB] bg-[#F9FAFB] px-1.5 py-0.5 text-[9px] text-[#6B7280]">
              {count}
            </span>
          ) : null}
          {disabled ? (
            <span className="ml-2 rounded border border-[#D0D5DD] bg-white px-1.5 py-0.5 text-[9px] font-normal text-[#6B7280]">
              🔒 restrito
            </span>
          ) : null}
        </span>
      </summary>
      {disabled ? (
        <p className="px-4 pb-3 text-[11px] text-[#6B7280]">
          {disabledMessage ??
            "Raw técnico oculto. Use includeRaw=true ou permissão técnica para visualizar."}
        </p>
      ) : (
        <div className="px-4 pb-3">{children}</div>
      )}
    </details>
  );
}

function TechnicalAuditRawBlock({
  data,
}: {
  data: unknown;
}): JSX.Element {
  if (data == null) {
    return (
      <p className="text-[11px] text-[#6B7280]">Sem raw disponível.</p>
    );
  }
  let json: string;
  try {
    json = JSON.stringify(data, null, 2);
  } catch {
    json = String(data);
  }
  const truncated =
    json.length > 20000 ? json.slice(0, 20000) + "\n… (truncado)" : json;
  return (
    <pre className="max-h-[360px] overflow-auto rounded-[8px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[10px] font-mono text-[#111827]">
      {truncated}
    </pre>
  );
}

function TechnicalAuditTab({
  technicalAudit,
}: {
  technicalAudit: OrderFullAuditTechnicalAuditBlock;
}): JSX.Element {
  const raw = technicalAudit.rawPayloads;
  const rawIncluded = technicalAudit.rawStatus.included;
  const groupedSources = new Map<
    OrderFullAuditTechnicalSource["category"],
    OrderFullAuditTechnicalSource[]
  >();
  for (const s of technicalAudit.sources) {
    const arr = groupedSources.get(s.category) ?? [];
    arr.push(s);
    groupedSources.set(s.category, arr);
  }
  const groupedRules = new Map<
    OrderFullAuditTechnicalRule["category"],
    OrderFullAuditTechnicalRule[]
  >();
  for (const r of technicalAudit.rulesApplied) {
    const arr = groupedRules.get(r.category) ?? [];
    arr.push(r);
    groupedRules.set(r.category, arr);
  }

  return (
    <div className="space-y-4" data-testid="order-full-audit-technical-tab">
      {/* Cabeçalho — status da run */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-summary"
      >
        <SectionHeader
          title="Auditoria técnica"
          subtitle="Rastreabilidade oficial: fontes, IDs, regras, raw controlado e histórico."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <Kpi label="Run ID" value={technicalAudit.orderToCashRunId ?? "—"} />
          <Kpi
            label="Run finalizada em"
            value={
              technicalAudit.orderToCashFinishedAt
                ? formatFinanceDate(technicalAudit.orderToCashFinishedAt)
                : "—"
            }
          />
          <Kpi
            label="Facts consumidos"
            value={String(technicalAudit.factCount)}
          />
          <Kpi
            label="Alertas criados"
            value={String(technicalAudit.history.alertsCreated)}
            tone={
              technicalAudit.history.alertsCreated > 0 ? "warning" : "muted"
            }
          />
          <Kpi
            label="Alertas resolvidos"
            value={String(technicalAudit.history.alertsResolved)}
          />
          <Kpi
            label="Commit / versão"
            value={technicalAudit.history.auditRunCommit ?? "—"}
            help={
              technicalAudit.history.auditRunProcess ?? "orderFullAuditService"
            }
          />
        </div>
      </section>

      {/* Seção 1 — Fontes usadas */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-section-sources"
      >
        <SectionHeader
          title="1. Fontes usadas"
          subtitle="Tabelas efetivamente consultadas neste ciclo — cada linha mostra quantidade e status."
        />
        <div className="overflow-x-auto">
          <table
            className="min-w-[900px] w-full text-left text-[11px]"
            data-testid="order-full-audit-technical-sources-table"
          >
            <thead className="text-[9px] uppercase tracking-wide text-[#6B7280] border-b border-[#E5E7EB]">
              <tr>
                <th className="py-1.5 pr-2 font-semibold">Fonte</th>
                <th className="py-1.5 pr-2 font-semibold">Categoria</th>
                <th className="py-1.5 pr-2 font-semibold text-right">
                  Registros
                </th>
                <th className="py-1.5 pr-2 font-semibold">Status</th>
                <th className="py-1.5 pr-2 font-semibold">Observação</th>
              </tr>
            </thead>
            <tbody>
              {technicalAudit.sources.map((s) => (
                <tr
                  key={s.name}
                  className="border-b border-[#F3F4F6]"
                  data-testid={`order-full-audit-technical-source-${s.name.replace(/[^\w]/g, "-")}`}
                >
                  <td className="py-1.5 pr-2 font-semibold text-[#111827]">
                    {s.label}
                    <div className="text-[9px] font-mono text-[#6B7280]">
                      {s.name}
                    </div>
                  </td>
                  <td className="py-1.5 pr-2 text-[10px] text-[#4B5563]">
                    {TECHNICAL_SOURCE_CATEGORY_LABEL[s.category] ?? s.category}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">
                    {s.recordCount}
                  </td>
                  <td className="py-1.5 pr-2">
                    <span
                      className={cn(
                        "inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        s.status === "loaded"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : s.status === "not_found"
                            ? "border-amber-200 bg-amber-50 text-amber-800"
                            : s.status === "error"
                              ? "border-red-200 bg-red-50 text-red-800"
                              : "border-[#D0D5DD] bg-white text-[#4B5563]"
                      )}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-[10px] text-[#4B5563] max-w-[280px]">
                    {s.note ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Seção 2 — IDs técnicos */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-section-identifiers"
      >
        <SectionHeader
          title="2. IDs técnicos"
          subtitle="Referências completas para localizar cada entidade no IndusCost / Nomus."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi
            label="salesOrderId"
            value={technicalAudit.identifiers.salesOrderId}
          />
          <Kpi
            label="orderCode"
            value={technicalAudit.identifiers.orderCode ?? "—"}
          />
          <Kpi
            label="externalSalesOrderId"
            value={
              technicalAudit.identifiers.externalSalesOrderId != null
                ? String(technicalAudit.identifiers.externalSalesOrderId)
                : "—"
            }
          />
          <Kpi
            label="externalSalesOrderCode"
            value={technicalAudit.identifiers.externalSalesOrderCode ?? "—"}
          />
          <Kpi
            label="proposalId"
            value={technicalAudit.identifiers.proposalId ?? "—"}
          />
          <Kpi
            label="externalProposalId"
            value={
              technicalAudit.identifiers.externalProposalId != null
                ? String(technicalAudit.identifiers.externalProposalId)
                : "—"
            }
          />
          <Kpi
            label="customerId"
            value={technicalAudit.identifiers.customerId ?? "—"}
          />
          <Kpi
            label="externalCustomerId"
            value={
              technicalAudit.identifiers.externalCustomerId != null
                ? String(technicalAudit.identifiers.externalCustomerId)
                : "—"
            }
          />
          <Kpi
            label="externalSellerId"
            value={
              technicalAudit.identifiers.externalSellerId != null
                ? String(technicalAudit.identifiers.externalSellerId)
                : "—"
            }
          />
          <Kpi
            label="externalCompanyId"
            value={
              technicalAudit.identifiers.externalCompanyId != null
                ? String(technicalAudit.identifiers.externalCompanyId)
                : "—"
            }
          />
          <Kpi
            label="commissionSnapshotId"
            value={technicalAudit.identifiers.commissionSnapshotId ?? "—"}
          />
          <Kpi label="runId" value={technicalAudit.identifiers.runId ?? "—"} />
        </div>
        <div className="mt-3 space-y-2 text-[11px]">
          <p>
            <strong>Documentos de saída ({technicalAudit.identifiers.stockDocumentExternalIds.length}):</strong>{" "}
            <span className="font-mono text-[#4B5563]">
              {technicalAudit.identifiers.stockDocumentExternalIds.length > 0
                ? technicalAudit.identifiers.stockDocumentExternalIds.join(", ")
                : "—"}
            </span>
          </p>
          <p>
            <strong>NF-e ({technicalAudit.identifiers.nfeExternalIds.length}):</strong>{" "}
            <span className="font-mono text-[#4B5563]">
              {technicalAudit.identifiers.nfeExternalIds.length > 0
                ? technicalAudit.identifiers.nfeExternalIds.join(", ")
                : "—"}
            </span>
          </p>
          <p>
            <strong>Recebíveis ({technicalAudit.identifiers.receivableExternalIds.length}):</strong>{" "}
            <span className="font-mono text-[#4B5563]">
              {technicalAudit.identifiers.receivableExternalIds.length > 0
                ? technicalAudit.identifiers.receivableExternalIds.join(", ")
                : "—"}
            </span>
          </p>
          <p>
            <strong>Ledger comissão ({technicalAudit.identifiers.commissionLedgerLineKeys.length}):</strong>{" "}
            <span className="font-mono text-[10px] text-[#4B5563]">
              {technicalAudit.identifiers.commissionLedgerLineKeys.length > 0
                ? technicalAudit.identifiers.commissionLedgerLineKeys
                    .slice(0, 5)
                    .join(", ") +
                  (technicalAudit.identifiers.commissionLedgerLineKeys.length > 5
                    ? ` (+${technicalAudit.identifiers.commissionLedgerLineKeys.length - 5})`
                    : "")
                : "—"}
            </span>
          </p>
        </div>
      </section>

      {/* Seção 3 — Regras aplicadas */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-section-rules"
      >
        <SectionHeader
          title="3. Regras aplicadas"
          subtitle="Invariantes oficiais do audit-full — documentação viva."
        />
        <div className="space-y-2">
          {[...groupedRules.entries()].map(([cat, rules]) => (
            <div key={cat} className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] p-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-[#6B7280] mb-1">
                {TECHNICAL_RULE_CATEGORY_LABEL[cat] ?? cat}
              </p>
              <ul className="space-y-1 text-[11px]">
                {rules.map((r) => (
                  <li
                    key={r.code}
                    className="rounded border border-[#E5E7EB] bg-white px-2 py-1"
                    data-testid={`order-full-audit-technical-rule-${r.code}`}
                  >
                    <p className="font-semibold text-[#111827]">{r.label}</p>
                    <p className="text-[10px] text-[#4B5563]">{r.description}</p>
                    <span className="font-mono text-[9px] text-[#6B7280]">
                      {r.code}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Seção 4 — Raw / evidências controladas */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-section-raw"
      >
        <SectionHeader
          title="4. Evidências / Raw (controlado)"
          subtitle={
            rawIncluded
              ? "Raw expandido a pedido explícito. Cuidado: expõe payload cru."
              : technicalAudit.rawStatus.reason
          }
        />
        <div className="space-y-2">
          <TechnicalAuditAccordion
            title="Raw Nomus do pedido (SalesOrder.nomusRawResponse)"
            testId="order-full-audit-technical-raw-order"
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.nomusRawResponse ?? null} />
          </TechnicalAuditAccordion>
          <TechnicalAuditAccordion
            title="Raw itens do pedido (SalesOrderItem.nomusRawItem)"
            testId="order-full-audit-technical-raw-order-items"
            count={
              raw ? Object.keys(raw.nomusRawItems ?? {}).length : null
            }
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.nomusRawItems ?? null} />
          </TechnicalAuditAccordion>
          <TechnicalAuditAccordion
            title="Raw documentos de saída (NomusStockDocument.rawJson)"
            testId="order-full-audit-technical-raw-documents"
            count={
              raw ? Object.keys(raw.stockDocumentPayloads ?? {}).length : null
            }
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.stockDocumentPayloads ?? null} />
          </TechnicalAuditAccordion>
          <TechnicalAuditAccordion
            title="Raw NF-e (NomusNfe.rawPayload)"
            testId="order-full-audit-technical-raw-nfes"
            count={raw ? Object.keys(raw.nfePayloads ?? {}).length : null}
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.nfePayloads ?? null} />
          </TechnicalAuditAccordion>
          <TechnicalAuditAccordion
            title="Raw CR (NomusAccountsReceivable.rawPayload)"
            testId="order-full-audit-technical-raw-receivables"
            count={
              raw ? Object.keys(raw.receivablePayloads ?? {}).length : null
            }
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.receivablePayloads ?? null} />
          </TechnicalAuditAccordion>
          <TechnicalAuditAccordion
            title="Facts da auditoria (OrderToCashAuditFact)"
            testId="order-full-audit-technical-raw-facts"
            count={raw ? raw.factsSample.length : technicalAudit.factCount}
            disabled={!rawIncluded}
          >
            <TechnicalAuditRawBlock data={raw?.factsSample ?? null} />
          </TechnicalAuditAccordion>
        </div>
        {!rawIncluded ? (
          <p
            className="mt-2 rounded-[8px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900"
            data-testid="order-full-audit-technical-raw-disabled-notice"
          >
            🔒 <strong>Raw restrito.</strong> {technicalAudit.rawStatus.reason}
            {" "}
            <span className="text-[10px] text-amber-800">
              (permissão necessária:{" "}
              <code>
                {technicalAudit.rawStatus.requiredPermission || "audit.raw.read"}
              </code>
              )
            </span>
          </p>
        ) : (
          <p
            className="mt-2 rounded-[8px] border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-900"
            data-testid="order-full-audit-technical-raw-enabled-notice"
          >
            ⚠ <strong>Raw expandido.</strong> Payload técnico visível — use apenas em depuração.
          </p>
        )}
      </section>

      {/* Seção 5 — Histórico */}
      <section
        className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
        data-testid="order-full-audit-technical-section-history"
      >
        <SectionHeader
          title="5. Histórico"
          subtitle="Datas oficiais de sync/rebuild/run e metadados do processo."
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Kpi
            label="Última sync SalesOrder"
            value={
              technicalAudit.history.lastNomusSalesOrderSync
                ? formatFinanceDate(technicalAudit.history.lastNomusSalesOrderSync)
                : "—"
            }
          />
          <Kpi
            label="Última sync NF-e"
            value={
              technicalAudit.history.lastNomusNfeSync
                ? formatFinanceDate(technicalAudit.history.lastNomusNfeSync)
                : "—"
            }
          />
          <Kpi
            label="Última sync documento"
            value={
              technicalAudit.history.lastNomusStockDocumentSync
                ? formatFinanceDate(
                    technicalAudit.history.lastNomusStockDocumentSync
                  )
                : "—"
            }
          />
          <Kpi
            label="Última sync CR"
            value={
              technicalAudit.history.lastNomusReceivableSync
                ? formatFinanceDate(
                    technicalAudit.history.lastNomusReceivableSync
                  )
                : "—"
            }
          />
          <Kpi
            label="Rebuild OrderToCash"
            value={
              technicalAudit.history.lastOrderToCashRebuild
                ? formatFinanceDate(
                    technicalAudit.history.lastOrderToCashRebuild
                  )
                : "—"
            }
          />
          <Kpi
            label="Conciliação carteira"
            value={
              technicalAudit.history.lastPortfolioReconciliationRun
                ? formatFinanceDate(
                    technicalAudit.history.lastPortfolioReconciliationRun
                  )
                : "—"
            }
          />
          <Kpi
            label="Rebuild comissão"
            value={
              technicalAudit.history.lastCommissionRebuild
                ? formatFinanceDate(
                    technicalAudit.history.lastCommissionRebuild
                  )
                : "—"
            }
          />
          <Kpi
            label="Processo"
            value={technicalAudit.history.auditRunProcess ?? "—"}
          />
          <Kpi
            label="Usuário"
            value={technicalAudit.history.auditRunUser ?? "—"}
            help="Preenchido quando a rota registra o usuário requisitante."
          />
        </div>
      </section>

      {/* Gaps + confiança */}
      {technicalAudit.gaps.length > 0 ? (
        <section
          className="rounded-[14px] border border-amber-200 bg-amber-50 p-3"
          data-testid="order-full-audit-technical-section-gaps"
        >
          <h4 className="text-[12px] font-bold text-amber-900 mb-2">
            Pontos em aberto ({technicalAudit.gaps.length})
          </h4>
          <ul className="list-disc pl-5 text-[11px] text-amber-900 space-y-0.5">
            {technicalAudit.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {Object.keys(technicalAudit.matchConfidenceSummary).length > 0 ? (
        <section
          className="rounded-[14px] border border-[#E5E7EB] bg-white p-3"
          data-testid="order-full-audit-technical-section-confidence"
        >
          <h4 className="text-[12px] font-bold text-[#111827] mb-2">
            Confiança de matching
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(technicalAudit.matchConfidenceSummary).map(
              ([k, v]) => (
                <Kpi key={k} label={k} value={String(v)} />
              )
            )}
          </div>
        </section>
      ) : null}
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
