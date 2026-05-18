import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { PERMISSION_GROUP_ORDER } from "@/src/lib/permissionCatalog";
import {
  applyTemplatePermissions,
  buildGroupTree,
  clearGroup,
  groupCatalogEntries,
  riskBadgeLabel,
  selectAllInGroup,
  selectViewOnlyForGroup,
  summarizePermissionSelection,
  togglePermissionSelected,
  type PermissionTemplateId,
  PERMISSION_TEMPLATES,
  type PermissionTreeNode,
} from "@/src/lib/permissionCatalogUtils";
import { MODULE_LABELS, type AppModuleId } from "@/src/lib/modulePermissions";

export type PermissionEditorProps = {
  selected: string[];
  onChange: (permissions: string[]) => void;
  readOnly?: boolean;
};

function PermissionRow({
  node,
  depth,
  selected,
  onToggle,
  readOnly,
}: {
  node: PermissionTreeNode;
  depth: number;
  selected: string[];
  onToggle: (key: string, enabled: boolean) => void;
  readOnly?: boolean;
}) {
  const checked = selected.includes(node.key);
  const badge = riskBadgeLabel(node.risk);

  return (
    <div className="space-y-1">
      <label
        className={cn(
          "flex items-start gap-2 rounded-lg border border-border/60 bg-background px-2 py-2 text-xs cursor-pointer hover:bg-accent/30",
          readOnly && "opacity-70 cursor-default"
        )}
        style={{ marginLeft: depth * 16 }}
      >
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          disabled={readOnly}
          onChange={(e) => onToggle(node.key, e.target.checked)}
        />
        <span className="min-w-0 flex-1">
          <span className="font-semibold block flex flex-wrap items-center gap-1.5">
            {node.label}
            {badge ? (
              <span
                className={cn(
                  "text-[9px] uppercase px-1.5 py-0.5 rounded-full font-bold",
                  node.risk === "critical"
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
                )}
              >
                {badge}
              </span>
            ) : null}
            <span className="text-[9px] text-muted-foreground font-normal uppercase">{node.type}</span>
          </span>
          <span className="text-muted-foreground">{node.description}</span>
        </span>
      </label>
      {node.children.map((child) => (
        <div key={child.key}>
          <PermissionRow
            node={child}
            depth={depth + 1}
            selected={selected}
            onToggle={onToggle}
            readOnly={readOnly}
          />
        </div>
      ))}
    </div>
  );
}

export const PermissionEditor: React.FC<PermissionEditorProps> = ({
  selected,
  onChange,
  readOnly = false,
}) => {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => groupCatalogEntries(), []);

  const summary = useMemo(
    () =>
      summarizePermissionSelection(selected, {
        hasPermission: (p) => selected.includes(p),
        hasAnyPermission: (ps) => ps.some((p) => selected.includes(p)),
      }),
    [selected]
  );

  const handleToggle = (key: string, enabled: boolean) => {
    if (readOnly) return;
    onChange(togglePermissionSelected(selected, key, enabled));
  };

  const applyTemplate = (id: PermissionTemplateId) => {
    if (readOnly) return;
    onChange(applyTemplatePermissions(id));
  };

  const toggleGroupCollapsed = (group: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [group]: !prev[group] }));
  };

  return (
    <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Permissões liberadas
        </p>
        <p className="text-[11px] text-muted-foreground flex items-start gap-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
          Permissões críticas podem alterar dados sensíveis, parâmetros, exclusões ou administração do
          sistema. Marcar um item filho inclui automaticamente os requisitos (pais).
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card/80 p-3 text-xs space-y-2">
        <p>
          <span className="font-semibold">{summary.total}</span> permissão(ões) selecionada(s)
          {summary.groups.length > 0 ? (
            <>
              {" "}
              · Grupos: <span className="text-foreground">{summary.groups.join(", ")}</span>
            </>
          ) : null}
        </p>
        {summary.critical.length > 0 ? (
          <p className="text-amber-800">
            Sensíveis/críticas: {summary.critical.map((c) => c.label).join(", ")}
          </p>
        ) : null}
        {summary.modules.length > 0 ? (
          <p>
            Módulos no menu:{" "}
            {summary.modules.map((m) => MODULE_LABELS[m as AppModuleId] ?? m).join(", ")}
          </p>
        ) : (
          <p className="text-muted-foreground">Nenhum módulo principal liberado no menu lateral.</p>
        )}
      </div>

      {!readOnly ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase text-muted-foreground">Modelos rápidos</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(PERMISSION_TEMPLATES) as PermissionTemplateId[]).map((id) => (
              <button
                key={id}
                type="button"
                title={PERMISSION_TEMPLATES[id].description}
                onClick={() => applyTemplate(id)}
                className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent"
              >
                {PERMISSION_TEMPLATES[id].label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar permissão"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm"
          disabled={readOnly}
        />
      </div>

      <div className="space-y-2 max-h-[min(420px,50vh)] overflow-y-auto pr-1">
        {PERMISSION_GROUP_ORDER.map((groupName) => {
          const groupData = groups.find((g) => g.group === groupName);
          if (!groupData) return null;
          const collapsed = collapsedGroups[groupName] ?? false;
          const tree = buildGroupTree(groupName, search);
          if (search.trim() && tree.length === 0) return null;

          return (
            <div key={groupName} className="rounded-xl border border-border bg-card/50 overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(groupName)}
                  className="flex items-center gap-1.5 text-xs font-bold min-w-0"
                >
                  {collapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                  )}
                  {groupName}
                  <span className="text-muted-foreground font-normal">
                    ({groupData.entries.filter((e) => selected.includes(e.key)).length}/
                    {groupData.entries.length})
                  </span>
                </button>
                {!readOnly ? (
                  <div className="flex flex-wrap gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onChange(selectAllInGroup(groupName, selected))}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
                    >
                      Marcar grupo
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(clearGroup(groupName, selected))}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
                    >
                      Limpar grupo
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(selectViewOnlyForGroup(groupName, selected))}
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
                    >
                      Só visualização
                    </button>
                  </div>
                ) : null}
              </div>
              {!collapsed ? (
                <div className="p-2 space-y-1">
                  {tree.map((node) => (
                    <div key={node.key}>
                      <PermissionRow
                        node={node}
                        depth={0}
                        selected={selected}
                        onToggle={handleToggle}
                        readOnly={readOnly}
                      />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
