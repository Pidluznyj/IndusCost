/**
 * Matriz hierárquica reutilizável de permissões (Prompt 08).
 * Não substitui telas finais neste passo; não altera regras de autorização.
 */

import React, { useEffect, useId, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import {
  applyBatchMatrixAction,
  childActionPartial,
  collectGroupIds,
  expandParentKeys,
  filterPermissionMatrixRows,
  flattenVisibleMatrixRows,
  formatImpactSummaryHuman,
  isMatrixDraftDirty,
  isParentViewBlocked,
  listMatrixColumns,
  permissionMatrixActionLabel,
  permissionMatrixCellAriaLabel,
  resetMatrixDraft,
  setMatrixDraftAction,
  summarizeMatrixImpact,
  toggleExpandedKey,
  toggleSelectedKey,
  type PermissionMatrixActionId,
  type PermissionMatrixDraft,
  type PermissionMatrixFilterState,
  type PermissionMatrixRow,
} from "@/src/lib/security/permissionMatrixUi/index.ts";
import { permissionResourceTypeLabel } from "@/src/lib/userPermissionsAdminUi";

export type PermissionMatrixProps = {
  rows: PermissionMatrixRow[];
  draft: PermissionMatrixDraft;
  baseline: PermissionMatrixDraft;
  onDraftChange: (next: PermissionMatrixDraft) => void;
  readOnly?: boolean;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  className?: string;
  /** Seleção em lote (controlada opcionalmente). */
  selectedKeys?: Set<string>;
  onSelectedKeysChange?: (next: Set<string>) => void;
};

function SourceBadge({
  source,
}: {
  source: string;
}) {
  if (source === "granted") {
    return (
      <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-900">
        Concedido
      </span>
    );
  }
  if (source === "denied") {
    return (
      <span className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-900">
        Negado
      </span>
    );
  }
  if (source === "inherited") {
    return (
      <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700">
        Herdado
      </span>
    );
  }
  return null;
}

export function PermissionMatrix({
  rows,
  draft,
  baseline,
  onDraftChange,
  readOnly,
  loading,
  error,
  emptyMessage = "Nenhum recurso para exibir.",
  className,
  selectedKeys: selectedKeysProp,
  onSelectedKeysChange,
}: PermissionMatrixProps) {
  const reactId = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => expandParentKeys(rows));
  const [internalSelected, setInternalSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<PermissionMatrixFilterState>({
    search: "",
    groupId: "ALL",
  });

  const selected = selectedKeysProp ?? internalSelected;
  const setSelected = (next: Set<string>) => {
    if (onSelectedKeysChange) onSelectedKeysChange(next);
    else setInternalSelected(next);
  };

  useEffect(() => {
    // Ao trocar dataset (ex.: outro usuário), reabre pais.
    setExpanded(expandParentKeys(rows));
  }, [rows]);

  const groups = collectGroupIds(rows);
  const filtered = filterPermissionMatrixRows(rows, filter);
  const visible = flattenVisibleMatrixRows(filtered, expanded);
  const columns = listMatrixColumns(rows);
  const dirty = isMatrixDraftDirty(draft, baseline);
  const impact = summarizeMatrixImpact(rows, draft, baseline);

  if (loading) {
    return (
      <div
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-12 text-sm text-muted-foreground",
          className
        )}
        data-testid="permission-matrix-loading"
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando permissões…
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          "rounded-xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-900",
          className
        )}
        data-testid="permission-matrix-error"
        role="alert"
      >
        <p className="font-semibold">Falha ao carregar permissões</p>
        <p className="mt-1 text-[13px] leading-relaxed">{error}</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground",
          className
        )}
        data-testid="permission-matrix-empty"
      >
        {emptyMessage}
      </div>
    );
  }

  const onToggleAction = (
    row: PermissionMatrixRow,
    action: PermissionMatrixActionId,
    allowed: boolean
  ) => {
    if (readOnly) return;
    if (!row.supportedActions.includes(action)) return;
    onDraftChange(setMatrixDraftAction(draft, row.resourceKey, action, allowed));
  };

  return (
    <div
      className={cn("space-y-3", className)}
      data-testid="permission-matrix"
      aria-labelledby={`${reactId}-title`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3
            id={`${reactId}-title`}
            className="text-sm font-semibold tracking-tight text-foreground"
          >
            Matriz de permissões
          </h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Colunas dinâmicas por ação suportada. Ações inexistentes aparecem como —.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span
              className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-950"
              data-testid="permission-matrix-dirty"
            >
              Alterações não salvas
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent disabled:opacity-50"
            disabled={readOnly || !dirty}
            onClick={() => onDraftChange(resetMatrixDraft(baseline))}
            data-testid="permission-matrix-reset"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            Resetar
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent"
            onClick={() => setExpanded(expandParentKeys(filtered))}
          >
            Expandir
          </button>
          <button
            type="button"
            className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium hover:bg-accent"
            onClick={() => setExpanded(new Set())}
          >
            Recolher
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={`${reactId}-search`}>
          Buscar recurso
        </label>
        <input
          id={`${reactId}-search`}
          type="search"
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          placeholder="Buscar por nome ou chave…"
          className="h-9 w-full rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs"
          data-testid="permission-matrix-search"
        />
        <label className="sr-only" htmlFor={`${reactId}-group`}>
          Filtrar por grupo
        </label>
        <select
          id={`${reactId}-group`}
          value={filter.groupId}
          onChange={(e) =>
            setFilter((f) => ({
              ...f,
              groupId: e.target.value as PermissionMatrixFilterState["groupId"],
            }))
          }
          className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          data-testid="permission-matrix-group-filter"
        >
          <option value="ALL">Todos os grupos</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>

      {!readOnly && selected.size > 0 ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-[11px]"
          data-testid="permission-matrix-batch"
        >
          <span className="font-semibold text-foreground">
            {selected.size} selecionado(s)
          </span>
          {(
            [
              ["view", "Ver"],
              ["execute", "Executar"],
              ["manage", "Gerenciar"],
            ] as const
          ).map(([action, label]) => (
            <React.Fragment key={action}>
              <button
                type="button"
                className="rounded-md border border-border bg-background px-2 py-1 font-medium hover:bg-accent"
                onClick={() =>
                  onDraftChange(
                    applyBatchMatrixAction(draft, rows, selected, action, true)
                  )
                }
              >
                Permitir {label}
              </button>
              <button
                type="button"
                className="rounded-md border border-border bg-background px-2 py-1 font-medium hover:bg-accent"
                onClick={() =>
                  onDraftChange(
                    applyBatchMatrixAction(draft, rows, selected, action, false)
                  )
                }
              >
                Negar {label}
              </button>
            </React.Fragment>
          ))}
        </div>
      ) : null}

      <p
        className="text-[11px] text-muted-foreground"
        data-testid="permission-matrix-impact"
      >
        {formatImpactSummaryHuman(impact)}
      </p>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="min-w-full border-collapse text-left text-[11px]">
          <thead className="sticky top-0 z-[1] bg-muted/80 backdrop-blur">
            <tr className="border-b border-border">
              <th scope="col" className="px-2 py-2 font-semibold text-foreground">
                <span className="sr-only">Seleção</span>
              </th>
              <th scope="col" className="min-w-[220px] px-2 py-2 font-semibold text-foreground">
                Recurso
              </th>
              {columns.map((action) => (
                <th
                  key={action}
                  scope="col"
                  className="px-1.5 py-2 text-center font-semibold text-foreground whitespace-nowrap"
                >
                  {permissionMatrixActionLabel(action)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const parentBlocked = isParentViewBlocked(rows, row.resourceKey, draft);
              const hasChildren = row.children.length > 0;
              const isOpen = expanded.has(row.resourceKey);
              const isSelected = selected.has(row.resourceKey);
              const dirtyRow = isMatrixDraftDirty(
                { [row.resourceKey]: draft[row.resourceKey] ?? {} },
                { [row.resourceKey]: baseline[row.resourceKey] ?? {} }
              );

              return (
                <tr
                  key={row.resourceKey}
                  className={cn(
                    "border-b border-border/60 hover:bg-muted/20",
                    dirtyRow && "bg-amber-50/40",
                    parentBlocked && "opacity-90"
                  )}
                  data-resource-key={row.resourceKey}
                >
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-border"
                      checked={isSelected}
                      disabled={readOnly}
                      aria-label={`Selecionar ${row.label}`}
                      onChange={() =>
                        setSelected(toggleSelectedKey(selected, row.resourceKey))
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5 align-middle">
                    <div
                      className="flex min-w-0 items-start gap-1"
                      style={{ paddingLeft: Math.min(row.depth, 8) * 12 }}
                    >
                      {hasChildren ? (
                        <button
                          type="button"
                          className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-accent"
                          aria-expanded={isOpen}
                          aria-label={
                            isOpen ? `Recolher ${row.label}` : `Expandir ${row.label}`
                          }
                          onClick={() =>
                            setExpanded(toggleExpandedKey(expanded, row.resourceKey))
                          }
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
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-foreground leading-snug">
                            {row.label}
                          </span>
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {permissionResourceTypeLabel(row.type)}
                          </span>
                          {dirtyRow ? (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-950">
                              Alterado
                            </span>
                          ) : null}
                          {parentBlocked ? (
                            <span
                              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-950"
                              title="O recurso pai está sem Ver. Filhos mantêm configuração, mas o acesso efetivo permanece bloqueado pelo pai."
                              data-testid="permission-matrix-parent-blocked"
                            >
                              <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
                              Pai bloqueado
                            </span>
                          ) : null}
                        </div>
                        {row.description ? (
                          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground line-clamp-2">
                            {row.description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  {columns.map((action) => {
                    const cell = row.cells[action];
                    const supported =
                      cell?.supported ?? row.supportedActions.includes(action);
                    if (!supported) {
                      return (
                        <td
                          key={action}
                          className="px-1.5 py-1.5 text-center text-muted-foreground"
                          title="Ação não suportada neste recurso"
                        >
                          <span aria-label={permissionMatrixCellAriaLabel({
                            resourceLabel: row.label,
                            action,
                            supported: false,
                            allowed: false,
                            source: "unsupported",
                          })}>
                            —
                          </span>
                        </td>
                      );
                    }
                    const allowed =
                      draft[row.resourceKey]?.[action] ??
                      row.values[action] ??
                      false;
                    const partial = childActionPartial(row, action, draft);
                    const origin = cell?.originLabel ?? "—";
                    return (
                      <td key={action} className="px-1.5 py-1.5 text-center align-middle">
                        <label
                          className="inline-flex flex-col items-center gap-0.5 cursor-pointer"
                          title={origin}
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-border"
                            checked={allowed}
                            ref={(el) => {
                              if (el) el.indeterminate = partial === true;
                            }}
                            disabled={readOnly}
                            aria-label={permissionMatrixCellAriaLabel({
                              resourceLabel: row.label,
                              action,
                              supported: true,
                              allowed,
                              source:
                                baseline[row.resourceKey]?.[action] === allowed
                                  ? "inherited"
                                  : allowed
                                    ? "granted"
                                    : "denied",
                            })}
                            onChange={(e) =>
                              onToggleAction(row, action, e.target.checked)
                            }
                          />
                          <SourceBadge
                            source={(() => {
                              const base =
                                baseline[row.resourceKey]?.[action] ??
                                row.inherited[action] ??
                                false;
                              if (allowed === Boolean(base)) return "inherited";
                              return allowed ? "granted" : "denied";
                            })()}
                          />
                        </label>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
