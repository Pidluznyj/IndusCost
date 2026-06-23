import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import {
  buildFinanceCostCentersListApiPath,
  FINANCE_COST_CENTERS_LIST_STATUS_OPTIONS,
} from "@/src/lib/financeCostCentersPageTypes";
import { buildFinanceCostCenterDetailPath } from "@/src/lib/financeNavigation";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import {
  FinanceCostCenterGridActiveFilters,
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridSummary,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  buildFinanceGridEmptyState,
  clampFinanceGridPage,
  DEFAULT_COST_CENTER_CRUD_SORT,
  paginateFinanceGridRows,
  prepareCostCenterCrudGridRows,
  readFinanceGridUrlInt,
  readFinanceGridUrlSort,
  readFinanceGridUrlString,
  toggleSortState,
  writeFinanceGridUrlParams,
  type CostCenterCrudSortKey,
} from "@/src/lib/financeCostCenterGridKit";
import { getSortDefaultDirection } from "@/src/lib/soldProductsTableSort";
import { COST_CENTER_CRUD_SORT_ACCESSORS } from "@/src/lib/financeCostCenterGridKit";
import { cn } from "@/src/lib/utils";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";

type Props = {
  canManage: boolean;
  onChanged?: () => void;
};

export function FinanceCostCentersCrudTab({ canManage, onChanged }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<FinanceCostCenterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceCostCenterDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [saving, setSaving] = useState(false);

  const listStatusFilter = readFinanceGridUrlString(searchParams, "cc_status", "all");
  const search = readFinanceGridUrlString(searchParams, "cc_q");
  const sort = readFinanceGridUrlSort(
    searchParams,
    "cc_sort",
    "cc_dir",
    ["code", "name", "status", "updatedAt"] as const,
    DEFAULT_COST_CENTER_CRUD_SORT
  );
  const page = readFinanceGridUrlInt(searchParams, "cc_page", 1);
  const pageSize = readFinanceGridUrlInt(searchParams, "cc_limit", 50, 1, 500);

  const patchUrl = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setSearchParams(writeFinanceGridUrlParams(searchParams, patch), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<{ items: FinanceCostCenterDto[] }>(
        buildFinanceCostCentersListApiPath(listStatusFilter),
        { credentials: "include" }
      );
      setItems(payload.items);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar os centros de custo.", e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [listStatusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ code: "", name: "", description: "" });
    setFormOpen(true);
  };

  const openEdit = (row: FinanceCostCenterDto) => {
    setEditing(row);
    setForm({
      code: row.code,
      name: row.name,
      description: row.description ?? "",
    });
    setFormOpen(true);
  };

  const save = async () => {
    if (!canManage) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await fetchJsonOk(`/api/finance/cost-centers/${editing.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            description: form.description || null,
          }),
        });
      } else {
        await fetchJsonOk("/api/finance/cost-centers", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: form.code,
            name: form.name,
            description: form.description || null,
          }),
        });
      }
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível salvar o centro de custo.", e));
    } finally {
      setSaving(false);
    }
  };

  const inactivate = async (row: FinanceCostCenterDto) => {
    if (!canManage || row.status === "INACTIVE") return;
    if (!window.confirm(`Inativar o centro de custo ${row.code}?`)) return;
    try {
      await fetchJsonOk(`/api/finance/cost-centers/${row.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "INACTIVE" }),
      });
      await load();
      onChanged?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível inativar o centro de custo.", e));
    }
  };

  const gridRows = useMemo(
    () =>
      prepareCostCenterCrudGridRows(
        items.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          status: row.status,
          updatedAt: row.updatedAt,
        })),
        search,
        sort
      ),
    [items, search, sort]
  );

  const { pageRows, totalPages, total } = useMemo(() => {
    const paged = paginateFinanceGridRows(gridRows, { page, pageSize });
    return {
      ...paged,
      page: clampFinanceGridPage(page, paged.totalPages),
    };
  }, [gridRows, page, pageSize]);

  const hasActiveFilters = Boolean(search.trim()) || listStatusFilter !== "all";
  const emptyCopy = buildFinanceGridEmptyState(
    items.length > 0,
    hasActiveFilters,
    {
      title: "Nenhum centro de custo cadastrado",
      description:
        "Comece criando seu primeiro centro de custo. Depois, defina regras por fornecedor para classificar títulos automaticamente.",
    },
    {
      title: "Nenhum centro no filtro",
      description: "Ajuste a busca ou o status para ver outros centros de custo.",
    }
  );

  const handleSort = (key: CostCenterCrudSortKey) => {
    const next = toggleSortState(
      sort,
      key,
      getSortDefaultDirection(COST_CENTER_CRUD_SORT_ACCESSORS, key)
    );
    patchUrl({ cc_sort: next.key, cc_dir: next.direction, cc_page: 1 });
  };

  const filterChips = [
    ...(listStatusFilter !== "all"
      ? [
          {
            key: "status",
            label: `Status: ${FINANCE_COST_CENTERS_LIST_STATUS_OPTIONS.find((o) => o.value === listStatusFilter)?.label ?? listStatusFilter}`,
            onRemove: () => patchUrl({ cc_status: null, cc_page: 1 }),
          },
        ]
      : []),
    ...(search.trim()
      ? [{ key: "q", label: `Busca: ${search.trim()}`, onRemove: () => patchUrl({ cc_q: null, cc_page: 1 }) }]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-crud-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cadastre a estrutura de centros de custo usada na classificação gerencial de AP.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FinanceCostCenterGridSearchBar
            value={search}
            onChange={(value) => patchUrl({ cc_q: value || null, cc_page: 1 })}
            placeholder="Código ou nome"
            testId="finance-cost-centers-crud-search"
          />
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={listStatusFilter}
              onChange={(e) => patchUrl({ cc_status: e.target.value === "all" ? null : e.target.value, cc_page: 1 })}
            >
              {FINANCE_COST_CENTERS_LIST_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              data-testid="finance-cost-centers-create-button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4" />
              Novo centro de custo
            </button>
          ) : null}
        </div>
      </div>

      <FinanceCostCenterGridActiveFilters
        chips={filterChips}
        onClear={
          hasActiveFilters
            ? () => patchUrl({ cc_q: null, cc_status: null, cc_page: 1 })
            : undefined
        }
      />

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando centros de custo…" /> : null}

      {!loading && gridRows.length === 0 ? (
        <FinanceModuleEmptyState title={emptyCopy.title} description={emptyCopy.description} />
      ) : null}

      {!loading && gridRows.length > 0 ? (
        <>
          <FinanceCostCenterGridSummary
            totals={{ rowCount: total }}
            filteredCount={total}
            page={clampFinanceGridPage(page, totalPages)}
            totalPages={totalPages}
            amountLabel="Centros"
          />
          <FinanceCostCenterGridTableShell
            tableClassName="min-w-[720px]"
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Código" sortKey="code" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Nome" sortKey="name" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Status" sortKey="status" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Atualizado" sortKey="updatedAt" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Ações</th>
              </tr>
            }
            footer={
              <FinanceCostCenterGridPagination
                page={clampFinanceGridPage(page, totalPages)}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={(nextPage) => patchUrl({ cc_page: nextPage })}
                onPageSizeChange={(nextSize) => patchUrl({ cc_limit: nextSize, cc_page: 1 })}
              />
            }
          >
            {pageRows.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="px-3 py-2 font-semibold">
                  <Link
                    to={buildFinanceCostCenterDetailPath(row.id)}
                    className="text-primary hover:underline"
                    data-testid="finance-cost-centers-open-detail"
                  >
                    {row.code}
                  </Link>
                </td>
                <td className="px-3 py-2">{row.name}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-semibold",
                      row.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {row.status === "ACTIVE" ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  {row.updatedAt ? formatFinanceDateTime(row.updatedAt) : "—"}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={buildFinanceCostCenterDetailPath(row.id)}
                      className="text-xs font-semibold text-primary"
                      data-testid="finance-cost-centers-view-allocations-button"
                    >
                      Ver lançamentos
                    </Link>
                    {canManage ? (
                      <>
                        <button
                          type="button"
                          data-testid="finance-cost-centers-edit-button"
                          className="text-xs font-semibold text-primary"
                          onClick={() => {
                            const full = items.find((item) => item.id === row.id);
                            if (full) openEdit(full);
                          }}
                        >
                          Editar
                        </button>
                        {row.status === "ACTIVE" ? (
                          <button
                            type="button"
                            data-testid="finance-cost-centers-inactivate-button"
                            className="text-xs font-semibold text-amber-700"
                            onClick={() => {
                              const full = items.find((item) => item.id === row.id);
                              if (full) void inactivate(full);
                            }}
                          >
                            Inativar
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn("rounded-xl border border-border bg-card p-4 shadow-sm w-full max-w-md space-y-4")}>
            <h3 className="text-lg font-semibold">
              {editing ? "Editar centro de custo" : "Novo centro de custo"}
            </h3>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Código</span>
              <input
                className="w-full rounded-lg border border-border px-3 py-2"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Nome</span>
              <input
                className="w-full rounded-lg border border-border px-3 py-2"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Descrição</span>
              <textarea
                className="w-full rounded-lg border border-border px-3 py-2"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setFormOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={saving || !form.code.trim() || !form.name.trim()}
                onClick={() => void save()}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
