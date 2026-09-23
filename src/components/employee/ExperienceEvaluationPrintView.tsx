import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Printer } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { DEFAULT_BRANDING, type BrandingSettingsDTO } from "@/src/types/branding";
import { mergePrintBranding } from "@/src/lib/printBranding";
import { triggerBrowserPrint, usePrintRouteBodyClass } from "@/src/lib/usePrintDocument";
import type { HrEmployeeEvaluationDto } from "@/src/lib/hrEvaluation";
import { ExperienceEvaluationPrintDocument } from "@/src/components/employee/ExperienceEvaluationPrintDocument";

const ROUTE_BODY_CLASS = "hr-eval-print-route";

export function ExperienceEvaluationPrintView() {
  const { employeeId, evaluationId } = useParams<{ employeeId: string; evaluationId: string }>();
  const [evaluation, setEvaluation] = useState<HrEmployeeEvaluationDto | null>(null);
  const [branding, setBranding] = useState<BrandingSettingsDTO>(DEFAULT_BRANDING);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  usePrintRouteBodyClass(ROUTE_BODY_CLASS);

  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-hr-eval-page", "true");
    style.textContent = "@page { size: A4 portrait; margin: 10mm; }";
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    if (!employeeId || !evaluationId) {
      setError("Avaliação inválida.");
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const [row, brand] = await Promise.all([
          fetchJsonOk<HrEmployeeEvaluationDto>(
            `/api/employees/${employeeId}/evaluations/${evaluationId}`
          ),
          fetchJsonOk<BrandingSettingsDTO>("/api/branding-settings").catch(() => DEFAULT_BRANDING),
        ]);
        if (cancelled) return;
        setEvaluation(row);
        setBranding(mergePrintBranding(brand, DEFAULT_BRANDING));
        document.title = `Avaliação ${row.referenceCode}`;
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Não foi possível abrir o formulário.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [employeeId, evaluationId]);

  const handlePrint = useCallback(async () => {
    if (!evaluation || !employeeId) return;
    try {
      await fetch(`/api/employees/${employeeId}/evaluations/${evaluation.id}/print`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
    } catch {
      /* a impressão do navegador segue mesmo se a auditoria falhar na rede */
    }
    triggerBrowserPrint();
  }, [employeeId, evaluation]);

  return (
    <div className="hr-eval-print-page min-h-screen bg-slate-100 px-4 py-4 print:bg-white print:p-0">
      <div className="print-no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-3">
        <Link
          to="/employees"
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para Pessoas
        </Link>
        <button
          type="button"
          onClick={() => void handlePrint()}
          disabled={!evaluation || !!error}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          Imprimir / Salvar PDF
        </button>
      </div>
      {loading ? (
        <p className="print-no-print flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Preparando formulário…
        </p>
      ) : error ? (
        <p className="print-no-print text-sm text-destructive">{error}</p>
      ) : evaluation ? (
        <div className="mx-auto max-w-[210mm] bg-white shadow-sm print:shadow-none">
          <ExperienceEvaluationPrintDocument evaluation={evaluation} branding={branding} />
        </div>
      ) : null}
    </div>
  );
}
