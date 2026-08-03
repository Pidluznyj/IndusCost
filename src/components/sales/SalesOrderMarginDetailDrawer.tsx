import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import { fetchJsonOk, HttpError } from "@/src/lib/http";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import { SalesOrderMarginAnalysisSection } from "@/src/components/sales/SalesOrderMarginAnalysis";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import {
  canViewSalesOrderMarginEconomics,
  formatSalesOrderDisplayCode,
  formatSalesOrderListIssueDate,
  SALES_ORDER_LIST_STATUS_LABELS,
} from "@/src/lib/salesOrderListUi";
import { resolveSalesOrderListSellerLabel } from "@/src/lib/salesOrderListSellerUi";
import type { SalesOrderItemMarginPayload, SalesOrderMarginSummaryPayload } from "@/src/lib/salesOrderMarginTypes";
import { cn } from "@/src/lib/utils";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";

/** Contexto do registro de comissão — apenas exibição; não recalcula comissão. */
export type SalesOrderMarginDetailCommissionContext = {
  orderCode: string | null;
  customerName: string | null;
  sellerName: string | null;
  nfeNumber: string | null;
  receivableNumber: string | null;
  nomusReceivableId: number | null;
  settlementDate: string | null;
  receivedAmount: number;
  /** null = percentual não auditável (nunca exibir como 0% — ver commissionReportOfficialReconcile.ts). */
  ratePercent: number | null;
  finalCommissionAmount: number;
  commissionableBaseAmount: number;
  lineStatus: string;
};

type SalesOrderDetailPayload = {
  id: string;
  orderCode: string;
  status: string;
  issueDate: string;
  responsible: string | null;
  seller?: {
    externalSellerId: number | null;
    name: string | null;
    resolutionStatus: string;
  } | null;
  totalItems: number;
  totalNetValue: unknown;
  Customer?: { companyName?: string; tradeName?: string };
  marginSummary?: SalesOrderMarginSummaryPayload;
  items: Array<{
    id: string;
    skuSnapshot: string;
    productNameSnapshot: string;
    quantity: unknown;
    unit: string | null;
    negotiatedPrice: unknown;
    totalNetValue: unknown;
    margin?: SalesOrderItemMarginPayload;
  }>;
};

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-foreground">{value}</p>
    </div>
  );
}

function formatDateBr(iso: string | null): string {
  if (!iso) return "Não disponível";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Não disponível";
  return d.toLocaleDateString("pt-BR");
}

function crLabel(ctx: SalesOrderMarginDetailCommissionContext): string {
  if (ctx.receivableNumber?.trim()) return ctx.receivableNumber;
  if (ctx.nomusReceivableId != null) return String(ctx.nomusReceivableId);
  return "Não disponível";
}

