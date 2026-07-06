import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { formatPrintDate, mergePrintBranding } from "@/src/lib/printBranding";
import { usePrintRouteBodyClass, triggerBrowserPrint } from "@/src/lib/usePrintDocument";
import {
  SalesOrderClientDocument,
  type SalesOrderClientDocumentOrder,
} from "@/src/components/sales/SalesOrderClientDocument";
import "@/src/sales-order-print.css";

const ROUTE_BODY_CLASS = "sales-order-print-route";

export function SalesOrderPrintView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<SalesOrderClientDocumentOrder | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);

  useEffect(() => {
    if (!order) return;
    document.title = `Pedido ${order.orderCode}`;
  }, [order]);

  const handlePrint = useCallback(() => {
    if (!order) return;
    triggerBrowserPrint();
  }, [order]);

  useEffect(() => {
    if (!id) {
      setError("Pedido inválido.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOrder(null);

    const run = async () => {
      try {
        const [row, brandRes] = await Promise.all([
          fetchJsonOk<SalesOrderClientDocumentOrder>(`/api/sales-orders/${id}`),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        if (!row) {
          setError("Pedido não encontrado.");
          return;
        }
        setOrder(row);
        setBranding(mergePrintBranding(brandRes, DEFAULT_BRANDING));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o pedido.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const issuedAt = useMemo(
    () => (order ? formatPrintDate(order.issueDate) : "—"),
    [order]
  );

  return (
    <div className="sales-order-print-route-page sales-order-print-page proposal-print-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <div className="proposal-print-no-print print-no-print mx-auto mb-4 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/sales-orders")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={!order || !!error}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>

      <div className="proposal-print-scroll mx-auto w-full max-w-[1180px] overflow-x-hidden print:overflow-visible">
        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando pedido…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !order ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Pedido não localizado.
          </div>
        ) : (
          <SalesOrderClientDocument order={order} branding={branding} issuedAt={issuedAt} />
        )}
      </div>
    </div>
  );
}
