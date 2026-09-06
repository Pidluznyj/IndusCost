import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, Eye, FileText, ListOrdered, Plus, RefreshCw, Settings2 } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { EnsureSupplierFromApIdentityResponse } from "@/src/lib/financeSupplierSearchClient";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { FinanceSupplierRebuildPreviewPayload } from "@/src/lib/financeSupplierRebuild";
import type {
  FinanceSupplierSearchResult,
  SupplierCostCenterRuleDto,
} from "@/src/lib/financeSupplierCostCenterRules";
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
  type SupplierStatusFilter,
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
import { getFinanceSectionPath } from "@/src/lib/financeNavigation";
import { FinanceSupplierCadastroDrawer } from "@/src/components/finance/cost-centers/FinanceSupplierCadastroDrawer";
import { FinanceSupplierPaymentDrilldownSection } from "@/src/components/finance/cost-centers/FinanceSupplierPaymentDrilldownSection";
import { FinanceSupplierTitlesModal } from "@/src/components/finance/cost-centers/FinanceSupplierTitlesModal";
import { SupplierServiceTerminationDialog } from "@/src/components/finance/cost-centers/SupplierServiceTerminationDialog";
import { useAuth } from "@/src/contexts/AuthContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess";
import {
  fetchSupplierEvaluationListSummaries,
  useSupplierPerformanceFeatureEnabled,
} from "@/src/lib/purchasing/supplierPerformanceClient";
import type { SupplierEvaluationListSummaryDto } from "@/src/lib/purchasing/supplierPerformance";
import {
  formatSupplierCoverage,
  formatSupplierEvaluationCount,
  formatSupplierScoreWithScale,
} from "@/src/lib/purchasing/supplierPerformance";

export type SuppliersManagementContext = "finance-menu" | "cost-center-tab";

type Props = {
  context?: SuppliersManagementContext;
  dashboard: FinanceCostCenterDashboardPayload | null;
  appliedFilters: FinanceCostCentersUiFilters;
  canViewSuppliers: boolean;
  canManageSuppliers: boolean;
  canDeleteSupplier: boolean;
  canReclassifyTitles: boolean;
  canViewServiceTermination?: boolean;
  canCreateServiceTermination?: boolean;
  canFinalizeServiceTermination?: boolean;
  canExportServiceTermination?: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onSuppliersChanged?: () => void;
};

function readStatusFilter(raw: string | null): SupplierStatusFilter {
  if (raw === "active" || raw === "inactive") return raw;
  return "all";
}

