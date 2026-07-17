/**
 * Árvore de permissões reutilizável (PERM-33 / PERM-34).
 * Módulo (accordion) → Página → Aba → Ação com Herdar | Permitir | Negar.
 * Ações em lote apenas no ramo selecionado (confirmação visual).
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  applyPermissionTreeDecisionToSubtree,
  collapseAllPermissionTreeKeys,
  collectPermissionTreeSubtreeIds,
  countPermissionTreeDecisions,
  decisionLabel,
  effectiveLabel,
  expandAllPermissionTreeKeys,
  filterPermissionTreeNodes,
  findPermissionTreeNode,
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
  /** Exibe seleção de ramo + barra de ações em lote (PERM-34). */
  enableBranchBatch?: boolean;
  /**
   * Destaca exceções vs valor do perfil (PERM-35):
   * DENY/ALLOW sobrepondo perfil e estado “Herdando”.
   */
  highlightExceptions?: boolean;
  resourceColumnLabel?: string;
  originColumnLabel?: string;
  configuredColumnLabel?: string;
  resultColumnLabel?: string;
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
      className="inline-flex shrink-0 rounded-lg border border-slate-200 bg-slate-100/80 p-1"
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
              "rounded-md px-3 py-1.5 text-[11px] font-semibold transition-all",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300",
              disabled && "cursor-not-allowed opacity-50",
              active &&
                d === "allow" &&
                "bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-700/20",
              active &&
                d === "deny" &&
                "bg-rose-600 text-white shadow-sm ring-1 ring-rose-700/20",
              active &&
                d === "inherit" &&
                "bg-amber-100 text-amber-950 shadow-sm ring-1 ring-amber-300",
              !active && "bg-white text-slate-600 hover:bg-slate-50"
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

function ProfileValueBadge({
  baseline,
}: {
  baseline: PermissionTreeEffective;
}) {
  const allowed = baseline === "allowed";
  return (
    <span
      data-testid="permissions-tree-profile-value"
      data-profile={allowed ? "allowed" : "denied"}
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold",
        allowed ? "bg-sky-50 text-sky-800" : "bg-slate-100 text-slate-600"
      )}
    >
      {allowed ? "Permitido" : "Negado"}
    </span>
  );
}

