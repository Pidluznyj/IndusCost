import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { canViewProjects } from "@/src/lib/projectsPermissions";
import {
  buildProjectExecutiveReport,
} from "@/src/lib/projectsExecutiveReport";
import { PROJECT_DETAIL_PATH } from "@/src/lib/projectsNavigation";
import { ProjectExecutiveReport } from "@/src/components/projects/ProjectExecutiveReport";
import { ProjectExecutiveReportPrintControls } from "@/src/components/projects/ProjectExecutiveReportPrintControls";
import type { ProjectDetail } from "@/src/types/projects";

const ROUTE_BODY_CLASS = "project-executive-report-route";

export function ProjectExecutiveReportPage() {
  const auth = useAuth();
  const canView = canViewProjects(auth);
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
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
        const data = await fetchJsonOk<ProjectDetail>(`/api/projects/${projectId}`);
        if (cancelled) return;
        setDetail(data);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o projeto.");
          setDetail(null);
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

  const report = useMemo(
    () => (detail ? buildProjectExecutiveReport(detail) : null),
    [detail]
  );

  useEffect(() => {
    if (!report) return;
    document.title = `${report.project.code} — Relatório Gerencial`;
  }, [report]);

  const handlePrint = useCallback(() => {
    if (!report) return;

    // Força A4 retrato: finance-executive-report-print.css define landscape global.
    const style = document.createElement("style");
    style.setAttribute("data-project-executive-report-print-page", "1");
    style.textContent = "@page { size: A4 portrait; margin: 10mm; }";
    document.head.appendChild(style);

    const cleanup = () => {
      style.remove();
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup, { once: true });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [report]);

  const handleBack = useCallback(() => {
    if (projectId) {
      navigate(PROJECT_DETAIL_PATH(projectId));
      return;
    }
    navigate("/projects");
  }, [navigate, projectId]);

  if (!canView) {
    return (
      <div className="project-executive-report-route-page min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Você não possui permissão para visualizar relatórios de projetos.
        </div>
      </div>
    );
  }

  return (
    <div className="project-executive-report-route-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <ProjectExecutiveReportPrintControls
        onBack={handleBack}
        onPrint={handlePrint}
        printDisabled={!report || !!error}
      />

      <div className="project-executive-report-scroll mx-auto w-full max-w-[1180px] overflow-x-hidden print:overflow-visible">
        {loading ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Carregando relatório gerencial…</p>
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        ) : !report ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Projeto não localizado.
          </div>
        ) : (
          <ProjectExecutiveReport report={report} />
        )}
      </div>
    </div>
  );
}
