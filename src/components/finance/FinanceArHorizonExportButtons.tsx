import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildFinanceArHorizonExportQueryString,
  type FinanceArHorizonExportPayload,
} from "@/src/lib/financeAccountsReceivableHorizonExport";
import {
  buildFinanceArHorizonExportFilename,
  sanitizeArHorizonExportSlug,
} from "@/src/lib/financeAccountsReceivableHorizonExportXlsx";
import { FinanceArHorizonPrintDocument } from "@/src/components/finance/FinanceArHorizonPrintDocument";
import "./finance-ar-horizon-print.css";

type Props = {
  agingBucket?: string;
  bucketLabel?: string;
  scope?: "bucket" | "full";
  disabled?: boolean;
  testIdPrefix?: string;
  excelLabel?: string;
  pdfLabel?: string;
  search?: string;
  customerId?: number;
  customerName?: string;
};

export function FinanceArHorizonExportButtons({
  agingBucket,
  bucketLabel = "faixa",
  scope = "bucket",
  disabled = false,
  testIdPrefix = "finance-ar-horizon",
  excelLabel = "Exportar Excel",
  pdfLabel = "Exportar PDF",
  search,
  customerId,
  customerName,
}: Props) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printPayload, setPrintPayload] = useState<FinanceArHorizonExportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportQuery = buildFinanceArHorizonExportQueryString({
    agingBucket,
    scope,
    search,
    customerId,
    customerName,
  });

  const handleExportExcel = async () => {
    if (exportingExcel || exportingPdf || disabled) return;
    setExportingExcel(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/finance/accounts-receivable/horizon/export.xlsx?${exportQuery}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível exportar o Excel.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildFinanceArHorizonExportFilename(
        scope === "full" ? "Todas as faixas" : bucketLabel
      );
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar o Excel.");
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (exportingExcel || exportingPdf || disabled) return;
    setExportingPdf(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<FinanceArHorizonExportPayload>(
        `/api/finance/accounts-receivable/horizon/export-data?${exportQuery}`,
        { credentials: "include" }
      );
      setPrintPayload(payload);
      document.body.classList.add("ar-horizon-print-route");
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              window.print();
              resolve();
            }, 200);
          });
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar o PDF.");
    } finally {
      document.body.classList.remove("ar-horizon-print-route");
      setExportingPdf(false);
      setPrintPayload(null);
    }
  };

  const busy = exportingExcel || exportingPdf;

  return (
    <>
      {printPayload
        ? createPortal(<FinanceArHorizonPrintDocument payload={printPayload} />, document.body)
        : null}
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid={`${testIdPrefix}-export-excel`}
            disabled={disabled || busy}
            onClick={() => void handleExportExcel()}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
            title={`${excelLabel} (${sanitizeArHorizonExportSlug(bucketLabel)})`}
          >
            {exportingExcel ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            {excelLabel}
          </button>
          <button
            type="button"
            data-testid={`${testIdPrefix}-export-pdf`}
            disabled={disabled || busy}
            onClick={() => void handleExportPdf()}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
          >
            {exportingPdf ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            {pdfLabel}
          </button>
        </div>
        {error ? <p className="text-[10px] text-destructive max-w-xs text-right">{error}</p> : null}
      </div>
    </>
  );
}
