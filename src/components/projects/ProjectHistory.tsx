import React, { useMemo } from "react";
import { Loader2, Plus } from "lucide-react";
import type { ProjectDetail, ProjectStatus } from "@/src/types/projects";

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Rascunho",
  TECHNICAL_ANALYSIS: "Análise técnica",
  WAITING_QUOTATION: "Aguardando cotação",
  WAITING_INTERNAL_APPROVAL: "Aguardando aprovação interna",
  SENT_TO_CUSTOMER: "Enviado ao cliente",
  NEGOTIATION: "Negociação",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  CANCELLED: "Cancelado",
  CONVERTED: "Convertido",
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

type HistoryEvent = {
  id: string;
  at: string;
  kind: string;
  message: string;
};

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  notesDraft: string;
  notesStatus: "idle" | "saving" | "saved" | "error";
  saving?: boolean;
  onNotesChange: (value: string) => void;
  onSaveNotes: () => void;
  onCreateVersion: () => void;
};

export function ProjectHistory({
  detail,
  canManage,
  notesDraft,
  notesStatus,
  saving,
  onNotesChange,
  onSaveNotes,
  onCreateVersion,
}: Props) {
  const events = useMemo(() => {
    const list: HistoryEvent[] = [
      {
        id: "created",
        at: detail.createdAt,
        kind: "Projeto criado",
        message: `Projeto ${detail.code} — ${detail.title}`,
      },
    ];

    for (const v of detail.versions) {
      list.push({
        id: `version-${v.id}`,
        at: v.createdAt,
        kind: v.isCurrent ? "Versão atual" : "Versão criada",
        message: `Versão v${v.versionNumber} · status ${PROJECT_STATUS_LABEL[v.status]} · custo un. ${v.unitCost ?? "—"}`,
      });
    }

    if (detail.simulatedProducts.length > 0) {
      list.push({
        id: "products",
        at: detail.updatedAt,
        kind: "Itens locais",
        message: `${detail.simulatedProducts.length} produto(s)/componente(s) local(is) no projeto`,
      });
    }

    const clonedCount = detail.structureLines.filter((l) => l.snapshotRootProductId).length;
    if (clonedCount > 0) {
      list.push({
        id: "clones",
        at: detail.updatedAt,
        kind: "Itens clonados",
        message: `${clonedCount} linha(s) de engenharia clonada(s) de itens oficiais`,
      });
    }

    if (detail.notes?.trim()) {
      list.push({
        id: "notes",
        at: detail.updatedAt,
        kind: "Comentário",
        message: detail.notes.trim().slice(0, 120),
      });
    }

    if (detail.status === "APPROVED") {
      list.push({
        id: "approved",
        at: detail.updatedAt,
        kind: "Aprovação",
        message: "Projeto aprovado — promoção para cadastro mestre disponível futuramente.",
      });
    }

    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [detail]);

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Histórico</h4>
        <p className="mt-1 text-sm text-muted-foreground">
          Linha do tempo de versões, itens, custos e observações do projeto.
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onCreateVersion}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Criar nova versão
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        {events.map((ev) => (
          <div
            key={ev.id}
            className="flex gap-4 rounded-xl border border-border bg-card px-4 py-3 text-sm"
          >
            <div className="w-36 shrink-0 text-xs text-muted-foreground">{formatDate(ev.at)}</div>
            <div>
              <p className="font-medium">{ev.kind}</p>
              <p className="mt-0.5 text-muted-foreground">{ev.message}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <h5 className="font-semibold">Observações e comentários</h5>
          {canManage ? (
            <div className="flex items-center gap-2">
              {notesStatus === "saved" ? (
                <span className="text-xs text-emerald-700">Salvo</span>
              ) : null}
              {notesStatus === "error" ? (
                <span className="text-xs text-destructive">Erro ao salvar</span>
              ) : null}
              <button
                type="button"
                disabled={saving || notesStatus === "saving"}
                onClick={onSaveNotes}
                className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
              >
                {notesStatus === "saving" ? "Salvando..." : "Salvar"}
              </button>
            </div>
          ) : null}
        </div>
        {canManage ? (
          <textarea
            className="mt-3 min-h-[120px] w-full rounded-lg border border-border px-3 py-2 text-sm"
            value={notesDraft}
            onChange={(e) => onNotesChange(e.target.value)}
          />
        ) : (
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">
            {detail.notes ?? "Sem observações."}
          </p>
        )}
      </div>
    </div>
  );
}
