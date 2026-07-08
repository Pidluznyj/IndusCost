import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { buildFinanceCostCentersDashboardQuery } from "@/src/lib/financeCostCentersPageTypes";
import type { CostCenterSupplierPaymentTitleRow } from "@/src/lib/financeCostCenterSupplierPaymentDrilldown.shared";
import type { CostCenterSupplierTitlesPayload } from "@/src/lib/financeCostCenterSupplierTitlesDrilldown.shared";
import { COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE } from "@/src/lib/financeCostCenterSupplierTitlesDrilldown.shared";
import type { SupplierGridRow } from "@/src/lib/financeCostCenterGridKit";
import { FinanceApTitleReclassifyModal } from "@/src/components/finance/cost-centers/FinanceApTitleReclassifyModal";
import { FinanceApTitleBatchReclassifyModal } from "@/src/components/finance/cost-centers/FinanceApTitleBatchReclassifyModal";
import { ExecutiveAlertBadge } from "@/src/components/ui/ExecutiveAlert";
import {
  formatFinanceCurrency,
  formatFinanceDate,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { usePortalContainer } from "@/src/components/finance/shared/usePortalContainer";
import {
  createDefaultSupplierTitleListFilters,
  type PaidTitleListFilters,
} from "@/src/lib/financePaidTitlesModalFilters";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";

type Props = {
  open: boolean;
  supplier: SupplierGridRow | null;
  filters: FinanceCostCentersUiFilters;
  canReclassify: boolean;
  onClose: () => void;
};

function buildSupplierTitlesQuery(
  filters: FinanceCostCentersUiFilters,
  supplier: SupplierGridRow,
  extra: Record<string, string | number | undefined> = {}
): string {
  const base = buildFinanceCostCentersDashboardQuery(filters);
  const q = new URLSearchParams(base);
  q.set("supplierKey", supplier.supplierKey);
  q.set("supplierDisplayName", supplier.name);
  for (const [key, value] of Object.entries(extra)) {
    if (value == null || value === "") continue;
    q.set(key, String(value));
  }
  return q.toString();
}

export function FinanceSupplierTitlesModal({
  open,
  supplier,
  filters,
  canReclassify,
  onClose,
}: Props) {
  const portalContainer = usePortalContainer();
  const [payload, setPayload] = useState<CostCenterSupplierTitlesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const defaultListFilters = useMemo(() => createDefaultSupplierTitleListFilters(), []);
  const [draftFilters, setDraftFilters] = useState<PaidTitleListFilters>(defaultListFilters);
  const [appliedFilters, setAppliedFilters] = useState<PaidTitleListFilters>(defaultListFilters);
  const [reclassifyTitle, setReclassifyTitle] =
    useState<CostCenterSupplierPaymentTitleRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchReclassifyOpen, setBatchReclassifyOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadTitles = useCallback(
    async (nextPage: number, nextFilters: PaidTitleListFilters) => {
      if (!supplier) return;
      setLoading(true);
      setError(null);
      try {
        const qs = buildSupplierTitlesQuery(filters, supplier, {
          page: nextPage,
          pageSize: 50,
          search: nextFilters.search || undefined,
          costCenterFilter: nextFilters.costCenterFilter,
          classificationStatus: nextFilters.classificationStatus,
        });
        const data = await fetchJsonOk<CostCenterSupplierTitlesPayload>(
          `/api/finance/cost-centers/supplier-titles?${qs}`,
          { credentials: "include" }
        );
        setPayload(data);
      } catch (e) {
        setError(buildFinanceTabLoadError("Não foi possível carregar títulos do fornecedor.", e));
        setPayload(null);
      } finally {
        setLoading(false);
      }
    },
    [filters, supplier]
  );

  useEffect(() => {
    if (!open || !supplier) {
      setPayload(null);
      setError(null);
      setPage(1);
      setSelectedIds(new Set());
      setBatchReclassifyOpen(false);
      setSuccessMessage(null);
      setReclassifyTitle(null);
      return;
    }
    const defaults = createDefaultSupplierTitleListFilters();
    setDraftFilters(defaults);
    setAppliedFilters(defaults);
    setPage(1);
    void loadTitles(1, defaults);
  }, [open, supplier, loadTitles]);

  const pageRows = payload?.items ?? [];
  const selectedRows = useMemo(
    () => pageRows.filter((row) => selectedIds.has(row.accountsPayableId)),
    [pageRows, selectedIds]
  );
  const selectedCount = selectedRows.length;
  const allPageSelected =
    pageRows.length > 0 && pageRows.every((row) => selectedIds.has(row.accountsPayableId));

  const costCenterOptions = payload?.costCenterOptions ?? [];

  const clearSelection = () => setSelectedIds(new Set());

  const applyFilters = (nextFilters: PaidTitleListFilters, nextPage = 1) => {
    setAppliedFilters(nextFilters);
    setDraftFilters(nextFilters);
    setPage(nextPage);
    clearSelection();
    setSuccessMessage(null);
    void loadTitles(nextPage, nextFilters);
  };

  const handleSearch = () => {
    applyFilters({ ...draftFilters, search: draftFilters.search.trim() }, 1);
  };

  const handleClearFilters = () => {
    applyFilters(defaultListFilters, 1);
  };

  const refreshCurrentList = (message?: string) => {
    if (message) setSuccessMessage(message);
    clearSelection();
    void loadTitles(page, appliedFilters);
  };

  const toggleRowSelection = (accountsPayableId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountsPayableId)) next.delete(accountsPayableId);
      else next.add(accountsPayableId);
      return next;
    });
  };

  const toggleSelectAllPage = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const row of pageRows) next.delete(row.accountsPayableId);
        return next;
      });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of pageRows) next.add(row.accountsPayableId);
      return next;
    });
  };

  const periodSummary = useMemo(() => {
    if (!payload) return null;
    return `${payload.periodLabel} · ${payload.titlesCount} título(s) · ${formatFinanceCurrency(payload.totalTitleAmount)}`;
  }, [payload]);

  const showPanel = Boolean(open && supplier && portalContainer);

  return (
    <>
      {showPanel && supplier && portalContainer
        ? createPortal(
            <div className="fixed inset-0 z-[75] flex">
              <button
                type="button"
                className="absolute inset-0 bg-black/40"
                aria-label="Fechar modal"
                onClick={onClose}
              />
              <div
                className={cn(
                  financeBiCardClass,
                  "relative ml-auto flex h-full w-full max-w-6xl flex-col overflow-hidden shadow-2xl"
                )}
                data-testid="finance-supplier-titles-modal"
              >
                <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold truncate">
                      Títulos do fornecedor — {supplier.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Títulos de Contas a Pagar vinculados a este fornecedor no período e filtros da
                      tela.
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {payload?.periodScopeNote ??
                        "Somente leitura — não altera classificação nem dados do Contas a Pagar."}
                    </p>
                  </div>
                  <button type="button" className="rounded-lg border p-2" onClick={onClose} aria-label="Fechar">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="border-b border-border/80 bg-muted/20 px-5 py-3 text-sm">
                  <div className="flex flex-wrap gap-x-6 gap-y-1">
                    <span>
                      <span className="text-muted-foreground">Fornecedor:</span>{" "}
                      <span className="font-semibold">{supplier.name}</span>
                    </span>
                    <span>
                      <span className="text-muted-foreground">Documento:</span>{" "}
                      {supplier.document ?? payload?.supplierDocument ?? "—"}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Centro padrão:</span> {supplier.costCenterName}
                    </span>
                    <span>
                      <span className="text-muted-foreground">Regra:</span> {supplier.ruleStatus}
                    </span>
                  </div>
                  {periodSummary ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Resultado filtrado:{" "}
                      <span className="font-semibold text-foreground">{periodSummary}</span>
                    </p>
                  ) : null}
                  <p
                    className="mt-1 text-[11px] text-muted-foreground"
                    title={COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE}
                  >
                    {payload?.dateRuleNote ?? COST_CENTER_SUPPLIER_TITLES_DATE_RULE_NOTE}
                  </p>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {error ? (
                    <FinanceModuleErrorBanner
                      message={error}
                      onRetry={() => void loadTitles(page, appliedFilters)}
                      onDismiss={() => setError(null)}
                    />
                  ) : null}

                  <div
                    className="flex flex-wrap items-end gap-3"
                    data-testid="finance-supplier-titles-filters"
                  >
                    <div className="min-w-[12rem] flex-1">
                      <FinanceCostCenterGridSearchBar
                        value={draftFilters.search}
                        onChange={(value) => setDraftFilters((prev) => ({ ...prev, search: value }))}
                        placeholder="Buscar documento, descrição, NF…"
                        testId="finance-supplier-titles-search"
                      />
                    </div>
                    <label className="min-w-[11rem] space-y-1">
                      <span className={financeModuleFilterLabelClass()}>Centro de custo</span>
                      <select
                        className={financeModuleFilterFieldClass()}
                        value={draftFilters.costCenterFilter}
                        onChange={(e) =>
                          setDraftFilters((prev) => ({
                            ...prev,
                            costCenterFilter: e.target.value,
                          }))
                        }
                        data-testid="finance-supplier-titles-cost-center-filter"
                      >
                        <option value="all">Todos</option>
                        <option value="unclassified">Sem centro de custo classificado</option>
                        {costCenterOptions.map((center) => (
                          <option key={center.id} value={center.id}>
                            {center.code} — {center.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="min-w-[11rem] space-y-1">
                      <span className={financeModuleFilterLabelClass()}>Status de classificação</span>
                      <select
                        className={financeModuleFilterFieldClass()}
                        value={draftFilters.classificationStatus}
                        onChange={(e) =>
                          setDraftFilters((prev) => ({
                            ...prev,
                            classificationStatus: e.target.value as PaidTitleListFilters["classificationStatus"],
                          }))
                        }
                        data-testid="finance-supplier-titles-classification-filter"
                      >
                        <option value="pending">Pendentes / sem classificação</option>
                        <option value="manual">Reclassificados manualmente</option>
                        <option value="auto">Classificados automaticamente</option>
                        <option value="all">Todos</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-2 text-sm font-semibold"
                      data-testid="finance-supplier-titles-search-button"
                      onClick={handleSearch}
                    >
                      Buscar
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border px-3 py-2 text-sm font-semibold"
                      data-testid="finance-supplier-titles-clear-filters-button"
                      onClick={handleClearFilters}
                    >
                      Limpar filtros
                    </button>
                  </div>

                  {canReclassify && selectedCount > 0 ? (
                    <div
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
                      data-testid="finance-supplier-titles-batch-bar"
                    >
                      <p className="text-sm font-semibold">
                        {selectedCount} título{selectedCount === 1 ? "" : "s"} selecionado
                        {selectedCount === 1 ? "" : "s"}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (desta página)
                        </span>
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                          onClick={clearSelection}
                        >
                          Limpar seleção
                        </button>
                        <button
                          type="button"
                          data-testid="finance-supplier-titles-batch-reclassify-button"
                          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
                          onClick={() => setBatchReclassifyOpen(true)}
                        >
                          Reclassificar selecionados
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {successMessage ? (
                    <p
                      className="text-sm font-semibold text-emerald-700 dark:text-emerald-400"
                      data-testid="finance-supplier-titles-success-message"
                    >
                      {successMessage}
                    </p>
                  ) : null}

                  {loading ? <FinanceModuleLoadingBlock label="Carregando títulos…" /> : null}

                  {!loading && payload && payload.items.length === 0 ? (
                    <FinanceModuleEmptyState
                      title="Nenhum título encontrado"
                      description="Nenhum título encontrado para este fornecedor no filtro atual."
                    />
                  ) : null}

                  {!loading && payload && payload.items.length > 0 ? (
                    <FinanceCostCenterGridTableShell
                      tableClassName="min-w-[1000px]"
                      head={
                        <tr className="border-b border-border text-left text-[10px] uppercase text-muted-foreground">
                          {canReclassify ? (
                            <th className="px-3 py-2 w-10">
                              <input
                                type="checkbox"
                                aria-label="Selecionar todos os títulos da página"
                                data-testid="finance-supplier-titles-select-all"
                                checked={allPageSelected}
                                onChange={toggleSelectAllPage}
                              />
                            </th>
                          ) : null}
                          <th className="px-3 py-2">Documento</th>
                          <th className="px-3 py-2">Emissão</th>
                          <th className="px-3 py-2">Vencimento</th>
                          <th className="px-3 py-2">Pagamento</th>
                          <th className="px-3 py-2 text-right">Valor</th>
                          <th className="px-3 py-2">Centro de custo</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2 min-w-[14rem]">Descrição / comentário</th>
                          {canReclassify ? <th className="px-3 py-2">Ações</th> : null}
                        </tr>
                      }
                      footer={
                        <FinanceCostCenterGridPagination
                          page={payload.page}
                          totalPages={payload.totalPages}
                          pageSize={payload.pageSize}
                          onPageChange={(nextPage) => {
                            setPage(nextPage);
                            clearSelection();
                            void loadTitles(nextPage, appliedFilters);
                          }}
                          onPageSizeChange={() => undefined}
                        />
                      }
                    >
                      {payload.items.map((row) => (
                        <tr key={row.accountsPayableId} className="border-b border-border/60 text-xs align-top">
                          {canReclassify ? (
                            <td className="px-3 py-2">
                              <input
                                type="checkbox"
                                aria-label={`Selecionar título ${row.documentNumber ?? row.accountsPayableId}`}
                                data-testid="finance-supplier-title-select"
                                checked={selectedIds.has(row.accountsPayableId)}
                                onChange={() => toggleRowSelection(row.accountsPayableId)}
                              />
                            </td>
                          ) : null}
                          <td className="px-3 py-2">
                            {row.documentNumber ?? row.accountsPayableId}
                            {row.sourceInvoiceNumber || row.sourceInvoiceId ? (
                              <p className="text-[10px] text-muted-foreground">
                                NF {row.sourceInvoiceNumber ?? row.sourceInvoiceId}
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-2">{formatFinanceDate(row.issueDate)}</td>
                          <td className="px-3 py-2">{formatFinanceDate(row.dueDate)}</td>
                          <td className="px-3 py-2">{formatFinanceDate(row.paymentDate)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold">
                            {formatFinanceCurrency(row.paidAmount)}
                          </td>
                          <td className="px-3 py-2" title={row.costCenterCode ?? undefined}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{row.costCenterName}</span>
                              {row.isManualClassification ? (
                                <ExecutiveAlertBadge variant="attention" className="text-[9px]">
                                  Manual
                                </ExecutiveAlertBadge>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-3 py-2">{row.statusLabel}</td>
                          <td className="px-3 py-2 max-w-[20rem]">
                            <p className="line-clamp-3 whitespace-pre-wrap" title={row.descriptiveText}>
                              {row.descriptiveText}
                            </p>
                          </td>
                          {canReclassify ? (
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                data-testid="finance-supplier-title-reclassify-button"
                                className="text-xs font-semibold text-primary hover:underline"
                                onClick={() => setReclassifyTitle(row)}
                              >
                                Reclassificar
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </FinanceCostCenterGridTableShell>
                  ) : null}
                </div>
              </div>
            </div>,
            portalContainer
          )
        : null}
      <FinanceApTitleReclassifyModal
        open={Boolean(open && supplier && reclassifyTitle)}
        titleRow={reclassifyTitle}
        supplierName={supplier?.name ?? ""}
        onClose={() => setReclassifyTitle(null)}
        onSaved={() => {
          setReclassifyTitle(null);
          refreshCurrentList("Título reclassificado com sucesso.");
        }}
      />
      <FinanceApTitleBatchReclassifyModal
        open={Boolean(open && supplier && batchReclassifyOpen && selectedCount > 0)}
        selectedRows={selectedRows}
        supplierName={supplier?.name ?? ""}
        onClose={() => setBatchReclassifyOpen(false)}
        onSaved={(result) => {
          setBatchReclassifyOpen(false);
          if (result.updated > 0) {
            refreshCurrentList(`${result.updated} título(s) reclassificado(s) com sucesso.`);
          } else {
            refreshCurrentList();
          }
        }}
      />
    </>
  );
}
