import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Layers,
  Loader2,
  Plus,
  Scale,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import { COMMISSIONS_RULES_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type {
  CommissionsRuleFormInput,
  CommissionsRuleItem,
} from "@/src/components/commissions/commissionsTypes";
import { CommissionsRuleFormModal } from "@/src/components/commissions/rules/CommissionsRuleFormModal";
import { CommissionsRuleUsageDrawer } from "@/src/components/commissions/rules/CommissionsRuleUsageDrawer";
import { CommissionsRulesFiltersPanel } from "@/src/components/commissions/rules/CommissionsRulesFiltersPanel";
import {
  EMPTY_COMMISSIONS_RULES_FILTERS,
  type CommissionsRulesFilters,
} from "@/src/components/commissions/rules/commissionsRulesFilters";
import {
  buildCommissionRuleSummary,
  formatCommissionRuleBase,
  formatCommissionRuleBeneficiary,
  formatCommissionRuleRelease,
} from "@/src/components/commissions/rules/commissionsRulesLabels";
import {
  duplicateCommissionRuleApi,
  saveCommissionRule,
  toggleCommissionRuleActiveApi,
  useCommissionsRulesData,
} from "@/src/components/commissions/rules/useCommissionsRulesData";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("pt-BR");
  } catch {
    return "—";
  }
}

function RuleRowActions({
  row,
  canManage,
  togglingId,
  duplicatingId,
  onEdit,
  onToggle,
  onDuplicate,
  onUsage,
}: {
  row: CommissionsRuleItem;
  canManage: boolean;
  togglingId: string | null;
  duplicatingId: string | null;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
  onUsage: () => void;
}) {
  const toggleBusy = togglingId === row.id;
  const dupBusy = duplicatingId === row.id;
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <button
        type="button"
        onClick={onUsage}
        className="rounded px-2 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#EFF6FF]"
      >
        Uso
      </button>
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
            disabled={dupBusy}
            onClick={onDuplicate}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
          >
            {dupBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            Duplicar
          </button>
          <button
            type="button"
            disabled={toggleBusy}
            onClick={onToggle}
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
          >
            {toggleBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {row.active ? "Inativar" : "Ativar"}
          </button>
        </>
      ) : null}
    </div>
  );
}

