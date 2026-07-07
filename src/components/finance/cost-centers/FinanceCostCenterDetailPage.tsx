import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import {
  FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT,
  FINANCE_CC_REALLOCATION_REASONS,
  type CostCenterDetailAllocationRow,
  type CostCenterDetailListPayload,
  type CostCenterDetailSortField,
  type CostCenterDetailSummary,
  type CostCenterReallocationPreviewPayload,
} from "@/src/lib/financeCostCenterDetailShared";
import {
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
} from "@/src/lib/financeAccountsReceivableFormat";
import { formatFinanceKpiCurrency } from "@/src/lib/financeKpiFormat";
import { FinanceBiDashboardShell } from "@/src/components/finance/bi/FinanceBiDashboardShell";
import { FinanceExecutivePageHeader } from "@/src/components/finance/shared/FinanceExecutivePageHeader";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";
import { FinanceKpiCard } from "@/src/components/finance/shared/FinanceKpiCard";
import {
  FinanceModuleEmptyState,
  FinanceModuleErrorBanner,
  FinanceModuleLoadingBlock,
} from "@/src/components/finance/shared/FinanceModuleStates";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  canReallocateFinanceCostCenterAllocations,
  canViewFinanceCostCenters,
} from "@/src/lib/financeCostCentersPermissions";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { cn } from "@/src/lib/utils";

const SORTABLE_COLUMNS: Array<{ key: CostCenterDetailSortField; label: string }> = [
  { key: "supplier", label: "Fornecedor" },
  { key: "company", label: "Empresa" },
  { key: "dueDate", label: "Vencimento" },
  { key: "competenceDate", label: "Competência" },
  { key: "amountPayable", label: "Valor" },
  { key: "balancePayable", label: "Saldo" },
  { key: "allocatedAmount", label: "Alocado" },
  { key: "classification", label: "Classificação" },
  { key: "source", label: "Fonte" },
  { key: "status", label: "Status" },
];

function sourceBadge(source: string) {
  const styles: Record<string, string> = {
    AUTO_RULE: "bg-blue-100 text-blue-800",
    BATCH: "bg-violet-100 text-violet-800",
    MANUAL: "bg-amber-100 text-amber-900",
  };
  const labels: Record<string, string> = {
    AUTO_RULE: "Auto",
    BATCH: "Batch",
    MANUAL: "Manual",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", styles[source] ?? "bg-muted")}>
      {labels[source] ?? source}
    </span>
  );
}

