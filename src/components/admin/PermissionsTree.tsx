/**
 * Árvore de permissões — matriz administrativa (padrão IAM / Okta Admin).
 * Colunas alinhadas, hierarquia por indentação, exceções por acento lateral.
 * Ações em lote só no ramo selecionado (barra superior).
 */

import React, { useEffect, useId, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Search,
} from "lucide-react";
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
  viewportPreset?: PermissionsTreeViewport;
  enableBranchBatch?: boolean;
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

/** Grid fixo: recurso | perfil | exceção | resultado */
const COL_GRID =
  "grid-cols-1 md:grid-cols-[minmax(0,1fr)_7.5rem_13.5rem_6.5rem]";

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
      className="inline-flex h-8 shrink-0 items-stretch overflow-hidden rounded-md border border-border bg-muted/40"
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
              "min-w-[4.25rem] px-2 text-[11px] font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              disabled && "cursor-not-allowed opacity-50",
              active && d === "allow" && "bg-foreground text-background",
              active && d === "deny" && "bg-destructive text-destructive-foreground",
              active &&
                d === "inherit" &&
                "bg-background text-foreground shadow-sm",
              !active && "text-muted-foreground hover:bg-background/80 hover:text-foreground"
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
        "inline-flex items-center text-[12px] font-medium tabular-nums",
        effective === "allowed" && "text-emerald-700",
        effective === "denied" && "text-destructive",
        effective === "inherited" && "text-muted-foreground"
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
        "text-[12px] font-medium",
        allowed ? "text-foreground" : "text-muted-foreground"
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
        className="text-[10px] font-medium text-destructive"
        title="Exceção: nega o valor do perfil"
      >
        DENY sobrepõe
      </span>
    );
  }
  if (decision === "allow" && baseline === "denied") {
    return (
      <span
        data-testid="permissions-tree-exception-allow"
        className="text-[10px] font-medium text-emerald-700"
        title="Exceção: libera além do perfil"
      >
        ALLOW sobrepõe
      </span>
    );
  }
  if (decision === "inherit") {
    return (
      <span
        data-testid="permissions-tree-exception-inherit"
        className="sr-only"
      >
        Herdando
      </span>
    );
  }
  return null;
}

