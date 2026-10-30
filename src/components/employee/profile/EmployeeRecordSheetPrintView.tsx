import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { mergePrintBranding } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { EmployeeRecordSheetDocument } from "./EmployeeRecordSheetDocument";
import { useEmployeeRecordSheet } from "./useEmployeeRecordSheet";

export function EmployeeRecordSheetPrintView() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const { sheet, loading, error } = useEmployeeRecordSheet(employeeId);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const issuedAt = useMemo(() => new Date(), []);

  usePrintRouteBodyClass("employee-record-sheet-print-route");

  useEffect(() => {
    let cancelled = false;
    fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings")
      .then((brand) => {
        if (!cancelled) setBranding(mergePrintBranding(brand, DEFAULT_BRANDING));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (sheet) document.title = `Ficha do colaborador - ${sheet.identity.fullName}`;
  }, [sheet]);

  return (
    <div className="employee-record-sheet-page min-h-screen bg-slate-100 px-4 py-4 print:bg-white print:p-0">
      <div className="print-no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Link
          to="/employees"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Pessoas
        </Link>
        <button
          type="button"
          onClick={() => triggerBrowserPrint()}
          disabled={!sheet}
          data-testid="employee-record-sheet-print"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>
      {loading ? (
        <p className="print-no-print flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparando ficha…
        </p>
      ) : error ? (
        <p className="print-no-print text-sm text-destructive">{error}</p>
      ) : sheet ? (
        <div className="mx-auto max-w-[210mm] bg-white shadow-sm print:shadow-none">
          <EmployeeRecordSheetDocument sheet={sheet} branding={branding} issuedAt={issuedAt} />
        </div>
      ) : null}
    </div>
  );
}
