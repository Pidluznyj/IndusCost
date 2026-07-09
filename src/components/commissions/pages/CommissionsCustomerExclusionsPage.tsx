import React, { useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { HttpError } from "@/src/lib/http";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiButtonOutlineClass } from "@/src/lib/financeBiDashboardTheme";
import { COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS } from "@/src/lib/commissionsPermissions";
import { ExecutiveAlert } from "@/src/components/ui/ExecutiveAlert";
import {
  SYSTEM_TOTALIZER_METRIC_CARD_CLASS,
  SystemTotalizerCard,
} from "@/src/components/ui/SystemTotalizerCard";
import { CommissionsPeriodFilterFields } from "@/src/components/commissions/CommissionsPeriodFilterFields";
import {
  CommissionsEmptyState,
  CommissionsErrorBanner,
  CommissionsKpiSection,
  CommissionsLoading,
  CommissionsSectionIntro,
  CommissionsTableScroll,
  formatCommissionsApiError,
} from "@/src/components/commissions/commissionsUi";
import type { CustomerExclusionRuleItem } from "@/src/components/commissions/commissionsTypes";
import { CommissionsCustomerExclusionFormModal } from "@/src/components/commissions/customerExclusions/CommissionsCustomerExclusionFormModal";
import {
  CUSTOMER_EXCLUSION_CLOSING_IMPACT_LABEL,
  CUSTOMER_EXCLUSION_EXCLUDED_LABEL,
  CUSTOMER_EXCLUSION_GROUP_AUTO_TYPE_LABEL,
  CUSTOMER_EXCLUSION_MANUAL_TYPE_LABEL,
  customerExclusionStatusBadgeClass,
  formatCustomerExclusionStatus,
  formatEffectiveRange,
  formatTaxIdDisplay,
  type CustomerExclusionFormInput,
} from "@/src/components/commissions/customerExclusions/commissionsCustomerExclusionLabels";
import {
  createCustomerExclusionApi,
  inactivateCustomerExclusionApi,
  mapRuleImpactById,
  updateCustomerExclusionApi,
  useCommissionsCustomerExclusionsData,
} from "@/src/components/commissions/customerExclusions/useCommissionsCustomerExclusionsData";

