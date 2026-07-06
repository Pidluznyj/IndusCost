import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Download, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  buildDailyRadarExportQueryString,
  type FinanceCashFlowDailyRadarExportPayload,
} from "@/src/lib/financeCashFlowDailyRadarExport";
import {
  buildFinanceCashFlowDailyRadarExportFilename,
  sanitizeDailyRadarExportSlug,
} from "@/src/lib/financeCashFlowDailyRadarExportXlsx";
import type { DailyRadarSelectionKey } from "@/src/lib/financeCashFlowDailyRadar";
import { FinanceCashFlowDailyRadarPrintDocument } from "@/src/components/finance/cash-flow/FinanceCashFlowDailyRadarPrintDocument";
import "./finance-cash-flow-daily-radar-print.css";

type Props = {
  rangeKey: DailyRadarSelectionKey;
  rangeLabel: string;
  baseDate?: string;
  customStartDate?: string;
  customEndDate?: string;
  selectedDate?: string | null;
  search?: string;
  payableSortBy?: string;
  payableSortDirection?: string;
  receivableSortBy?: string;
  receivableSortDirection?: string;
  disabled?: boolean;
};

export function FinanceCashFlowDailyRadarExportButtons({
  rangeKey,
  rangeLabel,
  baseDate,
  customStartDate,
  customEndDate,
  selectedDate,
  search,
  payableSortBy,
  payableSortDirection,
  receivableSortBy,
  receivableSortDirection,
  disabled = false,
}: Props) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printPayload, setPrintPayload] = useState<FinanceCashFlowDailyRadarExportPayload | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const exportQuery = buildDailyRadarExportQueryString({
    baseDate,
    range: rangeKey,
    customStartDate,
    customEndDate,
    day: selectedDate ?? undefined,
    search,
    payableSortBy,
    payableSortDirection,
    receivableSortBy,
    receivableSortDirection,
  });

  const handleExportExcel = async () => {
    if (exportingExcel || exportingPdf || disabled) return;
    setExportingExcel(true);
    setError(null);
    try {
      const res = await fetch(`/api/finance/cash-flow/daily-radar/export.xlsx?${exportQuery}`, {
        credentials: "include",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível exportar o Excel.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="([^"]+)"/);
      a.download =
        match?.[1] ??
        buildFinanceCashFlowDailyRadarExportFilename({
          level: selectedDate ? "day" : "range",
          rangeLabel,
          selectedDate: selectedDate ?? null,
        });
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
      const payload = await fetchJsonOk<FinanceCashFlowDailyRadarExportPayload>(
        `/api/finance/cash-flow/daily-radar/export-data?${exportQuery}`,
        { credentials: "include" }
      );
      setPrintPayload(payload);
      document.body.classList.add("cash-flow-daily-radar-print-route");
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
      document.body.classList.remove("cash-flow-daily-radar-print-route");
      setExportingPdf(false);
      setPrintPayload(null);
    }
  };

  const busy = exportingExcel || exportingPdf;

  return (
    <>
      {printPayload
        ? createPortal(
            <FinanceCashFlowDailyRadarPrintDocument payload={printPayload} />,
            document.body
          )
        : null}
      <div className="flex flex-col items-end gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="cash-flow-radar-export-excel"
            disabled={disabled || busy}
            onClick={() => void handleExportExcel()}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
            title={`Exportar Excel (${sanitizeDailyRadarExportSlug(rangeLabel)})`}
          >
            {exportingExcel ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            Exportar Excel
          </button>
          <button
            type="button"
            data-testid="cash-flow-radar-export-pdf"
            disabled={disabled || busy}
            onClick={() => void handleExportPdf()}
            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-[11px] font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-60"
          >
            {exportingPdf ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Printer className="h-3.5 w-3.5" />
            )}
            Exportar PDF
          </button>
        </div>
        {error ? <p className="text-[10px] text-destructive max-w-xs text-right">{error}</p> : null}
      </div>
    </>
  );
}
