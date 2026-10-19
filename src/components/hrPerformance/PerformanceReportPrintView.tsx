/**
 * Rota /performance-cycle/relatorio — emite o documento (código único e versão no servidor)
 * e mostra a prévia A4. "Imprimir / Salvar PDF" usa a impressão do navegador, como os
 * demais documentos institucionais do IndusCost.
 */
import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { mergePrintBranding } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import { issuePerformanceReport, type ReportIssue } from "@/src/lib/hrPerformance/performanceClient";
import { PerformanceReportDocument, REPORT_TITLES } from "./PerformanceReportDocument";
import "./performance-print.css";

const issued = new Map<string, Promise<{ issue: ReportIssue; data: unknown }>>();

/** Evita emitir duas vezes o mesmo documento quando o React monta o efeito em dobro (modo dev). */
function issueOnce(key: string, input: { cycleId: string; kind: string; participantId: string | null }) {
  const existing = issued.get(key);
  if (existing) return existing;
  const promise = issuePerformanceReport(input);
  issued.set(key, promise);
  promise.catch(() => issued.delete(key));
  return promise;
}

export function PerformanceReportPrintView() {
  const [params] = useSearchParams();
  const cycleId = params.get("cycleId") ?? "";
  const kind = params.get("kind") ?? "consolidado";
  const participantId = params.get("participantId");
  const [state, setState] = useState<{ issue: ReportIssue; data: any } | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);

  usePrintRouteBodyClass("perf-print-route");

  useEffect(() => {
    let cancelled = false;
    const key = `${window.location.search}|${performance.timeOrigin}`;
    Promise.all([issueOnce(key, { cycleId, kind, participantId }), fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING)])
      .then(([result, brand]) => {
        if (cancelled) return;
        setState(result as { issue: ReportIssue; data: any });
        setBranding(mergePrintBranding(brand, DEFAULT_BRANDING));
        document.title = `${REPORT_TITLES[kind] ?? "Documento"} ${result.issue.code}`;
      })
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : "Não foi possível emitir o documento."));
    return () => {
      cancelled = true;
    };
  }, [cycleId, kind, participantId]);

  useEffect(() => {
    if (!state) return;
    const style = document.createElement("style");
    style.setAttribute("data-perf-page", "true");
    const code = state.issue.code.replace(/"/g, "");
    style.textContent = `@page { size: A4 portrait; margin: 12mm 10mm 14mm; @bottom-left { content: "${code} · v${state.issue.version} · uso restrito RH"; font-size: 7pt; color: #64748b; } @bottom-right { content: "Página " counter(page) " de " counter(pages); font-size: 7pt; color: #64748b; } }`;
    document.head.appendChild(style);
    return () => style.remove();
  }, [state]);

  return (
    <div className="perf-print-page min-h-screen bg-slate-100 px-4 py-4 print:bg-white print:p-0">
      <div className="print-no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Link to="/performance-cycle" className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Voltar para Desempenho
        </Link>
        {state ? <span className="text-xs text-slate-600">Documento {state.issue.code} · versão {state.issue.version} registrado</span> : null}
        <button
          type="button"
          onClick={() => triggerBrowserPrint()}
          disabled={!state}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
          data-testid="perf-print-button"
        >
          <Printer className="h-4 w-4" aria-hidden /> Imprimir / Salvar PDF
        </button>
      </div>
      {error ? (
        <p className="print-no-print mx-auto max-w-[210mm] text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : !state ? (
        <p className="print-no-print mx-auto flex max-w-[210mm] items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Emitindo documento…
        </p>
      ) : (
        <div className="mx-auto max-w-[210mm] bg-white p-[10mm] shadow-sm print:p-0 print:shadow-none" data-testid="perf-print-document">
          <PerformanceReportDocument data={state.data} issue={state.issue} branding={branding} />
        </div>
      )}
    </div>
  );
}
