import React, { useMemo } from "react";
import { Copy, Link2, Loader2, Plus } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  buildProjectEngineeringItems,
  computeProjectEngineeringStats,
  PROJECT_ENGINEERING_MASTER_DATA_NOTICE,
  PROJECT_ENGINEERING_TAB_SUBTITLE,
  resolveProjectEngineeringItemBadges,
  type ProjectEngineeringItemRow,
} from "@/src/lib/projectsEngineeringWorkspace";
import type { ProjectDetail } from "@/src/types/projects";

function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR");
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

type Props = {
  detail: ProjectDetail;
  canManage: boolean;
  saving?: boolean;
  onNewItem: () => void;
  onCloneItem: () => void;
  onAddOfficialItem: () => void;
  onEditItem: (item: ProjectEngineeringItemRow) => void;
  onCreateLocalVariation: (item: ProjectEngineeringItemRow) => void;
  onDeleteProduct: (id: string, label: string) => void;
  onDeleteSimulatedItem: (id: string, label: string) => void;
  onDeleteSnapshot: (snapshotRootProductId: string, label: string) => void;
};

export function ProjectEngineeringTab({
  detail,
  canManage,
  saving,
  onNewItem,
  onCloneItem,
  onAddOfficialItem,
  onEditItem,
  onCreateLocalVariation,
  onDeleteProduct,
  onDeleteSimulatedItem,
  onDeleteSnapshot,
}: Props) {
  const stats = useMemo(() => computeProjectEngineeringStats(detail), [detail]);
  const items = useMemo(() => buildProjectEngineeringItems(detail), [detail]);

  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-lg font-semibold">Engenharia do Projeto</h4>
        <p className="mt-1 text-sm text-muted-foreground">{PROJECT_ENGINEERING_TAB_SUBTITLE}</p>
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          {PROJECT_ENGINEERING_MASTER_DATA_NOTICE}
        </p>
      </div>

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onNewItem}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Novo item do projeto
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onCloneItem}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50 disabled:opacity-60"
          >
            <Copy className="h-4 w-4" />
            Clonar item existente
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={onAddOfficialItem}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm hover:bg-muted/50 disabled:opacity-60"
          >
            <Link2 className="h-4 w-4" />
            Adicionar item oficial
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Itens locais" value={stats.localItemsCount} />
        <StatCard label="Itens clonados" value={stats.clonedItemsCount} />
        <StatCard label="Itens oficiais usados" value={stats.officialItemsUsedCount} />
        <StatCard label="Itens sem custo calculado" value={stats.itemsWithoutCostCount} />
        <StatCard label="Custo total simulado" value={formatMoney(stats.totalSimulatedCost)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left">
            <tr>
              <th className="px-3 py-2 font-medium">Código temporário</th>
              <th className="px-3 py-2 font-medium">Nome do item</th>
              <th className="px-3 py-2 font-medium">Tipo</th>
              <th className="px-3 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Custo simulado</th>
              <th className="px-3 py-2 font-medium">Item oficial de origem</th>
              <th className="px-3 py-2 font-medium">Última atualização</th>
              <th className="px-3 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum item de engenharia neste projeto. Use as ações acima para começar.
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const badges = resolveProjectEngineeringItemBadges(item);
                return (
                  <tr key={`${item.kind}-${item.id}`} className="border-b border-border/60">
                    <td className="px-3 py-2">{item.provisionalCode ?? "—"}</td>
                    <td className="px-3 py-2">{item.name}</td>
                    <td className="px-3 py-2">{item.itemType}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {badges.map((b) => (
                          <span
                            key={b.key}
                            title={b.title}
                            className={cn("rounded px-2 py-0.5 text-xs", b.className)}
                          >
                            {b.label}
                          </span>
                        ))}
                      </div>
                      <span className="mt-1 block text-xs text-muted-foreground">{item.originLabel}</span>
                    </td>
                    <td className="px-3 py-2">{item.status}</td>
                    <td className="px-3 py-2">{formatMoney(item.simulatedCost)}</td>
                    <td className="px-3 py-2">
                      {item.officialOriginCode
                        ? `${item.officialOriginCode}${item.officialOriginName ? ` — ${item.officialOriginName}` : ""}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">{formatDate(item.updatedAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-muted"
                          onClick={() => onEditItem(item)}
                        >
                          Abrir
                        </button>
                        {!item.isEditableLocally &&
                        item.snapshotRootProductId &&
                        canManage ? (
                          <button
                            type="button"
                            className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-950 hover:bg-amber-100"
                            onClick={() => onCreateLocalVariation(item)}
                          >
                            Criar variação local
                          </button>
                        ) : null}
                        {canManage && item.kind === "simulated_product" && item.simulatedProductId ? (
                          <button
                            type="button"
                            className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              onDeleteProduct(item.simulatedProductId!, item.name)
                            }
                          >
                            Excluir
                          </button>
                        ) : null}
                        {canManage && item.kind === "simulated_item" && item.simulatedItemId ? (
                          <button
                            type="button"
                            className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              onDeleteSimulatedItem(item.simulatedItemId!, item.name)
                            }
                          >
                            Excluir
                          </button>
                        ) : null}
                        {canManage &&
                        item.kind === "cloned_snapshot" &&
                        item.snapshotRootProductId ? (
                          <button
                            type="button"
                            className="rounded-lg border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                            onClick={() =>
                              onDeleteSnapshot(
                                item.snapshotRootProductId!,
                                `${item.provisionalCode ?? ""} — ${item.name}`
                              )
                            }
                          >
                            Remover clone
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
