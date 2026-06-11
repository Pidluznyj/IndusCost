import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn, formatCurrency } from "@/src/lib/utils";
import {
  buildProjectStructureSnapshotGroups,
  type ProjectStructureSnapshotGroup,
  type ProjectStructureSnapshotGroupStatus,
  type RootProductMeta,
} from "@/src/lib/projectsStructureSnapshotGroups";
import { ProjectEngineeringTreePanel } from "@/src/components/projects/ProjectEngineeringTreePanel";
import { resolveStructureLineBadges } from "@/src/lib/projectsStructureLineBadges";
import { structureLineTypeLabel } from "@/src/lib/projectsUiUtils";
import type { ProjectSimulatedProductRow, ProjectStructureLineRow } from "@/src/types/projects";

const STATUS_LABEL: Record<ProjectStructureSnapshotGroupStatus, string> = {
  HERDADO: "Herdado",
  ALTERADO: "Alterado",
  SEM_CUSTO: "Sem custo",
  FICTICIO: "Fictício",
};

const STATUS_CLASS: Record<ProjectStructureSnapshotGroupStatus, string> = {
  HERDADO: "bg-blue-100 text-blue-800",
  ALTERADO: "bg-amber-100 text-amber-900",
  SEM_CUSTO: "bg-red-100 text-red-800",
  FICTICIO: "bg-violet-100 text-violet-900",
};

