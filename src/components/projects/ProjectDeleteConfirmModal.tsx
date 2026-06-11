import React from "react";
import { Loader2 } from "lucide-react";
import { ProjectModalShell } from "@/src/components/projects/ProjectModalShell";

type Props = {
  open: boolean;
  title?: string;
  itemLabel?: string;
  description?: string;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
};

export function ProjectDeleteConfirmModal({
  open,
  title = "Confirmar exclusão",
  itemLabel,
  description = "Esta ação removerá o item apenas deste projeto/simulação. Nenhum cadastro oficial será alterado.",
  saving,
  error,
  onClose,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <ProjectModalShell
      title={title}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="rounded-lg border border-border px-4 py-2 text-sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onConfirm()}
            className="inline-flex items-center gap-2 rounded-lg bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Excluir
          </button>
        </>
      }
    >
      {error ? (
        <div className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">{description}</p>
      {itemLabel ? (
        <p className="mt-3 text-sm font-medium text-foreground">{itemLabel}</p>
      ) : null}
    </ProjectModalShell>
  );
}