export function CommissionsRulesPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_RULES_MANAGE_PERMISSIONS]);

  const [draftFilters, setDraftFilters] = useState<CommissionsRulesFilters>(
    EMPTY_COMMISSIONS_RULES_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<CommissionsRulesFilters>(
    EMPTY_COMMISSIONS_RULES_FILTERS
  );
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingRule, setEditingRule] = useState<CommissionsRuleItem | null>(null);
  const [usageRuleId, setUsageRuleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useCommissionsRulesData(appliedFilters);

  function changePage(nextPage: number) {
    setAppliedFilters((prev) => ({ ...prev, page: nextPage }));
    setDraftFilters((prev) => ({ ...prev, page: nextPage }));
  }

  function openCreate() {
    setEditingRule(null);
    setFormError(null);
    setModalMode("create");
  }

  function openEdit(row: CommissionsRuleItem) {
    setEditingRule(row);
    setFormError(null);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingRule(null);
    setFormError(null);
  }

  async function handleSave(payload: CommissionsRuleFormInput) {
    setSaving(true);
    setFormError(null);
    try {
      await saveCommissionRule(
        modalMode === "create" ? "create" : "edit",
        editingRule?.id ?? null,
        payload as unknown as Record<string, unknown>
      );
      closeModal();
      await reload();
    } catch (e: unknown) {
      setFormError(formatCommissionsApiError(e, "Não foi possível salvar a regra de comissão."));
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: CommissionsRuleItem) {
    const action = row.active ? "inativar" : "ativar";
    const ok = window.confirm(`${action.charAt(0).toUpperCase()}${action.slice(1)} "${row.name}"?`);
    if (!ok) return;

    setTogglingId(row.id);
    setActionError(null);
    try {
      await toggleCommissionRuleActiveApi(row.id);
      await reload();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível alterar o status da regra."));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleDuplicate(row: CommissionsRuleItem) {
    const ok = window.confirm(`Duplicar a regra "${row.name}"? A cópia será criada como inativa.`);
    if (!ok) return;

    setDuplicatingId(row.id);
    setActionError(null);
    try {
      await duplicateCommissionRuleApi(row.id);
      await reload();
    } catch (e: unknown) {
      setActionError(formatCommissionsApiError(e, "Não foi possível duplicar a regra."));
    } finally {
      setDuplicatingId(null);
    }
  }

  const cards = data?.cards;
  const rows = data?.rows ?? data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5" data-testid="commissions-rules-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-[#6B7280]">
            Regras de comissão
          </p>
          <h3 className="text-xl font-extrabold tracking-tight text-[#111827]">
            Configuração de percentuais e liberação
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[#6B7280]">
            Defina quem recebe comissão, sobre qual base e quando a liberação ocorre.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-3 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
          >
            <Plus className="h-4 w-4" />
            Nova regra
          </button>
        ) : null}
      </div>

      {actionError ? (
        <CommissionsErrorBanner message={actionError} onDismiss={() => setActionError(null)} />
      ) : null}

      {error ? (
        <CommissionsErrorBanner message={error} onRetry={() => void reload()} />
      ) : null}

      {cards ? (
        <CommissionsKpiSection
          title="Resumo de regras de comissão"
          eyebrow="Regras cadastradas no sistema"
          testId="commissions-rules-kpi"
        >
          <FinanceKpiCard
            label="Total de regras"
            value={String(cards.totalCount)}
            icon={Scale}
            tone="neutral"
          />
          <FinanceKpiCard
            label="Regras ativas"
            value={String(cards.activeCount)}
            icon={ToggleRight}
            tone="success"
          />
          <FinanceKpiCard
            label="Regras inativas"
            value={String(cards.inactiveCount)}
            icon={ToggleLeft}
            tone="warning"
          />
          <FinanceKpiCard
            label="Com uso em comissões"
            value={String(cards.withUsageCount)}
            icon={Layers}
            tone="info"
          />
          <FinanceKpiCard
            label="Com condições"
            value={String(cards.withConditionsCount)}
            icon={Copy}
            tone="neutral"
          />
        </CommissionsKpiSection>
      ) : null}

      <CommissionsRulesFiltersPanel
        filters={draftFilters}
        onChange={setDraftFilters}
        onApply={() => setAppliedFilters({ ...draftFilters, page: 1 })}
        disabled={loading}
      />

      {loading ? <CommissionsLoading label="Carregando regras de comissão…" /> : null}

      {!loading && !error && data ? (
        rows.length === 0 ? (
          <CommissionsEmptyState
            title="Nenhuma regra encontrada"
            description="Crie uma regra ou ajuste os filtros para localizar configurações existentes."
            testId="commissions-rules-empty"
          />
        ) : (
          <>
            <CommissionsTableScroll>
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Nome / resumo</th>
                  <th className="px-3 py-2 text-left font-medium">Beneficiário</th>
                  <th className="px-3 py-2 text-right font-medium">%</th>
                  <th className="px-3 py-2 text-left font-medium">Base</th>
                  <th className="px-3 py-2 text-left font-medium">Liberação</th>
                  <th className="px-3 py-2 text-right font-medium">Prioridade</th>
                  <th className="px-3 py-2 text-center font-medium">Uso</th>
                  <th className="px-3 py-2 text-left font-medium">Vigência</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border bg-card">
                {rows.map((row) => (
                  <tr key={row.id} className={row.active ? "" : "opacity-60"}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{row.name}</p>
                      <p className="mt-0.5 max-w-xs text-xs text-[#6B7280]">
                        {buildCommissionRuleSummary(row)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      {formatCommissionRuleBeneficiary(
                        row.beneficiaryType,
                        row.fixedCommissionPersonName
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{row.ratePercent}%</td>
                    <td className="px-3 py-2">{formatCommissionRuleBase(row.baseType)}</td>
                    <td className="px-3 py-2">{formatCommissionRuleRelease(row.releaseRule)}</td>
                    <td className="px-3 py-2 text-right">{row.priority}</td>
                    <td className="px-3 py-2 text-center">{row.usageCount ?? 0}</td>
                    <td className="px-3 py-2 text-xs text-[#6B7280]">
                      {formatDate(row.validFrom)} — {formatDate(row.validTo)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          row.active
                            ? "rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {row.active ? "Ativa" : "Inativa"}
                      </span>
                      {(row.conditionsCount ?? row.conditions.length) > 0 ? (
                        <span className="ml-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                          {row.conditionsCount ?? row.conditions.length} cond.
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <RuleRowActions
                        row={row}
                        canManage={canManage}
                        togglingId={togglingId}
                        duplicatingId={duplicatingId}
                        onEdit={() => openEdit(row)}
                        onToggle={() => void handleToggle(row)}
                        onDuplicate={() => void handleDuplicate(row)}
                        onUsage={() => setUsageRuleId(row.id)}
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

      <CommissionsRuleFormModal
        open={modalMode != null}
        mode={modalMode === "edit" ? "edit" : "create"}
        initial={editingRule}
        saving={saving}
        error={formError}
        onClose={closeModal}
        onSubmit={handleSave}
      />

      <CommissionsRuleUsageDrawer ruleId={usageRuleId} onClose={() => setUsageRuleId(null)} />
    </div>
  );
}
