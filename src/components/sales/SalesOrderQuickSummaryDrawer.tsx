import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { SalesOrderMarginStatusBadge } from "@/src/components/sales/SalesOrderMarginStatusBadge";
import type { SalesOrderIntelligencePayload } from "@/src/lib/salesOrderIntelligence";
import { getSalesOrderIntelligenceApiPath } from "@/src/lib/salesOrderManagementTypes";
import {
  formatDeadlineBadge,
  formatSalesOrderDate,
} from "@/src/lib/salesOrderManagementUi";
import {
  buildSalesOrderListCustomerMeta,
  formatSalesOrderDisplayCode,
  formatSalesOrderListIssueDate,
  formatSalesOrderListItemsCount,
  formatSalesOrderListNetValue,
  resolveSalesOrderListCustomerName,
  SALES_ORDER_LIST_STATUS_LABELS,
} from "@/src/lib/salesOrderListUi";
import {
  buildSalesOrderMarginAlerts,
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
  resolveSalesOrderMarginSupportText,
} from "@/src/lib/salesOrderMarginDisplay";
import type { SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import { buildCustomerIntelligencePath } from "@/src/lib/customerIntelligenceNavigation";

export type SalesOrderListRowSnapshot = {
  id: string;
  customerId: string | null;
  orderCode: string;
  status: string;
  issueDate: string;
  responsible: string | null;
  totalItems: number;
  totalNetValue: unknown;
  totalMarginPerc?: unknown;
  totalMarginValue?: unknown;
  marginSummary?: SalesOrderMarginSummaryPayload;
  Customer?: { companyName?: string; tradeName?: string };
  Proposal?: { number: number; externalProposalCode?: string | null; title?: string | null };
};

function SummaryField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

export function SalesOrderQuickSummaryDrawer({
  open,
  row,
  showMarginEconomics = true,
  onClose,
  onOpenDetail,
}: {
  open: boolean;
  row: SalesOrderListRowSnapshot | null;
  showMarginEconomics?: boolean;
  onClose: () => void;
  onOpenDetail: (orderId: string) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [intel, setIntel] = React.useState<SalesOrderIntelligencePayload | null>(null);

  useEffect(() => {
    if (!open || !row) {
      setIntel(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    void fetchJsonOk<SalesOrderIntelligencePayload>(getSalesOrderIntelligenceApiPath(row.id), {
      signal: ac.signal,
    })
      .then((payload) => {
        if (!ac.signal.aborted) setIntel(payload);
      })
      .catch((e) => {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        setError("Não foi possível carregar o resumo operacional.");
        setIntel(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, row?.id]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !row) return null;

  const customerName = resolveSalesOrderListCustomerName({
    companyName: row.Customer?.companyName,
    tradeName: row.Customer?.tradeName,
  });
  const customerMeta = buildSalesOrderListCustomerMeta({
    proposalNumber: row.Proposal?.number,
    externalProposalCode: row.Proposal?.externalProposalCode,
  });
  const netValue = formatSalesOrderListNetValue(row.totalNetValue);
  const items = formatSalesOrderListItemsCount(row.totalItems);
  const margin = row.marginSummary;
  const marginAlerts = buildSalesOrderMarginAlerts(margin);
  const invoices = intel?.invoices ?? [];
  const logisticLabel = intel?.logisticStatus?.label;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/40"
      data-testid="sales-order-quick-summary-drawer"
      role="dialog"
      aria-modal="true"
      aria-label="Resumo rápido do pedido"
      onClick={onClose}
    >
      <div
        className="flex h-[min(88vh,720px)] sm:h-full w-full sm:max-w-md flex-col bg-background shadow-xl rounded-t-2xl sm:rounded-none border-l border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="min-w-0 pr-3">
            <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Resumo rápido
            </p>
            <h2 className="text-base font-bold truncate">
              Pedido {formatSalesOrderDisplayCode(row.orderCode)}
            </h2>
            <p className="text-sm text-muted-foreground truncate" title={customerName}>
              {customerName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-accent text-muted-foreground"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <SummaryField
              label="Situação"
              value={
                <span className="so-status-badge inline-flex">
                  {SALES_ORDER_LIST_STATUS_LABELS[row.status] ?? row.status ?? "—"}
                </span>
              }
            />
            <SummaryField label="Emissão" value={formatSalesOrderListIssueDate(row.issueDate)} />
          </div>

          <section>
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Comercial
            </h3>
            <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-card p-3">
              <SummaryField label="Valor líquido" value={netValue.display} />
              <SummaryField label="Itens" value={items.display} />
              <SummaryField label="Responsável" value={row.responsible?.trim() || "Sem responsável"} />
              <SummaryField
                label="Proposta"
                value={
                  row.Proposal?.number != null ? `#${row.Proposal.number}` : "Sem proposta"
                }
              />
            </div>
            {customerMeta ? (
              <p className="mt-2 text-xs text-muted-foreground">{customerMeta}</p>
            ) : null}
            {row.customerId ? (
              <Link
                to={buildCustomerIntelligencePath(row.customerId)}
                className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                Ver inteligência do cliente
              </Link>
            ) : null}
          </section>

          {showMarginEconomics ? (
          <section data-testid="sales-order-quick-summary-margin">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Margem
            </h3>
            {margin ? (
              <div className="rounded-xl border border-border bg-card p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3">
                  <SummaryField
                    label="Receita líquida"
                    value={formatSalesOrderMarginMoney(margin.netRevenue)}
                  />
                  <SummaryField
                    label="Custo estimado"
                    value={formatSalesOrderMarginMoney(margin.totalCost)}
                  />
                  <SummaryField
                    label="Margem R$"
                    value={formatSalesOrderMarginMoney(margin.marginValue)}
                  />
                  <SummaryField
                    label="Margem %"
                    value={formatSalesOrderMarginPercent(margin.marginPercent)}
                  />
                </div>
                <SalesOrderMarginStatusBadge
                  label={margin.statusLabel}
                  status={margin.status}
                />
                <p className="text-[11px] text-muted-foreground">
                  {resolveSalesOrderMarginSupportText(margin)}
                </p>
                {marginAlerts.length > 0 ? (
                  <ul className="space-y-1 text-[11px] text-amber-900 dark:text-amber-200">
                    {marginAlerts.map((alert) => (
                      <li key={alert}>• {alert}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Margem não calculada</p>
            )}
          </section>
          ) : null}

          <section data-testid="sales-order-quick-summary-operations">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">
              Operação
            </h3>
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando NF e prazos…
              </div>
            ) : error ? (
              <p className="text-sm text-muted-foreground">{error}</p>
            ) : intel ? (
              <div className="rounded-xl border border-border bg-card p-3 space-y-2 text-sm">
                <SummaryField
                  label="NF vinculada"
                  value={
                    invoices.length > 0
                      ? invoices
                          .slice(0, 3)
                          .map((inv) => inv.number ?? inv.accessKey ?? "NF")
                          .join(", ")
                      : "Sem NF"
                  }
                />
                <SummaryField
                  label="Status logístico"
                  value={logisticLabel ?? intel.lifecycle.executiveStatusLabel ?? "—"}
                />
                <SummaryField
                  label="Entrega prevista"
                  value={formatSalesOrderDate(intel.order.expectedDeliveryDate ?? null)}
                />
                <SummaryField
                  label="Prazo"
                  value={formatDeadlineBadge(
                    intel.lifecycle.deadlineStatus,
                    intel.lifecycle.daysOverdue,
                    intel.lifecycle.operationalStatus
                  )}
                />
                {intel.lifecycle.daysOverdue != null && intel.lifecycle.daysOverdue > 0 ? (
                  <SummaryField
                    label="Atraso"
                    value={`${intel.lifecycle.daysOverdue} dia(s)`}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Sem dados operacionais.</p>
            )}
          </section>
        </div>

        <div className="border-t border-border px-4 py-3 flex flex-wrap gap-2 shrink-0">
          <button
            type="button"
            className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            data-testid="sales-order-open-detail"
            onClick={() => onOpenDetail(row.id)}
          >
            Abrir detalhe completo
          </button>
          <button
            type="button"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
            data-testid="sales-order-open-items"
            onClick={() => onOpenDetail(row.id)}
          >
            Ver itens
          </button>
          <button
            type="button"
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
            onClick={onClose}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
