import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { DraftOverrideMap } from "@/src/lib/userPermissionsAdminUi";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

function FlagChecks({
  flags,
  readOnly,
  onChange,
}: {
  flags: { canView: boolean; canExecute: boolean; canManage: boolean };
  readOnly?: boolean;
  onChange: (next: { canView: boolean; canExecute: boolean; canManage: boolean }) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px]">
      {(
        [
          ["canView", "Ver"],
          ["canExecute", "Executar"],
          ["canManage", "Gerenciar"],
        ] as const
      ).map(([key, label]) => (
        <label key={key} className="inline-flex items-center gap-1.5 text-muted-foreground">
          <input
            type="checkbox"
            className="rounded border-border"
            checked={flags[key]}
            disabled={readOnly}
            onChange={(e) => {
              const checked = e.target.checked;
              if (key === "canView") {
                onChange({
                  canView: checked,
                  canExecute: checked ? flags.canExecute : false,
                  canManage: checked ? flags.canManage : false,
                });
                return;
              }
              onChange({
                ...flags,
                canView: checked || flags.canView ? true : flags.canView,
                [key]: checked,
                ...(checked ? { canView: true } : {}),
              });
            }}
          />
          <span className="font-medium text-foreground">{label}</span>
        </label>
      ))}
    </div>
  );
}

function TreeNodeRow({
  node,
  depth,
  expanded,
  onToggleExpand,
  draft,
  onDraftChange,
  readOnly,
}: {
  node: EditableTreeNodeDto;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  draft: DraftOverrideMap;
  onDraftChange: (key: string, flags: DraftOverrideMap[string]) => void;
  readOnly?: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.key);
  const flags = draft[node.key] ?? node.effectiveFlags;
  const customized =
    flags.canView !== node.roleFlags.canView ||
    flags.canExecute !== node.roleFlags.canExecute ||
    flags.canManage !== node.roleFlags.canManage;

  return (
    <div className="space-y-1">
      <div
        className={cn(
          "rounded-lg border border-border/70 bg-background px-2.5 py-2",
          customized && "border-amber-200/80 bg-amber-50/40"
        )}
        style={{ marginLeft: depth * 12 }}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1">
              {hasChildren ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                  aria-expanded={isOpen}
                  onClick={() => onToggleExpand(node.key)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="inline-block w-4" />
              )}
              <span className="text-xs font-semibold text-foreground">{node.label}</span>
              <span className="text-[9px] uppercase text-muted-foreground">{node.type}</span>
              {customized ? (
                <span className="rounded-full bg-amber-100 px-1.5 py-0 text-[9px] font-bold uppercase text-amber-900">
                  Custom
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 pl-5 text-[10px] text-muted-foreground">{node.description}</p>
          </div>
          <FlagChecks
            flags={flags}
            readOnly={readOnly}
            onChange={(next) => onDraftChange(node.key, next)}
          />
        </div>
      </div>
      {hasChildren && isOpen
        ? node.children.map((child) => (
            <TreeNodeRow
              key={child.key}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              draft={draft}
              onDraftChange={onDraftChange}
              readOnly={readOnly}
            />
          ))
        : null}
    </div>
  );
}

export function UserPermissionTree({
  tree,
  draft,
  onDraftChange,
  expanded,
  onToggleExpand,
  readOnly,
}: {
  tree: EditableTreeNodeDto[];
  draft: DraftOverrideMap;
  onDraftChange: (key: string, flags: DraftOverrideMap[string]) => void;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  readOnly?: boolean;
}) {
  if (tree.length === 0) {
    return <p className="text-sm text-muted-foreground py-6">Nenhum recurso encontrado.</p>;
  }
  return (
    <div className="space-y-1.5" data-testid="user-permission-tree">
      {tree.map((node) => (
        <TreeNodeRow
          key={node.key}
          node={node}
          depth={0}
          expanded={expanded}
          onToggleExpand={onToggleExpand}
          draft={draft}
          onDraftChange={onDraftChange}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}