function depthPad(kind: PermissionTreeNode["kind"]): string {
  if (kind === "page") return "pl-4";
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
    return new Set(collectPermissionTreeSubtreeIds(nodes, selectedBranchId));
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
          "flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-8 text-sm text-muted-foreground",
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
          "rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive",
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
          "rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground",
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

    const rowShell = cn(
      "grid items-center gap-x-3 gap-y-2 border-b border-border/60 px-3 py-2",
      COL_GRID,
      !isModule && depthPad(node.kind),
      isBranchRoot && "bg-accent/60",
      !isBranchRoot && inSelectedBranch && "bg-muted/30",
      exceptionKind === "deny" && "border-l-2 border-l-destructive",
      exceptionKind === "allow" && "border-l-2 border-l-emerald-600",
      !exceptionKind && "border-l-2 border-l-transparent",
      "hover:bg-muted/40"
    );

    const resourceCell = (
      <div className="flex min-w-0 items-center gap-2">
        {hasChildren ? (
          <button
            type="button"
            aria-expanded={isOpen}
            data-testid={
              isModule
                ? `permissions-tree-accordion-${node.id}`
                : `permissions-tree-expand-${node.id}`
            }
            onClick={() =>
              setExpanded((prev) => togglePermissionTreeExpanded(prev, node.id))
            }
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {isOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}

        {canSelectBranch ? (
          <button
            type="button"
            data-testid={`permissions-tree-select-branch-${node.id}`}
            aria-pressed={isBranchRoot}
            aria-label={
              isBranchRoot
                ? `Ramo selecionado: ${node.label}`
                : `Selecionar ramo ${node.label}`
            }
            title={isBranchRoot ? "Selecionado — clique para limpar" : "Selecionar ramo"}
            onClick={() => selectBranch(node.id)}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition",
              isBranchRoot
                ? "border-foreground bg-foreground text-background"
                : "border-muted-foreground/40 bg-background hover:border-foreground"
            )}
          >
            {isBranchRoot ? <Check className="h-2.5 w-2.5" aria-hidden /> : null}
            <span className="sr-only">
              {isBranchRoot ? "Selecionado" : "Selecionar ramo"}
            </span>
          </button>
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={cn(
                "truncate text-sm text-foreground",
                (isModule || node.kind === "page") && "font-medium"
              )}
            >
              {node.label}
            </span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground/80">
              {kindLabel(node.kind)}
            </span>
            {highlightExceptions ? (
              <ExceptionOverlayChip
                decision={decision}
                baseline={node.baselineEffective}
              />
            ) : null}
          </div>
          <p className="truncate font-mono text-[10px] text-muted-foreground/70">
            {node.resourceKey}
          </p>
        </div>
      </div>
    );

    const row = (
      <div
        key={node.id}
        data-testid={
          isModule
            ? `permissions-tree-module-${node.id}`
            : `permissions-tree-row-${node.id}`
        }
        data-branch-selected={isBranchRoot ? "true" : undefined}
        data-exception={exceptionKind ?? undefined}
        className={rowShell}
      >
        {resourceCell}

        <div
          data-testid={`permissions-tree-origin-${node.id}`}
          className="md:justify-self-start"
          title={node.originLabel}
        >
          <span className="mb-0.5 block text-[10px] text-muted-foreground md:hidden">
            {originColumnLabel}
          </span>
          {highlightExceptions ? (
            <ProfileValueBadge baseline={node.baselineEffective} />
          ) : (
            <span className="truncate text-xs text-muted-foreground">
              {node.originLabel || "—"}
            </span>
          )}
        </div>

        <div className="md:justify-self-start">
          <span className="mb-0.5 block text-[10px] text-muted-foreground md:hidden">
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

        <div className="md:justify-self-end">
          <span className="mb-0.5 block text-[10px] text-muted-foreground md:hidden">
            {resultColumnLabel}
          </span>
          <EffectiveBadge effective={effective} />
        </div>
      </div>
    );

    return (
      <React.Fragment key={node.id}>
        {row}
        {hasChildren && isOpen
          ? node.children.map((child) => renderNode(child))
          : null}
        {isModule && isOpen && !hasChildren ? (
          <p className="border-b border-border/60 px-3 py-2 pl-14 text-xs text-muted-foreground">
            Sem páginas neste módulo.
          </p>
        ) : null}
      </React.Fragment>
    );
  };

  return (
    <div
      data-testid="permissions-tree"
      data-viewport={viewportPreset}
      data-branch-batch={enableBranchBatch ? "true" : undefined}
      className={cn(
        "flex h-[min(56vh,640px)] min-h-[360px] max-h-none flex-col overflow-hidden rounded-lg border border-border bg-card",
        viewportClass,
        className
      )}
    >
      <header
        data-testid="permissions-tree-header"
        className="sticky top-0 z-10 shrink-0 border-b border-border bg-card"
      >
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <label htmlFor={searchId} className="sr-only">
            Buscar recurso
          </label>
          <div className="relative min-w-[200px] flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              id={searchId}
              data-testid="permissions-tree-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou chave…"
              className="h-8 w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <button
            type="button"
            data-testid="permissions-tree-expand-all"
            onClick={() => setExpanded(expandAllPermissionTreeKeys(nodes))}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Expandir
          </button>
          <button
            type="button"
            data-testid="permissions-tree-collapse-all"
            onClick={() => setExpanded(collapseAllPermissionTreeKeys())}
            className="h-8 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            Recolher
          </button>
          <div
            data-testid="permissions-tree-counters"
            className="flex items-center gap-3 text-[11px] text-muted-foreground"
          >
            <span data-testid="permissions-tree-counter-allowed">
              <span className="font-semibold text-foreground">
                {counters.allowed}
              </span>{" "}
              permitidos
            </span>
            <span data-testid="permissions-tree-counter-denied">
              <span className="font-semibold text-foreground">
                {counters.denied}
              </span>{" "}
              negados
            </span>
            <span data-testid="permissions-tree-counter-inherited">
              <span className="font-semibold text-foreground">
                {counters.inherited}
              </span>{" "}
              herdados
            </span>
          </div>
        </div>

        {enableBranchBatch && !readOnly ? (
          <div
            data-testid="permissions-tree-batch-bar"
            className={cn(
              "flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-xs",
              selectedBranch ? "bg-muted/40" : "bg-muted/20"
            )}
          >
            {!selectedBranch ? (
              <p className="text-muted-foreground">
                Selecione o círculo ao lado de um módulo, página ou aba para aplicar
                a mesma decisão a todo o ramo.
              </p>
            ) : pendingBatchDecision ? (
              <div
                data-testid="permissions-tree-batch-confirm"
                className="flex flex-wrap items-center gap-2"
              >
                <span className="font-medium text-foreground">
                  Aplicar “{decisionLabel(pendingBatchDecision)}” a{" "}
                  {selectedSubtreeCount} item(ns) em “{selectedBranch.label}”?
                </span>
                <button
                  type="button"
                  data-testid="permissions-tree-batch-confirm-yes"
                  onClick={confirmBatch}
                  className="h-7 rounded-md bg-foreground px-2.5 text-[11px] font-medium text-background hover:opacity-90"
                >
                  Confirmar
                </button>
                <button
                  type="button"
                  data-testid="permissions-tree-batch-confirm-no"
                  onClick={() => setPendingBatchDecision(null)}
                  className="h-7 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  Ramo: {selectedBranch.label}
                  <span className="ml-1 font-normal text-muted-foreground">
                    ({selectedSubtreeCount})
                  </span>
                </span>
                <span className="text-muted-foreground">Aplicar:</span>
                {DECISIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    data-testid={`permissions-tree-batch-${d}`}
                    onClick={() => setPendingBatchDecision(d)}
                    className="h-7 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium hover:bg-muted"
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
                  className="h-7 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                >
                  Limpar seleção
                </button>
              </>
            )}
          </div>
        ) : null}

        <div
          data-testid="permissions-tree-columns"
          className={cn(
            "hidden gap-x-3 border-t border-border bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid",
            COL_GRID
          )}
        >
          <span>{resourceColumnLabel}</span>
          <span>{originColumnLabel}</span>
          <span>{configuredColumnLabel}</span>
          <span className="text-right">{resultColumnLabel}</span>
        </div>
      </header>

      <div
        data-testid="permissions-tree-body"
        className="min-h-0 flex-1 overflow-auto"
      >
        {filtered.length === 0 ? (
          <p
            data-testid="permissions-tree-no-matches"
            className="px-3 py-10 text-center text-sm text-muted-foreground"
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
