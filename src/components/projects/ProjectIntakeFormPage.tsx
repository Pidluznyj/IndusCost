import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { canViewProjects } from "@/src/lib/projectsPermissions";
import {
  buildBlankProjectIntakeForm,
  buildProjectIntakeFormFromDetail,
  intakeFormPathRequestsPrint,
  isBlankProjectIntakeFormPath,
  isFullIntakeFormPath,
  PROJECT_INTAKE_FORM_FULL_TITLE,
} from "@/src/lib/projectsIntakeForm";
import {
  buildBlankQuickIntakeForm,
  buildQuickIntakeFormFromDetail,
  PROJECT_INTAKE_QUICK_FORM_TITLE,
} from "@/src/lib/projectsIntakeQuickForm";
import { PROJECT_DETAIL_PATH } from "@/src/lib/projectsNavigation";
import { ProjectIntakeFormDocument } from "@/src/components/projects/ProjectIntakeFormDocument";
import { ProjectIntakeQuickFormDocument } from "@/src/components/projects/ProjectIntakeQuickFormDocument";
import { ProjectExecutiveReportPrintControls } from "@/src/components/projects/ProjectExecutiveReportPrintControls";
import type { ProjectDetail } from "@/src/types/projects";

const ROUTE_BODY_CLASS = "project-intake-form-route";

export function ProjectIntakeFormPage() {
  const auth = useAuth();
  const canView = canViewProjects(auth);
  const { projectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(!isBlankProjectIntakeFormPath(location.pathname));
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const routeEntryTitleRef = useRef<string | null>(null);
  const autoPrintedRef = useRef(false);

  const isBlank = isBlankProjectIntakeFormPath(location.pathname);
  const isFull = isFullIntakeFormPath(location.pathname);
  const wantsPrint = intakeFormPathRequestsPrint(location.pathname);

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
      setError("Você não possui permissão para visualizar fichas de projeto.");
      return;
    }
    if (isBlank) {
      setLoading(false);
      setDetail(null);
      setError(null);
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
  }, [canView, isBlank, projectId]);

  const quickPayload = useMemo(() => {
    const generatedBy = auth.authUser?.name ?? auth.authUser?.email ?? null;
    if (isBlank) return buildBlankQuickIntakeForm({ generatedBy });
    if (!detail) return null;
    return buildQuickIntakeFormFromDetail(detail, { generatedBy });
  }, [auth.authUser?.email, auth.authUser?.name, detail, isBlank]);

  const fullPayload = useMemo(() => {
    if (!isFull) return null;
    const generatedBy = auth.authUser?.name ?? auth.authUser?.email ?? null;
    if (isBlank) return buildBlankProjectIntakeForm({ generatedBy });
    if (!detail) return null;
    return buildProjectIntakeFormFromDetail(detail, { generatedBy });
  }, [auth.authUser?.email, auth.authUser?.name, detail, isBlank, isFull]);

  const payload = isFull ? fullPayload : quickPayload;

  useEffect(() => {
    const title = isFull
      ? isBlank
        ? `${PROJECT_INTAKE_FORM_FULL_TITLE} — em branco`
        : `${fullPayload?.header.projectCode ?? "Projeto"} — ${PROJECT_INTAKE_FORM_FULL_TITLE}`
      : isBlank
        ? `${PROJECT_INTAKE_QUICK_FORM_TITLE} — em branco`
        : `${quickPayload?.header.projectName ?? "Projeto"} — ${PROJECT_INTAKE_QUICK_FORM_TITLE}`;
    document.title = title;
  }, [fullPayload?.header.projectCode, isBlank, isFull, quickPayload?.header.projectName]);

  const handlePrint = useCallback(() => {
    if (!payload) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
      });
    });
  }, [payload]);

  useEffect(() => {
    if (!wantsPrint || !payload || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    const timer = window.setTimeout(() => handlePrint(), 400);
    return () => window.clearTimeout(timer);
  }, [handlePrint, payload, wantsPrint]);

  const handleBack = useCallback(() => {
    if (projectId) {
      navigate(PROJECT_DETAIL_PATH(projectId));
      return;
    }
    navigate("/projects");
  }, [navigate, projectId]);

  if (!canView) {
    return (
      <div className="project-intake-form-route-page min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Você não possui permissão para visualizar fichas de projeto.
        </div>
      </div>
    );
  }

  return (
    <div className="project-intake-form-route-page min-h-screen bg-slate-100 px-4 py-4 md:px-6 md:py-6 print:bg-white print:p-0">
      <ProjectExecutiveReportPrintControls
        onBack={handleBack}
        onPrint={handlePrint}
        printDisabled={!payload || !!error}
        backLabel={projectId ? "Voltar ao projeto" : "Voltar aos projetos"}
      />

      {loading ? (
        <div className="mx-auto flex max-w-[1180px] items-center justify-center gap-2 py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando ficha...
        </div>
      ) : null}

      {!loading && error ? (
        <div className="mx-auto max-w-[1180px] rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {!loading && quickPayload && !isFull ? (
        <div className="project-intake-form-scroll mx-auto w-full max-w-[900px] print:max-w-none">
          <ProjectIntakeQuickFormDocument payload={quickPayload} />
        </div>
      ) : null}

      {!loading && fullPayload && isFull ? (
        <div className="project-intake-form-scroll mx-auto w-full max-w-[1180px] print:max-w-none">
          <ProjectIntakeFormDocument payload={fullPayload} />
        </div>
      ) : null}
    </div>
  );
}
