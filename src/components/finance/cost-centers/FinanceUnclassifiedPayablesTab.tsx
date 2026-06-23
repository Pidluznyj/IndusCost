import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  Play,
  RefreshCw,
  Search,
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
import {
  formatFinanceCurrency,
  formatFinanceInteger,
} from "@/src/lib/financeAccountsReceivableFormat";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import { cn } from "@/src/lib/utils";
import type { FinanceCostCentersTabId } from "@/src/lib/financeCostCentersPageTypes";

type UnclassifiedCause =
  | "MANUAL_LOCKED"
  | "PARTIAL_ALLOCATION"
  | "NO_SUPPLIER"
  | "SUPPLIER_NO_RULE"
  | "RULE_NOT_APPLIED";

type UnclassifiedItem = {
  externalId: number;
  titleAmount: number;
  companyName: string | null;
  personName: string | null;
  cause?: UnclassifiedCause;
  supplierId?: string | null;
  supplierName?: string | null;
};

const CAUSE_LABEL: Record<UnclassifiedCause, string> = {
  MANUAL_LOCKED: "Manual bloqueado",
  PARTIAL_ALLOCATION: "Rateio incompleto",
  NO_SUPPLIER: "Fornecedor não casado",
  SUPPLIER_NO_RULE: "Fornecedor sem regra ativa",
  RULE_NOT_APPLIED: "Regra ativa, alocação pendente",
};

const CAUSE_HINT: Record<UnclassifiedCause, string> = {
  MANUAL_LOCKED: "Classificação manual protegida — não será sobrescrita.",
  PARTIAL_ALLOCATION: "Possui alocação parcial; complete o rateio para 100%.",
  NO_SUPPLIER: "Rode o bootstrap de fornecedores a partir do AP.",
  SUPPLIER_NO_RULE: "Cadastre uma regra de classificação para o fornecedor.",
  RULE_NOT_APPLIED: "Aplique o preview em lote para classificar.",
};

type GroupedRow = {
  name: string;
  titlesCount: number;
  amount: number;
  openAmount: number;
  cause: UnclassifiedCause | null;
  supplierId: string | null;
  supplierName: string | null;
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
  canApplyBatch: boolean;
  canManageRules: boolean;
  onNavigateTab: (tab: FinanceCostCentersTabId) => void;
  onApplied?: () => void;
};

