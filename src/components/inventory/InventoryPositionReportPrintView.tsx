import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { InventoryPositionReportPrintDocument } from "@/src/components/inventory/InventoryPositionReportPrintDocument";
import { fetchJsonOk } from "@/src/lib/http";
import { formatPrintDateTime, mergePrintBranding } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import type { InventoryPositionReport } from "@/src/lib/inventory/inventoryPositionReport";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import "@/src/components/print/print-document.css";
import "@/src/components/inventory/inventory-position-report-print.css";

const ROUTE_BODY_CLASS = "inventory-position-report-route";

export function InventoryPositionReportPrintView() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<InventoryPositionReport | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-inventory-position-report-page", "1");
    style.textContent = "@page { size: A4 landscape; margin: 8mm; }";
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  useEffect(() => {
    document.title = report
      ? `Posição de estoque — ${formatPrintDateTime(report.generatedAt)}`
      : "Posição de estoque";
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const [payload, brandRes] = await Promise.all([
          fetchJsonOk<InventoryPositionReport>("/api/inventory/position-report"),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        setReport(payload);
        setBranding(mergePrintBranding(brandRes, DEFAULT_BRANDING));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar a posição de estoque.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePrint = useCallback(() => {
    if (!report) return;
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
        <Link to="/inventory" className="text-slate-900 underline">
          Voltar ao estoque
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="print-no-print sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Link to="/inventory" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" />
          Estoque
        </Link>
        <button
          type="button"
          onClick={handlePrint}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
        >
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
      </div>
      <div className="inventory-position-report-sheet mx-auto max-w-[297mm] bg-white p-6 shadow-sm">
        <InventoryPositionReportPrintDocument report={report} branding={branding} />
      </div>
    </div>
  );
}
