import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { formatPrintDateTime, mergePrintBranding } from "@/src/lib/printBranding";
import { usePrintRouteBodyClass, triggerBrowserPrint } from "@/src/lib/usePrintDocument";
import type { ServiceTerminationDto } from "@/src/lib/suppliers/supplierServiceTerminationTypes";
import {
  buildServiceTerminationPrintModel,
} from "@/src/lib/suppliers/supplierServiceTerminationPrint";
import { SupplierServiceTerminationPrintDocument } from "@/src/components/finance/cost-centers/SupplierServiceTerminationPrintDocument";
import { getFinanceSectionPath } from "@/src/lib/financeNavigation";
import "@/src/sales-order-print.css";
import "@/src/components/finance/cost-centers/supplier-service-termination-print.css";

/** Classe própria — CSS da rota força @page A4 portrait sobre CSS global landscape. */
const ROUTE_BODY_CLASS = "service-termination-print-route";

export function SupplierServiceTerminationPrintView() {
  const { supplierId, id } = useParams<{ supplierId: string; id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [dto, setDto] = useState<ServiceTerminationDto | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);

  // Garante A4 retrato nesta rota mesmo com @page landscape de outros CSS globais.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-service-termination-print-page", "1");
    style.textContent = "@page { size: A4 portrait; margin: 8mm; }";
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  const model = useMemo(
    () => (dto ? buildServiceTerminationPrintModel(dto) : null),
    [dto]
  );

  useEffect(() => {
    if (!model) return;
    document.title = `Encerramento — ${model.personName}`;
  }, [model]);

  const handlePrint = useCallback(() => {
    if (!model) return;
    triggerBrowserPrint();
  }, [model]);

  useEffect(() => {
    if (!supplierId || !id) {
      setError("Encerramento inválido.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDto(null);

    const run = async () => {
      try {
        const [payload, brandRes] = await Promise.all([
          fetchJsonOk<{ ok: boolean; item: ServiceTerminationDto }>(
            `/api/suppliers/${supplierId}/service-terminations/${id}`
          ),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(
            () => DEFAULT_BRANDING
          ),
        ]);
        if (cancelled) return;
        if (!payload?.item) {
          setError("Encerramento não encontrado.");
          return;
        }
        setDto(payload.item);
        setBranding(mergePrintBranding(brandRes, DEFAULT_BRANDING));
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o encerramento."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [supplierId, id]);

  const issuedAt = useMemo(() => formatPrintDateTime(new Date().toISOString()), []);
  const emitterName = dto?.finalizedByName || dto?.createdByName || null;

  return (
    <div className="service-termination-print-route-page service-termination-print-page sales-order-print-route-page sales-order-print-page proposal-print-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <div className="proposal-print-no-print print-no-print mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => navigate(getFinanceSectionPath("suppliers"))}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <button
          type="button"
          onClick={handlePrint}
          disabled={!model || !!error}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
          data-testid="service-termination-print-button"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>

      <div className="proposal-print-scroll mx-auto w-full max-w-[210mm] overflow-x-hidden print:overflow-visible">
        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">
              Carregando relatório de encerramento…
            </p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !model ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Encerramento não localizado.
          </div>
        ) : (
          <SupplierServiceTerminationPrintDocument
            model={model}
            branding={branding}
            issuedAt={issuedAt}
            emitterName={emitterName}
          />
        )}
      </div>
    </div>
  );
}
