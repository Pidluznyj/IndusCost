import "./sales-order-detail-print.css";

import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Loader2, Printer, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { triggerBrowserPrint } from "@/src/lib/usePrintDocument";
import { useAuth } from "@/src/contexts/AuthContext";
import {
  getSalesOrderDetailUrl,
  type SalesOrderDetailPayload,
  type SalesOrderDetailResponse,
} from "@/src/lib/sales-orders/salesOrderDetailClient";
import { canViewSalesOrderFiscalTaxes } from "@/src/lib/sales-orders/salesOrderFiscalTaxesPermissions";
import { SalesOrderDetailView } from "./SalesOrderDetailView";
import { SalesOrderTributosTab } from "./SalesOrderTributosTab";

const DETAIL_PRINT_BODY_CLASS = "sales-order-detail-print-route";

type Props = {
  open: boolean;
  salesOrderId: string | null;
  orderCode?: string | null;
  onClose: () => void;
  onOpenFullAudit?: (salesOrderId: string, orderCode: string | null) => void;
};

const AUDIT_360_ENABLED = true;

type DetailTabId = "geral" | "tributos";

/**
 * Modal grande (quase fullscreen) para o Detalhe do Pedido de Venda.
 * Renderiza o componente compartilhado `SalesOrderDetailView` com o payload
 * oficial (mesmo consumido pelo PDF/impressão) e a aba executiva Tributos.
 *
 * Filtros da tela Comercial > Pedidos de venda são preservados: o modal é
 * portalizado no `document.body`, não altera a rota nem desmonta a lista.
 */
