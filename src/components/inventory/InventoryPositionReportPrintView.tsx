import React, { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

/** Largura × altura. `A4 landscape` perde para um `@page { size: A4 }` posterior. */
const LANDSCAPE_PAGE_STYLE = [
  "@page inventory-position-sheet { size: 297mm 210mm; margin: 10mm 8mm 12mm; }",
  "@page { size: 297mm 210mm; margin: 10mm 8mm 12mm; }",
  "html, body.inventory-position-report-route { page: inventory-position-sheet; }",
].join("\n");

/** A4 retrato. A medida em milímetros evita o diálogo cair na paisagem do outro relatório. */
const PORTRAIT_PAGE_STYLE = [
  "@page inventory-position-qty-sheet { size: 210mm 297mm; margin: 12mm 10mm 14mm; }",
  "@page { size: 210mm 297mm; margin: 12mm 10mm 14mm; }",
  "html, body.inventory-position-report-route { page: inventory-position-qty-sheet; }",
].join("\n");

function pinPageStyle(quantityOnly: boolean): HTMLStyleElement {
  const existing = document.head.querySelector<HTMLStyleElement>(
    "style[data-inventory-position-report-page]"
  );
  const style = existing ?? document.createElement("style");
  style.setAttribute("data-inventory-position-report-page", "1");
  style.textContent = quantityOnly ? PORTRAIT_PAGE_STYLE : LANDSCAPE_PAGE_STYLE;
  document.head.appendChild(style);
  return style;
}

export function InventoryPositionReportPrintView() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<InventoryPositionReport | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const quantityOnly = searchParams.get("modo") === "quantidade";

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);

  useEffect(() => {
    if (!quantityOnly) return;
    document.body.classList.add("inventory-position-report-portrait");
    return () => {
      document.body.classList.remove("inventory-position-report-portrait");
    };
  }, [quantityOnly]);

  useEffect(() => {
    const style = pinPageStyle(quantityOnly);
    const onBeforePrint = () => {
      pinPageStyle(quantityOnly);
    };
    window.addEventListener("beforeprint", onBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", onBeforePrint);
      style.remove();
    };
  }, [quantityOnly]);

  useEffect(() => {
    document.title = report
      ? `Posição de estoque${quantityOnly ? " — quantidades" : ""} — ${formatPrintDateTime(report.generatedAt)}`
      : "Posição de estoque";
  }, [quantityOnly, report]);

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
    pinPageStyle(quantityOnly);
    triggerBrowserPrint();
  }, [quantityOnly, report]);

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
          {quantityOnly ? "Imprimir quantidades" : "Imprimir / PDF"}
        </button>
      </div>
      <div
        className={
          quantityOnly
            ? "inventory-position-report-sheet mx-auto max-w-[210mm] bg-white p-6 shadow-sm"
            : "inventory-position-report-sheet mx-auto max-w-[297mm] bg-white p-6 shadow-sm"
        }
      >
        <InventoryPositionReportPrintDocument
          report={report}
          branding={branding}
          quantityOnly={quantityOnly}
        />
      </div>
    </div>
  );
}
