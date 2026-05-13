import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { Proposal, ProposalItem } from "@/src/types/commercial";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { ProposalClientDocument } from "@/src/components/proposal/ProposalClientDocument";

const PRINT_TITLE_CLEANUP_MS = 800;

function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatIssueDate(value: string | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("pt-BR");
}

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

export const ProposalPrintView = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<(Proposal & { items?: ProposalItem[] }) | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const printCleanupTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const savedDocumentTitleRef = useRef<string | null>(null);

  const clearPrintTitleState = useCallback(() => {
    if (printCleanupTimerRef.current != null) {
      window.clearTimeout(printCleanupTimerRef.current);
      printCleanupTimerRef.current = null;
    }
    if (savedDocumentTitleRef.current !== null) {
      document.title = savedDocumentTitleRef.current;
      savedDocumentTitleRef.current = null;
    }
  }, []);

  const handlePrint = useCallback(() => {
    if (!proposal) return;
    savedDocumentTitleRef.current = document.title;
    const cp =
      proposal.number != null && Number.isFinite(Number(proposal.number))
        ? ` CP ${proposal.number}`
        : "";
    document.title = `Proposta Comercial${cp}`.trim();

    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      if (printCleanupTimerRef.current != null) {
        window.clearTimeout(printCleanupTimerRef.current);
        printCleanupTimerRef.current = null;
      }
      clearPrintTitleState();
    };

    window.addEventListener("afterprint", onAfterPrint);
    printCleanupTimerRef.current = window.setTimeout(() => {
      printCleanupTimerRef.current = null;
      window.removeEventListener("afterprint", onAfterPrint);
      clearPrintTitleState();
    }, PRINT_TITLE_CLEANUP_MS);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [proposal, clearPrintTitleState]);

  useEffect(() => {
    return () => {
      clearPrintTitleState();
    };
  }, [clearPrintTitleState]);

  useEffect(() => {
    if (!id) {
      setError("Proposta inválida.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProposal(null);

    const run = async () => {
      try {
        const [prop, brandRes] = await Promise.all([
          fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${id}`),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        if (!prop) {
          setError("Proposta não encontrada.");
          setProposal(null);
          return;
        }
        setProposal(prop);
        setBranding(mergeBranding(brandRes));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar a proposta.");
          setProposal(null);
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

  const issuedAt = useMemo(() => formatIssueDate(proposal?.createdAt), [proposal?.createdAt]);

  const totals = useMemo(
    () =>
      proposal
        ? {
            totalGross: safeNum(proposal.totalGrossValue),
            totalDiscount: safeNum(proposal.totalDiscount),
            totalNet: safeNum(proposal.totalNetValue),
          }
        : { totalGross: 0, totalDiscount: 0, totalNet: 0 },
    [proposal],
  );

  const resolvedCustomer = proposal?.Customer ?? null;
  const proposalNumber = proposal != null && Number.isFinite(Number(proposal.number)) ? proposal.number : null;

  return (
    <div className="proposal-print-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <div className="proposal-print-no-print mx-auto mb-4 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate("/proposals")}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={!proposal || !!error}
          title="Para PDF sem título e URL do navegador no topo/rodapé, desative “Cabeçalhos e rodapés” nas opções de impressão (Chrome/Edge: Mais definições)."
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
            <p className="mt-2 text-sm text-muted-foreground">Carregando proposta…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : !proposal ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Proposta não localizada.
          </div>
        ) : (
          <ProposalClientDocument
            formData={proposal}
            resolvedCustomer={resolvedCustomer}
            proposalNumber={proposalNumber}
            totals={totals}
            branding={branding}
            issuedAt={issuedAt}
          />
        )}
      </div>
    </div>
  );
};
