import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle2,
  Download,
  Eye,
  Play,
  RefreshCw,
  Settings2,
  Upload,
  X,
} from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import { FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT } from "@/src/lib/financeApAllocationShared";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type {
  BatchAllocationApplyResult,
  BatchAllocationPreviewPayload,
} from "@/src/lib/financeAccountsPayableCostCenterAllocation";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import type {
  FinanceSupplierSearchResult,
  SupplierCostCenterRulePreviewPayload,
} from "@/src/lib/financeSupplierCostCenterRules";
import { FinanceSupplierAutocomplete } from "@/src/components/finance/cost-centers/FinanceSupplierAutocomplete";
import {
  ensureFinanceSupplierSearchResult,
  type EnsureSupplierFromApIdentityResponse,
} from "@/src/lib/financeSupplierSearchClient";
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  CLASSIFY_APPLY_LOADING_MESSAGE,
  CLASSIFY_APPLY_LOADING_TITLE,
  formatImportApplySuccessMessage,
  IMPORT_APPLY_LOADING_MESSAGE,
  IMPORT_APPLY_LOADING_TITLE,
  importApplyButtonDisabled,
  UNCLASSIFIED_CAUSE_CHIP_CLASS,
  UNCLASSIFIED_CAUSE_HINT,
  UNCLASSIFIED_CAUSE_LABEL,
  UNCLASSIFIED_CAUSE_SUGGESTION,
  UNCLASSIFIED_CLASSIFY_FLOW_HINT,
  type UnclassifiedCauseUi,
} from "@/src/lib/financeUnclassifiedPayablesUi";
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
  DEFAULT_UNCLASSIFIED_GROUPED_SORT,
  paginateFinanceGridRows,
  prepareUnclassifiedGroupedRows,
  readFinanceGridUrlInt,
  readFinanceGridUrlSort,
  readFinanceGridUrlString,
  toggleSortState,
  UNCLASSIFIED_GROUPED_SORT_ACCESSORS,
  unclassifiedGroupedSupplierCount,
  unclassifiedGroupedTotals,
  writeFinanceGridUrlParams,
  type UnclassifiedGroupedSortKey,
} from "@/src/lib/financeCostCenterGridKit";
import { getSortDefaultDirection } from "@/src/lib/soldProductsTableSort";
import { groupUnclassifiedPayablesBySupplier } from "@/src/lib/financeUnclassifiedPayablesGrouping";
import { FinanceUnclassifiedGroupTitlesModal } from "@/src/components/finance/cost-centers/FinanceUnclassifiedGroupTitlesModal";
import {
  CostCenterDialog,
  ModalErrorBlock,
  ModalLoadingOverlay,
  ModalSuccessBlock,
  PreviewStatGrid,
  SensitiveConfirmAlert,
} from "@/src/components/finance/cost-centers/financeUnclassifiedModalUi";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";
import {
  buildFinanceCostCentersUnclassifiedQuery,
  type FinanceCostCentersUiFilters,
} from "@/src/lib/financeCostCentersPageTypes";

type UnclassifiedCause = UnclassifiedCauseUi;

type UnclassifiedItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
  personDocument?: string | null;
  identityKey?: string | null;
  cause?: UnclassifiedCause;
  supplierId?: string | null;
  supplierName?: string | null;
};

type GroupedRow = {
  name: string;
  titlesCount: number;
  amount: number;
  openAmount: number;
  cause: UnclassifiedCause | null;
  supplierId: string | null;
  supplierName: string | null;
  identityKey: string;
  groupKey: string;
  personDocument: string | null;
  sampleExternalId: number;
};

type ImportPreviewLine = {
  rowNumber: number;
  status: "VALID" | "INVALID" | "SKIPPED" | "NEEDS_CONFIRMATION";
  personNameNomus: string | null;
  costCenterCode: string | null;
  percentual: number | null;
  sensitive: boolean;
  sensitiveReason: string | null;
  errors: string[];
};

type ImportPreview = {
  totalRead: number;
  validLines: number;
  invalidLines: number;
  skippedLines: number;
  suppliersToCreate: number;
  suppliersToLink: number;
  rulesToCreate: number;
  titlesToAllocate: number;
  titlesIgnoredManualLocked: number;
  sensitiveRequiringConfirmation: number;
  requiredConfirmationText: string;
  lines: ImportPreviewLine[];
};

type ImportApplyResult = {
  suppliersCreated: number;
  suppliersLinked: number;
  rulesCreated: number;
  titlesAllocated: number;
  titlesIgnoredManualLocked: number;
  skippedSensitiveUnconfirmed: number;
  lineErrors: Array<{ rowNumber: number; errors: string[] }>;
};

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  appliedFilters: FinanceCostCentersUiFilters;
  canApplyBatch: boolean;
  canManageRules: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onApplied?: () => void;
};

