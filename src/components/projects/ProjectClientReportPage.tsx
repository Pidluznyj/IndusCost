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
import { ProjectDocumentIssueBar } from "@/src/components/projects/documents/ProjectDocumentIssueBar";
import { useProjectDocument } from "@/src/components/projects/documents/useProjectDocument";

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
  const [saving, setSaving] = useState(false);
  // Prévia (precificação salva, montada no servidor) ou emissão congelada (?emissao=<id>).
  const doc = useProjectDocument<ProjectClientReportPayload>(projectId, "CLIENT_PROPOSAL", canView && !!projectId);
  const isIssued = doc.issued != null;
  const baseReport = doc.envelope?.body ?? null;
  const loading = doc.loading;
  const canEditQuantities = canManage && !isIssued;
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [savedQuantityDrafts, setSavedQuantityDrafts] = useState<Record<string, string>>({});
  const error = !canView
    ? "Você não possui permissão para visualizar relatórios de projetos."
    : !projectId
      ? "Projeto inválido."
      : doc.error;
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pptxError, setPptxError] = useState<string | null>(null);
  const [pptxDownloading, setPptxDownloading] = useState(false);
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
    if (!baseReport) return;
    const drafts = quantitiesFromReport(baseReport);
    setQuantityDrafts(drafts);
    setSavedQuantityDrafts(drafts);
  }, [baseReport]);

  const quantityValidation = useMemo(() => {
    if (!baseReport) return { ok: true as const, errors: {} };
    const numeric = quantitiesToNumbers(quantityDrafts);
    return validateProjectClientReportQuantities(baseReport.products, numeric);
  }, [baseReport, quantityDrafts]);

  const displayReport = useMemo(() => {
    if (!baseReport) return null;
    if (!canEditQuantities) return baseReport;
    const numeric = quantitiesToNumbers(quantityDrafts);
    if (Object.keys(numeric).length !== baseReport.products.length) {
      return baseReport;
    }
    return applyProjectClientReportQuantities(baseReport, numeric);
  }, [baseReport, canEditQuantities, quantityDrafts]);

  const hasUnsavedQuantities = useMemo(() => {
    return JSON.stringify(quantityDrafts) !== JSON.stringify(savedQuantityDrafts);
  }, [quantityDrafts, savedQuantityDrafts]);

  const printBlocked =
    !displayReport ||
    !!error ||
    (canEditQuantities &&
      (!quantityValidation.ok || hasUnsavedQuantities || displayReport.summary.pricingPending));
  // PDF/PowerPoint saem só da proposta EMITIDA (conteúdo congelado, número e hash).
  const exportBlocked = !isIssued || !!error || !displayReport;

  useEffect(() => {
    if (!displayReport) return;
    document.title = `${doc.envelope?.header.documentNumber ?? displayReport.project.code} — Proposta Cliente`;
  }, [displayReport, doc.envelope?.header.documentNumber]);

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
      await fetchJsonOk<ProjectClientReportPayload>(
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
      // Recarrega a prévia do servidor (mesma fonte da emissão).
      await doc.reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Erro ao salvar quantidades.");
    } finally {
      setSaving(false);
    }
  }, [projectId, baseReport, quantityDrafts, quantityValidation.ok, doc.reload]);

  const handlePrint = useCallback(() => {
    if (printBlocked) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [printBlocked]);

  const handleDownloadPdf = useCallback(() => {
    if (!projectId || exportBlocked || !doc.issued) return;
    window.open(
      `/api/projects/${projectId}/documents/issued/${doc.issued.id}/proposal.pdf`,
      "_blank",
      "noopener,noreferrer"
    );
  }, [projectId, exportBlocked, doc.issued]);

  const handleDownloadPptx = useCallback(async () => {
    if (!projectId || exportBlocked || !displayReport) return;
    setPptxDownloading(true);
    setPptxError(null);
    try {
      if (!doc.issued) return;
      const res = await fetch(`/api/projects/${projectId}/documents/issued/${doc.issued.id}/proposal.pptx`, {
        credentials: "include",
      });
      if (!res.ok) {
        let message = "Não foi possível gerar o PowerPoint.";
        try {
          const body = (await res.json()) as { message?: string; error?: string };
          if (body.message) message = body.message;
          else if (body.error) message = body.error;
        } catch {
          /* resposta não-JSON */
        }
        if (res.status === 404) {
          message = "Projeto não encontrado.";
        }
        setPptxError(message);
        return;
      }
      const blob = await res.blob();
      const filename = `${(doc.issued.documentNumber ?? displayReport.project.code).replace(/[^\w.-]+/g, "_")}.pptx`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setPptxError("Não foi possível gerar o PowerPoint. Tente novamente.");
    } finally {
      setPptxDownloading(false);
    }
  }, [projectId, exportBlocked, displayReport, doc.issued]);

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
          printDisabled={printBlocked}
          backLabel="Voltar ao projeto"
        />
        <div className="flex flex-wrap items-center gap-2">
          {canEditQuantities && baseReport ? (
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
            onClick={() => void handleDownloadPptx()}
            disabled={exportBlocked || pptxDownloading}
            title={!isIssued ? "Emita a proposta para exportar o PowerPoint." : undefined}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            data-testid="project-client-report-download-pptx"
          >
            {pptxDownloading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Presentation className="h-4 w-4" />
            )}
            Baixar PowerPoint
          </button>
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={exportBlocked}
            title={!isIssued ? "Emita a proposta para exportar o PDF." : undefined}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            data-testid="project-client-report-download-pdf"
          >
            <Download className="h-4 w-4" />
            Exportar PDF Cliente
          </button>
        </div>
      </div>

      {displayReport ? (
        <ProjectDocumentIssueBar
          state={doc}
          canIssue={canManage}
          disabledReason={
            hasUnsavedQuantities
              ? "Salve as quantidades antes de emitir."
              : !quantityValidation.ok
                ? "Corrija as quantidades antes de emitir."
                : null
          }
        />
      ) : null}

      {!isIssued && displayReport ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          PDF e PowerPoint são gerados a partir da proposta emitida (número, revisão e código de verificação).
        </div>
      ) : null}

      {canEditQuantities && hasUnsavedQuantities ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Salve as quantidades antes de imprimir ou exportar o PDF.
        </div>
      ) : null}

      {canEditQuantities && displayReport?.summary.pricingPending ? (
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

      {pptxError ? (
        <div className="project-client-report-print-no-print mx-auto mb-4 max-w-[1180px] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {pptxError}
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
          documentHeader={doc.envelope?.header ?? null}
          sha256={doc.issued?.payloadSha256 ?? null}
          editable={canEditQuantities}
          quantityDrafts={quantityDrafts}
          quantityErrors={quantityValidation.ok ? undefined : quantityValidation.errors}
          onQuantityChange={handleQuantityChange}
        />
      ) : null}
    </div>
  );
}
