import React from "react";
import { Box, Layers, Loader2, Settings } from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import type { ProjectEngineeringTreeNode } from "@/src/lib/projectsEngineeringTree";
import type { ProjectStructureLineRow } from "@/src/types/projects";

function LineBadges({ line }: { line: ProjectStructureLineRow }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {line.sourceType === "EXISTING_MATERIAL" || line.sourceType === "EXISTING_PRODUCT" ? (
        <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-800">
          Herdado
        </span>
      ) : null}
      {line.isChangedFromOfficial ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-900">
          Alterado
        </span>
      ) : null}
      {line.sourceType === "SIMULATED_ITEM" || line.sourceType === "MANUAL" ? (
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-900">
          {line.sourceType === "SIMULATED_ITEM" ? "Fictício" : "Manual"}
        </span>
      ) : null}
      {line.isMissingCost || line.unitCostSnapshot <= 0 ? (
        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold text-red-800">
          Sem custo
        </span>
      ) : null}
    </div>
  );
}

const TreeRow: React.FC<{
  node: ProjectEngineeringTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (line: ProjectStructureLineRow | null) => void;
}> = ({ node, depth, selectedId, onSelect }) => {
  const isComponent = node.nodeType === "PRODUCT" || node.nodeType === "ROOT";
  const isProcess = node.nodeType === "PROCESS";
  const isSelected = node.line ? selectedId === node.line.id : selectedId === node.id;

  return (
    <div className={cn("relative", depth > 0 && "mt-2")}>
      {depth > 0 ? <div className="absolute -left-6 top-4 h-px w-6 bg-border" /> : null}
      <button
        type="button"
        onClick={() => onSelect(node.line)}
        className={cn(
          "w-full rounded-lg border p-3 text-left transition-colors",
          isSelected
            ? "border-primary bg-primary/10 ring-2 ring-primary/30"
            : "border-border bg-accent/20 hover:border-primary/40"
        )}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded",
              isProcess
                ? "bg-sky-500/10 text-sky-700"
                : isComponent
                  ? "bg-purple-500/10 text-purple-600"
                  : "bg-orange-500/10 text-orange-600"
            )}
          >
            {isProcess ? (
              <Settings className="h-4 w-4" />
            ) : isComponent ? (
              <Layers className="h-4 w-4" />
            ) : (
              <Box className="h-4 w-4" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-bold">{node.label}</p>
              {node.line ? (
                <p className="shrink-0 text-[10px] font-bold text-primary">
                  Qtd: {node.line.quantity}
                </p>
              ) : null}
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{node.code}</p>
            {node.line ? (
              <>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Custo un.: {formatCurrency(node.line.unitCostSnapshot)} · Total:{" "}
                  {formatCurrency(node.line.totalCost)}
                </p>
                <LineBadges line={node.line} />
              </>
            ) : null}
          </div>
        </div>
      </button>
      {node.children.length > 0 ? (
        <div className="ml-6 mt-2 space-y-2 border-l-2 border-border pl-6">
          {node.children.map((child) => (
            <TreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

type Props = {
  tree: ProjectEngineeringTreeNode;
  loading?: boolean;
  selectedLineId: string | null;
  onSelectLine: (line: ProjectStructureLineRow | null) => void;
};

export function ProjectEngineeringTreePanel({
  tree,
  loading,
  selectedLineId,
  onSelectLine,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Carregando árvore de engenharia…
      </div>
    );
  }

  if (!tree.children.length) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Nenhuma linha importada. Use &quot;Importar BOM oficial como snapshot&quot; para carregar a
        engenharia completa.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <TreeRow
        node={tree}
        depth={0}
        selectedId={selectedLineId}
        onSelect={onSelectLine}
      />
    </div>
  );
}
