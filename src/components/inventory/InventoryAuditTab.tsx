import React, { useCallback, useEffect, useState } from "react";
import { fetchJsonOk } from "@/src/lib/http";
import { cn } from "@/src/lib/utils";
import { INVENTORY_EMPTY } from "@/src/components/inventory/inventoryEmptyStates";
import { appendQueryIfPresent, hasAnyFilter } from "@/src/components/inventory/inventoryFilterUtils";
import { useInventoryPermissions } from "@/src/components/inventory/inventoryPermissions";
import {
  formatInventoryApiError,
  formatInventoryDateTime,
  InventoryCollapsibleFilters,
  InventoryEmptyState,
  InventoryErrorBanner,
  InventoryFilterField,
  InventoryLoading,
  InventorySectionIntro,
  InventoryTableScroll,
  inventoryFilterInputClass,
  inventoryTableClassName,
} from "@/src/components/inventory/inventoryUi";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

type AuditRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string | null;
  userName: string | null;
  reason: string | null;
  createdAt: string;
};

export function InventoryAuditTab() {
  const { canViewAudit } = useInventoryPermissions();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");

  const filterValues = [entityType, entityId, action, userId];
  const filtersActive = hasAnyFilter(filterValues);
  const filterActiveCount = filterValues.filter((v) => hasAnyFilter([v])).length;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set("page", String(page));
      q.set("pageSize", "50");
      appendQueryIfPresent(q, "entityType", entityType);
      appendQueryIfPresent(q, "entityId", entityId);
      appendQueryIfPresent(q, "action", action);
      appendQueryIfPresent(q, "userId", userId);

      const raw = await fetchJsonOk<{
        rows?: AuditRow[];
        total?: number;
        totalPages?: number;
      }>(`/api/inventory/audit?${q.toString()}`);
      setRows(Array.isArray(raw.rows) ? raw.rows : []);
      setTotal(Number(raw.total) || 0);
      setTotalPages(Math.max(1, Number(raw.totalPages) || 1));
    } catch (e: unknown) {
      setError(formatInventoryApiError(e, "Não foi possível carregar a auditoria."));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [page, entityType, entityId, action, userId]);

  useEffect(() => {
    setPage(1);
  }, [entityType, entityId, action, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canViewAudit) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  const clearFilters = () => {
    setEntityType("");
    setEntityId("");
    setAction("");
    setUserId("");
  };

  const empty = INVENTORY_EMPTY.noAuditEntries;

  return (
    <div className="space-y-4" data-testid="inventory-audit-tab">
      <InventorySectionIntro
        title="Auditoria"
        description="Trilha paginada de alterações do módulo (movimentos, reservas, bloqueios, cadastros). Sem carregar o ledger completo no navegador."
      />

      {error ? (
        <InventoryErrorBanner
          message={error}
          onDismiss={() => setError(null)}
          testId="inventory-audit-error"
        />
      ) : null}

      <InventoryCollapsibleFilters
        activeCount={filterActiveCount}
        onClear={clearFilters}
        testId="inventory-audit-filters"
      >
        <InventoryFilterField label="Tipo de entidade">
          <input
            className={inventoryFilterInputClass}
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            placeholder="InventoryMovement…"
            data-testid="inventory-audit-filter-entity-type"
          />
        </InventoryFilterField>
        <InventoryFilterField label="ID da entidade">
          <input
            className={inventoryFilterInputClass}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            data-testid="inventory-audit-filter-entity-id"
          />
        </InventoryFilterField>
        <InventoryFilterField label="Ação">
          <input
            className={inventoryFilterInputClass}
            value={action}
            onChange={(e) => setAction(e.target.value)}
            data-testid="inventory-audit-filter-action"
          />
        </InventoryFilterField>
        <InventoryFilterField label="Usuário">
          <input
            className={inventoryFilterInputClass}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            data-testid="inventory-audit-filter-user"
          />
        </InventoryFilterField>
      </InventoryCollapsibleFilters>

      {loading ? (
        <InventoryLoading label="Carregando auditoria…" />
      ) : rows.length === 0 ? (
        <InventoryEmptyState
          title={empty.title}
          description={empty.description}
          actionLabel={filtersActive ? "Limpar filtros" : undefined}
          onAction={filtersActive ? clearFilters : undefined}
        />
      ) : (
        <InventoryTableScroll>
          <table className={inventoryTableClassName()} data-testid="inventory-audit-table">
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Ação</th>
                <th scope="col">Entidade</th>
                <th scope="col">Usuário</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap text-xs">{formatInventoryDateTime(row.createdAt)}</td>
                  <td className="font-medium text-sm">{row.action}</td>
                  <td className="text-xs">
                    <div>{row.entityType}</div>
                    <div className="font-mono text-[11px] text-slate-500">{row.entityId}</div>
                  </td>
                  <td className="text-xs">{row.userName || row.userId || "—"}</td>
                  <td className="text-xs" title={row.reason ?? undefined}>
                    {row.reason || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </InventoryTableScroll>
      )}

      {totalPages > 1 || total > 0 ? (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} evento(s) — página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={cn("rounded-md border px-3 py-1", page <= 1 ? "opacity-50" : "hover:bg-slate-50")}
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className={cn(
                "rounded-md border px-3 py-1",
                page >= totalPages ? "opacity-50" : "hover:bg-slate-50"
              )}
            >
              Próxima
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
