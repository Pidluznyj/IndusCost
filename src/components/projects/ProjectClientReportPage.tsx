import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { canViewProjects } from "@/src/lib/projectsPermissions";
import { PROJECT_DETAIL_PATH } from "@/src/lib/projectsNavigation";
import { PROJECT_CLIENT_REPORT_TITLE } from "@/src/lib/projectsClientReportShared";
import type { ProjectClientReportPayload } from "@/src/lib/projectsClientReportShared";
import { ProjectClientReport } from "@/src/components/projects/ProjectClientReport";
import { ProjectExecutiveReportPrintControls } from "@/src/components/projects/ProjectExecutiveReportPrintControls";
import "@/src/project-client-report-print.css";

const ROUTE_BODY_CLASS = "project-client-report-route";

export function ProjectClientReportPage() {
  const auth = useAuth();
  const canView = canViewProjects(auth);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ProjectClientReportPayload | null>(null);
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

    let cancelled = false;
    setLoading(true);
    setError(null);

    const run = async () => {
      try {
        const data = await fetchJsonOk<ProjectClientReportPayload>(
          `/api/projects/${projectId}/client-report`
        );
        if (cancelled) return;
        setReport(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o relatório.");
          setReport(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [canView, projectId]);

  useEffect(() => {
    if (!report) return;
    document.title = `${report.project.code} — Proposta Cliente`;
  }, [report]);

  const handlePrint = useCallback(() => {
    if (!report) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [report]);

  const handleDownloadPdf = useCallback(() => {
    if (!projectId) return;
    window.open(`/api/projects/${projectId}/client-report.pdf`, "_blank", "noopener,noreferrer");
  }, [projectId]);

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
          printDisabled={!report || !!error}
          backLabel="Voltar ao projeto"
        />
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={!report || !!error}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-sm font-semibold hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
          data-testid="project-client-report-download-pdf"
        >
          <Download className="h-4 w-4" />
          Exportar PDF Cliente
        </button>
      </div>

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

      {report ? <ProjectClientReport report={report} /> : null}
    </div>
  );
}
