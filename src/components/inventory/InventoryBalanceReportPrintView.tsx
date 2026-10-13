import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { InventoryBalanceReportPrintDocument } from "@/src/components/inventory/InventoryBalanceReportPrintDocument";
import { fetchJsonOk } from "@/src/lib/http";
import { formatPrintDateTime, mergePrintBranding } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import type { InventoryBalanceReport } from "@/src/lib/inventory/inventoryBalanceReport";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import "@/src/components/print/print-document.css";
import "@/src/components/inventory/inventory-position-report-print.css";

/** Mesmas classes de rota da posição de estoque: o CSS de impressão é compartilhado. */
const ROUTE_BODY_CLASS = "inventory-position-report-route";
const PORTRAIT_BODY_CLASS = "inventory-position-report-portrait";

/** A4 retrato em milímetros, recolocado no fim do <head> para vencer `@page` posteriores. */
const PORTRAIT_PAGE_STYLE = [
  "@page inventory-position-qty-sheet { size: 210mm 297mm; margin: 12mm 10mm 14mm; }",
  "@page { size: 210mm 297mm; margin: 12mm 10mm 14mm; }",
  "html, body.inventory-position-report-route { page: inventory-position-qty-sheet; }",
].join("\n");

function pinPageStyle(): HTMLStyleElement {
  const existing = document.head.querySelector<HTMLStyleElement>(
    "style[data-inventory-position-report-page]"
  );
  const style = existing ?? document.createElement("style");
  style.setAttribute("data-inventory-position-report-page", "1");
  style.textContent = PORTRAIT_PAGE_STYLE;
  document.head.appendChild(style);
  return style;
}

export function InventoryBalanceReportPrintView() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<InventoryBalanceReport | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const filterQuery = searchParams.toString();
  const backTo = `/inventory/balances${filterQuery ? `?${filterQuery}` : ""}`;

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);
  usePrintRouteBodyClass(PORTRAIT_BODY_CLASS);

  useEffect(() => {
    const style = pinPageStyle();
    const onBeforePrint = () => {
      pinPageStyle();
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      style.remove();
    };
  }, []);

  useEffect(() => {
    document.title = report
      ? `Saldos de estoque — ${formatPrintDateTime(report.generatedAt)}`
      : "Saldos de estoque";
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [payload, brandRes] = await Promise.all([
          fetchJsonOk<InventoryBalanceReport>(
            `/api/inventory/balances/report${filterQuery ? `?${filterQuery}` : ""}`
          ),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        setReport(payload);
        setBranding(mergePrintBranding(brandRes, DEFAULT_BRANDING));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório de saldos.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [filterQuery]);

  const handlePrint = useCallback(() => {
    if (!report) return;
    pinPageStyle();
    triggerBrowserPrint();
  }, [report]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-slate-600">
        <Loader2 className="h-4 w-4 animate-spin" />
        Montando o relatório…
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="mx-auto max-w-lg space-y-3 p-8 text-sm text-slate-700">
        <p>{error ?? "Relatório indisponível."}</p>
        <Link to={backTo} className="text-slate-900 underline">
          Voltar aos saldos
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="print-no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Saldos
        </Link>
        <button
          type="button"
          onClick={handlePrint}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
          data-testid="inventory-balance-report-print"
        >
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
      </div>
      <div className="inventory-position-report-sheet mx-auto max-w-[210mm] bg-white p-6 shadow-sm">
        <InventoryBalanceReportPrintDocument report={report} branding={branding} />
      </div>
    </div>
  );
}
