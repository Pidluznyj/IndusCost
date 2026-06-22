import React, { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import {
  buildFinanceCostCentersListApiPath,
  FINANCE_COST_CENTERS_LIST_STATUS_OPTIONS,
} from "@/src/lib/financeCostCentersPageTypes";
import { formatFinanceDateTime } from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
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
  const [items, setItems] = useState<FinanceCostCenterDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FinanceCostCenterDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", description: "" });
  const [saving, setSaving] = useState(false);
  const [listStatusFilter, setListStatusFilter] = useState("all");

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

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-crud-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cadastre a estrutura de centros de custo usada na classificação gerencial de AP.
        </p>
        <label className="space-y-1">
          <span className={financeModuleFilterLabelClass()}>Status</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={listStatusFilter}
            onChange={(e) => setListStatusFilter(e.target.value)}
          >
            {FINANCE_COST_CENTERS_LIST_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
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

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando centros de custo…" /> : null}

      {!loading && items.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum centro de custo cadastrado"
          description="Comece criando seu primeiro centro de custo. Depois, defina regras por fornecedor para classificar títulos automaticamente."
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Código</th>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Atualizado</th>
                {canManage ? <th className="px-3 py-2">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="px-3 py-2 font-semibold">{row.code}</td>
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
                  <td className="px-3 py-2 text-muted-foreground">{formatFinanceDateTime(row.updatedAt)}</td>
                  {canManage ? (
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          data-testid="finance-cost-centers-edit-button"
                          className="text-xs font-semibold text-primary"
                          onClick={() => openEdit(row)}
                        >
                          Editar
                        </button>
                        {row.status === "ACTIVE" ? (
                          <button
                            type="button"
                            data-testid="finance-cost-centers-inactivate-button"
                            className="text-xs font-semibold text-amber-700"
                            onClick={() => void inactivate(row)}
                          >
                            Inativar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {formOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "w-full max-w-md space-y-4")}>
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
