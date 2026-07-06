import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, Loader2, Presentation, RotateCcw, Save } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { canManageProjects, canViewProjects } from "@/src/lib/projectsPermissions";
import { PROJECT_DETAIL_PATH } from "@/src/lib/projectsNavigation";
import { PROJECT_CLIENT_REPORT_TITLE } from "@/src/lib/projectsClientReportShared";
import type { ProjectClientReportPayload } from "@/src/lib/projectsClientReportShared";
import {
  applyProjectClientReportQuantities,
  CLIENT_PROPOSAL_DEFAULT_QUANTITY_PER_SET,
  normalizeClientProposalQuantityPerSet,
  validateProjectClientReportQuantities,
} from "@/src/lib/projectsClientReport";
import { ProjectClientReport } from "@/src/components/projects/ProjectClientReport";
import { ProjectExecutiveReportPrintControls } from "@/src/components/projects/ProjectExecutiveReportPrintControls";
import "@/src/project-client-report-print.css";

const ROUTE_BODY_CLASS = "project-client-report-route";

function quantitiesFromReport(report: ProjectClientReportPayload): Record<string, string> {
  const next: Record<string, string> = {};
  for (const product of report.products) {
    next[product.id] = String(product.quantityPerSet);
  }
  return next;
}

function quantitiesToNumbers(drafts: Record<string, string>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [productId, raw] of Object.entries(drafts)) {
    const normalized = normalizeClientProposalQuantityPerSet(raw);
    if (normalized != null) {
      next[productId] = normalized;
    }
  }
  return next;
}

