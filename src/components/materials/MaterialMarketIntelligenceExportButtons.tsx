import React, { useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import {
  buildMaterialMarketIntelligenceExportQueryString,
  MATERIALS_MARKET_INTELLIGENCE_EXPORT_API,
  type MaterialMarketIntelligenceExportAppliedFilters,
  type MaterialMarketIntelligenceExportFormat,
  type MaterialMarketIntelligenceExportScope,
} from "@/src/lib/materialMarketIntelligenceExport";
import type { MaterialMarketSimulationResponse } from "@/src/lib/materialMarketSimulation";
import { cn } from "@/src/lib/utils";

type Props = {
  scope: MaterialMarketIntelligenceExportScope;
  filters?: MaterialMarketIntelligenceExportAppliedFilters;
  /** Último resultado de simulação (efêmero) — enviado via POST. */
  simulationResult?: MaterialMarketSimulationResponse | null;
  formats?: MaterialMarketIntelligenceExportFormat[];
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  labelPrefix?: string;
};

const FORMAT_LABELS: Record<MaterialMarketIntelligenceExportFormat, string> = {
  xlsx: "Excel",
  csv: "CSV",
  pdf: "PDF",
};

async function downloadExport(input: {
  scope: MaterialMarketIntelligenceExportScope;
  format: MaterialMarketIntelligenceExportFormat;
  filters?: MaterialMarketIntelligenceExportAppliedFilters;
  simulationResult?: MaterialMarketSimulationResponse | null;
}): Promise<void> {
  const qs = buildMaterialMarketIntelligenceExportQueryString({
    scope: input.scope,
    format: input.format,
    filters: input.filters,
  });
  const url = `${MATERIALS_MARKET_INTELLIGENCE_EXPORT_API}?${qs}`;

  const usePost = input.scope === "simulations";
  const res = await fetch(url, {
    method: usePost ? "POST" : "GET",
    credentials: "include",
    headers: usePost ? { "Content-Type": "application/json" } : undefined,
    body: usePost
      ? JSON.stringify({ simulationResult: input.simulationResult ?? null })
      : undefined,
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Não foi possível exportar.");
  }

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  a.download = match?.[1] ?? `inteligencia-mercado-${input.scope}.${input.format}`;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export function MaterialMarketIntelligenceExportButtons({
  scope,
  filters,
  simulationResult = null,
  formats = ["xlsx", "csv", "pdf"],
  disabled = false,
  className,
  size = "sm",
  labelPrefix = "Exportar",
}: Props) {
  const [busyFormat, setBusyFormat] = useState<MaterialMarketIntelligenceExportFormat | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: MaterialMarketIntelligenceExportFormat) => {
    if (disabled || busyFormat) return;
    setBusyFormat(format);
    setError(null);
    try {
      await downloadExport({ scope, format, filters, simulationResult });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar.");
    } finally {
      setBusyFormat(null);
    }
  };

  const btnClass =
    size === "sm"
      ? "inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-accent/40 disabled:opacity-60"
      : "inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:bg-accent/40 disabled:opacity-60";

  return (
    <div
      className={cn("flex flex-col items-end gap-1", className)}
      data-testid={`mi-export-buttons-${scope}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {formats.map((format) => (
          <button
            key={format}
            type="button"
            data-testid={`mi-export-${scope}-${format}`}
            disabled={disabled || busyFormat != null}
            onClick={() => void handleExport(format)}
            className={btnClass}
            title={`${labelPrefix} ${FORMAT_LABELS[format]}`}
          >
            {busyFormat === format ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : format === "pdf" ? (
              <FileText className="h-3.5 w-3.5" />
            ) : format === "csv" ? (
              <Download className="h-3.5 w-3.5" />
            ) : (
              <FileSpreadsheet className="h-3.5 w-3.5" />
            )}
            {labelPrefix} {FORMAT_LABELS[format]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="max-w-xs text-right text-[10px] text-destructive" data-testid="mi-export-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
