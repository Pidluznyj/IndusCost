/**
 * Árvore de permissões reutilizável (PERM-33).
 * Módulo (accordion) → Página → Aba → Ação com Herdar | Permitir | Negar.
 * Não conectada às telas finais neste passo.
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  collapseAllPermissionTreeKeys,
  countPermissionTreeDecisions,
  decisionLabel,
  effectiveLabel,
  expandAllPermissionTreeKeys,
  filterPermissionTreeNodes,
  getNodeDecision,
  kindLabel,
  mapPermissionTreeEffectives,
  setPermissionTreeDecision,
  togglePermissionTreeExpanded,
  type PermissionTreeDecision,
  type PermissionTreeDecisions,
  type PermissionTreeEffective,
  type PermissionTreeNode,
} from "@/src/lib/security/permissionsTreeUi/index.ts";

export type PermissionsTreeViewport = "fluid" | "1366" | "1920";

export type PermissionsTreeProps = {
  nodes: PermissionTreeNode[];
  decisions: PermissionTreeDecisions;
  onDecisionsChange: (next: PermissionTreeDecisions) => void;
  readOnly?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  /** Presets para validação visual 1366×768 e 1920×1080. */
  viewportPreset?: PermissionsTreeViewport;
};

const DECISIONS: readonly PermissionTreeDecision[] = [
  "inherit",
  "allow",
  "deny",
];

function DecisionSegmented({
  value,
  onChange,
  disabled,
  ariaLabel,
  testId,
}: {
  value: PermissionTreeDecision;
  onChange: (next: PermissionTreeDecision) => void;
  disabled?: boolean;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid={testId}
      className="inline-flex shrink-0 rounded-md border border-slate-200 bg-slate-50/80 p-0.5"
    >
      {DECISIONS.map((d) => {
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            data-testid={`${testId}-${d}`}
            onClick={() => onChange(d)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-semibold transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
              disabled && "cursor-not-allowed opacity-50",
              active &&
                d === "allow" &&
                "bg-emerald-100 text-emerald-900 shadow-sm",
              active && d === "deny" && "bg-rose-100 text-rose-900 shadow-sm",
              active &&
                d === "inherit" &&
                "bg-amber-50 text-amber-900 shadow-sm",
              !active && "text-slate-600 hover:bg-white/80"
            )}
          >
            {decisionLabel(d)}
          </button>
        );
      })}
    </div>
  );
}

function EffectiveBadge({
  effective,
}: {
  effective: PermissionTreeEffective;
}) {
  return (
    <span
      data-testid="permissions-tree-effective"
      data-effective={effective}
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        effective === "allowed" && "bg-emerald-50 text-emerald-800",
        effective === "denied" && "bg-rose-50 text-rose-800",
        effective === "inherited" && "bg-slate-100 text-slate-700"
      )}
    >
      {effectiveLabel(effective)}
    </span>
  );
}

function KindChip({ kind }: { kind: PermissionTreeNode["kind"] }) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        kind === "module" && "bg-sky-100 text-sky-800",
        kind === "page" && "bg-indigo-50 text-indigo-800",
        kind === "tab" && "bg-violet-50 text-violet-800",
        kind === "action" && "bg-slate-100 text-slate-700"
      )}
    >
      {kindLabel(kind)}
    </span>
  );
}

function indentClass(kind: PermissionTreeNode["kind"]): string {
  if (kind === "page") return "pl-3";
  if (kind === "tab") return "pl-8";
  if (kind === "action") return "pl-12";
  return "";
}

