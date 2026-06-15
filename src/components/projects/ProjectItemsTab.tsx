import React from "react";
import { Plus } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildProjectGuidedItems,
  PROJECT_GUIDED_MASTER_NOTICE,
  type ProjectGuidedItemRow,
} from "@/src/lib/projectsGuidedFlow";
import { formatProjectGuidedItemCost } from "@/src/lib/projectsUiUtils";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

type Props = {
  items: ProjectGuidedItemRow[];
  canManage: boolean;
  onAddItem: () => void;
  onCreateMold: () => void;
  onCreateOtherCost: () => void;
  onOpenItem: (item: ProjectGuidedItemRow) => void;
  onDeleteItem?: (item: ProjectGuidedItemRow) => void;
};

export function ProjectItemsTab({
  items,
  canManage,
  onAddItem,
  onCreateMold,
  onCreateOtherCost,
  onOpenItem,
  onDeleteItem,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-semibold">Itens do Projeto</h4>
          <p className="mt-1 text-sm text-muted-foreground">
            Produtos oficiais, simulações, moldes e custos adicionais vinculados a este projeto.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{PROJECT_GUIDED_MASTER_NOTICE}</p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onAddItem}>
              <Plus className="mr-1 inline h-4 w-4" />
              Adicionar item
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onCreateMold}>
              Criar molde
            </button>
            <button type="button" className="rounded-lg border px-3 py-1.5 text-sm" onClick={onCreateOtherCost}>
              Adicionar custo
            </button>
          </div>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Código/Nome</th>
              <th className="px-3 py-2">Descrição</th>
              <th className="px-3 py-2">Origem</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Custo estimado</th>
              <th className="px-3 py-2">Última atualização</th>
              <th className="px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum item cadastrado. Use o assistente na aba Início para começar.
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={`${item.entityKind}-${item.id}`} className="border-b border-border/60">
                  <td className="px-3 py-2">{item.itemTypeLabel}</td>
                  <td className="px-3 py-2">{item.code ?? item.name}</td>
                  <td className="px-3 py-2">{item.description}</td>
                  <td className="px-3 py-2">{item.originLabel}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded px-2 py-0.5 text-xs",
                        item.status === "PENDING_COST"
                          ? "bg-amber-100 text-amber-900"
                          : "bg-slate-100 text-slate-800"
                      )}
                    >
                      {item.statusLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {formatProjectGuidedItemCost(item.estimatedCost, item.status)}
                  </td>
                  <td className="px-3 py-2">{formatDate(item.updatedAt)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-lg border px-2 py-1 text-xs hover:bg-muted"
                        onClick={() => onOpenItem(item)}
                      >
                        Abrir
                      </button>
                      {canManage && onDeleteItem ? (
                        <button
                          type="button"
                          className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                          onClick={() => onDeleteItem(item)}
                        >
                          Remover
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