function ExceptionOverlayChip({
  decision,
  baseline,
}: {
  decision: PermissionTreeDecision;
  baseline: PermissionTreeEffective;
}) {
  if (decision === "deny" && baseline === "allowed") {
    return (
      <span
        data-testid="permissions-tree-exception-deny"
        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-rose-100 text-rose-900"
      >
        DENY sobrepõe
      </span>
    );
  }
  if (decision === "allow" && baseline === "denied") {
    return (
      <span
        data-testid="permissions-tree-exception-allow"
        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-900"
      >
        ALLOW sobrepõe
      </span>
    );
  }
  if (decision === "inherit") {
    return (
      <span
        data-testid="permissions-tree-exception-inherit"
        className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide bg-amber-50 text-amber-900"
      >
        Herdando
      </span>
    );
  }
  return null;
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
  enableBranchBatch = false,
  highlightExceptions = false,
  resourceColumnLabel = "Recurso",
  originColumnLabel = "Origem/perfil",
  configuredColumnLabel = "Decisão individual",
  resultColumnLabel = "Resultado efetivo",
}: PermissionsTreeProps) {
  const searchId = useId();
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    expandAllPermissionTreeKeys(nodes)
  );
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
  const [pendingBatchDecision, setPendingBatchDecision] =
    useState<PermissionTreeDecision | null>(null);

  useEffect(() => {
    setExpanded(expandAllPermissionTreeKeys(nodes));
    setSelectedBranchId(null);
    setPendingBatchDecision(null);
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

  const selectedBranch = useMemo(
    () =>
      selectedBranchId
        ? findPermissionTreeNode(nodes, selectedBranchId)
        : null,
    [nodes, selectedBranchId]
  );

  const selectedSubtreeCount = useMemo(
    () =>
      selectedBranchId
        ? collectPermissionTreeSubtreeIds(nodes, selectedBranchId).length
        : 0,
    [nodes, selectedBranchId]
  );

  const selectedAncestorIds = useMemo(() => {
    if (!selectedBranchId) return new Set<string>();
    const ids = new Set<string>(
      collectPermissionTreeSubtreeIds(nodes, selectedBranchId)
    );
    return ids;
  }, [nodes, selectedBranchId]);

  const viewportClass =
    viewportPreset === "1366"
      ? "w-[1366px] max-w-full"
      : viewportPreset === "1920"
        ? "w-[1920px] max-w-full"
        : "w-full";

  const confirmBatch = () => {
    if (!selectedBranchId || !pendingBatchDecision || readOnly) return;
    const ids = collectPermissionTreeSubtreeIds(nodes, selectedBranchId);
    onDecisionsChange(
      applyPermissionTreeDecisionToSubtree(
        decisions,
        ids,
        pendingBatchDecision
      )
    );
    setPendingBatchDecision(null);
  };

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

  const selectBranch = (id: string) => {
    if (!enableBranchBatch || readOnly) return;
    setSelectedBranchId((prev) => (prev === id ? null : id));
    setPendingBatchDecision(null);
  };

  const renderNode = (node: PermissionTreeNode): React.ReactNode => {
    const hasChildren = node.children.length > 0;
    const isOpen = expanded.has(node.id);
    const decision = getNodeDecision(decisions, node.id);
    const effective = effectives.get(node.id) ?? "inherited";
    const isModule = node.kind === "module";
    const isAction = node.kind === "action";
    const inSelectedBranch = selectedAncestorIds.has(node.id);
    const isBranchRoot = selectedBranchId === node.id;
    const canSelectBranch =
      enableBranchBatch && !readOnly && node.kind !== "action";
    const exceptionKind =
      highlightExceptions &&
      ((decision === "deny" && node.baselineEffective === "allowed") ||
        (decision === "allow" && node.baselineEffective === "denied"))
        ? decision === "deny"
          ? "deny"
          : "allow"
        : null;

    if (isModule) {
      return (
        <section
          key={node.id}
          data-testid={`permissions-tree-module-${node.id}`}
          data-branch-selected={isBranchRoot ? "true" : undefined}
          data-exception={exceptionKind ?? undefined}
          className={cn(
            "overflow-hidden rounded-lg border bg-white",
            isBranchRoot
              ? "border-sky-500 ring-2 ring-sky-300 shadow-md"
              : inSelectedBranch
                ? "border-sky-200"
                : exceptionKind === "deny"
                  ? "border-rose-300"
                  : exceptionKind === "allow"
                    ? "border-emerald-300"
                    : "border-slate-200"
          )}
        >
          <div
            className={cn(
              "flex w-full items-center gap-2 bg-slate-50/90 px-3 py-2.5",
              inSelectedBranch && "bg-sky-100/90",
              exceptionKind === "deny" && "bg-rose-50/70",
              exceptionKind === "allow" && "bg-emerald-50/70"
            )}
          >
            <button
              type="button"
              data-testid={`permissions-tree-accordion-${node.id}`}
              aria-expanded={isOpen}
              onClick={() =>
                setExpanded((prev) =>
                  togglePermissionTreeExpanded(prev, node.id)
                )
              }
              className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
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
              {highlightExceptions ? (
                <>
                  <ProfileValueBadge baseline={node.baselineEffective} />
                  <ExceptionOverlayChip
                    decision={decision}
                    baseline={node.baselineEffective}
                  />
                </>
              ) : (
                <span className="hidden text-xs text-slate-500 sm:inline">
                  {node.originLabel}
                </span>
              )}
              <EffectiveBadge effective={effective} />
            </button>
            {canSelectBranch ? (
              <button
                type="button"
                data-testid={`permissions-tree-select-branch-${node.id}`}
                aria-pressed={isBranchRoot}
                onClick={() => selectBranch(node.id)}
                className={cn(
                  "shrink-0 rounded-md border px-2.5 py-1.5 text-[10px] font-bold",
                  isBranchRoot
                    ? "border-sky-600 bg-sky-600 text-white shadow-sm"
                    : "border-sky-200 bg-white text-sky-700 hover:border-sky-400 hover:bg-sky-50"
                )}
              >
                {isBranchRoot ? "Selecionado" : "Selecionar ramo"}
              </button>
            ) : null}
          </div>
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
          data-branch-selected={isBranchRoot ? "true" : undefined}
          data-exception={exceptionKind ?? undefined}
          className={cn(
            "grid grid-cols-1 items-center gap-3 px-3 py-2 md:grid-cols-[minmax(260px,1.5fr)_minmax(100px,0.6fr)_minmax(250px,auto)_minmax(90px,0.5fr)]",
            indentClass(node.kind),
            isAction && "bg-slate-50/40",
            node.kind === "page" && "bg-white",
            node.kind === "tab" && "bg-slate-50/30",
            inSelectedBranch && "bg-sky-50/70",
            isBranchRoot && "bg-sky-100 ring-2 ring-inset ring-sky-400",
            exceptionKind === "deny" && "bg-rose-50/80",
            exceptionKind === "allow" && "bg-emerald-50/80"
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
                {highlightExceptions ? (
                  <ExceptionOverlayChip
                    decision={decision}
                    baseline={node.baselineEffective}
                  />
                ) : null}
                {canSelectBranch ? (
                  <button
                    type="button"
                    data-testid={`permissions-tree-select-branch-${node.id}`}
                    aria-pressed={isBranchRoot}
                    onClick={() => selectBranch(node.id)}
                    className={cn(
                      "rounded-md border px-2 py-1 text-[9px] font-bold",
                      isBranchRoot
                        ? "border-sky-600 bg-sky-600 text-white"
                        : "border-sky-200 bg-white text-sky-700 hover:border-sky-400"
                    )}
                  >
                    {isBranchRoot ? "Selecionado" : "Selecionar"}
                  </button>
                ) : null}
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
            {highlightExceptions ? (
              <ProfileValueBadge baseline={node.baselineEffective} />
            ) : (
              node.originLabel || "—"
            )}
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 md:hidden">
              {configuredColumnLabel}
            </span>
            <DecisionSegmented
              value={decision}
              disabled={readOnly}
              ariaLabel={`Exceção do usuário para ${node.label}`}
              testId={`permissions-tree-decision-${node.id}`}
              onChange={(next) =>
                onDecisionsChange(
                  setPermissionTreeDecision(decisions, node.id, next)
                )
              }
            />
          </div>

          <div className="justify-self-start md:justify-self-end">
            <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-wide text-slate-400 md:hidden">
              {resultColumnLabel}
            </span>
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
      data-branch-batch={enableBranchBatch ? "true" : undefined}
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

        {enableBranchBatch && !readOnly ? (
          <div
            data-testid="permissions-tree-batch-bar"
            className={cn(
              "mt-2 rounded-lg border px-3 py-2.5 text-xs",
              selectedBranch
                ? "border-sky-400 bg-sky-100 text-sky-950 shadow-sm"
                : "border-dashed border-sky-200 bg-sky-50/60 text-sky-900"
            )}
          >
            {!selectedBranch ? (
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[10px] font-bold text-white">
                  1
                </span>
                <p>
                  Clique em <strong>Selecionar ramo</strong> para alterar um módulo,
                  página ou aba inteira de uma vez.
                </p>
              </div>
            ) : pendingBatchDecision ? (
              <div
                data-testid="permissions-tree-batch-confirm"
                className="flex flex-wrap items-center gap-2"
              >
                <Check className="h-3.5 w-3.5 text-sky-700" aria-hidden />
                <span className="font-semibold">
                  Aplicar “{decisionLabel(pendingBatchDecision)}” a{" "}
                  {selectedSubtreeCount} item(ns) em “{selectedBranch.label}”?
                </span>
                <button
                  type="button"
                  data-testid="permissions-tree-batch-confirm-yes"
                  onClick={confirmBatch}
                  className="rounded-md bg-sky-700 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-sky-800"
                >
                  Confirmar lote
                </button>
                <button
                  type="button"
                  data-testid="permissions-tree-batch-confirm-no"
                  onClick={() => setPendingBatchDecision(null)}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-sky-700" aria-hidden />
                  <span className="font-semibold">
                    Selecionado: {selectedBranch.label} ({selectedSubtreeCount} itens)
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sky-800">2. Aplicar ao ramo:</span>
                  {DECISIONS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      data-testid={`permissions-tree-batch-${d}`}
                      onClick={() => setPendingBatchDecision(d)}
                      className={cn(
                        "rounded-md border px-2.5 py-1.5 text-[11px] font-bold shadow-sm",
                        d === "allow" &&
                          "border-emerald-300 bg-emerald-100 text-emerald-950",
                        d === "deny" &&
                          "border-rose-300 bg-rose-100 text-rose-950",
                        d === "inherit" &&
                          "border-amber-300 bg-amber-100 text-amber-950"
                      )}
                    >
                      {decisionLabel(d)}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-testid="permissions-tree-batch-clear"
                    onClick={() => {
                      setSelectedBranchId(null);
                      setPendingBatchDecision(null);
                    }}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600"
                  >
                    Cancelar seleção
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div
          data-testid="permissions-tree-columns"
          className="mt-2 hidden grid-cols-[minmax(260px,1.5fr)_minmax(100px,0.6fr)_minmax(250px,auto)_minmax(90px,0.5fr)] gap-3 border-t border-slate-100 pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 md:grid"
        >
          <span>{resourceColumnLabel}</span>
          <span>{originColumnLabel}</span>
          <span>{configuredColumnLabel}</span>
          <span className="text-right">{resultColumnLabel}</span>
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
