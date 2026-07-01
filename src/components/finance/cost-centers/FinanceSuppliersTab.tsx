import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FileText, RefreshCw, Settings2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { EnsureSupplierFromApIdentityResponse } from "@/src/lib/financeSupplierSearchClient";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { FinanceSupplierRebuildPreviewPayload } from "@/src/lib/financeSupplierRebuild";
import type { SupplierCostCenterRuleDto } from "@/src/lib/financeSupplierCostCenterRules";
import { formatFinanceCurrency } from "@/src/lib/financeAccountsReceivableFormat";
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
  DEFAULT_SUPPLIER_GRID_SORT,
  paginateFinanceGridRows,
  prepareSupplierGridRows,
  readFinanceGridUrlInt,
  readFinanceGridUrlSort,
  readFinanceGridUrlString,
  SUPPLIER_GRID_SORT_ACCESSORS,
  supplierGridTotals,
  toggleSortState,
  writeFinanceGridUrlParams,
  type SupplierGridRow,
  type SupplierGridSortKey,
} from "@/src/lib/financeCostCenterGridKit";
import { getSortDefaultDirection } from "@/src/lib/soldProductsTableSort";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import { FinanceSupplierCadastroDrawer } from "@/src/components/finance/cost-centers/FinanceSupplierCadastroDrawer";
import { FinanceSupplierPaymentDrilldownSection } from "@/src/components/finance/cost-centers/FinanceSupplierPaymentDrilldownSection";

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  appliedFilters: FinanceCostCentersUiFilters;
  canViewSuppliers: boolean;
  canManageSuppliers: boolean;
  canDeleteSupplier: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onSuppliersChanged?: () => void;
};

