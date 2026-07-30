import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { ProposalInternalManagementDocument } from "@/src/components/proposal/ProposalInternalManagementDocument";
import type { ProposalInternalManagementPdfDocument } from "@/src/lib/proposalInternalManagementPdf";

const ROUTE_BODY_CLASS = "proposal-print-route";

function mergeBranding(data: BrandingSettingsDTO): BrandingSettingsDTO {
  return {
    ...DEFAULT_BRANDING,
    ...data,
    companyName:
      typeof data.companyName === "string" && data.companyName.trim()
        ? data.companyName.trim()
        : DEFAULT_BRANDING.companyName,
    slogan: typeof data.slogan === "string" ? data.slogan : DEFAULT_BRANDING.slogan,
    primaryColor:
      typeof data.primaryColor === "string" && data.primaryColor.trim()
        ? data.primaryColor.trim()
        : DEFAULT_BRANDING.primaryColor,
    secondaryColor:
      typeof data.secondaryColor === "string" && data.secondaryColor.trim()
        ? data.secondaryColor.trim()
        : DEFAULT_BRANDING.secondaryColor,
  };
}

export const ProposalInternalManagementPrintView = () => {
  const { proposalId, id } = useParams<{ proposalId?: string; id?: string }>();
  const resolvedId = proposalId ?? id;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [mgmtDoc, setMgmtDoc] = useState<ProposalInternalManagementPdfDocument | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const routeEntryTitleRef = useRef<string | null>(null);

  useEffect(() => {
    document.body.classList.add(ROUTE_BODY_CLASS);
    routeEntryTitleRef.current = document.title;
    return () => {
      document.body.classList.remove(ROUTE_BODY_CLASS);
      if (routeEntryTitleRef.current !== null) {
        document.title = routeEntryTitleRef.current;
        routeEntryTitleRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mgmtDoc) return;
    document.title = `${mgmtDoc.proposalCode} — Relatório Gerencial Interno`;
  }, [mgmtDoc]);

  const handlePrint = useCallback(() => {
    if (!mgmtDoc) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [mgmtDoc]);

  useEffect(() => {
    if (!resolvedId) {
      setError("Proposta inválida.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMgmtDoc(null);

    const run = async () => {
      try {
        const [payload, brandRes] = await Promise.all([
          fetchJsonOk<{ document: ProposalInternalManagementPdfDocument }>(
            `/api/proposals/${resolvedId}/internal-management-document`
          ),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(
            () => DEFAULT_BRANDING
          ),
        ]);
        if (cancelled) return;
        if (!payload?.document) {
          setError("Proposta não encontrada.");
          setMgmtDoc(null);
          return;
        }
        setMgmtDoc(payload.document);
        setBranding(mergeBranding(brandRes));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o relatório gerencial interno."
          );
          setMgmtDoc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [resolvedId]);

  const subtitle = useMemo(
    () => (mgmtDoc ? `${mgmtDoc.proposalCode} · ${mgmtDoc.customerName}` : ""),
    [mgmtDoc]
  );

  return (
    <div className="proposal-print-route-page proposal-print-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <div className="proposal-print-no-print mx-auto mb-4 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/proposals")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {subtitle ? (
            <p className="text-xs font-medium text-slate-600">{subtitle}</p>
          ) : null}
          <button
            type="button"
            onClick={handlePrint}
            disabled={!mgmtDoc || !!error}
            title="Para PDF sem título e URL do navegador, desative “Cabeçalhos e rodapés” nas opções de impressão."
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700 disabled:pointer-events-none disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            Imprimir / Salvar PDF
          </button>
        </div>
      </div>

      <div className="proposal-print-scroll mx-auto w-full max-w-[1180px] overflow-x-hidden print:overflow-visible">
        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-white p-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando relatório gerencial…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-900">
            {error}
          </div>
        ) : mgmtDoc ? (
          <ProposalInternalManagementDocument document={mgmtDoc} branding={branding} />
        ) : null}
      </div>
    </div>
  );
};
