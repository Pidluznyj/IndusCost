/**
 * Legado visual — não montar em AdminUsersModule.
 * Edição de overrides do usuário: PermissionMatrix + userPermissionsMatrix (Prompt 10).
 * Mantido para referência / possíveis imports internos; não usar em novas UIs.
 */
import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  permissionResourceTypeLabel,
  type DraftOverrideMap,
} from "@/src/lib/userPermissionsAdminUi";
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
      {(
        [
          ["canView", "Ver", "Pode abrir e visualizar esta área"],
          ["canExecute", "Executar", "Pode executar ações nesta área"],
          ["canManage", "Gerenciar", "Pode configurar ou administrar esta área"],
        ] as const
      ).map(([key, label, title]) => (
        <label
          key={key}
          title={title}
          className="inline-flex items-center gap-1.5 text-muted-foreground cursor-pointer select-none"
        >
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-border"
            checked={flags[key]}
            disabled={readOnly}
            aria-label={label}
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
    <div className="space-y-1.5">
      <div
        className={cn(
          "rounded-lg border border-border/70 bg-background px-2.5 py-2.5 sm:px-3",
          customized && "border-amber-300/70 bg-amber-50/50"
        )}
        style={{ marginLeft: Math.min(depth, 6) * 10 }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              {hasChildren ? (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent"
                  aria-expanded={isOpen}
                  aria-label={isOpen ? `Recolher ${node.label}` : `Expandir ${node.label}`}
                  onClick={() => onToggleExpand(node.key)}
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="inline-block w-4" aria-hidden />
              )}
              <span className="text-xs font-semibold text-foreground leading-snug">
                {node.label}
              </span>
              <span
                className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground"
                title={permissionResourceTypeLabel(node.type)}
              >
                {permissionResourceTypeLabel(node.type)}
              </span>
              {customized ? (
                <span
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-950"
                  title="Diferente do padrão do perfil"
                >
                  Personalizado
                </span>
              ) : null}
            </div>
            {node.description ? (
              <p className="mt-1 pl-5 text-[11px] leading-relaxed text-muted-foreground">
                {node.description}
              </p>
            ) : null}
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
  emptyMessage = "Nenhuma área encontrada.",
}: {
  tree: EditableTreeNodeDto[];
  draft: DraftOverrideMap;
  onDraftChange: (key: string, flags: DraftOverrideMap[string]) => void;
  expanded: Set<string>;
  onToggleExpand: (key: string) => void;
  readOnly?: boolean;
  emptyMessage?: string;
}) {
  if (tree.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    );
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
