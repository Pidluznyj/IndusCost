import React from "react";
import { Box, Layers, Loader2, Pencil, Settings } from "lucide-react";
import { cn, formatCurrency } from "@/src/lib/utils";
import { resolveStructureLineBadges } from "@/src/lib/projectsStructureLineBadges";
import type { ProjectEngineeringTreeNode } from "@/src/lib/projectsEngineeringTree";
import type { ProjectStructureLineRow } from "@/src/types/projects";

function LineBadges({
  line,
  hasChildren,
}: {
  line: ProjectStructureLineRow;
  hasChildren: boolean;
}) {
  const badges = resolveStructureLineBadges(line, { hasChildren });
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          title={badge.title}
          className={cn(
            "rounded px-1.5 py-0.5 text-[9px] font-semibold",
            badge.className
          )}
        >
          {badge.label}
        </span>
      ))}
    </div>
  );
}

const TreeRow: React.FC<{
  node: ProjectEngineeringTreeNode;
  depth: number;
  selectedId: string | null;
  onSelect: (line: ProjectStructureLineRow | null) => void;
  onEditLine?: (line: ProjectStructureLineRow) => void;
  canManage?: boolean;
}> = ({ node, depth, selectedId, onSelect, onEditLine, canManage }) => {
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
              <div className="flex shrink-0 items-center gap-2">
                {node.line ? (
                  <p className="text-[10px] font-bold text-primary">Qtd: {node.line.quantity}</p>
                ) : null}
                {canManage && node.line && onEditLine ? (
                  <button
                    type="button"
                    title="Editar linha"
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditLine(node.line!);
                    }}
                    className="rounded border border-border p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">{node.code}</p>
            {node.line ? (
              <>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Custo un.: {formatCurrency(node.line.unitCostSnapshot)} · Total:{" "}
                  {formatCurrency(node.line.totalCost)}
                </p>
                <LineBadges line={node.line} hasChildren={node.children.length > 0} />
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
              onEditLine={onEditLine}
              canManage={canManage}
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
  variant?: "default" | "embedded";
  onEditLine?: (line: ProjectStructureLineRow) => void;
  canManage?: boolean;
};

export function ProjectEngineeringTreePanel({
  tree,
  loading,
  selectedLineId,
  onSelectLine,
  variant = "default",
  onEditLine,
  canManage,
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

  if (variant === "embedded") {
    return (
      <div className="space-y-2">
        {tree.children.map((child) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={0}
            selectedId={selectedLineId}
            onSelect={onSelectLine}
            onEditLine={onEditLine}
            canManage={canManage}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <TreeRow
        node={tree}
        depth={0}
        selectedId={selectedLineId}
        onSelect={onSelectLine}
        onEditLine={onEditLine}
        canManage={canManage}
      />
    </div>
  );
}