export function FinanceSuppliersTab({
  dashboard,
  appliedFilters,
  canViewSuppliers,
  canManageSuppliers,
  canDeleteSupplier,
  onNavigateTab,
  onSuppliersChanged,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [preview, setPreview] = useState<FinanceSupplierRebuildPreviewPayload | null>(null);
  const [rules, setRules] = useState<SupplierCostCenterRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aliasesSupplier, setAliasesSupplier] = useState<SupplierGridRow | null>(null);
  const [cadastroSupplierId, setCadastroSupplierId] = useState<string | null>(null);
  const [creatingCadastroFor, setCreatingCadastroFor] = useState<string | null>(null);

  const search = readFinanceGridUrlString(searchParams, "sup_q");
  const ruleFilter = (readFinanceGridUrlString(searchParams, "sup_rule", "all") ||
    "all") as "all" | "with_rule" | "without_rule";
  const sort = readFinanceGridUrlSort(
    searchParams,
    "sup_sort",
    "sup_dir",
    ["name", "document", "titlesCount", "amount", "costCenterName", "ruleStatus"] as const,
    DEFAULT_SUPPLIER_GRID_SORT
  );
  const page = readFinanceGridUrlInt(searchParams, "sup_page", 1);
  const pageSize = readFinanceGridUrlInt(searchParams, "sup_limit", 50, 1, 500);

  const patchUrl = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      setSearchParams(writeFinanceGridUrlParams(searchParams, patch), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const load = useCallback(async () => {
    if (!canViewSuppliers) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [previewPayload, rulesPayload] = await Promise.all([
        fetchJsonOk<FinanceSupplierRebuildPreviewPayload>(
          "/api/finance/suppliers/rebuild-from-ap-preview",
          { credentials: "include" }
        ),
        fetchJsonOk<{ items: SupplierCostCenterRuleDto[] }>(
          "/api/finance/supplier-cost-center-rules",
          { credentials: "include" }
        ),
      ]);
      setPreview(previewPayload);
      setRules(rulesPayload.items);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar fornecedores.", e));
    } finally {
      setLoading(false);
    }
  }, [canViewSuppliers]);

  useEffect(() => {
    void load();
  }, [load]);

  const allRows = useMemo<SupplierGridRow[]>(() => {
    const bySupplier = dashboard?.bySupplier ?? [];
    const activeRulesBySupplier = new Map<string, SupplierCostCenterRuleDto[]>();
    for (const rule of rules) {
      if (!rule.isActive) continue;
      const list = activeRulesBySupplier.get(rule.supplierId) ?? [];
      list.push(rule);
      activeRulesBySupplier.set(rule.supplierId, list);
    }

    const previewById = new Map(
      (preview?.items ?? [])
        .filter((item) => item.existingSupplierId)
        .map((item) => [item.existingSupplierId!, item])
    );

    return bySupplier.map((row) => {
      const supplierRules = row.supplierId
        ? activeRulesBySupplier.get(row.supplierId) ?? []
        : [];
      const previewItem = row.supplierId ? previewById.get(row.supplierId) : null;
      const hasActiveRule = supplierRules.length > 0;
      return {
        supplierId: row.supplierId,
        name: row.name,
        document: row.document,
        titlesCount: row.titlesCount,
        amount: row.amount,
        costCenterName: row.costCenterName,
        ruleStatus: hasActiveRule
          ? supplierRules.length > 1
            ? "Rateio ativo"
            : "Regra ativa"
          : "Sem regra",
        hasActiveRule,
        aliasesCount: previewItem ? 1 : 0,
      };
    });
  }, [dashboard, preview, rules]);

  const gridRows = useMemo(
    () =>
      prepareSupplierGridRows(allRows, { search, ruleFilter }, sort),
    [allRows, search, ruleFilter, sort]
  );

  const totals = useMemo(() => supplierGridTotals(gridRows), [gridRows]);

  const { pageRows, totalPages, total } = useMemo(() => {
    const paged = paginateFinanceGridRows(gridRows, { page, pageSize });
    return { ...paged, page: clampFinanceGridPage(page, paged.totalPages) };
  }, [gridRows, page, pageSize]);

  const hasActiveFilters = Boolean(search.trim()) || ruleFilter !== "all";
  const emptyCopy = buildFinanceGridEmptyState(
    allRows.length > 0,
    hasActiveFilters,
    {
      title: "Nenhum fornecedor no filtro",
      description:
        "Execute a sincronização de AP ou reconstrua fornecedores a partir dos títulos para popular esta lista.",
    },
    {
      title: "Nenhum fornecedor no filtro aplicado",
      description: "Ajuste a busca ou o filtro de regra para ver outros fornecedores.",
    }
  );

  const handleSort = (key: SupplierGridSortKey) => {
    const next = toggleSortState(sort, key, getSortDefaultDirection(SUPPLIER_GRID_SORT_ACCESSORS, key));
    patchUrl({ sup_sort: next.key, sup_dir: next.direction, sup_page: 1 });
  };

  if (!canViewSuppliers) {
    return (
      <FinanceModuleEmptyState
        title="Sem permissão para fornecedores"
        description="Solicite acesso a fornecedores financeiros para gerenciar esta área."
      />
    );
  }

  const openCadastroFromApRow = async (row: SupplierGridRow) => {
    if (row.supplierId) {
      setCadastroSupplierId(row.supplierId);
      return;
    }
    setCreatingCadastroFor(row.name);
    try {
      const result = await fetchJsonOk<EnsureSupplierFromApIdentityResponse>(
        "/api/finance/suppliers/ensure-from-ap-identity",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ personName: row.name, personDocument: row.document }),
        }
      );
      setCadastroSupplierId(result.supplierId);
      onSuppliersChanged?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível criar cadastro gerencial a partir da origem AP.", e));
    } finally {
      setCreatingCadastroFor(null);
    }
  };

  const filterChips = [
    ...(ruleFilter !== "all"
      ? [
          {
            key: "rule",
            label: ruleFilter === "with_rule" ? "Com regra ativa" : "Sem regra ativa",
            onRemove: () => patchUrl({ sup_rule: null, sup_page: 1 }),
          },
        ]
      : []),
    ...(search.trim()
      ? [{ key: "q", label: `Busca: ${search.trim()}`, onRemove: () => patchUrl({ sup_q: null, sup_page: 1 }) }]
      : []),
  ];

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-suppliers-tab">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Fornecedores consolidados com volume de AP e status de classificação por centro de custo.{" "}
          <span className="text-xs">“Sem regra” é indicador operacional — distinto de títulos sem alocação real.</span>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FinanceCostCenterGridSearchBar
            value={search}
            onChange={(value) => patchUrl({ sup_q: value || null, sup_page: 1 })}
            placeholder="Nome, CNPJ ou centro"
            testId="finance-suppliers-search"
          />
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Regra</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={ruleFilter}
              onChange={(e) =>
                patchUrl({
                  sup_rule: e.target.value === "all" ? null : e.target.value,
                  sup_page: 1,
                })
              }
            >
              <option value="all">Todas</option>
              <option value="with_rule">Com regra ativa</option>
              <option value="without_rule">Sem regra ativa</option>
            </select>
          </label>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" />
          Atualizar
        </button>
      </div>

      <FinanceCostCenterGridActiveFilters
        chips={filterChips}
        onClear={
          hasActiveFilters
            ? () => patchUrl({ sup_q: null, sup_rule: null, sup_page: 1 })
            : undefined
        }
      />

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando fornecedores…" /> : null}

      {!loading && gridRows.length === 0 ? (
        <FinanceModuleEmptyState title={emptyCopy.title} description={emptyCopy.description} />
      ) : null}

      {!loading && gridRows.length > 0 ? (
        <>
          <FinanceCostCenterGridSummary
            totals={totals}
            filteredCount={total}
            page={clampFinanceGridPage(page, totalPages)}
            totalPages={totalPages}
          />
          <FinanceCostCenterGridTableShell
            tableClassName="min-w-[760px]"
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Fornecedor" sortKey="name" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Documento" sortKey="document" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Títulos" sortKey="titlesCount" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Valor" sortKey="amount" sort={sort} onSort={handleSort} align="right" />
                <FinanceCostCenterSortableTh label="Centro padrão" sortKey="costCenterName" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Regra" sortKey="ruleStatus" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Ações</th>
              </tr>
            }
            footer={
              <FinanceCostCenterGridPagination
                page={clampFinanceGridPage(page, totalPages)}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={(nextPage) => patchUrl({ sup_page: nextPage })}
                onPageSizeChange={(nextSize) => patchUrl({ sup_limit: nextSize, sup_page: 1 })}
              />
            }
          >
            {pageRows.map((row) => (
              <tr key={`${row.supplierId ?? row.name}`} className="border-b border-border/60">
                <td className="px-3 py-2 font-semibold">{row.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{row.document ?? "—"}</td>
                <td className="px-3 py-2 tabular-nums">{row.titlesCount}</td>
                <td className="px-3 py-2 tabular-nums text-right">{formatFinanceCurrency(row.amount)}</td>
                <td className="px-3 py-2">{row.costCenterName}</td>
                <td className="px-3 py-2">{row.ruleStatus}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {row.supplierId ? (
                      <button
                        type="button"
                        data-testid="finance-suppliers-open-cadastro-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                        onClick={() => setCadastroSupplierId(row.supplierId!)}
                      >
                        <FileText className="h-3 w-3" />
                        Abrir cadastro
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-testid="finance-suppliers-create-cadastro-button"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-50"
                        disabled={!canManageSuppliers || creatingCadastroFor === row.name}
                        onClick={() => void openCadastroFromApRow(row)}
                      >
                        <FileText className="h-3 w-3" />
                        {creatingCadastroFor === row.name ? "Criando…" : "Criar cadastro"}
                      </button>
                    )}
                    <button
                      type="button"
                      data-testid="finance-suppliers-define-rule-button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                      onClick={() => onNavigateTab("rules")}
                    >
                      <Settings2 className="h-3 w-3" />
                      Definir regra
                    </button>
                    <button
                      type="button"
                      data-testid="finance-suppliers-view-aliases-button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground"
                      onClick={() => setAliasesSupplier(row)}
                    >
                      <Eye className="h-3 w-3" />
                      Ver aliases
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}

      {aliasesSupplier ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "w-full max-w-lg space-y-3")}>
            <h3 className="text-lg font-semibold">Aliases — {aliasesSupplier.name}</h3>
            <p className="text-sm text-muted-foreground">
              Documento: {aliasesSupplier.document ?? "—"} · Centro: {aliasesSupplier.costCenterName}
            </p>
            <p className="text-sm">
              Os aliases consolidados são gerados automaticamente a partir dos títulos AP. Use a
              reconstrução de fornecedores para atualizar vínculos quando necessário.
            </p>
            <button
              type="button"
              className="rounded-lg border px-3 py-2 text-sm"
              onClick={() => setAliasesSupplier(null)}
            >
              Fechar
            </button>
          </div>
        </div>
      ) : null}

      <FinanceSupplierCadastroDrawer
        open={Boolean(cadastroSupplierId)}
        supplierId={cadastroSupplierId}
        onClose={() => setCadastroSupplierId(null)}
        onChanged={onSuppliersChanged}
        canManage={canManageSuppliers}
        canDelete={canDeleteSupplier}
      />

      <FinanceSupplierPaymentDrilldownSection filters={appliedFilters} />
    </div>
  );
}
