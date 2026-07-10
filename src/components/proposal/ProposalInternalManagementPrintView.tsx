import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import type { Proposal, ProposalItem } from "@/src/types/commercial";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { ProposalInternalManagementDocument } from "@/src/components/proposal/ProposalInternalManagementDocument";
import {
  buildProposalInternalManagementPdfDocument,
  type ProposalInternalManagementPdfDocument,
} from "@/src/lib/proposalInternalManagementPdf";

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

function buildDocumentFromProposal(
  proposal: Proposal & { items?: ProposalItem[] }
): ProposalInternalManagementPdfDocument {
  const customer = proposal.Customer;
  return buildProposalInternalManagementPdfDocument({
    id: proposal.id,
    number: proposal.number,
    title: proposal.title,
    status: proposal.status,
    responsible: proposal.responsible,
    companyIssuer: proposal.companyIssuer,
    validityDays: proposal.validityDays,
    paymentTerms: proposal.paymentTerms,
    paymentMethod: proposal.paymentMethod,
    freightCondition: proposal.freightCondition,
    deliveryLocation: proposal.deliveryLocation,
    notes: proposal.notes,
    internalNotes: proposal.internalNotes,
    createdAt: proposal.createdAt,
    customerName: customer?.companyName ?? customer?.tradeName ?? null,
    customerTradeName: customer?.tradeName ?? null,
    customerDocument: customer?.taxId ?? null,
    customerPhone: customer?.phone ?? null,
    customerAddress: customer?.address ?? null,
    customerCity: customer?.city ?? null,
    customerState: customer?.state ?? null,
    customerZip: customer?.zipCode ?? null,
    totalGrossValue: proposal.totalGrossValue,
    totalDiscount: proposal.totalDiscount,
    totalNetValue: proposal.totalNetValue,
    totalCost: proposal.totalCost,
    totalMarginValue: proposal.totalMarginValue,
    totalMarginPerc: proposal.totalMarginPerc,
    totalTaxes: proposal.totalTaxes,
    totalCommission: proposal.totalCommission,
    totalFreight: proposal.totalFreight,
    items: (proposal.items ?? []).map((item) => ({
      sku: item.Product?.sku ?? null,
      name: item.Product?.name ?? null,
      quantity: item.quantity,
      unit: item.unit,
      unitCost: item.unitCost,
      negotiatedPrice: item.negotiatedPrice,
      suggestedPrice: item.suggestedPrice,
      marginValue: item.marginValue,
      marginPerc: item.marginPerc,
      commissionPerc: item.commissionPerc,
      commissionValue: item.commissionValue,
      taxesValue: item.taxesValue,
      freightValue: item.freightValue,
      notes: item.notes,
      pricingSnapshotJson: item.pricingSnapshotJson,
    })),
  });
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
        const [prop, brandRes] = await Promise.all([
          fetchJsonOk<Proposal & { items?: ProposalItem[] }>(`/api/proposals/${resolvedId}`),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        if (!prop) {
          setError("Proposta não encontrada.");
          setMgmtDoc(null);
          return;
        }
        setMgmtDoc(buildDocumentFromProposal(prop));
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
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">
              Carregando relatório gerencial interno…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !mgmtDoc ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Proposta não localizada.
          </div>
        ) : (
          <ProposalInternalManagementDocument document={mgmtDoc} branding={branding} />
        )}
      </div>
    </div>
  );
};
