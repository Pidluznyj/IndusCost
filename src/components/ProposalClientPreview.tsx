import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Printer, X } from "lucide-react";
import type { Customer, Proposal } from "@/src/types/commercial";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import {
  ProposalClientDocument,
  type ProposalClientDocumentTotals,
} from "@/src/components/proposal/ProposalClientDocument";

const CLIENT_PREVIEW_BRANDING_TTL_MS = 120_000;
const PRINTING_BODY_CLASS = "printing-proposal-client-preview";
const PRINT_CLEANUP_MS = 1000;

let clientPreviewBrandingCache: BrandingSettingsDTO | null = null;
let clientPreviewBrandingCacheAt = 0;

/** @deprecated use ProposalClientDocumentTotals */
export type ProposalClientPreviewTotals = ProposalClientDocumentTotals;

export type ProposalClientPreviewProps = {
  open: boolean;
  onClose: () => void;
  formData: Partial<Proposal>;
  resolvedCustomer: Customer | null;
  proposalNumber: number | null;
  totals: ProposalClientDocumentTotals;
};

/**
 * Modal de pré-visualização comercial: toolbar, impressão e branding.
 * O conteúdo do relatório é {@link ProposalClientDocument}.
 */
export function ProposalClientPreview({
  open,
  onClose,
  formData,
  resolvedCustomer,
  proposalNumber,
  totals,
}: ProposalClientPreviewProps) {
  const [emissionDate, setEmissionDate] = useState("");
  const [branding, setBranding] = useState<BrandingSettingsDTO | null>(null);
  const printCleanupTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const savedDocumentTitleRef = useRef<string | null>(null);

  const clearClientPrintState = useCallback(() => {
    document.documentElement.classList.remove(PRINTING_BODY_CLASS);
    document.body.classList.remove(PRINTING_BODY_CLASS);
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
    savedDocumentTitleRef.current = document.title;
    const cp =
      proposalNumber != null && Number.isFinite(proposalNumber)
        ? ` CP ${proposalNumber}`
        : "";
    document.title = `Proposta Comercial${cp}`.trim();

    document.documentElement.classList.add(PRINTING_BODY_CLASS);
    document.body.classList.add(PRINTING_BODY_CLASS);

    const onAfterPrint = () => {
      window.removeEventListener("afterprint", onAfterPrint);
      if (printCleanupTimerRef.current != null) {
        window.clearTimeout(printCleanupTimerRef.current);
        printCleanupTimerRef.current = null;
      }
      clearClientPrintState();
    };

    window.addEventListener("afterprint", onAfterPrint);
    printCleanupTimerRef.current = window.setTimeout(() => {
      printCleanupTimerRef.current = null;
      window.removeEventListener("afterprint", onAfterPrint);
      clearClientPrintState();
    }, PRINT_CLEANUP_MS);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [proposalNumber, clearClientPrintState]);

  useEffect(() => {
    const clearCache = () => {
      clientPreviewBrandingCache = null;
      clientPreviewBrandingCacheAt = 0;
    };
    window.addEventListener("induscost:branding-updated", clearCache);
    return () => window.removeEventListener("induscost:branding-updated", clearCache);
  }, []);

  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    if (
      clientPreviewBrandingCache &&
      now - clientPreviewBrandingCacheAt < CLIENT_PREVIEW_BRANDING_TTL_MS
    ) {
      setBranding(clientPreviewBrandingCache);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const data = await fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings");
        if (cancelled) return;
        const merged: BrandingSettingsDTO = {
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
        clientPreviewBrandingCache = merged;
        clientPreviewBrandingCacheAt = Date.now();
        setBranding(merged);
      } catch {
        if (!cancelled) setBranding(DEFAULT_BRANDING);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setEmissionDate(new Date().toLocaleDateString("pt-BR"));
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
      clearClientPrintState();
    };
  }, [open, clearClientPrintState]);

  const b = useMemo(() => branding ?? DEFAULT_BRANDING, [branding]);

  if (!open) return null;

  return (
    <div
      className="proposal-print-page proposal-print-modal-page fixed inset-0 z-[100] flex flex-col overflow-hidden bg-slate-200/95 backdrop-blur-sm print:bg-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-client-preview-title"
    >
      <div className="proposal-print-no-print shrink-0 border-b border-border bg-card px-4 py-3 shadow-sm">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-accent"
            >
              <X className="h-4 w-4" aria-hidden />
              Voltar para edição
            </button>
            <button
              type="button"
              onClick={handlePrint}
              title="Para PDF sem título e URL do navegador no topo/rodapé, desative “Cabeçalhos e rodapés” nas opções de impressão (Chrome/Edge: Mais definições)."
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90"
            >
              <Printer className="h-4 w-4" aria-hidden />
              Imprimir / Salvar PDF
            </button>
          </div>
          <p className="text-xs text-muted-foreground">Somente visualização — não altera a proposta.</p>
        </div>
      </div>

      <div className="proposal-print-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 md:px-6 md:py-6 print:p-0">
        <ProposalClientDocument
          formData={formData}
          resolvedCustomer={resolvedCustomer}
          proposalNumber={proposalNumber}
          totals={totals}
          branding={b}
          issuedAt={emissionDate}
          titleHeadingId="proposal-client-preview-title"
        />
      </div>
    </div>
  );
}