export function FinanceCostCenterDetailPage() {
  const { costCenterId = "" } = useParams<{ costCenterId: string }>();
  const auth = useAuth();
  const canView = canViewFinanceCostCenters(auth);
  const canReallocate = canReallocateFinanceCostCenterAllocations(auth);

  const [center, setCenter] = useState<FinanceCostCenterDto | null>(null);
  const [summary, setSummary] = useState<CostCenterDetailSummary | null>(null);
  const [list, setList] = useState<CostCenterDetailListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [allocationSource, setAllocationSource] = useState("all");
  const [manualOnly, setManualOnly] = useState(false);
  const [lockedOnly, setLockedOnly] = useState(false);
  const [divergentOnly, setDivergentOnly] = useState(false);
  const [timing, setTiming] = useState("all");
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CostCenterDetailSortField>("dueDate");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reallocateOpen, setReallocateOpen] = useState(false);
  const [targetCenterId, setTargetCenterId] = useState("");
  const [centers, setCenters] = useState<FinanceCostCenterDto[]>([]);
  const [reason, setReason] = useState("MANUAL_CORRECTION");
  const [reasonNote, setReasonNote] = useState("");
  const [preview, setPreview] = useState<CostCenterReallocationPreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  const [confirmManual, setConfirmManual] = useState(false);
  const [manualConfirmText, setManualConfirmText] = useState("");
  const [reallocateError, setReallocateError] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const queryString = useMemo(() => {
    const q = new URLSearchParams();
    if (year) q.set("year", year);
    if (status !== "all") q.set("status", status);
    if (debouncedSearch.trim()) q.set("search", debouncedSearch.trim());
    if (allocationSource !== "all") q.set("allocationSource", allocationSource);
    if (manualOnly) q.set("manualOnly", "true");
    if (lockedOnly) q.set("lockedOnly", "true");
    if (divergentOnly) q.set("divergentOnly", "true");
    if (timing !== "all") q.set("timing", timing);
    q.set("page", String(page));
    q.set("limit", "50");
    q.set("sortBy", sortBy);
    q.set("sortDirection", sortDirection);
    return q.toString();
  }, [
    year,
    status,
    debouncedSearch,
    allocationSource,
    manualOnly,
    lockedOnly,
    divergentOnly,
    timing,
    page,
    sortBy,
    sortDirection,
  ]);

  const load = useCallback(async () => {
    if (!costCenterId || !canView) return;
    setLoading(true);
    setError(null);
    try {
      const [centerRes, listRes] = await Promise.all([
        fetchJsonOk<{ item: FinanceCostCenterDto }>(
          `/api/finance/cost-centers/${costCenterId}`,
          { credentials: "include" }
        ),
        fetchJsonOk<CostCenterDetailListPayload>(
          `/api/finance/cost-centers/${costCenterId}/allocations?${queryString}`,
          { credentials: "include" }
        ),
      ]);
      setCenter(centerRes.item);
      setSummary(listRes.summary);
      setList(listRes);
    } catch (e) {
      setError(buildFinanceTabLoadError("Não foi possível carregar o centro de custo.", e));
      setCenter(null);
      setSummary(null);
      setList(null);
    } finally {
      setLoading(false);
    }
  }, [costCenterId, canView, queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [year, status, debouncedSearch, allocationSource, manualOnly, lockedOnly, divergentOnly, timing, sortBy, sortDirection]);

  useEffect(() => {
    if (!canReallocate) return;
    void fetchJsonOk<{ items: FinanceCostCenterDto[] }>("/api/finance/cost-centers?status=ACTIVE", {
      credentials: "include",
    }).then((payload) => setCenters(payload.items));
  }, [canReallocate]);

  const toggleSort = (column: CostCenterDetailSortField) => {
    if (sortBy === column) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDirection("asc");
    }
  };

  const toggleRow = (allocationId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(allocationId)) next.delete(allocationId);
      else next.add(allocationId);
      return next;
    });
  };

  const runPreview = async () => {
    if (!targetCenterId || selected.size === 0) return;
    setPreviewLoading(true);
    setReallocateError(null);
    try {
      const payload = await fetchJsonOk<CostCenterReallocationPreviewPayload>(
        "/api/finance/cost-centers/reallocation/preview",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocationIds: [...selected],
            targetCostCenterId: targetCenterId,
            reason,
            reasonNote: reasonNote || null,
            confirmManualOverride: confirmManual,
          }),
        }
      );
      setPreview(payload);
    } catch (e) {
      setReallocateError(buildFinanceTabLoadError("Não foi possível gerar o preview.", e));
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runApply = async () => {
    if (!targetCenterId || selected.size === 0) return;
    setApplyLoading(true);
    setReallocateError(null);
    try {
      await fetchJsonOk("/api/finance/cost-centers/reallocation/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocationIds: [...selected],
          targetCostCenterId: targetCenterId,
          reason,
          reasonNote: reasonNote || null,
          confirmManualOverride: confirmManual,
          manualConfirmationText: manualConfirmText,
        }),
      });
      setReallocateOpen(false);
      setPreview(null);
      setSelected(new Set());
      setConfirmManual(false);
      setManualConfirmText("");
      await load();
    } catch (e) {
      setReallocateError(buildFinanceTabLoadError("Não foi possível aplicar a realocação.", e));
    } finally {
      setApplyLoading(false);
    }
  };

  if (!canView) {
    return (
      <div className="rounded-xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        Sem permissão para visualizar centros de custo.
      </div>
    );
  }

  return (
    <FinanceBiDashboardShell data-testid="finance-cost-center-detail-page">
      <FinanceExecutivePageHeader
        eyebrow="Financeiro / Centros de Custo"
        title={center ? `${center.code} — ${center.name}` : "Centro de custo"}
        subtitle="Lançamentos alocados e realocação gerencial (sem alterar Nomus)."
        actions={[
          {
            id: "refresh",
            label: "Atualizar",
            onClick: () => void load(),
            icon: <RefreshCw className="h-4 w-4" />,
          },
        ]}
      />

      <div className="mb-4">
        <Link
          to="/finance/cost-centers"
          className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar para lista de centros
        </Link>
      </div>

      {error ? (
        <FinanceModuleErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />
      ) : null}

      {loading && !summary ? <FinanceModuleLoadingBlock label="Carregando centro de custo…" /> : null}

      {summary ? (
        <ExecutiveSummarySection
          title="Resumo do centro"
          eyebrow="Totais alocados no filtro aplicado"
          testId="finance-cc-detail-summary"
        >
          <SummaryKpiGrid minColumnWidth={200}>
          <FinanceKpiCard
            label="Total alocado no filtro"
            value={formatFinanceKpiCurrency(list?.totals.allocatedAmount ?? summary.totalAllocatedAmount)}
          />
          <FinanceKpiCard label="Títulos" value={String(summary.titlesCount)} />
          <FinanceKpiCard label="Fornecedores" value={String(summary.suppliersCount)} />
          <FinanceKpiCard label="Status" value={summary.status === "ACTIVE" ? "Ativo" : "Inativo"} />
          <FinanceKpiCard label="Vencido" value={formatFinanceKpiCurrency(summary.overdueAmount)} />
          <FinanceKpiCard label="A vencer" value={formatFinanceKpiCurrency(summary.upcomingAmount)} />
          <FinanceKpiCard
            label="Maior fornecedor"
            value={summary.topSupplierName ?? "—"}
            helperText={summary.topSupplierAmount > 0 ? formatFinanceCurrency(summary.topSupplierAmount) : undefined}
          />
          <FinanceKpiCard label="Maior classificação Nomus" value={summary.topNomusClassification ?? "—"} />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      <div className={cn(financeBiCardClass, "mt-6 space-y-4 p-4")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Ano vencimento</span>
            <input className={financeModuleFilterFieldClass()} value={year} onChange={(e) => setYear(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Status título</span>
            <select className={financeModuleFilterFieldClass()} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="open">Em aberto</option>
              <option value="overdue">Vencidos</option>
              <option value="settled">Liquidados</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className={financeModuleFilterLabelClass()}>Fonte alocação</span>
            <select
              className={financeModuleFilterFieldClass()}
              value={allocationSource}
              onChange={(e) => setAllocationSource(e.target.value)}
            >
              <option value="all">Todas</option>
              <option value="AUTO_RULE">Auto rule</option>
              <option value="BATCH">Batch</option>
              <option value="MANUAL">Manual</option>
            </select>
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={financeModuleFilterLabelClass()}>Busca livre</span>
            <input
              className={financeModuleFilterFieldClass()}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Fornecedor, descrição, documento, classificação…"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={manualOnly} onChange={(e) => setManualOnly(e.target.checked)} />
            Apenas manuais
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={lockedOnly} onChange={(e) => setLockedOnly(e.target.checked)} />
            Apenas locked
          </label>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" checked={divergentOnly} onChange={(e) => setDivergentOnly(e.target.checked)} />
            Apenas parciais/divergentes
          </label>
          <select className={financeModuleFilterFieldClass()} value={timing} onChange={(e) => setTiming(e.target.value)}>
            <option value="all">Prazo: todos</option>
            <option value="overdue">Vencidos</option>
            <option value="upcoming">A vencer</option>
          </select>
        </div>

        {canReallocate ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              type="button"
              data-testid="finance-cost-center-reallocate-open"
              className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              disabled={selected.size === 0}
              onClick={() => {
                setReallocateOpen(true);
                setPreview(null);
                setReallocateError(null);
              }}
            >
              Realocar ({selected.size})
            </button>
            <span className="text-xs text-muted-foreground">
              Selecione lançamentos para mover para outro centro (preview obrigatório).
            </span>
          </div>
        ) : null}
      </div>

      {list && list.items.length === 0 && !loading ? (
        <FinanceModuleEmptyState
          title="Nenhum lançamento no filtro"
          description="Amplie o período ou remova filtros para ver alocações neste centro."
        />
      ) : null}

      {list && list.items.length > 0 ? (
        <div className={cn(financeBiCardClass, "mt-4 overflow-x-auto")}>
          <table className="w-full min-w-[1100px] text-sm" data-testid="finance-cost-center-allocations-table">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-[10px] font-bold uppercase text-muted-foreground">
                {canReallocate ? <th className="px-2 py-2 w-8" /> : null}
                {SORTABLE_COLUMNS.map((col) => (
                  <th key={col.key} className="px-2 py-2">
                    <button type="button" className="hover:text-foreground" onClick={() => toggleSort(col.key)}>
                      {col.label}
                      {sortBy === col.key ? (sortDirection === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2">AP</th>
                <th className="px-2 py-2">%</th>
                <th className="px-2 py-2">Atualizado</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((row: CostCenterDetailAllocationRow) => (
                <tr key={row.allocationId} className="border-b border-border/60 hover:bg-muted/30">
                  {canReallocate ? (
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.allocationId)}
                        onChange={() => toggleRow(row.allocationId)}
                      />
                    </td>
                  ) : null}
                  <td className="px-2 py-2">{row.personName ?? row.supplierName ?? "—"}</td>
                  <td className="px-2 py-2">{row.companyName ?? "—"}</td>
                  <td className="px-2 py-2">{formatFinanceDate(row.dueDate)}</td>
                  <td className="px-2 py-2">{formatFinanceDate(row.competenceDate)}</td>
                  <td className="px-2 py-2 tabular-nums">{formatFinanceCurrency(row.amountPayable)}</td>
                  <td className="px-2 py-2 tabular-nums">{formatFinanceCurrency(row.balancePayable)}</td>
                  <td className="px-2 py-2 tabular-nums font-semibold">{formatFinanceCurrency(row.allocatedAmount)}</td>
                  <td className="px-2 py-2">{row.nomusClassification ?? "—"}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {sourceBadge(row.allocationSource)}
                      {row.lockedManual ? (
                        <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                          Locked
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2">{row.statusLabel}</td>
                  <td className="px-2 py-2 tabular-nums">{row.accountsPayableId}</td>
                  <td className="px-2 py-2 tabular-nums">{row.allocatedPercentage}%</td>
                  <td className="px-2 py-2 text-xs text-muted-foreground">
                    {formatFinanceDateTime(row.allocationUpdatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              {list.totalItems} registro(s) · Total alocado filtrado:{" "}
              {formatFinanceCurrency(list.totals.allocatedAmount)}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border p-1 disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span>
                {page} / {list.totalPages}
              </span>
              <button
                type="button"
                className="rounded border p-1 disabled:opacity-40"
                disabled={page >= list.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {reallocateOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={cn(financeBiCardClass, "max-h-[90vh] w-full max-w-2xl overflow-y-auto space-y-4 p-5")}>
            <h3 className="text-lg font-semibold">Realocar lançamentos</h3>
            <p className="text-sm text-muted-foreground">
              {selected.size} alocação(ões) selecionada(s). Apenas `AccountsPayableCostCenterAllocation` será
              alterado.
            </p>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Centro de destino</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={targetCenterId}
                onChange={(e) => setTargetCenterId(e.target.value)}
              >
                <option value="">Selecione…</option>
                {centers
                  .filter((c) => c.id !== costCenterId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Motivo</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {FINANCE_CC_REALLOCATION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-semibold">Observação (opcional)</span>
              <textarea
                className={financeModuleFilterFieldClass()}
                rows={2}
                value={reasonNote}
                onChange={(e) => setReasonNote(e.target.value)}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={confirmManual} onChange={(e) => setConfirmManual(e.target.checked)} />
              Confirmo override para alocações manuais/locked elegíveis
            </label>
            {confirmManual ? (
              <label className="block space-y-1 text-sm">
                <span className="font-semibold">Confirmação manual</span>
                <input
                  className={financeModuleFilterFieldClass()}
                  value={manualConfirmText}
                  onChange={(e) => setManualConfirmText(e.target.value)}
                  placeholder={FINANCE_CC_REALLOCATION_MANUAL_CONFIRMATION_TEXT}
                />
              </label>
            ) : null}

            {reallocateError ? (
              <p className="text-sm text-destructive">{reallocateError}</p>
            ) : null}

            {preview ? (
              <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm space-y-2">
                <p>
                  <strong>Preview:</strong> {preview.summary.wouldMove} mover · {preview.summary.skipped} ignorar ·{" "}
                  {formatFinanceCurrency(preview.summary.totalAmount)}
                </p>
                <p>
                  Origem {preview.sourceCostCenterLabel}: {formatFinanceCurrency(preview.summary.sourceAmountBefore)} →{" "}
                  {formatFinanceCurrency(preview.summary.sourceAmountAfter)}
                </p>
                <p>
                  Destino {preview.targetCostCenterLabel}: {formatFinanceCurrency(preview.summary.targetAmountBefore)} →{" "}
                  {formatFinanceCurrency(preview.summary.targetAmountAfter)}
                </p>
                {preview.warnings.map((w) => (
                  <p key={w} className="text-amber-800">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setReallocateOpen(false)}>
                Cancelar
              </button>
              <button
                type="button"
                className="rounded-lg border px-3 py-2 text-sm font-semibold"
                disabled={!targetCenterId || previewLoading}
                onClick={() => void runPreview()}
              >
                {previewLoading ? <Loader2 className="inline h-4 w-4 animate-spin" /> : "Preview"}
              </button>
              <button
                type="button"
                data-testid="finance-cost-center-reallocate-apply"
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                disabled={!preview || applyLoading || preview.summary.wouldMove === 0}
                onClick={() => void runApply()}
              >
                {applyLoading ? "Aplicando…" : "Aplicar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </FinanceBiDashboardShell>
  );
}