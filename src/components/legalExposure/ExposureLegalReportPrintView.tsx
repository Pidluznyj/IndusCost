/**
 * Preview isolado de impressão/PDF do Exposure. Sem Puppeteer.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Printer, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { mergePrintBranding } from "@/src/lib/printBranding";
import {
  EXPOSURE_LEGAL_REPORT_BODY_CLASS,
  waitForExposurePrintAssets,
  type ExposureGroupPrintReport,
  type ExposurePrintDashboardSource,
} from "@/src/lib/legalExposure/legalExposurePrint";
import { ExposureCaseLegalReportDocument } from "./ExposureCaseLegalReportDocument";
import { ExposureGroupLegalReportDocument } from "./ExposureGroupLegalReportDocument";
import type { ExposureDossier } from "./ExposureCaseDossier";

type Kind = "case" | "group";

export function ExposureLegalReportPrintView({ kind }: { kind: Kind }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [printReady, setPrintReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [dossier, setDossier] = useState<ExposureDossier | null>(null);
  const [report, setReport] = useState<ExposureGroupPrintReport | null>(null);
  const [sources, setSources] = useState<ExposurePrintDashboardSource[]>([]);

  useEffect(() => {
    document.body.classList.add(EXPOSURE_LEGAL_REPORT_BODY_CLASS);
    const previousTitle = document.title;
    document.title = kind === "case" ? "Dossiê jurídico executivo" : "Relatório executivo de exposição jurídica";
    return () => {
      document.body.classList.remove(EXPOSURE_LEGAL_REPORT_BODY_CLASS);
      document.title = previousTitle;
    };
  }, [kind]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPrintReady(false);
    setError(null);
    const run = async () => {
      try {
        const brandP = fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING);
        const dashP = fetchJsonOk<{ sources?: ExposurePrintDashboardSource[] }>("/api/legal-exposure/dashboard").catch(
          () => ({ sources: [] as ExposurePrintDashboardSource[] })
        );
        if (kind === "case") {
          if (!id) throw new Error("Processo inválido.");
          const [brand, dash, caseRow] = await Promise.all([
            brandP,
            dashP,
            fetchJsonOk<ExposureDossier>(`/api/legal-exposure/cases/${id}`),
          ]);
          if (cancelled) return;
          setBranding(mergePrintBranding(brand, DEFAULT_BRANDING));
          setSources(dash.sources ?? []);
          setDossier(caseRow);
        } else {
          const [brand, dash, group] = await Promise.all([
            brandP,
            dashP,
            fetchJsonOk<ExposureGroupPrintReport>("/api/legal-exposure/reports/group"),
          ]);
          if (cancelled) return;
          setBranding(mergePrintBranding(brand, DEFAULT_BRANDING));
          setSources(dash.sources ?? []);
          setReport(group);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  useEffect(() => {
    if (loading || error || (kind === "case" ? !dossier : !report)) return;
    let cancelled = false;
    void waitForExposurePrintAssets(rootRef.current).then(() => {
      if (!cancelled) setPrintReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [loading, error, kind, dossier, report]);

  const handlePrint = useCallback(() => {
    if (!printReady) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => window.print());
    });
  }, [printReady]);

  const handleClose = useCallback(() => {
    if (window.opener) {
      window.close();
      return;
    }
    navigate("/exposure");
  }, [navigate]);

  const readyDocument = kind === "case" ? Boolean(dossier) : Boolean(report);

  return (
    <div className="exposure-legal-report-preview" ref={rootRef}>
      <div className="exposure-legal-report-no-print mx-auto mb-4 flex w-full max-w-[210mm] items-center justify-between gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
          Fechar
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!printReady || !readyDocument || Boolean(error)}
          onClick={handlePrint}
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>
      {loading ? (
        <div className="mx-auto flex min-h-[40vh] max-w-[210mm] flex-col items-center justify-center rounded-xl bg-white py-24">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="mt-2 text-sm text-muted-foreground">Carregando relatório, branding e layout…</p>
        </div>
      ) : error ? (
        <p className="mx-auto max-w-[210mm] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
      ) : kind === "case" && dossier ? (
        <ExposureCaseLegalReportDocument dossier={dossier} branding={branding} sources={sources} generatedAt={new Date().toISOString()} />
      ) : kind === "group" && report ? (
        <ExposureGroupLegalReportDocument report={report} branding={branding} sources={sources} />
      ) : null}
    </div>
  );
}
