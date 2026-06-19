import React from "react";
import { Link } from "react-router-dom";
import { ClipboardList, FileText, Upload } from "lucide-react";
import {
  getProjectIntakeFormPath,
  PROJECT_INTAKE_FORM_BUTTON_LABEL,
} from "@/src/lib/projectsIntakeForm";

type Props = {
  canManage: boolean;
  projectId?: string | null;
};

export function ProjectDocuments({ canManage, projectId }: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">Documentos</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Anexos do projeto, ficha de abertura imprimível e checklist de documentos técnicos.
          </p>
        </div>
        {projectId ? (
          <Link
            to={getProjectIntakeFormPath(projectId)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            <ClipboardList className="h-4 w-4" />
            {PROJECT_INTAKE_FORM_BUTTON_LABEL}
          </Link>
        ) : null}
      </div>

      {projectId ? (
        <div className="rounded-xl border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Use a <strong>Ficha de Abertura de Projeto</strong> para reunir dados com cliente,
              comercial, engenharia e custos antes de avançar a simulação. O sistema preenche
              automaticamente o que já existir no projeto e deixa linhas em branco para completar
              em reunião ou impressão.
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
        <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Repositório de documentos em preparação</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nesta fase, os anexos podem ser registrados nas observações do projeto. Upload estruturado
          será integrado em versão futura.
        </p>
        {canManage ? (
          <button
            type="button"
            disabled
            title="Em breve"
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm opacity-50"
          >
            <Upload className="h-4 w-4" />
            Anexar documento
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs">Em breve</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
