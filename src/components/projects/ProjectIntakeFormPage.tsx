import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { canManageProjects, canViewProjects } from "@/src/lib/projectsPermissions";
import {
  buildBlankProjectIntakeForm,
  type ProjectIntakeFormPayload,
  intakeFormPathRequestsPrint,
  isBlankProjectIntakeFormPath,
  isFullIntakeFormPath,
  PROJECT_INTAKE_FORM_FULL_TITLE,
} from "@/src/lib/projectsIntakeForm";
import {
  buildBlankQuickIntakeForm,
  PROJECT_INTAKE_QUICK_FORM_TITLE,
  type ProjectIntakeQuickFormPayload,
} from "@/src/lib/projectsIntakeQuickForm";
import { PROJECT_DETAIL_PATH } from "@/src/lib/projectsNavigation";
import { ProjectIntakeFormDocument } from "@/src/components/projects/ProjectIntakeFormDocument";
import { ProjectIntakeQuickFormDocument } from "@/src/components/projects/ProjectIntakeQuickFormDocument";
import { ProjectExecutiveReportPrintControls } from "@/src/components/projects/ProjectExecutiveReportPrintControls";
import { ProjectDocumentIssueBar } from "@/src/components/projects/documents/ProjectDocumentIssueBar";
import { useProjectDocument } from "@/src/components/projects/documents/useProjectDocument";

const ROUTE_BODY_CLASS = "project-intake-form-route";

export function ProjectIntakeFormPage() {
  const auth = useAuth();
  const canView = canViewProjects(auth);
  const canManage = canManageProjects(auth);
  const { projectId } = useParams<{ projectId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const routeEntryTitleRef = useRef<string | null>(null);
  const autoPrintedRef = useRef(false);

  const isBlank = isBlankProjectIntakeFormPath(location.pathname);
  const isFull = isFullIntakeFormPath(location.pathname);
  const wantsPrint = intakeFormPathRequestsPrint(location.pathname);
  // Ficha de projeto: montada no servidor (dados reais + precificação salva). Em branco: local.
  const doc = useProjectDocument<ProjectIntakeQuickFormPayload | ProjectIntakeFormPayload>(
    projectId,
    isFull ? "FULL_FORM" : "QUICK_FORM",
    canView && !isBlank && !!projectId,
  );
  const loading = !isBlank && doc.loading;
  const error = !canView
    ? "Você não possui permissão para visualizar fichas de projeto."
    : !isBlank && !projectId
      ? "Projeto inválido."
      : isBlank
        ? null
        : doc.error;

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

  const quickPayload = useMemo(() => {
    if (isFull) return null;
    const generatedBy = auth.authUser?.name ?? auth.authUser?.email ?? null;
    if (isBlank) return buildBlankQuickIntakeForm({ generatedBy });
    return (doc.envelope?.body as ProjectIntakeQuickFormPayload | undefined) ?? null;
  }, [auth.authUser?.email, auth.authUser?.name, doc.envelope, isBlank, isFull]);

  const fullPayload = useMemo(() => {
    if (!isFull) return null;
    const generatedBy = auth.authUser?.name ?? auth.authUser?.email ?? null;
    if (isBlank) return buildBlankProjectIntakeForm({ generatedBy });
    return (doc.envelope?.body as ProjectIntakeFormPayload | undefined) ?? null;
  }, [auth.authUser?.email, auth.authUser?.name, doc.envelope, isBlank, isFull]);
  const documentHeader = isBlank ? null : doc.envelope?.header ?? null;
  const sha256 = isBlank ? null : doc.issued?.payloadSha256 ?? null;

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
      {!isBlank && payload ? <ProjectDocumentIssueBar state={doc} canIssue={canManage} /> : null}

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
          <ProjectIntakeQuickFormDocument payload={quickPayload} documentHeader={documentHeader} sha256={sha256} />
        </div>
      ) : null}

      {!loading && fullPayload && isFull ? (
        <div className="project-intake-form-scroll mx-auto w-full max-w-[1180px] print:max-w-none">
          <ProjectIntakeFormDocument payload={fullPayload} documentHeader={documentHeader} sha256={sha256} />
        </div>
      ) : null}
    </div>
  );
}