type Props = {
  structureLines: ProjectStructureLineRow[];
  simulatedProducts?: ProjectSimulatedProductRow[];
  canManage: boolean;
  onEditSimulation: (snapshotRootProductId: string) => void;
  onReimport: (snapshotRootProductId: string) => void;
  onDeleteSnapshot: (group: ProjectStructureSnapshotGroup) => void;
  onEditLine: (line: ProjectStructureLineRow) => void;
  onDeleteLine: (line: ProjectStructureLineRow) => void;
  onAddToSimulatedProduct?: (
    productId: string,
    sourceType: "EXISTING_MATERIAL" | "SIMULATED_ITEM" | "MANUAL",
    parentLineId?: string | null
  ) => void;
};

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function renderStructureGroupCard(
  group: ProjectStructureSnapshotGroup,
  options: {
    expanded: boolean;
    canManage: boolean;
    toggleGroup: (key: string) => void;
    onEditSimulation?: (id: string) => void;
    onReimport?: (id: string) => void;
    onDeleteSnapshot?: (group: ProjectStructureSnapshotGroup) => void;
    onAddToSimulatedProduct?: Props["onAddToSimulatedProduct"];
    onEditLine: (line: ProjectStructureLineRow) => void;
    variant: "imported" | "simulated";
  }
) {
  const diffPositive = group.differenceAmount > 0;
  const diffNegative = group.differenceAmount < 0;

  return (
    <div key={group.groupKey} className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <button
            type="button"
            onClick={() => options.toggleGroup(group.groupKey)}
            className="flex w-full items-start gap-2 text-left"
          >
            {options.expanded ? (
              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0">
              <p className="font-semibold">
                {group.rootCode} — {group.rootDescription}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>Origem: {group.sourceLabel}</span>
                {options.variant === "imported" ? (
                  <>
                    <span>Custo oficial: {formatCurrency(group.officialCost)}</span>
                    <span>Custo simulado: {formatCurrency(group.simulatedCost)}</span>
                    <span className={cn(diffPositive && "text-amber-700", diffNegative && "text-emerald-700")}>
                      Dif. R$: {formatCurrency(group.differenceAmount)}
                    </span>
                    <span className={cn(diffPositive && "text-amber-700", diffNegative && "text-emerald-700")}>
                      Dif. %: {formatPct(group.differencePercent)}
                    </span>
                  </>
                ) : (
                  <span>Custo total: {formatCurrency(group.totalCost)}</span>
                )}
                <span>Itens: {group.itemCount}</span>
                <span className={cn("rounded px-1.5 py-0.5 font-semibold", STATUS_CLASS[group.status])}>
                  {STATUS_LABEL[group.status]}
                </span>
              </div>
            </div>
          </button>
        </div>

        {options.canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs"
              onClick={() => options.toggleGroup(group.groupKey)}
            >
              {options.expanded ? "Recolher estrutura" : "Abrir estrutura"}
            </button>
            {options.variant === "imported" && group.snapshotRootProductId ? (
              <>
                <button
                  type="button"
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-950"
                  onClick={() => options.onEditSimulation?.(group.snapshotRootProductId!)}
                >
                  Editar simulação
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  onClick={() => options.onReimport?.(group.snapshotRootProductId!)}
                >
                  <RefreshCw className="mr-1 inline h-3 w-3" />
                  Reimportar
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => options.onDeleteSnapshot?.(group)}
                >
                  <Trash2 className="mr-1 inline h-3 w-3" />
                  Excluir
                </button>
              </>
            ) : null}
            {options.variant === "simulated" && group.simulatedProductId && options.onAddToSimulatedProduct ? (
              <>
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  onClick={() =>
                    options.onAddToSimulatedProduct?.(group.simulatedProductId!, "EXISTING_MATERIAL")
                  }
                >
                  + Matéria-prima
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  onClick={() =>
                    options.onAddToSimulatedProduct?.(group.simulatedProductId!, "SIMULATED_ITEM")
                  }
                >
                  + Componente
                </button>
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  onClick={() => options.onAddToSimulatedProduct?.(group.simulatedProductId!, "MANUAL")}
                >
                  + Manual
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {options.expanded && group.tree ? (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <ProjectEngineeringTreePanel
            tree={group.tree}
            variant="embedded"
            selectedLineId={null}
            onSelectLine={() => {}}
            onEditLine={options.onEditLine}
            canManage={options.canManage}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ProjectStructureSnapshotAccordion({
  structureLines,
  simulatedProducts = [],
  canManage,
  onEditSimulation,
  onReimport,
  onDeleteSnapshot,
  onEditLine,
  onDeleteLine,
  onAddToSimulatedProduct,
}: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [rootProducts, setRootProducts] = useState<Record<string, RootProductMeta>>({});
  const [loadingMeta, setLoadingMeta] = useState(false);

  const snapshotRootIds = useMemo(() => {
    const ids = new Set<string>();
    for (const line of structureLines) {
      if (line.snapshotRootProductId) ids.add(line.snapshotRootProductId);
    }
    return [...ids];
  }, [structureLines]);

  useEffect(() => {
    const missing = snapshotRootIds.filter((id) => !rootProducts[id]);
    if (!missing.length) return;

    let cancelled = false;
    setLoadingMeta(true);
    void (async () => {
      try {
        const entries = await Promise.all(
          missing.map(async (id) => {
            try {
              const snap = await fetchJsonOk<{ sku: string; name: string }>(
                `/api/projects/lookup/products/${id}/snapshot`
              );
              return [id, { sku: snap.sku, name: snap.name }] as const;
            } catch {
              return [id, { sku: id.slice(0, 8), name: "Produto importado" }] as const;
            }
          })
        );
        if (cancelled) return;
        setRootProducts((prev) => {
          const next = { ...prev };
          for (const [id, meta] of entries) next[id] = meta;
          return next;
        });
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [snapshotRootIds, rootProducts]);

  const { snapshotGroups, simulatedProductGroups, manualLines } = useMemo(
    () =>
      buildProjectStructureSnapshotGroups(structureLines, {
        rootProducts,
        simulatedProducts,
      }),
    [structureLines, rootProducts, simulatedProducts]
  );

  const toggleGroup = (groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {snapshotGroups.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h5 className="text-sm font-semibold text-muted-foreground">
              Produtos importados / simulados
            </h5>
            <p className="mt-1 text-xs text-muted-foreground">
              Clique em Abrir estrutura para visualizar a engenharia importada deste produto.
            </p>
          </div>
          {loadingMeta && !Object.keys(rootProducts).length ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando produtos…
            </div>
          ) : null}
          {snapshotGroups.map((group) =>
            renderStructureGroupCard(group, {
              expanded: expandedGroups.has(group.groupKey),
              canManage,
              toggleGroup,
              onEditSimulation,
              onReimport,
              onDeleteSnapshot,
              onEditLine,
              variant: "imported",
            })
          )}
        </div>
      ) : null}

      {simulatedProductGroups.length > 0 ? (
        <div className="space-y-3">
          <div>
            <h5 className="text-sm font-semibold text-muted-foreground">Produtos do projeto (engenharia isolada)</h5>
            <p className="mt-1 text-xs text-muted-foreground">
              Monte BOM provisória com matérias-primas oficiais e componentes do projeto — sem alterar cadastro.
            </p>
          </div>
          {simulatedProductGroups.map((group) =>
            renderStructureGroupCard(group, {
              expanded: expandedGroups.has(group.groupKey),
              canManage,
              toggleGroup,
              onAddToSimulatedProduct,
              onEditLine,
              variant: "simulated",
            })
          )}
        </div>
      ) : null}

      {manualLines.length > 0 ? (
        <div className="space-y-3">
          <h5 className="text-sm font-semibold text-muted-foreground">Itens manuais do projeto</h5>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Qtd</th>
                  <th className="px-3 py-2">Un.</th>
                  <th className="px-3 py-2">Perda</th>
                  <th className="px-3 py-2">Custo un.</th>
                  <th className="px-3 py-2">Total</th>
                  {canManage ? <th className="px-3 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {manualLines.map((line) => {
                  const badges = resolveStructureLineBadges(line);
                  return (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="px-3 py-2">
                      <div className="space-y-1">
                        <span>{structureLineTypeLabel(line)}</span>
                        <div className="flex flex-wrap gap-1">
                          {badges.map((b) => (
                            <span
                              key={b.key}
                              title={b.title}
                              className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", b.className)}
                            >
                              {b.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{line.descriptionSnapshot}</td>
                    <td className="px-3 py-2">{line.quantity}</td>
                    <td className="px-3 py-2">{line.unitSnapshot}</td>
                    <td className="px-3 py-2">{line.lossPercent ?? 0}%</td>
                    <td className="px-3 py-2">{formatCurrency(line.unitCostSnapshot)}</td>
                    <td className="px-3 py-2">{formatCurrency(line.totalCost)}</td>
                    {canManage ? (
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            title="Editar"
                            onClick={() => onEditLine(line)}
                            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-muted"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Excluir"
                            onClick={() => onDeleteLine(line)}
                            className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {!snapshotGroups.length && !simulatedProductGroups.length && !manualLines.length ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhuma linha de estrutura. Importe um produto ou adicione itens manuais.
        </p>
      ) : null}
    </div>
  );
}