export function SuppliersManagementView({
  context = "cost-center-tab",
  dashboard,
  appliedFilters,
  canViewSuppliers,
  canManageSuppliers,
  canDeleteSupplier,
  canReclassifyTitles,
  canViewServiceTermination = false,
  canCreateServiceTermination = false,
  canFinalizeServiceTermination = false,
  canExportServiceTermination = false,
  onNavigateTab,
  onSuppliersChanged,
}: Props) {
  const navigate = useNavigate();
  const auth = useAuth();
  const permissions = usePermissions();
  const supplierPerformanceEnabled = useSupplierPerformanceFeatureEnabled();
  const canViewEvaluation =
    auth.hasPermission("purchases.view") ||
    permissions.canPerformAction(
      OPERATIONS_RESOURCE_KEYS.purchases,
      OPERATIONS_ACTIONS.view
    );
  const showEvaluationScore =
    supplierPerformanceEnabled === true && canViewEvaluation;
  const [searchParams, setSearchParams] = useSearchParams();
  const [preview, setPreview] = useState<FinanceSupplierRebuildPreviewPayload | null>(null);
  const [rules, setRules] = useState<SupplierCostCenterRuleDto[]>([]);
  const [masterSuppliers, setMasterSuppliers] = useState<FinanceSupplierSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aliasesSupplier, setAliasesSupplier] = useState<SupplierGridRow | null>(null);
  const [supplierTitlesSupplier, setSupplierTitlesSupplier] = useState<SupplierGridRow | null>(null);
  const [cadastroSupplierId, setCadastroSupplierId] = useState<string | null>(null);
  const [cadastroMode, setCadastroMode] = useState<"create" | "edit">("edit");
  const [terminationTarget, setTerminationTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [creatingCadastroFor, setCreatingCadastroFor] = useState<string | null>(null);

  const search = readFinanceGridUrlString(searchParams, "sup_q");
  const ruleFilter = (readFinanceGridUrlString(searchParams, "sup_rule", "all") ||
    "all") as "all" | "with_rule" | "without_rule";
  const statusFilter = readStatusFilter(readFinanceGridUrlString(searchParams, "sup_status", "all"));
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
      // PERM-41: menu Financeiro > Fornecedores não depende de Centros de Custo.
      const needsCostCenterRules = context === "cost-center-tab";
      const [previewPayload, rulesPayload, searchPayload] = await Promise.all([
        fetchJsonOk<FinanceSupplierRebuildPreviewPayload>(
          "/api/finance/suppliers/rebuild-from-ap-preview",
          { credentials: "include" }
        ),
        needsCostCenterRules
          ? fetchJsonOk<{ items: SupplierCostCenterRuleDto[] }>(
              "/api/finance/supplier-cost-center-rules",
              { credentials: "include" }
            )
          : Promise.resolve({ items: [] as SupplierCostCenterRuleDto[] }),
        fetchJsonOk<{ suppliers: FinanceSupplierSearchResult[] }>(
          "/api/finance/suppliers/search?includeInactive=true&limit=500",
          { credentials: "include" }
        ),
      ]);
      setPreview(previewPayload);
      setRules(rulesPayload.items);
      setMasterSuppliers(searchPayload.suppliers ?? []);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar fornecedores.", e));
    } finally {
      setLoading(false);
    }
  }, [canViewSuppliers, context]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleNavigateRules = () => {
    if (context === "finance-menu") {
      navigate(`${getFinanceSectionPath("cost-centers")}?tab=rules`);
      return;
    }
    onNavigateTab("rules");
  };

  /** Colunas/ações/resumo financeiros e de regra — só na aba Centro de Custos. */
  const showFinancialContext = context === "cost-center-tab";
  const showOperationalActions = showFinancialContext;

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

    const statusById = new Map(
      masterSuppliers
        .filter((row) => row.id)
        .map((row) => [row.id!, row.status ?? "ACTIVE"] as const)
    );

    const fromDashboard = bySupplier.map((row) => {
      const supplierRules = row.supplierId
        ? activeRulesBySupplier.get(row.supplierId) ?? []
        : [];
      const previewItem = row.supplierId ? previewById.get(row.supplierId) : null;
      const hasActiveRule = supplierRules.length > 0;
      return {
        supplierKey: row.supplierKey,
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
        status: row.supplierId ? statusById.get(row.supplierId) ?? "ACTIVE" : null,
      } satisfies SupplierGridRow;
    });

    const seenIds = new Set(
      fromDashboard.map((row) => row.supplierId).filter((id): id is string => Boolean(id))
    );

    // Sem dashboard (menu Fornecedores): grade a partir do cadastro mestre.
    // Com dashboard: só complementa INACTIVE ausentes (comportamento CC).
    const masterExtras: SupplierGridRow[] = [];
    for (const master of masterSuppliers) {
      if (!master.id || seenIds.has(master.id)) continue;
      const status = master.status ?? "ACTIVE";
      if (bySupplier.length > 0 && status !== "INACTIVE") continue;
      const supplierRules = activeRulesBySupplier.get(master.id) ?? [];
      const hasActiveRule = supplierRules.length > 0;
      masterExtras.push({
        supplierKey: master.id,
        supplierId: master.id,
        name: master.name,
        document: master.document,
        titlesCount: master.titlesCount,
        amount: master.totalValue ?? 0,
        costCenterName: "—",
        ruleStatus: hasActiveRule
          ? supplierRules.length > 1
            ? "Rateio ativo"
            : "Regra ativa"
          : "Sem regra",
        hasActiveRule,
        aliasesCount: 0,
        status,
      });
    }

    return [...fromDashboard, ...masterExtras];
  }, [dashboard, preview, rules, masterSuppliers]);

  const gridRows = useMemo(
    () =>
      prepareSupplierGridRows(
        allRows,
        {
          search,
          ruleFilter: showFinancialContext ? ruleFilter : "all",
          statusFilter,
        },
        sort
      ),
    [allRows, search, ruleFilter, statusFilter, sort, showFinancialContext]
  );

  const totals = useMemo(() => {
    const base = supplierGridTotals(gridRows);
    if (showFinancialContext) return base;
    return { rowCount: base.rowCount };
  }, [gridRows, showFinancialContext]);

  const { pageRows, totalPages, total } = useMemo(() => {
    const paged = paginateFinanceGridRows(gridRows, { page, pageSize });
    return { ...paged, page: clampFinanceGridPage(page, paged.totalPages) };
  }, [gridRows, page, pageSize]);

  const [evaluationSummaries, setEvaluationSummaries] = useState<
    Record<string, SupplierEvaluationListSummaryDto>
  >({});

  const pageSupplierIds = useMemo(
    () =>
      pageRows
        .map((row) => row.supplierId)
        .filter((id): id is string => Boolean(id)),
    [pageRows]
  );
  const pageSupplierIdsKey = pageSupplierIds.join(",");

  useEffect(() => {
    if (!showEvaluationScore) {
      setEvaluationSummaries({});
      return;
    }
    if (!pageSupplierIdsKey) {
      setEvaluationSummaries({});
      return;
    }
    const controller = new AbortController();
    void fetchSupplierEvaluationListSummaries(pageSupplierIdsKey.split(","), controller.signal)
      .then((payload) => {
        const next: Record<string, SupplierEvaluationListSummaryDto> = {};
        for (const item of payload.items) next[item.supplierId] = item;
        setEvaluationSummaries(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setEvaluationSummaries({});
      });
    return () => controller.abort();
  }, [showEvaluationScore, pageSupplierIdsKey]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    statusFilter !== "all" ||
    (showFinancialContext && ruleFilter !== "all");
  const emptyCopy = buildFinanceGridEmptyState(
    allRows.length > 0,
    hasActiveFilters,
    showFinancialContext
      ? {
          title: "Nenhum fornecedor no filtro",
          description:
            "Execute a sincronização de AP ou reconstrua fornecedores a partir dos títulos para popular esta lista.",
        }
      : {
          title: "Nenhum fornecedor no filtro",
          description: "Cadastre um novo fornecedor ou ajuste a busca/status para ver outros registros.",
        },
    showFinancialContext
      ? {
          title: "Nenhum fornecedor no filtro aplicado",
          description: "Ajuste a busca ou o filtro de regra/status para ver outros fornecedores.",
        }
      : {
          title: "Nenhum fornecedor no filtro aplicado",
          description: "Ajuste a busca ou o filtro de status para ver outros fornecedores.",
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
      setCadastroMode("edit");
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
      setCadastroMode("edit");
      setCadastroSupplierId(result.supplierId);
      onSuppliersChanged?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível criar cadastro gerencial a partir da origem AP.", e));
    } finally {
      setCreatingCadastroFor(null);
    }
  };

  const filterChips = [
    ...(showFinancialContext && ruleFilter !== "all"
      ? [
          {
            key: "rule",
            label: ruleFilter === "with_rule" ? "Com regra ativa" : "Sem regra ativa",
            onRemove: () => patchUrl({ sup_rule: null, sup_page: 1 }),
          },
        ]
      : []),
    ...(statusFilter !== "all"
      ? [
          {
            key: "status",
            label: statusFilter === "active" ? "Ativos" : "Inativos",
            onRemove: () => patchUrl({ sup_status: null, sup_page: 1 }),
          },
        ]
      : []),
    ...(search.trim()
      ? [{ key: "q", label: `Busca: ${search.trim()}`, onRemove: () => patchUrl({ sup_q: null, sup_page: 1 }) }]
      : []),
  ];

  const rootTestId =
    context === "finance-menu"
      ? "finance-suppliers-page-view"
      : "finance-cost-centers-suppliers-tab";

  return (
    <div className="space-y-4" data-testid={rootTestId} data-suppliers-context={context}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {showFinancialContext ? (
            <>
              Fornecedores consolidados com volume de AP e status de classificação por centro de custo.{" "}
              <span className="text-xs">
                “Sem regra” é indicador operacional — distinto de títulos sem alocação real.
              </span>
            </>
          ) : (
            "Cadastro de fornecedores utilizado para padronização de nomes, documentos e vínculo operacional com centros de custo."
          )}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <FinanceCostCenterGridSearchBar
            value={search}
            onChange={(value) => patchUrl({ sup_q: value || null, sup_page: 1 })}
            placeholder={showFinancialContext ? "Nome, CNPJ ou centro" : "Nome ou CNPJ"}
            testId="finance-suppliers-search"
          />
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={statusFilter}
              data-testid="finance-suppliers-status-filter"
              onChange={(e) =>
                patchUrl({
                  sup_status: e.target.value === "all" ? null : e.target.value,
                  sup_page: 1,
                })
              }
            >
              <option value="all">Todos</option>
              <option value="active">Ativo</option>
              <option value="inactive">Inativo</option>
            </select>
          </label>
          {showFinancialContext ? (
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Regra</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={ruleFilter}
                data-testid="finance-suppliers-rule-filter"
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
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {canManageSuppliers ? (
            <button
              type="button"
              data-testid="finance-suppliers-new-supplier-button"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => {
                setCadastroMode("create");
                setCadastroSupplierId(null);
              }}
            >
              <Plus className="h-4 w-4" />
              Novo fornecedor
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-semibold"
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
        </div>
      </div>

      <FinanceCostCenterGridActiveFilters
        chips={filterChips}
        onClear={
          hasActiveFilters
            ? () =>
                patchUrl({
                  sup_q: null,
                  ...(showFinancialContext ? { sup_rule: null } : {}),
                  sup_status: null,
                  sup_page: 1,
                })
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
            tableClassName={showFinancialContext ? "min-w-[760px]" : "min-w-[520px]"}
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Fornecedor" sortKey="name" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Documento" sortKey="document" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Status</th>
                {showFinancialContext ? (
                  <>
                    <FinanceCostCenterSortableTh label="Títulos" sortKey="titlesCount" sort={sort} onSort={handleSort} />
                    <FinanceCostCenterSortableTh label="Valor" sortKey="amount" sort={sort} onSort={handleSort} align="right" />
                  </>
                ) : null}
                <FinanceCostCenterSortableTh label="Centro padrão" sortKey="costCenterName" sort={sort} onSort={handleSort} />
                {showFinancialContext ? (
                  <FinanceCostCenterSortableTh label="Regra" sortKey="ruleStatus" sort={sort} onSort={handleSort} />
                ) : null}
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
              <tr key={row.supplierKey} className="border-b border-border/60">
                <td className="px-3 py-2 font-semibold">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span>{row.name}</span>
                    {showEvaluationScore && row.supplierId ? (
                      <SupplierListEvaluationBadge summary={evaluationSummaries[row.supplierId]} />
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.document ?? "—"}</td>
                <td className="px-3 py-2">
                  {row.status === "INACTIVE" ? (
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      Inativo
                    </span>
                  ) : row.status ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                      Ativo
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Origem AP</span>
                  )}
                </td>
                {showFinancialContext ? (
                  <>
                    <td className="px-3 py-2 tabular-nums">{row.titlesCount}</td>
                    <td className="px-3 py-2 tabular-nums text-right">{formatFinanceCurrency(row.amount)}</td>
                  </>
                ) : null}
                <td className="px-3 py-2">{row.costCenterName}</td>
                {showFinancialContext ? (
                  <td className="px-3 py-2">{row.ruleStatus}</td>
                ) : null}
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {row.supplierId ? (
                      <>
                        <button
                          type="button"
                          data-testid="finance-suppliers-open-cadastro-button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                          onClick={() => {
                            setCadastroMode("edit");
                            setCadastroSupplierId(row.supplierId!);
                          }}
                        >
                          <FileText className="h-3 w-3" />
                          {row.status === "INACTIVE" ? "Ver cadastro" : "Editar"}
                        </button>
                        {canViewServiceTermination ? (
                          <button
                            type="button"
                            data-testid="finance-suppliers-service-termination-button"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                            onClick={() =>
                              setTerminationTarget({
                                id: row.supplierId!,
                                name: row.name,
                              })
                            }
                          >
                            <Calculator className="h-3 w-3" />
                            Encerramento de prestação
                          </button>
                        ) : null}
                      </>
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
                    {showOperationalActions ? (
                      <>
                        <button
                          type="button"
                          data-testid="finance-suppliers-view-paid-titles-button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                          onClick={() => setSupplierTitlesSupplier(row)}
                        >
                          <ListOrdered className="h-3 w-3" />
                          Ver títulos
                        </button>
                        <button
                          type="button"
                          data-testid="finance-suppliers-define-rule-button"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                          onClick={handleNavigateRules}
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
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}

      {showOperationalActions && aliasesSupplier ? (
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
        open={cadastroMode === "create" || Boolean(cadastroSupplierId)}
        mode={cadastroMode}
        supplierId={cadastroSupplierId}
        onClose={() => {
          setCadastroMode("edit");
          setCadastroSupplierId(null);
        }}
        onOpenExisting={(id) => {
          setCadastroMode("edit");
          setCadastroSupplierId(id);
        }}
        onChanged={() => {
          onSuppliersChanged?.();
          void load();
        }}
        canManage={canManageSuppliers}
        canDelete={canDeleteSupplier}
        showFinancialSummary={showFinancialContext}
        canViewServiceTermination={canViewServiceTermination}
        canCreateServiceTermination={canCreateServiceTermination}
        canFinalizeServiceTermination={canFinalizeServiceTermination}
        canExportServiceTermination={canExportServiceTermination}
      />

      {terminationTarget ? (
        <SupplierServiceTerminationDialog
          open
          supplierId={terminationTarget.id}
          supplierName={terminationTarget.name}
          onClose={() => setTerminationTarget(null)}
          canCreate={canCreateServiceTermination}
          canFinalize={canFinalizeServiceTermination}
          canExport={canExportServiceTermination}
        />
      ) : null}

      {showOperationalActions ? (
        <>
          <FinanceSupplierTitlesModal
            open={Boolean(supplierTitlesSupplier)}
            supplier={supplierTitlesSupplier}
            filters={appliedFilters}
            canReclassify={canReclassifyTitles}
            onClose={() => setSupplierTitlesSupplier(null)}
          />

          <FinanceSupplierPaymentDrilldownSection filters={appliedFilters} />
        </>
      ) : null}
    </div>
  );
}

function SupplierListEvaluationBadge({
  summary,
}: {
  summary: SupplierEvaluationListSummaryDto | undefined;
}) {
  if (!summary || summary.summary.overallScore == null) {
    return (
      <span
        className="text-xs font-medium text-muted-foreground"
        data-testid="supplier-list-evaluation-empty"
        title="Sem avaliações"
      >
        Sem avaliações
      </span>
    );
  }
  const title = [
    formatSupplierScoreWithScale(summary.summary.overallScore, summary.scaleMax),
    formatSupplierEvaluationCount(summary.summary.evaluatedOrders),
    summary.summary.coverage == null ? null : `Cobertura ${formatSupplierCoverage(summary.summary.coverage)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="inline-flex flex-wrap items-baseline gap-x-1.5 text-xs font-semibold tabular-nums text-primary"
      data-testid="supplier-list-evaluation-score"
      title={title}
    >
      <span>{formatSupplierScoreWithScale(summary.summary.overallScore, summary.scaleMax)}</span>
      <span className="font-medium text-muted-foreground">
        {formatSupplierEvaluationCount(summary.summary.evaluatedOrders)}
      </span>
    </span>
  );
}