export function FinanceUnclassifiedPayablesTab({
  dashboard,
  appliedFilters,
  canApplyBatch,
  canManageRules,
  onNavigateTab,
  onApplied,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<UnclassifiedItem[]>([]);
  const [causeSummary, setCauseSummary] = useState<Partial<Record<UnclassifiedCause, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchAllocationPreviewPayload | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  const [classifyGroup, setClassifyGroup] = useState<GroupedRow | null>(null);
  const [viewTitlesGroup, setViewTitlesGroup] = useState<GroupedRow | null>(null);
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [centersLoaded, setCentersLoaded] = useState(false);
  const [modalCostCenterId, setModalCostCenterId] = useState("");
  const [modalSupplier, setModalSupplier] = useState<FinanceSupplierSearchResult | null>(null);
  const [modalPreview, setModalPreview] = useState<SupplierCostCenterRulePreviewPayload | null>(null);
  const [modalConfirmChecked, setModalConfirmChecked] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [ensuredSupplierId, setEnsuredSupplierId] = useState<string | null>(null);
  const [ensuringApOrigin, setEnsuringApOrigin] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoadingPreview, setImportLoadingPreview] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [importApplyResult, setImportApplyResult] = useState<ImportApplyResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importErrorDetails, setImportErrorDetails] = useState<string | null>(null);
  const [importConfirmSensitive, setImportConfirmSensitive] = useState(false);

  const search = readFinanceGridUrlString(searchParams, "unc_q");
  const causeFilter = (readFinanceGridUrlString(searchParams, "unc_cause", "all") ||
    "all") as UnclassifiedCause | "all";
  const sort = readFinanceGridUrlSort(
    searchParams,
    "unc_sort",
    "unc_dir",
    ["name", "titlesCount", "amount", "cause"] as const,
    DEFAULT_UNCLASSIFIED_GROUPED_SORT
  );
  const page = readFinanceGridUrlInt(searchParams, "unc_page", 1);
  const pageSize = readFinanceGridUrlInt(searchParams, "unc_limit", 50, 1, 500);

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
      const query = buildFinanceCostCentersUnclassifiedQuery(appliedFilters);
      const payload = await fetchJsonOk<{
        items: UnclassifiedItem[];
        causeSummary?: Partial<Record<UnclassifiedCause, number>>;
      }>(`/api/finance/accounts-payable/unclassified?${query}`, { credentials: "include" });
      setItems(payload.items);
      setCauseSummary(payload.causeSummary ?? {});
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar títulos sem classificação.", e));
      setItems([]);
      setCauseSummary({});
    } finally {
      setLoading(false);
    }
  }, [appliedFilters]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupedAll = useMemo(() => groupUnclassifiedPayablesBySupplier(items), [items]);

  const gridRows = useMemo(
    () =>
      prepareUnclassifiedGroupedRows(
        groupedAll,
        { search, cause: causeFilter },
        sort
      ),
    [groupedAll, search, causeFilter, sort]
  );

  const gridTotals = useMemo(() => unclassifiedGroupedTotals(gridRows), [gridRows]);

  const { pageRows, totalPages, total } = useMemo(() => {
    const paged = paginateFinanceGridRows(gridRows, { page, pageSize });
    return { ...paged, page: clampFinanceGridPage(page, paged.totalPages) };
  }, [gridRows, page, pageSize]);

  const hasActiveFilters = Boolean(search.trim()) || causeFilter !== "all";
  const emptyCopy = buildFinanceGridEmptyState(
    groupedAll.length > 0,
    hasActiveFilters,
    {
      title: "Nenhum título sem classificação",
      description:
        "Todos os títulos em aberto já possuem alocação completa — ou cadastre regras para novos fornecedores.",
    },
    {
      title: "Nenhum fornecedor no filtro",
      description: "Ajuste a busca ou a causa para ver outros títulos com gap de alocação real.",
    }
  );

  const handleSort = (key: UnclassifiedGroupedSortKey) => {
    const next = toggleSortState(
      sort,
      key,
      getSortDefaultDirection(UNCLASSIFIED_GROUPED_SORT_ACCESSORS, key)
    );
    patchUrl({ unc_sort: next.key, unc_dir: next.direction, unc_page: 1 });
  };

  const causeChips = useMemo(
    () =>
      (Object.keys(UNCLASSIFIED_CAUSE_LABEL) as UnclassifiedCause[])
        .map((cause) => ({ cause, count: causeSummary[cause] ?? 0 }))
        .filter((entry) => entry.count > 0),
    [causeSummary]
  );

  const runPreview = async () => {
    try {
      const payload = await fetchJsonOk<BatchAllocationPreviewPayload>(
        "/api/finance/accounts-payable/classify-batch-preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unclassifiedOnly: true }),
        }
      );
      setPreview(payload);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível gerar o preview em lote.", e));
    }
  };

  const applyBatch = async () => {
    if (!canApplyBatch) return;
    setApplying(true);
    try {
      await fetchJsonOk("/api/finance/accounts-payable/classify-batch-apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unclassifiedOnly: true,
          confirmationText: confirmation,
        }),
      });
      setPreview(null);
      setConfirmation("");
      await load();
      onApplied?.();
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível aplicar a classificação em lote.", e));
    } finally {
      setApplying(false);
    }
  };

  const ensureCenters = useCallback(async () => {
    if (centersLoaded) return;
    try {
      const payload = await fetchJsonOk<{ items: FinanceCostCenterDto[] }>(
        "/api/finance/cost-centers",
        { credentials: "include" }
      );
      setCenters(payload.items.filter((row) => row.status === "ACTIVE"));
      setCentersLoaded(true);
    } catch (e) {
      setModalError(buildFinanceTabLoadError("Não foi possível carregar os centros de custo.", e));
    }
  }, [centersLoaded]);

  const effectiveSupplierId =
    classifyGroup?.supplierId ?? ensuredSupplierId ?? modalSupplier?.id ?? null;
  const needsSupplierLink = Boolean(classifyGroup) && !classifyGroup?.supplierId && !ensuredSupplierId;

  const resolveModalSupplierId = useCallback(async (): Promise<string | null> => {
    if (classifyGroup?.supplierId) return classifyGroup.supplierId;
    if (ensuredSupplierId) return ensuredSupplierId;
    if (modalSupplier) return ensureFinanceSupplierSearchResult(modalSupplier);
    return null;
  }, [classifyGroup, ensuredSupplierId, modalSupplier]);

  const useApOriginAsSupplier = useCallback(async () => {
    if (!classifyGroup || modalSaving) return;
    setEnsuringApOrigin(true);
    setModalError(null);
    try {
      const result = await fetchJsonOk<EnsureSupplierFromApIdentityResponse>(
        "/api/finance/suppliers/ensure-from-ap-identity",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identityKey: classifyGroup.identityKey,
            personName: classifyGroup.name,
            personDocument: classifyGroup.personDocument,
            accountsPayableId: classifyGroup.sampleExternalId,
          }),
        }
      );
      setEnsuredSupplierId(result.supplierId);
      setModalSupplier({
        id: result.supplierId,
        identityKey: result.identityKey,
        name: result.displayName,
        document: result.document,
        externalCode: null,
        titlesCount: classifyGroup.titlesCount,
        lastTitleDate: null,
        totalValue: classifyGroup.amount,
        matched: true,
        source: "MASTER",
        status: "ACTIVE",
        hasActiveRule: false,
      });
      setModalPreview(null);
    } catch (e) {
      setModalError(
        buildFinanceTabLoadError("Não foi possível vincular a origem AP ao cadastro gerencial.", e)
      );
    } finally {
      setEnsuringApOrigin(false);
    }
  }, [classifyGroup, modalSaving]);

  const openClassifyModal = (row: GroupedRow) => {
    if (!canManageRules) {
      onNavigateTab("rules");
      return;
    }
    setClassifyGroup(row);
    setModalCostCenterId("");
    setModalSupplier(null);
    setModalPreview(null);
    setModalConfirmChecked(false);
    setModalError(null);
    setEnsuredSupplierId(null);
    void ensureCenters();
  };

  const closeClassifyModal = (force = false) => {
    if (modalSaving && !force) return;
    setClassifyGroup(null);
    setModalSaving(false);
    setModalError(null);
  };

  const runModalPreview = async () => {
    if (!modalCostCenterId) return;
    setModalError(null);
    try {
      const supplierId = await resolveModalSupplierId();
      if (!supplierId) return;
      const payload = await fetchJsonOk<SupplierCostCenterRulePreviewPayload>(
        "/api/finance/supplier-cost-center-rules/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId,
            rules: [{ costCenterId: modalCostCenterId, percentage: 100 }],
          }),
        }
      );
      setModalPreview(payload);
    } catch (e) {
      setModalError(buildFinanceTabLoadError("Não foi possível gerar o preview da classificação.", e));
    }
  };

  const confirmClassify = async () => {
    if (!canManageRules || !modalCostCenterId || !modalConfirmChecked || modalSaving) {
      return;
    }
    setModalSaving(true);
    setModalError(null);
    try {
      const supplierId = await resolveModalSupplierId();
      if (!supplierId) {
        setModalError("Selecione ou vincule um fornecedor antes de classificar.");
        return;
      }
      await fetchJsonOk("/api/finance/supplier-cost-center-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          replaceExisting: true,
          autoApply: true,
          rules: [{ costCenterId: modalCostCenterId, percentage: 100 }],
        }),
      });

      let appliedMessage = "Regra de classificação criada.";
      if (canApplyBatch) {
        const applyResult = await fetchJsonOk<BatchAllocationApplyResult>(
          "/api/finance/accounts-payable/classify-batch-apply",
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filters: { unclassifiedOnly: true, supplierId },
              confirmationText: FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT,
            }),
          }
        );
        const applied = applyResult.created + applyResult.replaced;
        const lockedSkipped = applyResult.summary?.skippedManualLocked ?? 0;
        appliedMessage =
          applied > 0
            ? `Regra criada e ${applied} título(s) classificados.`
            : "Regra criada. Nenhum título elegível foi classificado agora.";
        if (lockedSkipped > 0) {
          appliedMessage += ` ${lockedSkipped} título(s) com classificação manual foram preservados.`;
        }
      } else {
        appliedMessage =
          "Regra criada. A classificação dos títulos será aplicada por quem tiver permissão de aplicação em lote.";
      }

      setNotice(appliedMessage);
      closeClassifyModal(true);
      await load();
      onApplied?.();
    } catch (e) {
      setModalError(buildFinanceTabLoadError("Não foi possível concluir a classificação.", e));
    } finally {
      setModalSaving(false);
    }
  };

  const modalCanConfirm =
    Boolean(classifyGroup?.supplierId || ensuredSupplierId || modalSupplier) &&
    Boolean(modalCostCenterId) &&
    modalConfirmChecked &&
    !modalSaving;

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/finance/cost-centers/unclassified/export", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Erro HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "titulos-sem-classificacao.xlsx";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível exportar a planilha.", e));
    } finally {
      setExporting(false);
    }
  };

  const openImportModal = () => {
    setImportOpen(true);
    setImportFile(null);
    setImportPreview(null);
    setImportApplyResult(null);
    setImportError(null);
    setImportErrorDetails(null);
    setImportConfirmSensitive(false);
  };

  const closeImportModal = () => {
    if (importApplying) return;
    setImportOpen(false);
    setImportLoadingPreview(false);
    setImportApplyResult(null);
    setImportError(null);
    setImportErrorDetails(null);
  };

  const finishImportSuccess = async (result: ImportApplyResult) => {
    setImportApplyResult(result);
    setNotice(formatImportApplySuccessMessage(result));
    await load();
    onApplied?.();
  };

  const runImportPreview = async (file: File) => {
    setImportLoadingPreview(true);
    setImportError(null);
    setImportErrorDetails(null);
    setImportApplyResult(null);
    setImportPreview(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const payload = await fetchJsonOk<ImportPreview>(
        "/api/finance/cost-centers/unclassified/import/preview",
        { method: "POST", credentials: "include", body: formData }
      );
      setImportPreview(payload);
    } catch (e) {
      const message = buildFinanceTabLoadError("Não foi possível validar a planilha.", e);
      setImportError(message);
      setImportErrorDetails(e instanceof Error ? e.message : String(e));
    } finally {
      setImportLoadingPreview(false);
    }
  };

  const applyImport = async () => {
    if (!importFile || !importPreview || importApplying) return;
    setImportApplying(true);
    setImportError(null);
    setImportErrorDetails(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("confirmationText", importPreview.requiredConfirmationText);
      formData.append("confirmSensitive", importConfirmSensitive ? "true" : "false");
      const result = await fetchJsonOk<ImportApplyResult>(
        "/api/finance/cost-centers/unclassified/import/apply",
        { method: "POST", credentials: "include", body: formData }
      );
      await finishImportSuccess(result);
    } catch (e) {
      const message = buildFinanceTabLoadError("Não foi possível aplicar a importação.", e);
      setImportError(message);
      setImportErrorDetails(e instanceof Error ? e.message : String(e));
    } finally {
      setImportApplying(false);
    }
  };

  const importCanApply =
    Boolean(importPreview) &&
    importPreview.validLines + importPreview.sensitiveRequiringConfirmation > 0;

  const importApplyDisabled = importApplyButtonDisabled({
    applying: importApplying,
    loadingPreview: importLoadingPreview,
    sensitiveCount: importPreview?.sensitiveRequiringConfirmation ?? 0,
    confirmSensitive: importConfirmSensitive,
    canApply: importCanApply,
  });

  const importPreviewStats = importPreview
    ? [
        { label: "Linhas lidas", value: importPreview.totalRead },
        { label: "Válidas", value: importPreview.validLines, tone: "ok" as const },
        { label: "Inválidas", value: importPreview.invalidLines, tone: "error" as const },
        { label: "Ignoradas", value: importPreview.skippedLines },
        { label: "Fornecedores a criar", value: importPreview.suppliersToCreate },
        { label: "Fornecedores a vincular", value: importPreview.suppliersToLink },
        { label: "Regras a criar", value: importPreview.rulesToCreate },
        { label: "Títulos a classificar", value: importPreview.titlesToAllocate },
        {
          label: "Sensíveis (confirmar)",
          value: importPreview.sensitiveRequiringConfirmation,
          tone: importPreview.sensitiveRequiringConfirmation > 0 ? ("warn" as const) : undefined,
        },
      ]
    : [];

  const importApplyLoadingStats = importPreview
    ? [
        { label: "Fornecedores a criar", value: importPreview.suppliersToCreate },
        { label: "Fornecedores a vincular", value: importPreview.suppliersToLink },
        { label: "Regras a criar", value: importPreview.rulesToCreate },
        { label: "Títulos a classificar", value: importPreview.titlesToAllocate },
        {
          label: "Sensíveis confirmados",
          value: importConfirmSensitive ? importPreview.sensitiveRequiringConfirmation : 0,
        },
      ]
    : [];

  const unclassified = dashboard?.unclassified;

  return (
    <div className="space-y-5" data-testid="finance-cost-centers-unclassified-tab">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground leading-relaxed">
          Títulos AP sem classificação completa. Agrupe por fornecedor, classifique manualmente ou
          use exportação/importação de planilha com preview.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted/40"
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" />
            Atualizar
          </button>
          <button
            type="button"
            data-testid="finance-unclassified-export-button"
            className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exportando…" : "Exportar planilha"}
          </button>
          {canManageRules ? (
            <button
              type="button"
              data-testid="finance-unclassified-import-button"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted/40"
              onClick={openImportModal}
            >
              <Upload className="h-4 w-4" />
              Importar planilha
            </button>
          ) : null}
          {canApplyBatch ? (
            <button
              type="button"
              data-testid="finance-unclassified-preview-button"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-muted/40"
              onClick={() => void runPreview()}
            >
              <Play className="h-4 w-4" />
              Preview em lote
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}
      {notice ? (
        <div
          data-testid="finance-unclassified-notice"
          className="flex items-start justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <span className="inline-flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            {notice}
          </span>
          <button type="button" className="text-emerald-700" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando títulos sem classificação…" /> : null}

      {!loading && causeChips.length > 0 ? (
        <div className="space-y-2" data-testid="finance-unclassified-cause-summary">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Resumo por causa (gap de alocação real — clique para filtrar)
          </p>
          <div className="flex flex-wrap gap-2">
            {causeChips.map(({ cause, count }) => (
              <button
                key={cause}
                type="button"
                title={UNCLASSIFIED_CAUSE_HINT[cause]}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold shadow-sm transition",
                  UNCLASSIFIED_CAUSE_CHIP_CLASS[cause],
                  causeFilter === cause && "ring-2 ring-primary ring-offset-1"
                )}
                onClick={() =>
                  patchUrl({
                    unc_cause: causeFilter === cause ? null : cause,
                    unc_page: 1,
                  })
                }
              >
                {UNCLASSIFIED_CAUSE_LABEL[cause]}
                <span className="rounded-full bg-white/70 px-2 py-0.5 tabular-nums">{count}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <FinanceCostCenterGridActiveFilters
        chips={[
          ...(causeFilter !== "all"
            ? [
                {
                  key: "cause",
                  label: `Causa: ${UNCLASSIFIED_CAUSE_LABEL[causeFilter]}`,
                  onRemove: () => patchUrl({ unc_cause: null, unc_page: 1 }),
                },
              ]
            : []),
          ...(search.trim()
            ? [{ key: "q", label: `Busca: ${search.trim()}`, onRemove: () => patchUrl({ unc_q: null, unc_page: 1 }) }]
            : []),
        ]}
        onClear={
          hasActiveFilters
            ? () => patchUrl({ unc_q: null, unc_cause: null, unc_page: 1 })
            : undefined
        }
      />

      {!loading && gridRows.length === 0 ? (
        <FinanceModuleEmptyState title={emptyCopy.title} description={emptyCopy.description} />
      ) : null}

      {!loading && gridRows.length > 0 ? (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <FinanceCostCenterGridSearchBar
              value={search}
              onChange={(value) => patchUrl({ unc_q: value || null, unc_page: 1 })}
              placeholder="Fornecedor"
              testId="finance-unclassified-search"
            />
          </div>
          <FinanceCostCenterGridSummary
            totals={{
              rowCount: gridTotals.rowCount ?? 0,
              amountSum: gridTotals.amountSum,
            }}
            filteredCount={unclassifiedGroupedSupplierCount(gridRows)}
            page={clampFinanceGridPage(page, totalPages)}
            totalPages={totalPages}
            amountLabel="Gap total (filtrado)"
          />
          <FinanceCostCenterGridTableShell
            tableClassName="min-w-[760px]"
            head={
              <tr className="border-b border-border text-left">
                <FinanceCostCenterSortableTh label="Fornecedor" sortKey="name" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Títulos" sortKey="titlesCount" sort={sort} onSort={handleSort} />
                <FinanceCostCenterSortableTh label="Valor" sortKey="amount" sort={sort} onSort={handleSort} align="right" />
                <FinanceCostCenterSortableTh label="Causa" sortKey="cause" sort={sort} onSort={handleSort} />
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Sugestão</th>
                <th className="px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground text-right">Ação</th>
              </tr>
            }
            footer={
              <FinanceCostCenterGridPagination
                page={clampFinanceGridPage(page, totalPages)}
                totalPages={totalPages}
                pageSize={pageSize}
                onPageChange={(nextPage) => patchUrl({ unc_page: nextPage })}
                onPageSizeChange={(nextSize) => patchUrl({ unc_limit: nextSize, unc_page: 1 })}
              />
            }
          >
            {pageRows.map((row) => (
              <tr key={row.groupKey} className="border-b border-border/60 hover:bg-muted/20">
                <td className="px-4 py-3 font-semibold">{row.name}</td>
                <td className="px-4 py-3 tabular-nums">
                  <button
                    type="button"
                    className="font-semibold text-primary hover:underline tabular-nums"
                    title="Ver títulos deste grupo"
                    data-testid="finance-unclassified-view-titles-count"
                    onClick={() => setViewTitlesGroup(row)}
                  >
                    {row.titlesCount}
                  </button>
                </td>
                <td className="px-4 py-3 tabular-nums text-right">{formatFinanceCurrency(row.amount)}</td>
                <td className="px-4 py-3">
                  {row.cause ? (
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        UNCLASSIFIED_CAUSE_CHIP_CLASS[row.cause]
                      )}
                    >
                      {UNCLASSIFIED_CAUSE_LABEL[row.cause]}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[11px] text-muted-foreground max-w-[180px]">
                  {row.cause
                    ? UNCLASSIFIED_CAUSE_SUGGESTION[row.cause]
                    : unclassified && unclassified.titlesCount > 0
                      ? "Definir regra"
                      : "Revisar fornecedor"}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      data-testid="finance-unclassified-view-titles-button"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-muted/40"
                      title="Ver títulos deste grupo"
                      onClick={() => setViewTitlesGroup(row)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Ver títulos
                    </button>
                    <button
                      type="button"
                      data-testid="finance-unclassified-classify-supplier-button"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10"
                      onClick={() => openClassifyModal(row)}
                    >
                      <Settings2 className="h-3.5 w-3.5" />
                      Classificar fornecedor
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </FinanceCostCenterGridTableShell>
        </>
      ) : null}

      {preview && canApplyBatch ? (
        <div className={cn(financeBiCardClass, "space-y-3 p-4")}>
          <h3 className="font-semibold">Preview em lote</h3>
          <p className="text-sm text-muted-foreground">
            Criar: {preview.summary.wouldCreate} · Substituir: {preview.summary.wouldReplace} ·
            Ignorados: {preview.summary.skipped}
          </p>
          <label className="block space-y-1 text-sm">
            <span className="font-semibold">
              Confirmação — digite: {FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT}
            </span>
            <input
              className="w-full rounded-lg border px-3 py-2 font-mono text-xs"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </label>
          <button
            type="button"
            data-testid="finance-unclassified-batch-apply-button"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            disabled={
              applying || confirmation.trim() !== FINANCE_AP_ALLOCATION_BATCH_CONFIRMATION_TEXT
            }
            onClick={() => void applyBatch()}
          >
            {applying ? "Aplicando…" : "Aplicar classificação em lote"}
          </button>
        </div>
      ) : null}

      {classifyGroup ? (
        <CostCenterDialog
          testId="finance-unclassified-classify-modal"
          title="Classificar fornecedor"
          subtitle="Defina o centro de custo e aplique a classificação aos títulos elegíveis deste fornecedor."
          onClose={closeClassifyModal}
          closeDisabled={modalSaving}
          maxWidthClass="max-w-xl"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40"
                onClick={closeClassifyModal}
                disabled={modalSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="finance-unclassified-classify-confirm"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={!modalCanConfirm}
                onClick={() => void confirmClassify()}
              >
                {modalSaving ? "Classificando…" : "Criar regra e classificar"}
              </button>
            </div>
          }
        >
          <div className="relative space-y-5">
            {modalSaving ? (
              <ModalLoadingOverlay
                testId="finance-unclassified-classify-loading"
                title={CLASSIFY_APPLY_LOADING_TITLE}
                message={CLASSIFY_APPLY_LOADING_MESSAGE}
              />
            ) : null}

            <section className="rounded-xl border border-border bg-muted/20 p-4 space-y-2">
              <p className="text-base font-semibold">{classifyGroup.name}</p>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {classifyGroup.cause ? (
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-semibold",
                      UNCLASSIFIED_CAUSE_CHIP_CLASS[classifyGroup.cause]
                    )}
                  >
                    {UNCLASSIFIED_CAUSE_LABEL[classifyGroup.cause]}
                  </span>
                ) : null}
                <span>{formatFinanceInteger(classifyGroup.titlesCount)} título(s)</span>
                <span>{formatFinanceCurrency(classifyGroup.amount)}</span>
              </div>
              {classifyGroup.cause ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {UNCLASSIFIED_CLASSIFY_FLOW_HINT[classifyGroup.cause]}
                </p>
              ) : null}
            </section>

            {needsSupplierLink ? (
              <section className="space-y-3">
                <h4 className="text-sm font-semibold">Fornecedor gerencial</h4>
                <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-900">
                  Esta origem AP ainda não possui cadastro gerencial casado. Você pode usar a
                  própria origem do título ou buscar/vincular outro fornecedor.
                </div>
                <button
                  type="button"
                  data-testid="finance-unclassified-use-ap-origin"
                  className="w-full rounded-lg border border-primary bg-primary/5 px-3 py-2 text-sm font-semibold text-primary disabled:opacity-50"
                  disabled={modalSaving || ensuringApOrigin}
                  onClick={() => void useApOriginAsSupplier()}
                >
                  {ensuringApOrigin
                    ? "Criando cadastro gerencial…"
                    : "Usar esta origem AP / criar fornecedor gerencial"}
                </button>
                <FinanceSupplierAutocomplete
                  selected={modalSupplier}
                  onSelect={(supplier) => {
                    setModalSupplier(supplier);
                    setEnsuredSupplierId(null);
                    setModalPreview(null);
                  }}
                  disabled={modalSaving}
                  initialQuery={classifyGroup.name}
                  testIdPrefix="finance-unclassified-supplier"
                />
              </section>
            ) : (
              <section className="rounded-xl border border-border bg-muted/15 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Fornecedor financeiro: </span>
                <span className="font-semibold">{classifyGroup.supplierName ?? "vinculado"}</span>
              </section>
            )}

            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Centro de custo</h4>
              <select
                data-testid="finance-unclassified-cost-center-select"
                className="w-full rounded-xl border px-3 py-2.5 text-sm"
                value={modalCostCenterId}
                disabled={modalSaving}
                onChange={(e) => {
                  setModalCostCenterId(e.target.value);
                  setModalPreview(null);
                }}
              >
                <option value="">Selecione o centro de custo</option>
                {centers.map((cc) => (
                  <option key={cc.id} value={cc.id}>
                    {cc.code} — {cc.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">Percentual padrão 100%.</p>
            </section>

            <button
              type="button"
              data-testid="finance-unclassified-modal-preview-button"
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={!(classifyGroup?.supplierId || ensuredSupplierId || modalSupplier) || !modalCostCenterId || modalSaving}
              onClick={() => void runModalPreview()}
            >
              <Eye className="h-4 w-4" />
              Pré-visualizar impacto
            </button>

            {modalPreview ? (
              <section className="rounded-xl border border-border bg-muted/20 p-3 text-sm">
                <p>
                  Títulos em aberto: {formatFinanceInteger(modalPreview.openTitlesCount)} · Bloqueados
                  manual: {formatFinanceInteger(modalPreview.manualLockedTitlesCount)}
                </p>
                {modalPreview.manualLockedTitlesCount > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Classificações manuais bloqueadas não serão sobrescritas.
                  </p>
                ) : null}
              </section>
            ) : null}

            {modalError ? (
              <ModalErrorBlock title="Não foi possível classificar" message={modalError} />
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="finance-unclassified-confirm-checkbox"
                className="mt-1"
                checked={modalConfirmChecked}
                disabled={modalSaving}
                onChange={(e) => setModalConfirmChecked(e.target.checked)}
              />
              <span>
                Confirmo criar a regra (100%) e aplicar aos títulos elegíveis, preservando
                classificações manuais bloqueadas.
              </span>
            </label>
          </div>
        </CostCenterDialog>
      ) : null}

      {importOpen ? (
        <CostCenterDialog
          testId="finance-unclassified-import-modal"
          title="Importar planilha de classificação"
          subtitle="Valide o arquivo, revise o preview e aplique somente após confirmar linhas sensíveis, se houver."
          onClose={closeImportModal}
          closeDisabled={importApplying}
          maxWidthClass="max-w-4xl"
          footer={
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                className="rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-40"
                onClick={closeImportModal}
                disabled={importApplying}
              >
                {importApplyResult ? "Fechar" : "Cancelar"}
              </button>
              {importApplyResult ? null : importCanApply ? (
                <button
                  type="button"
                  data-testid="finance-unclassified-import-apply-button"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={importApplyDisabled}
                  onClick={() => void applyImport()}
                >
                  {importApplying ? "Aplicando…" : "Aplicar importação"}
                </button>
              ) : null}
            </div>
          }
        >
          <div className="relative space-y-6">
            {importApplying ? (
              <ModalLoadingOverlay
                testId="finance-unclassified-import-loading"
                title={IMPORT_APPLY_LOADING_TITLE}
                message={IMPORT_APPLY_LOADING_MESSAGE}
                stats={importApplyLoadingStats}
              />
            ) : null}

            {importApplyResult ? (
              <ModalSuccessBlock
                title="Importação aplicada com sucesso."
                message={formatImportApplySuccessMessage(importApplyResult)}
                stats={[
                  { label: "Fornecedores criados", value: importApplyResult.suppliersCreated },
                  { label: "Fornecedores vinculados", value: importApplyResult.suppliersLinked },
                  { label: "Regras criadas", value: importApplyResult.rulesCreated },
                  { label: "Títulos classificados", value: importApplyResult.titlesAllocated },
                  {
                    label: "Manuais preservados",
                    value: importApplyResult.titlesIgnoredManualLocked,
                  },
                ]}
              />
            ) : (
              <>
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold">Arquivo selecionado</h4>
                  <input
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    data-testid="finance-unclassified-import-file"
                    className="block w-full rounded-xl border border-dashed px-3 py-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold"
                    disabled={importApplying}
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      setImportFile(file);
                      setImportPreview(null);
                      setImportError(null);
                      setImportErrorDetails(null);
                      if (file) void runImportPreview(file);
                    }}
                  />
                  {importFile ? (
                    <p className="text-xs text-muted-foreground">
                      {importFile.name} · {(importFile.size / 1024).toFixed(1)} KB
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Exporte a planilha, preencha as colunas e marque aplicar = SIM.
                    </p>
                  )}
                </section>

                {importLoadingPreview ? (
                  <FinanceModuleLoadingBlock label="Validando planilha…" />
                ) : null}

                {importError ? (
                  <ModalErrorBlock
                    title="Não foi possível concluir a importação"
                    message={importError}
                    details={importErrorDetails}
                    hint="Corrija a planilha e gere novo preview antes de aplicar."
                  />
                ) : null}

                {importPreview ? (
                  <section className="space-y-4" data-testid="finance-unclassified-import-preview">
                    <div>
                      <h4 className="text-sm font-semibold">Resumo do preview</h4>
                      <p className="text-xs text-muted-foreground mt-1">
                        Nenhuma alteração é feita até você clicar em Aplicar importação.
                      </p>
                    </div>
                    <PreviewStatGrid stats={importPreviewStats} />

                    {importPreview.lines.some((line) => line.errors.length > 0) ? (
                      <div className="max-h-44 overflow-auto rounded-xl border border-border bg-muted/20 p-3 text-xs">
                        <p className="mb-2 font-semibold">Erros por linha</p>
                        {importPreview.lines
                          .filter((line) => line.errors.length > 0)
                          .map((line) => (
                            <p key={line.rowNumber} className="text-rose-700 py-0.5">
                              Linha {line.rowNumber}
                              {line.personNameNomus ? ` (${line.personNameNomus})` : ""}:{" "}
                              {line.errors.join(" ")}
                            </p>
                          ))}
                      </div>
                    ) : null}

                    {importPreview.sensitiveRequiringConfirmation > 0 ? (
                      <SensitiveConfirmAlert
                        count={importPreview.sensitiveRequiringConfirmation}
                        checked={importConfirmSensitive}
                        onChange={setImportConfirmSensitive}
                      />
                    ) : null}
                  </section>
                ) : null}
              </>
            )}
          </div>
        </CostCenterDialog>
      ) : null}

      <FinanceUnclassifiedGroupTitlesModal
        open={Boolean(viewTitlesGroup)}
        group={viewTitlesGroup}
        appliedFilters={appliedFilters}
        causeFilter={causeFilter}
        onClose={() => setViewTitlesGroup(null)}
      />
    </div>
  );
}