export function SalesOrderMarginDetailDrawer({
  open,
  salesOrderId,
  orderCodeFallback,
  commissionContext,
  onClose,
}: {
  open: boolean;
  salesOrderId: string | null;
  orderCodeFallback?: string | null;
  commissionContext?: SalesOrderMarginDetailCommissionContext | null;
  onClose: () => void;
}) {
  const portalContainer = usePortalContainer();
  const auth = useAuth();
  const showMargin = canViewSalesOrderMarginEconomics(auth);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<SalesOrderDetailPayload | null>(null);

  const displayCode = formatSalesOrderDisplayCode(
    order?.orderCode ?? commissionContext?.orderCode ?? orderCodeFallback
  );

  useEffect(() => {
    if (!open) {
      setOrder(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!salesOrderId) {
      setOrder(null);
      setError("Não foi possível carregar o detalhe do pedido.");
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setOrder(null);

    void fetchJsonOk<SalesOrderDetailPayload>(`/api/sales-orders/${salesOrderId}`, {
      signal: ac.signal,
      credentials: "include",
    })
      .then((payload) => {
        if (!ac.signal.aborted) setOrder(payload);
      })
      .catch((e: unknown) => {
        if (ac.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
        if (e instanceof HttpError && e.status === 404) {
          setError("Pedido de venda não encontrado.");
        } else {
          setError("Não foi possível carregar o detalhe do pedido.");
        }
        setOrder(null);
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });

    return () => ac.abort();
  }, [open, salesOrderId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !portalContainer) return null;

  const customerName =
    order?.Customer?.tradeName ||
    order?.Customer?.companyName ||
    commissionContext?.customerName ||
    "Não disponível";
  const sellerName = order
    ? resolveSalesOrderListSellerLabel(order)
    : commissionContext?.sellerName ?? "Não disponível";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalhe do pedido ${displayCode}`}
      data-testid="sales-order-margin-detail-drawer"
      onClick={onClose}
    >
      <div
        className={cn(financeBiCardClass, "flex h-full w-full max-w-3xl flex-col shadow-xl")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">Detalhe do pedido {displayCode}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {customerName}
              {" · "}
              {sellerName}
              {order?.issueDate ? ` · emissão ${formatSalesOrderListIssueDate(order.issueDate)}` : null}
              {commissionContext?.nfeNumber ? ` · NF-e ${commissionContext.nfeNumber}` : null}
              {commissionContext ? ` · CR ${crLabel(commissionContext)}` : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-muted"
            aria-label="Fechar"
            data-testid="sales-order-margin-detail-close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm">Carregando detalhe do pedido…</p>
            </div>
          ) : null}

          {!loading && error ? (
            <div
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950"
              data-testid="sales-order-margin-detail-error"
            >
              {error}
            </div>
          ) : null}

          {!loading && order ? (
            <>
              <section className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                <Field label="Pedido" value={formatSalesOrderDisplayCode(order.orderCode)} />
                <Field label="Cliente" value={customerName} />
                <Field label="Vendedor" value={sellerName} />
                <Field
                  label="Data de emissão"
                  value={formatSalesOrderListIssueDate(order.issueDate)}
                />
                <Field
                  label="Status"
                  value={SALES_ORDER_LIST_STATUS_LABELS[order.status] ?? order.status}
                />
                <Field
                  label="NF-e vinculada"
                  value={commissionContext?.nfeNumber?.trim() || "Não disponível"}
                />
                <Field
                  label="CR / título"
                  value={commissionContext ? crLabel(commissionContext) : "Não disponível"}
                />
                <Field
                  label="Data de recebimento"
                  value={formatDateBr(commissionContext?.settlementDate ?? null)}
                />
                <Field
                  label="Valor recebido"
                  value={
                    commissionContext
                      ? formatFinanceCurrency(commissionContext.receivedAmount)
                      : "Não disponível"
                  }
                />
                <Field
                  label="Comissão do registro"
                  value={
                    commissionContext
                      ? `${formatFinanceCurrency(commissionContext.finalCommissionAmount)} (${
                          commissionContext.ratePercent == null
                            ? "% indisponível"
                            : `${commissionContext.ratePercent.toFixed(2)}%`
                        })`
                      : "Não disponível"
                  }
                />
                <Field
                  label="Base comissionável"
                  value={
                    commissionContext
                      ? formatFinanceCurrency(commissionContext.commissionableBaseAmount)
                      : "Não disponível"
                  }
                />
              </section>

              {showMargin ? (
                <SalesOrderMarginAnalysisSection
                  summary={order.marginSummary}
                  items={order.items ?? []}
                  orderIssueDate={order.issueDate}
                />
              ) : (
                <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
                  Margem econômica não disponível para o seu perfil. Os dados comerciais do pedido
                  permanecem acima; use “Abrir pedido completo” se tiver permissão.
                </div>
              )}

              {showMargin && order.marginSummary?.hasMissingCost ? (
                <p
                  className="text-xs text-amber-800"
                  data-testid="sales-order-margin-detail-pending-cost"
                >
                  Alguns itens estão com custo pendente ou não disponível — a margem pode ficar
                  incompleta.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3">
          <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={onClose}>
            Fechar
          </button>
          {salesOrderId ? (
            <Link
              to={`/sales-orders/${salesOrderId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm font-semibold text-primary"
              data-testid="sales-order-margin-detail-open-full"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Abrir pedido completo
            </Link>
          ) : null}
        </div>
      </div>
    </div>,
    portalContainer
  );
}
