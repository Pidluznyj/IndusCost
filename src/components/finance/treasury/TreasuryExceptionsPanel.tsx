/**
 * Painel de listagem — Central de Exceções.
 */

import React from "react";
import { Link } from "react-router-dom";
import type { TreasuryExceptionDto } from "@/src/lib/treasury/contracts/index.js";
import {
  TREASURY_EXCEPTION_SEVERITY_LABELS,
  TREASURY_EXCEPTION_STATUS_LABELS,
  formatTreasuryExceptionAgeLabel,
  isTreasuryExceptionOpenStatus,
  type TreasuryExceptionsFilterState,
} from "@/src/lib/treasury/treasuryExceptionsUi.js";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards.js";

function formatMoney(value: string | null): string {
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function TreasuryExceptionsPanel(props: {
  items: TreasuryExceptionDto[];
  filters: TreasuryExceptionsFilterState;
  canManage: boolean;
  onFiltersChange: (next: TreasuryExceptionsFilterState) => void;
  onAcknowledge: (row: TreasuryExceptionDto) => void;
  onAssign: (row: TreasuryExceptionDto) => void;
  onSetDueAt: (row: TreasuryExceptionDto) => void;
  onSetStatus: (row: TreasuryExceptionDto) => void;
  onResolve: (row: TreasuryExceptionDto) => void;
  onIgnore: (row: TreasuryExceptionDto) => void;
}) {
  const {
    items,
    filters,
    canManage,
    onFiltersChange,
    onAcknowledge,
    onAssign,
    onSetDueAt,
    onSetStatus,
    onResolve,
    onIgnore,
  } = props;

  return (
    <div className="space-y-4" data-testid="treasury-exceptions-panel">
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Status</span>
          <select
            className={financeModuleFilterFieldClass}
            value={filters.status}
            onChange={(e) =>
              onFiltersChange({ ...filters, status: e.target.value })
            }
            data-testid="treasury-exceptions-filter-status"
          >
            <option value="">Todos</option>
            <option value="OPEN">Aberta</option>
            <option value="IN_ANALYSIS">Em análise</option>
            <option value="WAITING_THIRD_PARTY">Aguardando terceiro</option>
            <option value="RESOLVED">Resolvida</option>
            <option value="IGNORED">Ignorada</option>
            <option value="CANCELLED">Cancelada</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Severidade</span>
          <select
            className={financeModuleFilterFieldClass}
            value={filters.severity}
            onChange={(e) =>
              onFiltersChange({ ...filters, severity: e.target.value })
            }
          >
            <option value="">Todas</option>
            <option value="CRITICAL">Crítica</option>
            <option value="WARNING">Atenção</option>
            <option value="INFO">Info</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Empresa</span>
          <input
            className={financeModuleFilterFieldClass}
            value={filters.companyCode}
            onChange={(e) =>
              onFiltersChange({ ...filters, companyCode: e.target.value })
            }
            placeholder="companyCode"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Responsável</span>
          <input
            className={financeModuleFilterFieldClass}
            value={filters.responsibleUserId}
            onChange={(e) =>
              onFiltersChange({
                ...filters,
                responsibleUserId: e.target.value,
              })
            }
            placeholder="userId"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Busca</span>
          <input
            className={financeModuleFilterFieldClass}
            value={filters.search}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value })
            }
            placeholder="título, chave…"
          />
        </label>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass}>Ordenar</span>
          <select
            className={financeModuleFilterFieldClass}
            value={`${filters.sortBy}:${filters.sortDirection}`}
            onChange={(e) => {
              const [sortBy, sortDirection] = e.target.value.split(":");
              onFiltersChange({
                ...filters,
                sortBy: sortBy || "detectedAt",
                sortDirection: (sortDirection as "asc" | "desc") || "desc",
              });
            }}
            data-testid="treasury-exceptions-filter-sort"
          >
            <option value="detectedAt:desc">Detecção (mais recente)</option>
            <option value="detectedAt:asc">Detecção (mais antiga)</option>
            <option value="ageDays:desc">Idade (maior)</option>
            <option value="severity:asc">Severidade</option>
            <option value="amount:desc">Valor (maior)</option>
            <option value="dueAt:asc">Prazo</option>
            <option value="status:asc">Status</option>
          </select>
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-sm" data-testid="treasury-exceptions-table">
          <thead className="bg-muted/40 text-left text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Severidade</th>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Valor</th>
              <th className="px-3 py-2 font-medium">Idade</th>
              <th className="px-3 py-2 font-medium">Prazo</th>
              <th className="px-3 py-2 font-medium">Responsável</th>
              <th className="px-3 py-2 font-medium">Ação recomendada</th>
              <th className="px-3 py-2 font-medium">Entidade</th>
              <th className="px-3 py-2 font-medium">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const open = isTreasuryExceptionOpenStatus(row.status);
              return (
                <tr
                  key={row.id}
                  className="border-t border-border"
                  data-testid={`treasury-exception-row-${row.id}`}
                >
                  <td className="px-3 py-2">
                    {TREASURY_EXCEPTION_SEVERITY_LABELS[row.severity]}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{row.title}</div>
                    <div className="text-xs text-muted-foreground">{row.type}</div>
                  </td>
                  <td className="px-3 py-2">
                    {TREASURY_EXCEPTION_STATUS_LABELS[row.status]}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {formatMoney(row.amount)}
                  </td>
                  <td className="px-3 py-2">
                    {formatTreasuryExceptionAgeLabel(row.ageDays)}
                  </td>
                  <td className="px-3 py-2">{row.dueAt ?? "—"}</td>
                  <td className="px-3 py-2">
                    {row.responsibleUserId
                      ? row.responsibleUserId.slice(0, 8)
                      : "—"}
                  </td>
                  <td className="px-3 py-2 max-w-[14rem] text-muted-foreground">
                    {row.recommendedAction}
                  </td>
                  <td className="px-3 py-2">
                    {row.entityHref ? (
                      <Link
                        to={row.entityHref}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                        data-testid={`treasury-exception-entity-${row.id}`}
                      >
                        Abrir
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canManage && open ? (
                      <div className="flex flex-wrap gap-1">
                        {row.status === "OPEN" || row.status === "ACK" ? (
                          <button
                            type="button"
                            className="rounded border border-border px-2 py-1 text-xs"
                            onClick={() => onAcknowledge(row)}
                          >
                            Em análise
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => onAssign(row)}
                        >
                          Atribuir
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => onSetDueAt(row)}
                        >
                          Prazo
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => onSetStatus(row)}
                        >
                          Status
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => onResolve(row)}
                        >
                          Resolver
                        </button>
                        <button
                          type="button"
                          className="rounded border border-border px-2 py-1 text-xs"
                          onClick={() => onIgnore(row)}
                        >
                          Ignorar
                        </button>
                      </div>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
