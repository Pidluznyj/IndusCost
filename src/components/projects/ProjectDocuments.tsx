import React from "react";
import { FileText, Upload } from "lucide-react";

type Props = {
  canManage: boolean;
};

export function ProjectDocuments({ canManage }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-lg font-semibold">Documentos</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Anexos do projeto: desenhos, PDFs, propostas, especificações, imagens e planilhas.
        </p>
      </div>

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
