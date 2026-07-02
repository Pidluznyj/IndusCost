import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  UserCheck,
  UserCog,
  Users,
  UserX,
  Wallet,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { COMMISSIONS_PEOPLE_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type {
  CommissionsPersonFormInput,
  CommissionsPersonItem,
} from "@/src/components/commissions/commissionsTypes";
import { CommissionsPersonFormModal } from "@/src/components/commissions/persons/CommissionsPersonFormModal";
import { CommissionsPersonsFiltersPanel } from "@/src/components/commissions/persons/CommissionsPersonsFiltersPanel";
import {
  buildPersonCommissionsLink,
  buildPersonRulesLink,
  EMPTY_COMMISSIONS_PERSONS_FILTERS,
  type CommissionsPersonsFilters,
} from "@/src/components/commissions/persons/commissionsPersonsFilters";
import {
  formatCommissionPersonSource,
  formatCommissionPersonType,
} from "@/src/components/commissions/persons/commissionsPersonsLabels";
import {
  importCommissionPersonsFromOrdersApi,
  saveCommissionPerson,
  toggleCommissionPersonActiveApi,
  useCommissionsPersonsData,
} from "@/src/components/commissions/persons/useCommissionsPersonsData";

function PersonRowActions({
  row,
  year,
  canManage,
  togglingId,
  onEdit,
  onToggle,
}: {
  row: CommissionsPersonItem;
  year: string;
  canManage: boolean;
  togglingId: string | null;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const busy = togglingId === row.id;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Link
        to={buildPersonCommissionsLink(row.id, year)}
        className="rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
      >
        Comissões
      </Link>
      <Link
        to={buildPersonRulesLink(row.id, row.type)}
        className="rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6]"
      >
        Regras
      </Link>
      {canManage ? (
        <>
          <button
            type="button"
            onClick={onEdit}
            className="rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Editar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {row.active ? "Inativar" : "Ativar"}
          </button>
        </>
      ) : null}
    </div>
  );
}

export function CommissionsPersonsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_PEOPLE_MANAGE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsPersonsFilters>(
    EMPTY_COMMISSIONS_PERSONS_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsPersonsFilters>(
    EMPTY_COMMISSIONS_PERSONS_FILTERS
  );
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingPerson, setEditingPerson] = useState<CommissionsPersonItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsPersonsData(appliedFilters);

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  function openCreate() {
    setEditingPerson(null);
    setFormError(null);
    setModalMode("create");
  }

  function openEdit(row: CommissionsPersonItem) {
    setEditingPerson(row);
    setFormError(null);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingPerson(null);
    setFormError(null);
  }

  async function handleSave(payload: CommissionsPersonFormInput) {
    setSaving(true);
    setFormError(null);
    try {
      await saveCommissionPerson(modalMode === "create" ? "create" : "edit", editingPerson?.id ?? null, {
        name: payload.name.trim(),
        type: payload.type,
        source: payload.source,
        nomusPersonId: payload.nomusPersonId,
        email: payload.email,
        document: payload.document,
        active: payload.active,
        notes: payload.notes,
      });
      closeModal();
      await reload();
    } catch (e: unknown) {
      setFormError(formatCommissionsApiError(e, "Não foi possível salvar a pessoa comissionada."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: CommissionsPersonItem) {
    const action = row.active ? "inativar" : "ativar";
    const ok = window.confirm(`${action.charAt(0).toUpperCase()}${action.slice(1)} "${row.name}"?`);
    if (!ok) return;

    setTogglingId(row.id);
    setActionError(null);
    try {
      await toggleCommissionPersonActiveApi(row.id);
      await reload();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível alterar o status."));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleImport() {
    const ok = window.confirm(
      "Importar/atualizar pessoas comissionadas a partir dos pedidos?\n\nSerão considerados vendedores (ID + responsável) e representantes (ID + nome no payload Nomus). Registros sem nome real serão ignorados."
    );
    if (!ok) return;

    setImporting(true);
    setImportMessage(null);
    setActionError(null);
    try {
      const result = await importCommissionPersonsFromOrdersApi();
      setImportMessage(
        `${result.ordersScanned} pedidos analisados: ${result.created} criados, ${result.updated} atualizados, ${result.unchanged} sem alteração, ${result.skippedNoName} ignorados por falta de nome.`
      );
      await reload();
    } catch (e: unknown) {
      setActionError(
        formatCommissionsApiError(e, "Não foi possível importar pessoas dos pedidos.")
      );
    } finally {
      setImporting(false);
    }
  }

  const cards = data?.cards;
  const rows = data?.rows ?? data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-persons-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Pessoas comissionadas
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Vendedores, representantes e beneficiários
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Cadastro interno para mapear pessoas do Nomus e aplicar regras de comissão.
          </p>
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={importing}
              onClick={() => void handleImport()}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Importar dos pedidos
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
            >
              <Plus className="h-4 w-4" />
              Nova pessoa
            </button>
          </div>
        ) : null}
      </div>

      {importMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {importMessage}
        </div>
      ) : null}

      {actionError ? (
        <CommissionsErrorBanner
          message={actionError}
          onDismiss={() => setActionError(null)}
        />
      ) : null}

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {cards ? (
        <div className="indus-kpi-grid commercial-kpi-grid">
          <FinanceKpiCard
            label="Total de pessoas"
            value={String(cards.totalCount)}
            icon={Users}
            tone="neutral"
          />
          <FinanceKpiCard
            label="Vendedores ativos"
            value={String(cards.activeSellersCount)}
            icon={UserCheck}
            tone="info"
          />
          <FinanceKpiCard
            label="Representantes ativos"
            value={String(cards.activeRepresentativesCount)}
            icon={UserCog}
            tone="success"
          />
          <FinanceKpiCard
            label="Sem regra ativa"
            value={String(cards.withoutActiveRuleCount)}
            icon={UserX}
            tone="warning"
          />
          <FinanceKpiCard
            label="Com comissão no período"
            value={String(cards.withCommissionInPeriodCount)}
            icon={Wallet}
            tone="success"
          />
        </div>
      ) : null}

      <CommissionsPersonsFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {loading ? <CommissionsLoading label="Carregando pessoas comissionadas…" /> : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma pessoa encontrada"
            description="Ajuste os filtros, cadastre manualmente ou importe a partir dos pedidos."
            testId="commissions-persons-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll>
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nome</th>
                  <th className="px-3 py-2 text-left font-medium">Tipo</th>
                  <th className="px-3 py-2 text-left font-medium">Origem</th>
                  <th className="px-3 py-2 text-left font-medium">ID Nomus</th>
                  <th className="px-3 py-2 text-left font-medium">E-mail</th>
                  <th className="px-3 py-2 text-left font-medium">Documento</th>
                  <th className="px-3 py-2 text-center font-medium">Regras</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr key={row.id} className={row.active ? "" : "opacity-60"}>
                    <td className="px-3 py-2 font-medium">{row.name}</td>
                    <td className="px-3 py-2">{formatCommissionPersonType(row.type)}</td>
                    <td className="px-3 py-2">{formatCommissionPersonSource(row.source)}</td>
                    <td className="px-3 py-2">{row.nomusPersonId ?? "—"}</td>
                    <td className="px-3 py-2">{row.email ?? "—"}</td>
                    <td className="px-3 py-2">{row.document ?? "—"}</td>
                    <td className="px-3 py-2 text-center">{row.linkedRulesCount ?? 0}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.active
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {row.active ? "Ativo" : "Inativo"}
                      </span>
                      {row.hasCommissionInPeriod ? (
                        <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                          Comissão
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <PersonRowActions
                        row={row}
                        year={appliedFilters.year}
                        canManage={canManage}
                        togglingId={togglingId}
                        onEdit={() => openEdit(row)}
                        onToggle={() => void handleToggle(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </CommissionsTableScroll>

            {pagination && pagination.totalPages > 1 ? (
              <div className="flex items-center justify-between text-sm text-[#6B7280]">
                <span>
                  Página {pagination.page} de {pagination.totalPages} ({pagination.total}{" "}
                  registros)
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => changePage(pagination.page - 1)}
                    className="inline-flex h-8 items-center gap-1 rounded border border-[#E5E7EB] px-2 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    type="button"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => changePage(pagination.page + 1)}
                    className="inline-flex h-8 items-center gap-1 rounded border border-[#E5E7EB] px-2 disabled:opacity-40"
                  >
                    Próxima
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )
      ) : null}

      <CommissionsPersonFormModal
        open={modalMode != null}
        mode={modalMode === "edit" ? "edit" : "create"}
        initial={editingPerson}
        saving={saving}
        error={formError}
        onClose={closeModal}
        onSubmit={handleSave}
      />
    </div>
  );
}
