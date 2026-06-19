import React from "react";
import { ProjectIntakeActions } from "@/src/components/projects/ProjectIntakeActions";

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
            Ficha rápida de estimativa, dossiê completo e planilha modelo para abertura de projetos.
          </p>
        </div>
        {projectId ? <ProjectIntakeActions projectId={projectId} layout="documents" /> : null}
      </div>

      {projectId ? (
        <div className="rounded-xl border border-border bg-muted/10 px-4 py-3 text-sm text-muted-foreground">
          <p>
            Use a <strong>Ficha rápida</strong> em reuniões para marcar tipo, entregáveis e estimativas
            preliminares. A <strong>Ficha completa</strong> reúne o dossiê detalhado. A{" "}
            <strong>planilha modelo</strong> prepara dados para preenchimento offline e futura importação.
          </p>
        </div>
      ) : null}

      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-6 py-12 text-center">
        <p className="text-sm font-medium">Repositório de anexos em preparação</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Nesta fase, documentos complementares podem ser registrados nas observações do projeto.
        </p>
        {canManage ? (
          <p className="mt-3 text-xs text-muted-foreground">Upload estruturado — em breve</p>
        ) : null}
      </div>
    </div>
  );
}