export function PermissionsTree({
  nodes,
  decisions,
  onDecisionsChange,
  readOnly = false,
  loading = false,
  error = null,
  emptyMessage = "Nenhum recurso para exibir.",
  className,
  viewportPreset = "fluid",
}: PermissionsTreeProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandAllPermissionTreeKeys(nodes)
  );

  useEffect(() => {
    setExpanded(expandAllPermissionTreeKeys(nodes));
  }, [nodes]);

  const filtered = useMemo(
    () => filterPermissionTreeNodes(nodes, { search }),
    [nodes, search]
  );

  const effectives = useMemo(
    () => mapPermissionTreeEffectives(filtered, decisions),
    [filtered, decisions]
  );

  const counters = useMemo(
    () => countPermissionTreeDecisions(nodes, decisions),
    [nodes, decisions]
  );

  const viewportClass =
    viewportPreset === "1366"
      ? "w-[1366px] max-w-full"
      : viewportPreset === "1920"
        ? "w-[1920px] max-w-full"
        : "w-full";

  if (loading) {
    return (
      <div
        data-testid="permissions-tree-loading"
        className={cn(
          "flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-8 text-sm text-slate-600",
          className
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando árvore de permissões…
      </div>
    );
  }

  if (error) {
    return (
      <div
        data-testid="permissions-tree-error"
        className={cn(
          "rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800",
          className
        )}
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div
        data-testid="permissions-tree-empty"
        className={cn(
          "rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600",
          className
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  const renderNode = (node: PermissionTreeNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const decision = getNodeDecision(decisions, node.id);
    const effective = effectives.get(node.id) ?? "inherited";
    const isModule = node.kind === "module";
    const isAction = node.kind === "action";

    if (isModule) {
      return (
        <section
          key={node.id}
          data-testid={`permissions-tree-module-${node.id}`}
          className="overflow-hidden rounded-lg border border-slate-200 bg-white"
        >
          <button
            type="button"
            data-testid={`permissions-tree-accordion-${node.id}`}
            aria-expanded={isOpen}
            onClick={() =>
              setExpanded((prev) => togglePermissionTreeExpanded(prev, node.id))
            }
            className="flex w-full items-center gap-2 bg-slate-50/90 px-3 py-2.5 text-left hover:bg-slate-100/80"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
            )}
            <KindChip kind="module" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
              {node.label}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              {node.originLabel}
            </span>
            <EffectiveBadge effective={effective} />
          </button>
          {isOpen ? (
            <div className="border-t border-slate-100">
              <div className="divide-y divide-slate-100">
                {node.children.map((child) => renderNode(child))}
              </div>
              {hasChildren ? null : (
                <p className="px-3 py-2 text-xs text-slate-500">
                  Sem páginas neste módulo.
                </p>
              )}
            </div>
          ) : null}
        </section>
      );
    }

    return (
      <div key={node.id} data-testid={`permissions-tree-row-${node.id}`}>
        <div
          className={cn(
            "grid grid-cols-1 items-center gap-2 px-3 py-2 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_auto_auto]",
            indentClass(node.kind),
            isAction && "bg-slate-50/40",
            node.kind === "page" && "bg-white",
            node.kind === "tab" && "bg-slate-50/30"
          )}
        >
          <div className="flex min-w-0 items-start gap-2">
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={isOpen}
                data-testid={`permissions-tree-expand-${node.id}`}
                onClick={() =>
                  setExpanded((prev) =>
                    togglePermissionTreeExpanded(prev, node.id)
                  )
                }
                className="mt-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-100"
              >
                {isOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            ) : (
              <span className="mt-0.5 w-4 shrink-0" aria-hidden />
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <KindChip kind={node.kind} />
                <span
                  className={cn(
                    "truncate text-sm text-slate-900",
                    node.kind === "page" && "font-semibold",
                    isAction && "font-medium"
                  )}
                >
                  {node.label}
                </span>
              </div>
              <p className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                {node.resourceKey}
              </p>
            </div>
          </div>

          <div
            data-testid={`permissions-tree-origin-${node.id}`}
            className="truncate text-xs text-slate-600"
            title={node.originLabel}
          >
            {node.originLabel || "—"}
          </div>

          <DecisionSegmented
            value={decision}
            disabled={readOnly}
            ariaLabel={`Decisão para ${node.label}`}
            testId={`permissions-tree-decision-${node.id}`}
            onChange={(next) =>
              onDecisionsChange(
                setPermissionTreeDecision(decisions, node.id, next)
              )
            }
          />

          <div className="justify-self-start md:justify-self-end">
            <EffectiveBadge effective={effective} />
          </div>
        </div>

        {hasChildren && isOpen
          ? node.children.map((child) => renderNode(child))
          : null}
      </div>
    );
  };

  return (
    <div
      data-testid="permissions-tree"
      data-viewport={viewportPreset}
      className={cn(
        "flex max-h-[min(72vh,720px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-[#f8fafc] shadow-sm",
        viewportClass,
        className
      )}
    >
      <header
        data-testid="permissions-tree-header"
        className="sticky top-0 z-10 shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2.5 backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={searchId} className="sr-only">
            Buscar recurso
          </label>
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id={searchId}
              data-testid="permissions-tree-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou chave…"
              className="w-full rounded-md border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-sky-300 focus:outline-none focus:ring-2 focus:ring-sky-100"
            />
          </div>
          <button
            type="button"
            data-testid="permissions-tree-expand-all"
            onClick={() => setExpanded(expandAllPermissionTreeKeys(nodes))}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Expandir tudo
          </button>
          <button
            type="button"
            data-testid="permissions-tree-collapse-all"
            onClick={() => setExpanded(collapseAllPermissionTreeKeys())}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Recolher tudo
          </button>
        </div>

        <div
          data-testid="permissions-tree-counters"
          className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold"
        >
          <span
            data-testid="permissions-tree-counter-allowed"
            className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-800"
          >
            {counters.allowed} permitidos
          </span>
          <span
            data-testid="permissions-tree-counter-denied"
            className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-800"
          >
            {counters.denied} negados
          </span>
          <span
            data-testid="permissions-tree-counter-inherited"
            className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-900"
          >
            {counters.inherited} herdados
          </span>
        </div>

        <div
          data-testid="permissions-tree-columns"
          className="mt-2 hidden grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_auto_auto] gap-2 border-t border-slate-100 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 md:grid"
        >
          <span>Recurso</span>
          <span>Origem/perfil</span>
          <span>Decisão individual</span>
          <span className="text-right">Resultado efetivo</span>
        </div>
      </header>

      <div
        data-testid="permissions-tree-body"
        className="flex-1 space-y-2 overflow-auto p-2"
      >
        {filtered.length === 0 ? (
          <p
            data-testid="permissions-tree-no-matches"
            className="px-2 py-6 text-center text-sm text-slate-500"
          >
            Nenhum recurso corresponde à busca.
          </p>
        ) : (
          filtered.map((node) => renderNode(node))
        )}
      </div>
    </div>
  );
}
