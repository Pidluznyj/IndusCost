import React, { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  applyTemplatePermissions,
  enablePermission,
  riskBadgeLabel,
  summarizePermissionSelection,
  togglePermissionSelected,
  type PermissionTemplateId,
  PERMISSION_TEMPLATES,
  type PermissionTreeNode,
} from "@/src/lib/permissionCatalogUtils";
import {
  buildPermissionAccessGroupSections,
  clearAccessGroup,
  getAccessGroupButtonId,
  getAccessGroupPanelId,
  selectAllInAccessGroup,
  selectViewOnlyForAccessGroup,
  type PermissionAccessGroupSection,
} from "@/src/lib/permissionGroups";
import { MODULE_LABELS, type AppModuleId } from "@/src/lib/modulePermissions";

export type QuickAccessProfileOption = {
  id: string;
  name: string;
  description?: string | null;
  permissions: string[];
};

export type PermissionEditorProps = {
  selected: string[];
  onChange: (permissions: string[]) => void;
  readOnly?: boolean;
  quickProfiles?: QuickAccessProfileOption[];
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

function AccessGroupSection({
  section,
  collapsed,
  readOnly,
  selected,
  onToggleCollapsed,
  onChange,
  onTogglePermission,
}: {
  section: PermissionAccessGroupSection;
  collapsed: boolean;
  readOnly: boolean;
  selected: string[];
  onToggleCollapsed: () => void;
  onChange: (permissions: string[]) => void;
  onTogglePermission: (key: string, enabled: boolean) => void;
}) {
  const buttonId = getAccessGroupButtonId(section.id);
  const panelId = getAccessGroupPanelId(section.id);
  const hasVisibleSections = section.catalogSections.some((catalog) => catalog.tree.length > 0);

  if (!hasVisibleSections) return null;

  return (
    <div className="rounded-xl border border-border bg-card/50 overflow-hidden">
      <div className="flex items-start justify-between gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        <button
          id={buttonId}
          type="button"
          aria-expanded={!collapsed}
          aria-controls={panelId}
          onClick={onToggleCollapsed}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleCollapsed();
            }
          }}
          className="flex flex-col items-start gap-1 text-left min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-md"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold min-w-0">
            {collapsed ? (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            {section.label}
            <span className="text-muted-foreground font-normal">
              ({section.selectedCount}/{section.totalCount})
            </span>
          </span>
          {section.relatedMenuLabels.length > 0 ? (
            <span className="text-[10px] text-muted-foreground font-normal leading-snug">
              Menus relacionados: {section.relatedMenuLabels.join(", ")}
            </span>
          ) : null}
        </button>
        {!readOnly ? (
          <div className="flex flex-wrap gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onChange(selectAllInAccessGroup(section.id, selected))}
              className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
            >
              Selecionar grupo
            </button>
            <button
              type="button"
              onClick={() => onChange(clearAccessGroup(section.id, selected))}
              className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
            >
              Limpar grupo
            </button>
            <button
              type="button"
              onClick={() => onChange(selectViewOnlyForAccessGroup(section.id, selected))}
              className="text-[10px] font-semibold px-2 py-0.5 rounded border border-border hover:bg-accent"
            >
              Só visualização
            </button>
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="p-2 space-y-3">
          {section.catalogSections.map((catalogSection) =>
            catalogSection.tree.length > 0 ? (
              <div key={catalogSection.catalogGroup} className="space-y-1">
                <p className="px-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                  {catalogSection.catalogGroup}
                </p>
                {catalogSection.tree.map((node) => (
                  <div key={node.key}>
                    <PermissionRow
                      node={node}
                      depth={0}
                      selected={selected}
                      onToggle={onTogglePermission}
                      readOnly={readOnly}
                    />
                  </div>
                ))}
              </div>
            ) : null
          )}
        </div>
      ) : null}
    </div>
  );
}

export const PermissionEditor: React.FC<PermissionEditorProps> = ({
  selected,
  onChange,
  readOnly = false,
  quickProfiles,
}) => {
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const accessGroups = useMemo(
    () => buildPermissionAccessGroupSections(selected, search),
    [selected, search]
  );

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

  const applyQuickProfile = (profile: QuickAccessProfileOption) => {
    if (readOnly) return;
    let acc: string[] = [];
    for (const key of profile.permissions) {
      acc = enablePermission(acc, key);
    }
    onChange(acc);
  };

  const toggleGroupCollapsed = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
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
          sistema. Marcar um item filho inclui automaticamente os requisitos (pais). Os grupos abaixo
          seguem as mesmas áreas da sidebar — cada permissão continua individual.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card/80 p-3 text-xs space-y-2">
        <p>
          <span className="font-semibold">{summary.total}</span> permissão(ões) selecionada(s)
          {summary.groups.length > 0 ? (
            <>
              {" "}
              · Catálogos: <span className="text-foreground">{summary.groups.join(", ")}</span>
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
          <p className="text-[10px] font-bold uppercase text-muted-foreground">
            {quickProfiles && quickProfiles.length > 0 ? "Perfis cadastrados" : "Modelos rápidos"}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {quickProfiles && quickProfiles.length > 0
              ? quickProfiles.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    title={profile.description ?? profile.name}
                    onClick={() => applyQuickProfile(profile)}
                    className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-semibold hover:bg-accent"
                  >
                    {profile.name}
                  </button>
                ))
              : (Object.keys(PERMISSION_TEMPLATES) as PermissionTemplateId[]).map((id) => (
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
        {accessGroups.map((section) => (
          <AccessGroupSection
            key={section.id}
            section={section}
            collapsed={collapsedGroups[section.id] ?? false}
            readOnly={readOnly}
            selected={selected}
            onToggleCollapsed={() => toggleGroupCollapsed(section.id)}
            onChange={onChange}
            onTogglePermission={handleToggle}
          />
        ))}
      </div>
    </div>
  );
};