export function ProjectClientReportPage() {
  const auth = useAuth();
  const canView = canViewProjects(auth);
  const canManage = canManageProjects(auth);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [baseReport, setBaseReport] = useState<ProjectClientReportPayload | null>(null);
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [savedQuantityDrafts, setSavedQuantityDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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

  const loadReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJsonOk<ProjectClientReportPayload>(
        `/api/projects/${projectId}/client-report`
      );
      setBaseReport(data);
      const drafts = quantitiesFromReport(data);
      setQuantityDrafts(drafts);
      setSavedQuantityDrafts(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
      setBaseReport(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      setError("Você não possui permissão para visualizar relatórios de projetos.");
      return;
    }
    if (!projectId) {
      setLoading(false);
      setError("Projeto inválido.");
      return;
    }
    void loadReport();
  }, [canView, projectId, loadReport]);

  const quantityValidation = useMemo(() => {
    if (!baseReport) return { ok: true as const, errors: {} };
    const numeric = quantitiesToNumbers(quantityDrafts);
    return validateProjectClientReportQuantities(baseReport.products, numeric);
  }, [baseReport, quantityDrafts]);

  const displayReport = useMemo(() => {
    if (!baseReport) return null;
    if (!canManage) return baseReport;
    const numeric = quantitiesToNumbers(quantityDrafts);
    if (Object.keys(numeric).length !== baseReport.products.length) {
      return baseReport;
    }
    return applyProjectClientReportQuantities(baseReport, numeric);
  }, [baseReport, canManage, quantityDrafts]);

  const hasUnsavedQuantities = useMemo(() => {
    return JSON.stringify(quantityDrafts) !== JSON.stringify(savedQuantityDrafts);
  }, [quantityDrafts, savedQuantityDrafts]);

  const exportBlocked =
    !displayReport ||
    !!error ||
    (canManage &&
      (!quantityValidation.ok || hasUnsavedQuantities || displayReport.summary.pricingPending));

  useEffect(() => {
    if (!displayReport) return;
    document.title = `${displayReport.project.code} — Proposta Cliente`;
  }, [displayReport]);

  const handleQuantityChange = useCallback((productId: string, value: string) => {
    setQuantityDrafts((current) => ({ ...current, [productId]: value }));
    setSaveError(null);
  }, []);

  const handleRestoreDefaults = useCallback(() => {
    if (!baseReport) return;
    const next: Record<string, string> = {};
    for (const product of baseReport.products) {
      next[product.id] = String(CLIENT_PROPOSAL_DEFAULT_QUANTITY_PER_SET);
    }
    setQuantityDrafts(next);
  }, [baseReport]);

  const handleApplyOneToAll = useCallback(() => {
    if (!baseReport) return;
    const next: Record<string, string> = {};
    for (const product of baseReport.products) {
      next[product.id] = "1";
    }
    setQuantityDrafts(next);
  }, [baseReport]);

  const handleSaveQuantities = useCallback(async () => {
    if (!projectId || !baseReport || !quantityValidation.ok) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = await fetchJsonOk<ProjectClientReportPayload>(
        `/api/projects/${projectId}/client-report/quantities`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: baseReport.products.map((product) => ({
              targetItemId: product.id,
              quantityPerSet: Number(quantityDrafts[product.id]),
            })),
          }),
        }
      );
      setBaseReport(payload);
      const drafts = quantitiesFromReport(payload);
      setQuantityDrafts(drafts);
      setSavedQuantityDrafts(drafts);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar quantidades.");
    } finally {
      setSaving(false);
    }
  }, [projectId, baseReport, quantityDrafts, quantityValidation.ok]);

  const handlePrint = useCallback(() => {
    if (exportBlocked) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [exportBlocked]);

  const handleDownloadPdf = useCallback(() => {
    if (!projectId || exportBlocked) return;
    window.open(`/api/projects/${projectId}/client-report.pdf`, "_blank", "noopener,noreferrer");
  }, [projectId, exportBlocked]);

  const handleDownloadPptx = useCallback(() => {
    if (!projectId || exportBlocked) return;
    window.open(`/api/projects/${projectId}/client-proposal-pptx`, "_blank", "noopener,noreferrer");
  }, [projectId, exportBlocked]);

  const handleBack = useCallback(() => {
    if (projectId) {
      navigate(PROJECT_DETAIL_PATH(projectId));
      return;
    }
    navigate("/projects");
  }, [navigate, projectId]);

  if (!canView) {
    return (
      <div className="project-client-report-route-page min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Você não possui permissão para visualizar relatórios de projetos.
        </div>
      </div>
    );
  }

  return (
    <div className="project-client-report-route-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <div className="no-print mx-auto mb-4 flex w-full max-w-[1180px] flex-wrap items-center justify-between gap-3 print:hidden">
        <ProjectExecutiveReportPrintControls
          onBack={handleBack}
          onPrint={handlePrint}
          printDisabled={exportBlocked}
          backLabel="Voltar ao projeto"
        />
        <div className="flex flex-wrap items-center gap-2">
          {canManage && baseReport ? (
            <>
              <button
                type="button"
                onClick={handleApplyOneToAll}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm hover:bg-accent"
              >
                Aplicar 1 para todos
              </button>
              <button
                type="button"
                onClick={handleRestoreDefaults}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm hover:bg-accent"
              >
                <RotateCcw className="h-4 w-4" />
                Restaurar padrão
              </button>
              <button
                type="button"
                onClick={handleSaveQuantities}
                disabled={saving || !quantityValidation.ok || !hasUnsavedQuantities}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar quantidades
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={handleDownloadPptx}
            disabled={exportBlocked}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            data-testid="project-client-report-download-pptx"
          >
            <Presentation className="h-4 w-4" />
            Baixar PowerPoint
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exportBlocked}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            data-testid="project-client-report-download-pdf"
          >
            <Download className="h-4 w-4" />
            Exportar PDF Cliente
          </button>
        </div>
      </div>

      {canManage && hasUnsavedQuantities ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Salve as quantidades antes de imprimir ou exportar o PDF.
        </div>
      ) : null}

      {canManage && displayReport?.summary.pricingPending ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Alguns produtos ainda não possuem preço comercial final. Corrija a precificação antes de
          gerar a proposta.
        </div>
      ) : null}

      {saveError ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </div>
      ) : null}

      {loading ? (
        <div className="mx-auto flex max-w-[1180px] items-center gap-2 rounded-xl border bg-white p-6 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando {PROJECT_CLIENT_REPORT_TITLE.toLowerCase()}…
        </div>
      ) : null}

      {error ? (
        <div className="mx-auto max-w-[1180px] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {displayReport ? (
        <ProjectClientReport
          report={displayReport}
          editable={canManage}
          quantityDrafts={quantityDrafts}
          quantityErrors={quantityValidation.ok ? undefined : quantityValidation.errors}
          onQuantityChange={handleQuantityChange}
        />
      ) : null}
    </div>
  );
}