export function CommissionsCustomerExclusionsPage() {
  const auth = useAuth();
  const canManage = auth.hasAnyPermission([...COMMISSIONS_EXCEPTIONS_MANAGE_PERMISSIONS]);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const { data, reconciliation, loading, error, reload } = useCommissionsCustomerExclusionsData(
    search,
    year,
    month
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingRow, setEditingRow] = useState<CustomerExclusionRuleItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = data?.rows ?? [];
  const ruleImpact = useMemo(() => mapRuleImpactById(reconciliation), [reconciliation]);

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
        description="Cadastro oficial das exclusões manuais usadas pelo Fechamento, Previsão e Auditoria Visual. Empresas do grupo são excluídas automaticamente — não precisam ser cadastradas aqui."
        testId="commissions-customer-exclusions-intro"
      />

      <ExecutiveAlert
        variant="info"
        density="compact"
        title="Regra oficial"
        description="Exceções impactam o cálculo no backend (CommissionCustomerExclusionRule). Clientes excluídos não entram no grid comissionável do vendedor e aparecem na auditoria como excluídos."
      />

      <div className="rounded-xl border p-4 space-y-3">
        <CommissionsPeriodFilterFields
          year={year}
          month={month}
          onYearChange={setYear}
          onMonthChange={setMonth}
          yearLabel="Ano do fechamento"
          monthLabel="Mês do fechamento"
        />
        <p className="text-xs text-muted-foreground">
          A reconciliação abaixo usa o mesmo universo do Fechamento do mês (settlementDate).
        </p>
      </div>

      {reconciliation ? (
        <CommissionsKpiSection
          title="Reconciliação com Fechamento do mês"
          eyebrow={reconciliation.scopeNote}
          testId="commissions-customer-exclusions-reconciliation-kpi"
          minColumnWidth={220}
        >
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Clientes excluídos (fechamento)"
            amount={reconciliation.materializationSummary.excludedCustomerCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Empresas do grupo excluídas"
            amount={reconciliation.materializationSummary.groupCompanyExcludedCount}
            amountFormat="number"
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Recebido grupo (auditoria)"
            amount={reconciliation.materializationSummary.groupCompanyExcludedReceivedAmount}
          />
          <SystemTotalizerCard
            className={SYSTEM_TOTALIZER_METRIC_CARD_CLASS}
            label="Total recebido gerencial"
            amount={reconciliation.materializationSummary.totalReceivedAmount}
          />
        </CommissionsKpiSection>
      ) : null}

      {reconciliation && reconciliation.manualExcludedCustomers.length > 0 ? (
        <CommissionsTableScroll testId="commissions-customer-exclusions-closing-manual">
          <p className="mb-2 text-sm font-semibold">
            Clientes excluídos no fechamento selecionado ({CUSTOMER_EXCLUSION_EXCLUDED_LABEL})
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Cliente</th>
                <th className="px-3 py-2">ID Nomus</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Motivo</th>
                <th className="px-3 py-2 text-right">Títulos</th>
                <th className="px-3 py-2 text-right">Recebido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reconciliation.manualExcludedCustomers.map((row) => (
                <tr key={row.customerKey}>
                  <td className="px-3 py-2 font-medium">{row.customerName ?? "—"}</td>
                  <td className="px-3 py-2">{row.customerExternalId ?? "—"}</td>
                  <td className="px-3 py-2">{CUSTOMER_EXCLUSION_EXCLUDED_LABEL}</td>
                  <td className="px-3 py-2">{row.exclusionReason ?? "—"}</td>
                  <td className="px-3 py-2 text-right">{row.receivableCount}</td>
                  <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CommissionsTableScroll>
      ) : null}

      {reconciliation && reconciliation.groupCompanyExcluded.length > 0 ? (
        <CommissionsTableScroll testId="commissions-customer-exclusions-closing-group">
          <p className="mb-2 text-sm font-semibold">
            Empresas do grupo excluídas automaticamente ({CUSTOMER_EXCLUSION_GROUP_AUTO_TYPE_LABEL})
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">CNPJ</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2 text-right">Títulos</th>
                <th className="px-3 py-2 text-right">Recebido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reconciliation.groupCompanyExcluded.map((row) => (
                <tr key={row.cnpj}>
                  <td className="px-3 py-2 font-medium">{row.companyName}</td>
                  <td className="px-3 py-2">{row.displayCnpj}</td>
                  <td className="px-3 py-2">{row.exclusionLabel}</td>
                  <td className="px-3 py-2 text-right">{row.receivableCount}</td>
                  <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.receivedAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CommissionsTableScroll>
      ) : null}

      {reconciliation ? (
        <CommissionsTableScroll testId="commissions-customer-exclusions-fixed-group">
          <p className="mb-2 text-sm font-semibold">Empresas do grupo — exclusão fixa (sem cadastro manual)</p>
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Empresa</th>
                <th className="px-3 py-2">CNPJ</th>
                <th className="px-3 py-2">Tipo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {reconciliation.fixedGroupCompanies.map((row) => (
                <tr key={row.cnpj}>
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2">{row.displayCnpj}</td>
                  <td className="px-3 py-2">{row.exclusionLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CommissionsTableScroll>
      ) : null}

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
          <p className="mb-2 text-sm font-semibold">
            Exceções manuais cadastradas ({CUSTOMER_EXCLUSION_MANUAL_TYPE_LABEL})
          </p>
          <table className="min-w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Documento/CNPJ</th>
                <th className="px-3 py-2 font-semibold">ID Nomus</th>
                <th className="px-3 py-2 font-semibold">Tipo</th>
                <th className="px-3 py-2 font-semibold">Vigência</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Motivo</th>
                <th className="px-3 py-2 font-semibold">Impacto no fechamento</th>
                <th className="px-3 py-2 font-semibold">Atualizado em</th>
                {canManage ? <th className="px-3 py-2 font-semibold">Ações</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-background">
              {rows.map((row) => {
                const impact = ruleImpact.get(row.id);
                return (
                  <tr key={row.id} data-testid={`customer-exclusion-row-${row.id}`}>
                    <td className="px-3 py-2 font-medium">{row.customerNameSnapshot}</td>
                    <td className="px-3 py-2">{formatTaxIdDisplay(row.customerTaxId)}</td>
                    <td className="px-3 py-2">{row.customerExternalId ?? "—"}</td>
                    <td className="px-3 py-2">{CUSTOMER_EXCLUSION_MANUAL_TYPE_LABEL}</td>
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
                      {impact?.usedInClosing ? (
                        <span className="text-xs font-semibold text-emerald-800">
                          {CUSTOMER_EXCLUSION_CLOSING_IMPACT_LABEL}: {impact.receivableCount}{" "}
                          título(s), {formatFinanceCurrency(impact.receivedAmount)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem impacto no mês</span>
                      )}
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
                );
              })}
            </tbody>
          </table>
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