export function FinanceUnclassifiedPayablesTab({
  dashboard,
  canApplyBatch,
  canManageRules,
  onNavigateTab,
  onApplied,
}: Props) {
  const [items, setItems] = useState<UnclassifiedItem[]>([]);
  const [causeSummary, setCauseSummary] = useState<Partial<Record<UnclassifiedCause, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<BatchAllocationPreviewPayload | null>(null);
  const [applying, setApplying] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  // Classificação por fornecedor (modal)
  const [classifyGroup, setClassifyGroup] = useState<GroupedRow | null>(null);
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [centersLoaded, setCentersLoaded] = useState(false);
  const [modalCostCenterId, setModalCostCenterId] = useState("");
  const [modalSupplier, setModalSupplier] = useState<FinanceSupplierSearchResult | null>(null);
  const [modalPreview, setModalPreview] = useState<SupplierCostCenterRulePreviewPayload | null>(null);
  const [modalConfirmChecked, setModalConfirmChecked] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  // Autocomplete de fornecedor (apenas quando não há fornecedor casado)
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<FinanceSupplierSearchResult[]>([]);
  const [supplierSearching, setSupplierSearching] = useState(false);
  const [supplierDropdownOpen, setSupplierDropdownOpen] = useState(false);
  const searchSeq = useRef(0);

  // Exportar / Importar planilha
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importLoadingPreview, setImportLoadingPreview] = useState(false);
  const [importApplying, setImportApplying] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importConfirmSensitive, setImportConfirmSensitive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<{
        items: UnclassifiedItem[];
        causeSummary?: Partial<Record<UnclassifiedCause, number>>;
      }>("/api/finance/accounts-payable/unclassified", { credentials: "include" });
      setItems(payload.items);
      setCauseSummary(payload.causeSummary ?? {});
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar títulos sem classificação.", e));
      setItems([]);
      setCauseSummary({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo<GroupedRow[]>(() => {
    const map = new Map<string, GroupedRow>();
    for (const item of items) {
      const key = item.personName ?? `Título ${item.externalId}`;
      const row =
        map.get(key) ??
        ({
          name: key,
          titlesCount: 0,
          amount: 0,
          openAmount: 0,
          cause: null,
          supplierId: null,
          supplierName: null,
        } satisfies GroupedRow);
      row.titlesCount += 1;
      row.amount += item.titleAmount;
      row.openAmount += item.titleAmount;
      if (item.cause) row.cause = item.cause;
      if (!row.supplierId && item.supplierId) row.supplierId = item.supplierId;
      if (!row.supplierName && item.supplierName) row.supplierName = item.supplierName;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }, [items]);

  const causeChips = useMemo(
    () =>
      (Object.keys(CAUSE_LABEL) as UnclassifiedCause[])
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

  const effectiveSupplierId = classifyGroup?.supplierId ?? modalSupplier?.id ?? null;
  const needsSupplierLink = Boolean(classifyGroup) && !classifyGroup?.supplierId;

  // Busca de fornecedor com debounce, apenas quando o grupo não tem fornecedor casado.
  useEffect(() => {
    if (!classifyGroup || !needsSupplierLink || modalSupplier) return;
    const term = supplierQuery.trim();
    if (term.length < 2) {
      setSupplierResults([]);
      setSupplierSearching(false);
      return;
    }
    setSupplierSearching(true);
    const seq = ++searchSeq.current;
    const handle = window.setTimeout(async () => {
      try {
        const payload = await fetchJsonOk<{ suppliers: FinanceSupplierSearchResult[] }>(
          `/api/finance/supplier-cost-center-rules/suppliers/search?search=${encodeURIComponent(
            term
          )}&limit=20`,
          { credentials: "include" }
        );
        if (seq !== searchSeq.current) return;
        setSupplierResults(payload.suppliers);
        setSupplierDropdownOpen(true);
      } catch {
        if (seq !== searchSeq.current) return;
        setSupplierResults([]);
      } finally {
        if (seq === searchSeq.current) setSupplierSearching(false);
      }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [supplierQuery, classifyGroup, needsSupplierLink, modalSupplier]);

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
    setSupplierQuery("");
    setSupplierResults([]);
    setSupplierDropdownOpen(false);
    void ensureCenters();
  };

  const closeClassifyModal = () => {
    setClassifyGroup(null);
    setModalSaving(false);
    setModalError(null);
  };

  const runModalPreview = async () => {
    if (!effectiveSupplierId || !modalCostCenterId) return;
    setModalError(null);
    try {
      const payload = await fetchJsonOk<SupplierCostCenterRulePreviewPayload>(
        "/api/finance/supplier-cost-center-rules/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: effectiveSupplierId,
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
    if (!canManageRules || !effectiveSupplierId || !modalCostCenterId || !modalConfirmChecked) return;
    setModalSaving(true);
    setModalError(null);
    try {
      await fetchJsonOk("/api/finance/supplier-cost-center-rules", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: effectiveSupplierId,
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
              filters: { unclassifiedOnly: true, supplierId: effectiveSupplierId },
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
      closeClassifyModal();
      await load();
      onApplied?.();
    } catch (e) {
      setModalError(buildFinanceTabLoadError("Não foi possível concluir a classificação.", e));
    } finally {
      setModalSaving(false);
    }
  };

  const modalCanConfirm =
    Boolean(effectiveSupplierId) && Boolean(modalCostCenterId) && modalConfirmChecked && !modalSaving;

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
    setImportError(null);
    setImportConfirmSensitive(false);
  };

  const closeImportModal = () => {
    setImportOpen(false);
    setImportApplying(false);
    setImportLoadingPreview(false);
  };

  const runImportPreview = async (file: File) => {
    setImportLoadingPreview(true);
    setImportError(null);
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
      setImportError(buildFinanceTabLoadError("Não foi possível validar a planilha.", e));
    } finally {
      setImportLoadingPreview(false);
    }
  };

  const applyImport = async () => {
    if (!importFile || !importPreview) return;
    setImportApplying(true);
    setImportError(null);
    try {
      const formData = new FormData();
      formData.append("file", importFile);
      formData.append("confirmationText", importPreview.requiredConfirmationText);
      formData.append("confirmSensitive", importConfirmSensitive ? "true" : "false");
      const result = await fetchJsonOk<ImportApplyResult>(
        "/api/finance/cost-centers/unclassified/import/apply",
        { method: "POST", credentials: "include", body: formData }
      );
      let message = `Importação aplicada: ${result.rulesCreated} regra(s), ${result.titlesAllocated} título(s) classificados.`;
      if (result.suppliersCreated > 0) message += ` ${result.suppliersCreated} fornecedor(es) criados.`;
      if (result.titlesIgnoredManualLocked > 0) {
        message += ` ${result.titlesIgnoredManualLocked} título(s) com classificação manual preservados.`;
      }
      if (result.skippedSensitiveUnconfirmed > 0) {
        message += ` ${result.skippedSensitiveUnconfirmed} linha(s) sensível(is) ignorada(s) sem confirmação.`;
      }
      setNotice(message);
      closeImportModal();
      await load();
      onApplied?.();
    } catch (e) {
      setImportError(buildFinanceTabLoadError("Não foi possível aplicar a importação.", e));
    } finally {
      setImportApplying(false);
    }
  };

  const unclassified = dashboard?.unclassified;

  return (
    <div className="space-y-4" data-testid="finance-cost-centers-unclassified-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Títulos AP sem classificação completa. Agrupe por fornecedor e aplique regras em lote com
          confirmação.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold" onClick={() => void load()}>
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
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
              onClick={openImportModal}
            >
              <Upload className="h-4 w-4" />
              Importar planilha
            </button>
          ) : null}
          {canApplyBatch ? (
            <>
              <button
                type="button"
                data-testid="finance-unclassified-preview-button"
                className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold"
                onClick={() => void runPreview()}
              >
                <Play className="h-4 w-4" />
                Preview em lote
              </button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} /> : null}
      {notice ? (
        <div
          data-testid="finance-unclassified-notice"
          className="flex items-start justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
        >
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {notice}
          </span>
          <button type="button" className="text-emerald-700" onClick={() => setNotice(null)}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {loading ? <FinanceModuleLoadingBlock label="Carregando títulos sem classificação…" /> : null}

      {!loading && causeChips.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="finance-unclassified-cause-summary">
          {causeChips.map(({ cause, count }) => (
            <span
              key={cause}
              title={CAUSE_HINT[cause]}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-semibold"
            >
              {CAUSE_LABEL[cause]}
              <span className="rounded-full bg-primary/10 px-1.5 text-primary">{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      {!loading && grouped.length === 0 ? (
        <FinanceModuleEmptyState
          title="Nenhum título sem classificação"
          description="Todos os títulos do filtro já possuem classificação por centro de custo — ou cadastre regras para novos fornecedores."
        />
      ) : null}

      {!loading && grouped.length > 0 ? (
        <div className={cn(financeBiCardClass, "overflow-x-auto")}>
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2">Fornecedor</th>
                <th className="px-3 py-2">Títulos</th>
                <th className="px-3 py-2">Valor</th>
                <th className="px-3 py-2">Causa</th>
                <th className="px-3 py-2">Sugestão</th>
                <th className="px-3 py-2">Ação</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((row) => (
                <tr key={row.name} className="border-b border-border/60">
                  <td className="px-3 py-2 font-semibold">{row.name}</td>
                  <td className="px-3 py-2">{row.titlesCount}</td>
                  <td className="px-3 py-2">{formatFinanceCurrency(row.amount)}</td>
                  <td className="px-3 py-2">
                    {row.cause ? (
                      <span className="text-xs font-semibold">{CAUSE_LABEL[row.cause]}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.cause
                      ? CAUSE_HINT[row.cause]
                      : unclassified && unclassified.titlesCount > 0
                        ? "Definir regra para o fornecedor"
                        : "Revisar fornecedor"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      data-testid="finance-unclassified-classify-supplier-button"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                      onClick={() => openClassifyModal(row)}
                    >
                      <Settings2 className="h-3 w-3" />
                      Classificar fornecedor
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {preview && canApplyBatch ? (
        <div className={cn(financeBiCardClass, "space-y-3")}>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={cn(financeBiCardClass, "w-full max-w-lg space-y-4")}
            data-testid="finance-unclassified-classify-modal"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">Classificar fornecedor</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
                onClick={closeClassifyModal}
              >
                <X className="h-3 w-3" />
                Fechar
              </button>
            </div>

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <p className="font-semibold">{classifyGroup.name}</p>
              <p className="text-xs text-muted-foreground">
                {classifyGroup.cause ? CAUSE_LABEL[classifyGroup.cause] : "Sem classificação"} ·{" "}
                {formatFinanceInteger(classifyGroup.titlesCount)} título(s) ·{" "}
                {formatFinanceCurrency(classifyGroup.amount)}
              </p>
              {classifyGroup.supplierId ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Fornecedor financeiro:{" "}
                  <span className="font-semibold">
                    {classifyGroup.supplierName ?? "vinculado"}
                  </span>
                </p>
              ) : (
                <p className="mt-1 text-xs text-amber-700">
                  Sem fornecedor financeiro vinculado — busque e vincule abaixo.
                </p>
              )}
            </div>

            {needsSupplierLink ? (
              <div className="space-y-1 text-sm">
                <span className="font-semibold">Fornecedor financeiro</span>
                {modalSupplier ? (
                  <div
                    className="rounded-lg border border-primary/40 bg-primary/5 p-3"
                    data-testid="finance-unclassified-selected-supplier"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <p className="font-semibold">{modalSupplier.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {modalSupplier.document ?? "Sem documento"}
                          {modalSupplier.externalCode ? ` · código ${modalSupplier.externalCode}` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFinanceInteger(modalSupplier.titlesCount)} título(s)
                        </p>
                      </div>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
                        onClick={() => {
                          setModalSupplier(null);
                          setModalPreview(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                        Trocar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <input
                        data-testid="finance-unclassified-supplier-search"
                        className="w-full bg-transparent text-sm outline-none"
                        value={supplierQuery}
                        onChange={(e) => {
                          setSupplierQuery(e.target.value);
                          setSupplierDropdownOpen(true);
                        }}
                        onFocus={() => setSupplierDropdownOpen(true)}
                        placeholder="Buscar fornecedor por nome, CNPJ, documento ou código..."
                      />
                    </div>
                    {supplierDropdownOpen && supplierQuery.trim().length >= 2 ? (
                      <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-background shadow-lg">
                        {supplierSearching ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            Buscando fornecedores…
                          </p>
                        ) : supplierResults.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">
                            Nenhum fornecedor encontrado. Rode o bootstrap de fornecedores a partir do
                            AP na aba Fornecedores.
                          </p>
                        ) : (
                          supplierResults.map((supplier) => (
                            <button
                              key={supplier.id}
                              type="button"
                              data-testid="finance-unclassified-supplier-option"
                              className="block w-full border-b border-border/40 px-3 py-2 text-left hover:bg-muted/50"
                              onClick={() => {
                                setModalSupplier(supplier);
                                setSupplierDropdownOpen(false);
                                setModalPreview(null);
                              }}
                            >
                              <p className="text-sm font-semibold">{supplier.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {supplier.document ?? "Sem documento"} ·{" "}
                                {formatFinanceInteger(supplier.titlesCount)} título(s)
                              </p>
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
                    <p className="mt-1 text-xs text-muted-foreground">
                      Digite ao menos 2 caracteres para buscar.
                    </p>
                  </div>
                )}
              </div>
            ) : null}

            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Centro de custo</span>
              <select
                data-testid="finance-unclassified-cost-center-select"
                className="w-full rounded-lg border px-3 py-2 text-sm"
                value={modalCostCenterId}
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
              <span className="text-xs text-muted-foreground">
                Percentual padrão 100%. Para rateio, use a aba Regras de Classificação.
              </span>
            </label>

            <button
              type="button"
              data-testid="finance-unclassified-modal-preview-button"
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"
              disabled={!effectiveSupplierId || !modalCostCenterId}
              onClick={() => void runModalPreview()}
            >
              <Eye className="h-4 w-4" />
              Pré-visualizar impacto
            </button>
            {modalPreview ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                <p>
                  Títulos em aberto: {formatFinanceInteger(modalPreview.openTitlesCount)} · Bloqueados
                  manual: {formatFinanceInteger(modalPreview.manualLockedTitlesCount)}
                </p>
                {modalPreview.manualLockedTitlesCount > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Classificações manuais bloqueadas não serão sobrescritas.
                  </p>
                ) : null}
              </div>
            ) : null}

            {modalError ? (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {modalError}
              </div>
            ) : null}

            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                data-testid="finance-unclassified-confirm-checkbox"
                className="mt-1"
                checked={modalConfirmChecked}
                onChange={(e) => setModalConfirmChecked(e.target.checked)}
              />
              <span>
                Confirmo criar a regra de classificação (100%) e aplicar aos títulos elegíveis deste
                fornecedor, preservando classificações manuais bloqueadas.
              </span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={closeClassifyModal}
              >
                Cancelar
              </button>
              <button
                type="button"
                data-testid="finance-unclassified-classify-confirm"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={!modalCanConfirm}
                onClick={() => void confirmClassify()}
              >
                {modalSaving ? "Classificando…" : "Criar regra e classificar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {importOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            className={cn(financeBiCardClass, "w-full max-w-2xl space-y-4")}
            data-testid="finance-unclassified-import-modal"
          >
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-lg font-semibold">Importar planilha de classificação</h3>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold"
                onClick={closeImportModal}
              >
                <X className="h-3 w-3" />
                Fechar
              </button>
            </div>

            <p className="text-sm text-muted-foreground">
              Exporte a planilha, preencha as colunas de ação, centro de custo e percentual, marque
              <span className="font-semibold"> aplicar = SIM</span> e importe aqui. A validação roda
              antes de qualquer alteração.
            </p>

            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Arquivo (.xlsx)</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                data-testid="finance-unclassified-import-file"
                className="block w-full text-sm"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  setImportFile(file);
                  setImportPreview(null);
                  setImportError(null);
                  if (file) void runImportPreview(file);
                }}
              />
            </label>

            {importLoadingPreview ? (
              <FinanceModuleLoadingBlock label="Validando planilha…" />
            ) : null}

            {importError ? (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {importError}
              </div>
            ) : null}

            {importPreview ? (
              <div className="space-y-3" data-testid="finance-unclassified-import-preview">
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <SummaryStat label="Linhas lidas" value={importPreview.totalRead} />
                  <SummaryStat label="Válidas" value={importPreview.validLines} tone="ok" />
                  <SummaryStat label="Inválidas" value={importPreview.invalidLines} tone="error" />
                  <SummaryStat label="Ignoradas" value={importPreview.skippedLines} />
                  <SummaryStat label="Fornecedores a criar" value={importPreview.suppliersToCreate} />
                  <SummaryStat label="Fornecedores a vincular" value={importPreview.suppliersToLink} />
                  <SummaryStat label="Regras a criar" value={importPreview.rulesToCreate} />
                  <SummaryStat label="Títulos a classificar" value={importPreview.titlesToAllocate} />
                  <SummaryStat
                    label="Sensíveis (confirmar)"
                    value={importPreview.sensitiveRequiringConfirmation}
                    tone={importPreview.sensitiveRequiringConfirmation > 0 ? "warn" : undefined}
                  />
                </div>

                {importPreview.lines.some((line) => line.errors.length > 0) ? (
                  <div className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/30 p-2 text-xs">
                    <p className="mb-1 font-semibold">Erros por linha</p>
                    {importPreview.lines
                      .filter((line) => line.errors.length > 0)
                      .map((line) => (
                        <p key={line.rowNumber} className="text-rose-700">
                          Linha {line.rowNumber}
                          {line.personNameNomus ? ` (${line.personNameNomus})` : ""}:{" "}
                          {line.errors.join(" ")}
                        </p>
                      ))}
                  </div>
                ) : null}

                {importPreview.sensitiveRequiringConfirmation > 0 ? (
                  <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
                    <input
                      type="checkbox"
                      data-testid="finance-unclassified-import-confirm-sensitive"
                      className="mt-1"
                      checked={importConfirmSensitive}
                      onChange={(e) => setImportConfirmSensitive(e.target.checked)}
                    />
                    <span className="inline-flex items-start gap-1">
                      <AlertTriangle className="mt-0.5 h-4 w-4" />
                      Há {importPreview.sensitiveRequiringConfirmation} linha(s) sensível(is) (conta
                      administrativa, receita federal, sócios, financiamentos ou grupo interno).
                      Confirmo a classificação dessas linhas.
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={closeImportModal}
              >
                Cancelar
              </button>
              {importPreview && importPreview.validLines + importPreview.sensitiveRequiringConfirmation > 0 ? (
                <button
                  type="button"
                  data-testid="finance-unclassified-import-apply-button"
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  disabled={
                    importApplying ||
                    (importPreview.sensitiveRequiringConfirmation > 0 && !importConfirmSensitive)
                  }
                  onClick={() => void applyImport()}
                >
                  {importApplying ? "Aplicando…" : "Aplicar importação"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "error" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-700"
      : tone === "error"
        ? "text-rose-700"
        : tone === "warn"
          ? "text-amber-700"
          : "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-[10px] font-bold uppercase text-muted-foreground">{label}</p>
      <p className={cn("text-lg font-semibold", toneClass)}>{value}</p>
    </div>
  );
}
