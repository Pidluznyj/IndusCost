import React, { useState } from "react";
import { Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { HttpError } from "@/src/lib/http";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CustomerExclusionRuleItem } from "@/src/components/commissions/commissionsTypes";
import { CommissionsCustomerExclusionFormModal } from "@/src/components/commissions/customerExclusions/CommissionsCustomerExclusionFormModal";
import {
  customerExclusionStatusBadgeClass,
  formatCustomerExclusionStatus,
  formatEffectiveRange,
  formatTaxIdDisplay,
  type CustomerExclusionFormInput,
} from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";
import {
  createCustomerExclusionApi,
  inactivateCustomerExclusionApi,
  updateCustomerExclusionApi,
  useCommissionsCustomerExclusionsData,
} from "@/src/components/commissions/customerExclusions/useCommissionsCustomerExclusionsData";

export function CommissionsCustomerExclusionsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const { data, loading, error, reload } = useCommissionsCustomerExclusionsData(search);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<CustomerExclusionRuleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = data?.rows ?? [];

  function openCreate() {
    setModalMode("create");
    setEditingRow(null);
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(row: CustomerExclusionRuleItem) {
    setModalMode("edit");
    setEditingRow(row);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(form: CustomerExclusionFormInput) {
    setSaving(true);
    setFormError(null);
    try {
      if (modalMode === "create") {
        await createCustomerExclusionApi(form);
      } else if (editingRow) {
        await updateCustomerExclusionApi(editingRow.id, form);
      }
      setModalOpen(false);
      setEditingRow(null);
      await reload();
    } catch (err: unknown) {
      if (err instanceof HttpError && err.status === 409) {
        setFormError(
          "Já existe uma regra ativa conflitante para este cliente no período informado."
        );
      } else {
        setFormError(formatCommissionsApiError(err, "Não foi possível salvar a exclusão."));
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleInactivate(row: CustomerExclusionRuleItem) {
    if (!canManage) return;
    const confirmed = window.confirm(
      `Inativar exclusão do cliente "${row.customerNameSnapshot}"?\n\nVendas futuras dentro da vigência voltarão a seguir as regras normais de comissão (após recálculo).`
    );
    if (!confirmed) return;
    setActionError(null);
    try {
      await inactivateCustomerExclusionApi(row.id);
      await reload();
    } catch (err: unknown) {
      setActionError(formatCommissionsApiError(err, "Não foi possível inativar a exclusão."));
    }
  }

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput.trim() || null);
  }

  return (
    <div className="space-y-5" data-testid="commissions-customer-exclusions-page">
      <CommissionsSectionIntro
        title="Exceções por cliente"
        description="Cadastre clientes que não geram comissão. A regra zera a comissão dentro da vigência, com motivo auditável — sem ocultar pedidos, NFs ou títulos."
        testId="commissions-customer-exclusions-intro"
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={applySearch} className="flex max-w-md flex-1 gap-2">
          <label className="sr-only" htmlFor="customer-exclusion-search">
            Buscar exclusões
          </label>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <input
              id="customer-exclusion-search"
              className="w-full rounded-md border py-2 pl-9 pr-2 text-sm"
              placeholder="Buscar cliente ou motivo…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
          </div>
          <button type="submit" className={financeBiButtonOutlineClass}>
            Buscar
          </button>
        </form>

        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" className={financeBiButtonOutlineClass} onClick={() => void reload()}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Atualizar
          </button>
          {canManage ? (
            <button
              type="button"
              className={financeBiButtonOutlineClass}
              onClick={openCreate}
              data-testid="customer-exclusion-new-button"
            >
              <Plus className="mr-2 h-4 w-4" />
              Nova exclusão de cliente
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}
      {actionError ? (
        <CommissionsErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      {loading && !data ? (
        <CommissionsLoading label="Carregando exclusões por cliente…" />
      ) : null}

      {!loading && rows.length === 0 ? (
        <CommissionsEmptyState
          title="Nenhuma exclusão cadastrada"
          description="Clientes sem comissão aparecerão aqui quando cadastrados."
          testId="commissions-customer-exclusions-empty"
        />
      ) : null}

      {rows.length > 0 ? (
        <CommissionsTableScroll testId="commissions-customer-exclusions-table">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Cliente</th>
              <th className="px-3 py-2 font-semibold">Documento/CNPJ</th>
              <th className="px-3 py-2 font-semibold">ID Nomus</th>
              <th className="px-3 py-2 font-semibold">Vigência</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Motivo</th>
              <th className="px-3 py-2 font-semibold">Atualizado em</th>
              {canManage ? <th className="px-3 py-2 font-semibold">Ações</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-background">
            {rows.map((row) => (
              <tr key={row.id} data-testid={`customer-exclusion-row-${row.id}`}>
                <td className="px-3 py-2 font-medium">{row.customerNameSnapshot}</td>
                <td className="px-3 py-2">{formatTaxIdDisplay(row.customerTaxId)}</td>
                <td className="px-3 py-2">{row.customerExternalId ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatEffectiveRange(row.effectiveFrom, row.effectiveTo)}
                </td>
                <td className="px-3 py-2">
                  <span className={customerExclusionStatusBadgeClass(row.status)}>
                    {formatCustomerExclusionStatus(row.status)}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-xs truncate" title={row.reason}>
                  {row.reason}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {new Date(row.updatedAt).toLocaleString("pt-BR")}
                </td>
                {canManage ? (
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => openEdit(row)}
                        data-testid={`customer-exclusion-edit-${row.id}`}
                      >
                        Editar
                      </button>
                      {row.status === "ACTIVE" ? (
                        <button
                          type="button"
                          className="text-xs font-semibold text-red-700 hover:underline"
                          onClick={() => void handleInactivate(row)}
                          data-testid={`customer-exclusion-inactivate-${row.id}`}
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
        </CommissionsTableScroll>
      ) : null}

      <CommissionsCustomerExclusionFormModal
        open={modalOpen}
        mode={modalMode}
        initial={editingRow}
        saving={saving}
        error={formError}
        onClose={() => {
          if (saving) return;
          setModalOpen(false);
          setEditingRow(null);
          setFormError(null);
        }}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