export function SalesOrderDetailDialog({
  open,
  salesOrderId,
  orderCode,
  onClose,
  onOpenFullAudit,
}: Props): JSX.Element | null {
  const auth = useAuth();
  const canTributos = canViewSalesOrderFiscalTaxes(auth);
  const [payload, setPayload] = useState<SalesOrderDetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<DetailTabId>("geral");

  useEffect(() => {
    if (!open || !salesOrderId) {
      setPayload(null);
      setError(null);
      setActiveTab("geral");
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setActiveTab("geral");
    fetchJsonOk<SalesOrderDetailResponse>(getSalesOrderDetailUrl(salesOrderId), {
      signal: ac.signal,
    })
      .then((data) => {
        if (ac.signal.aborted) return;
        if (!("ok" in data) || data.ok !== true) {
          setPayload(null);
          setError(
            (data as { error?: string }).error ??
              "Erro ao carregar detalhe do pedido."
          );
          return;
        }
        setPayload(data);
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setPayload(null);
        setError(
          e instanceof Error ? e.message : "Erro ao carregar detalhe do pedido."
        );
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [open, salesOrderId]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const handleCopyOrderCode = useCallback(async () => {
    const code = payload?.orderCode ?? orderCode ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível */
    }
  }, [payload?.orderCode, orderCode]);

  const handlePrint = useCallback(() => {
    if (!payload) return;
    document.body.classList.add(DETAIL_PRINT_BODY_CLASS);
    let fallbackTimer: number | null = null;
    const cleanup = () => {
      document.body.classList.remove(DETAIL_PRINT_BODY_CLASS);
      window.removeEventListener("afterprint", cleanup);
      if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
    };
    window.addEventListener("afterprint", cleanup);
    // Fallback se afterprint não disparar (alguns WebViews).
    fallbackTimer = window.setTimeout(cleanup, 60_000);
    triggerBrowserPrint(120);
  }, [payload]);

  const handleOpenAudit = useCallback(() => {
    if (!payload) return;
    onOpenFullAudit?.(payload.salesOrderId, payload.orderCode);
  }, [onOpenFullAudit, payload]);

  const searchRef = payload?.orderCode ?? orderCode ?? "";

  if (!open) return null;

  return createPortal(
    <div
      className="so-detail-dialog-shell fixed inset-0 z-[70] flex items-stretch justify-center bg-black/40 p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Detalhe do Pedido de Venda"
      data-testid="sales-order-detail-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "so-detail-dialog-panel flex w-full max-w-[1400px] max-h-[95vh] flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl",
          "sm:max-h-[92vh]"
        )}
      >
        {/* Header fixo — oculto na impressão */}
        <header className="so-detail-no-print print-no-print flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E7EB] bg-white px-4 py-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#1e3a8a]">
              Comercial · Pedidos de Venda
            </p>
            <h1 className="text-base font-bold text-[#0f172a]">
              Detalhe do Pedido — {payload?.orderCode ?? orderCode ?? "…"}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => void handleCopyOrderCode()}
              disabled={!searchRef}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
              data-testid="sales-order-detail-copy-code"
              title="Copiar número do pedido"
            >
              <Copy className="h-3 w-3" />
              {copied ? "Copiado" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={!payload || activeTab !== "geral"}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
              data-testid="sales-order-detail-print"
              title="Imprimir / Gerar PDF"
            >
              <Printer className="h-3 w-3" />
              Imprimir / PDF
            </button>
            {AUDIT_360_ENABLED && onOpenFullAudit ? (
              <button
                type="button"
                onClick={handleOpenAudit}
                disabled={!payload}
                className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                data-testid="sales-order-detail-open-audit"
                title="Abrir Auditoria 360º do pedido"
              >
                <ExternalLink className="h-3 w-3" />
                Auditoria 360º
              </button>
            ) : null}
            {searchRef ? (
              <a
                href={`/finance/accounts-receivable?search=${encodeURIComponent(searchRef)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                title="Abrir no Contas a Receber"
                data-testid="sales-order-detail-open-cr"
              >
                <ExternalLink className="h-3 w-3" />
                CR
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
              data-testid="sales-order-detail-close"
              aria-label="Fechar detalhe"
              title="Fechar (Esc)"
            >
              <X className="h-3 w-3" />
              Fechar
            </button>
          </div>
        </header>

        {/* Abas Gerais / Tributos */}
        <nav
          className="so-detail-no-print print-no-print flex flex-wrap items-center gap-1 border-b border-[#E5E7EB] bg-[#F9FAFB] px-4 py-2"
          role="tablist"
          data-testid="sales-order-detail-tabs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "geral"}
            onClick={() => setActiveTab("geral")}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
              activeTab === "geral"
                ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563] hover:bg-[#F3F4F6]"
            )}
            data-testid="sales-order-detail-tab-geral"
          >
            Geral
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "tributos"}
            onClick={() => setActiveTab("tributos")}
            className={cn(
              "rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors",
              activeTab === "tributos"
                ? "bg-white text-[#111827] shadow-sm ring-1 ring-[#E5E7EB]"
                : "text-[#4B5563] hover:bg-[#F3F4F6]"
            )}
            data-testid="sales-order-detail-tab-tributos"
          >
            Tributos
          </button>
        </nav>

        {/* Body com scroll interno — conteúdo liberado no @media print */}
        <div className="so-detail-dialog-body flex-1 overflow-y-auto bg-[#f8fafc] px-4 py-4">
          {loading ? (
            <div
              className="so-detail-no-print flex items-center justify-center py-12 text-[#6b7280]"
              data-testid="sales-order-detail-loading"
            >
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Carregando detalhe do pedido…
            </div>
          ) : error ? (
            <div
              className="so-detail-no-print rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              data-testid="sales-order-detail-error"
            >
              {error}
            </div>
          ) : payload ? (
            activeTab === "geral" ? (
              <div id="sales-order-detail-print-root">
                <SalesOrderDetailView payload={payload} />
              </div>
            ) : (
              <SalesOrderTributosTab
                fiscalTaxes={payload.fiscalTaxes}
                denied={!canTributos || payload.fiscalTaxesAccess === "denied"}
                fiscalTaxesAccess={payload.fiscalTaxesAccess}
              />
            )
          ) : (
            <div className="so-detail-no-print text-[12px] text-[#6b7280]">
              Nenhum pedido selecionado.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
