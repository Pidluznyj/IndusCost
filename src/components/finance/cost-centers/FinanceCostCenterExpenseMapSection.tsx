import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Download, Link, Loader2, Printer, X } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import { buildFinanceTabLoadError } from "@/src/lib/financeTabLoadError";
import type { FinanceCostCenterDashboardPayload } from "@/src/lib/financeCostCenterDashboard";
import type { FinanceCostCenterDto } from "@/src/lib/financeCostCenters";
import type { FinanceCostCentersUiFilters } from "@/src/lib/financeCostCentersPageTypes";
import {
  buildCostCenterExpenseMapAllocationsQuery,
  buildCostCenterExpenseMapCards,
  buildCostCenterExpenseMapExportQuery,
  DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
  expenseMapCategoryLabel,
  filterCostCenterExpenseMapCards,
  type CostCenterExpenseMapCard,
  type CostCenterExpenseMapCategoryFilter,
  type CostCenterExpenseMapDrilldownFilters,
} from "@/src/lib/financeCostCenterExpenseMap";
import type {
  CostCenterDetailAllocationRow,
  CostCenterDetailExportPayload,
  CostCenterDetailListPayload,
  CostCenterDetailSortField,
  CostCenterDetailSummary,
} from "@/src/lib/financeCostCenterDetailShared";
import {
  buildCostCenterDetailExportFilename,
  buildCostCenterDetailPdfFilename,
} from "@/src/lib/financeCostCenterDetailExportMeta";
import { FinanceCostCenterDetailPrintDocument } from "@/src/components/finance/cost-centers/FinanceCostCenterDetailPrintDocument";
import "./finance-cc-detail-print.css";
import { buildFinanceCostCenterDetailPath } from "@/src/lib/financeNavigation";
import {
  displayFinanceText,
  formatFinanceCurrency,
  formatFinanceDate,
  formatFinanceDateTime,
  formatFinanceInteger,
  formatFinancePercent,
} from "@/src/lib/financeAccountsReceivableFormat";
import { financeBiCardClass } from "@/src/lib/financeBiDashboardTheme";
import {
  FinanceCostCenterGridPagination,
  FinanceCostCenterGridSearchBar,
  FinanceCostCenterGridTableShell,
  FinanceCostCenterSortableTh,
} from "@/src/components/finance/cost-centers/FinanceCostCenterGridKit";
import { toggleSortState } from "@/src/lib/financeCostCenterGridKit";
import { getSortDefaultDirection } from "@/src/lib/soldProductsTableSort";
import {
  financeModuleFilterFieldClass,
  financeModuleFilterLabelClass,
} from "@/src/lib/financeModuleUiStandards";
import { cn } from "@/src/lib/utils";

const CARD_FILTER_OPTIONS: Array<{ value: CostCenterExpenseMapCategoryFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "withValue", label: "Apenas com valor" },
  { value: "activeOnly", label: "Apenas ativos" },
  { value: "administrative", label: "Administrativo" },
  { value: "manufacturing", label: "Fabricação" },
  { value: "exclude", label: "Não considerar" },
];

const DETAIL_SORT_ACCESSORS = {
  supplier: { defaultDirection: "asc" as const },
  company: { defaultDirection: "asc" as const },
  dueDate: { defaultDirection: "asc" as const },
  competenceDate: { defaultDirection: "asc" as const },
  amountPayable: { defaultDirection: "desc" as const },
  balancePayable: { defaultDirection: "desc" as const },
  allocatedAmount: { defaultDirection: "desc" as const },
  classification: { defaultDirection: "asc" as const },
  source: { defaultDirection: "asc" as const },
  status: { defaultDirection: "asc" as const },
};

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

function ExpenseMapCard({
  card,
  active,
  onSelect,
}: {
  card: CostCenterExpenseMapCard;
  active: boolean;
  onSelect: () => void;
}) {
  const shareWidth = Math.min(100, Math.max(0, card.sharePercentage));
  return (
    <button
      type="button"
      data-testid={`finance-cc-expense-map-card-${card.costCenterId}`}
      aria-pressed={active}
      onClick={onSelect}
      title="Clique para detalhar"
      className={cn(
        financeBiCardClass,
        "p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        active && "ring-2 ring-primary shadow-sm"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {card.code}
          </p>
          <h4 className="text-sm font-bold text-foreground truncate">{card.name}</h4>
          {card.parentName ? (
            <p className="text-[10px] text-muted-foreground truncate">Pai: {card.parentName}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              card.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-muted text-muted-foreground"
            )}
          >
            {card.status === "ACTIVE" ? "Ativo" : "Inativo"}
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {expenseMapCategoryLabel(card.category)}
          </span>
        </div>
      </div>

      <p className="mt-3 text-xl font-bold tabular-nums">{formatFinanceCurrency(card.amount)}</p>
      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full bg-primary/70" style={{ width: `${shareWidth}%` }} />
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {formatFinancePercent(card.sharePercentage)} do total · {formatFinanceInteger(card.titlesCount)} título(s)
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
          Vencido {formatFinanceCurrency(card.overdueAmount)}
        </span>
        <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-800">
          A vencer {formatFinanceCurrency(card.upcomingAmount)}
        </span>
        {card.paidAmount > 0 ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
            Pago {formatFinanceCurrency(card.paidAmount)}
          </span>
        ) : null}
      </div>
    </button>
  );
}

type Props = {
  dashboard: FinanceCostCenterDashboardPayload | null;
  appliedFilters: FinanceCostCentersUiFilters;
  centers: FinanceCostCenterDto[];
  dashboardLoading?: boolean;
};

export function FinanceCostCenterExpenseMapSection({
  dashboard,
  appliedFilters,
  centers,
  dashboardLoading = false,
}: Props) {
  const [cardFilter, setCardFilter] = useState<CostCenterExpenseMapCategoryFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drilldown, setDrilldown] = useState<CostCenterExpenseMapDrilldownFilters>(
    DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS
  );
  const [searchDraft, setSearchDraft] = useState("");
  const [summary, setSummary] = useState<CostCenterDetailSummary | null>(null);
  const [list, setList] = useState<CostCenterDetailListPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [printPayload, setPrintPayload] = useState<CostCenterDetailExportPayload | null>(null);

  const cards = useMemo(() => {
    const built = buildCostCenterExpenseMapCards(dashboard?.byCostCenter ?? [], centers);
    return filterCostCenterExpenseMapCards(built, cardFilter);
  }, [dashboard?.byCostCenter, centers, cardFilter]);

  const selectedCard = cards.find((card) => card.costCenterId === selectedId) ?? null;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDrilldown((prev) => ({ ...prev, search: searchDraft, page: 1 }));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  const loadDrilldown = useCallback(async () => {
    if (!selectedId) {
      setSummary(null);
      setList(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = buildCostCenterExpenseMapAllocationsQuery(appliedFilters, drilldown);
      const [summaryRes, listRes] = await Promise.all([
        fetchJsonOk<{ summary: CostCenterDetailSummary }>(
          `/api/finance/cost-centers/${selectedId}/summary?${qs}`,
          { credentials: "include" }
        ),
        fetchJsonOk<CostCenterDetailListPayload>(
          `/api/finance/cost-centers/${selectedId}/allocations?${qs}`,
          { credentials: "include" }
        ),
      ]);
      setSummary(summaryRes.summary);
      setList(listRes);
    } catch (e) {
      setSummary(null);
      setList(null);
      setError(buildFinanceTabLoadError("Não foi possível carregar o detalhamento do centro.", e));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, drilldown, selectedId]);

  useEffect(() => {
    void loadDrilldown();
  }, [loadDrilldown]);

  const handleCardClick = (card: CostCenterExpenseMapCard) => {
    setSelectedId((current) => (current === card.costCenterId ? null : card.costCenterId));
    setDrilldown(DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS);
    setSearchDraft("");
  };

  const patchDrilldown = (patch: Partial<CostCenterExpenseMapDrilldownFilters>) => {
    setDrilldown((prev) => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  };

  const handleSort = (key: CostCenterDetailSortField) => {
    setDrilldown((prev) => ({
      ...prev,
      ...toggleSortState(
        { key: prev.sortBy, direction: prev.sortDirection },
        key,
        getSortDefaultDirection(DETAIL_SORT_ACCESSORS, key)
      ),
      page: 1,
    }));
  };

  const exportQuery = useMemo(
    () => buildCostCenterExpenseMapExportQuery(appliedFilters, drilldown),
    [appliedFilters, drilldown]
  );

  const handleExportExcel = async () => {
    if (!selectedId || !selectedCard || exportingExcel) return;
    setExportingExcel(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/finance/cost-centers/${selectedId}/detail/export.xlsx?${exportQuery}`,
        { credentials: "include" }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não foi possível exportar o Excel.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildCostCenterDetailExportFilename(selectedCard.name);
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível exportar o Excel do detalhe."
      );
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    if (!selectedId || exportingPdf) return;
    setExportingPdf(true);
    setError(null);
    try {
      const payload = await fetchJsonOk<CostCenterDetailExportPayload>(
        `/api/finance/cost-centers/${selectedId}/detail/export-data?${exportQuery}`,
        { credentials: "include" }
      );
      setPrintPayload(payload);
      document.body.classList.add("cc-detail-print-route");
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTimeout(() => {
              window.print();
              resolve();
            }, 200);
          });
        });
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível exportar o PDF do detalhe.");
    } finally {
      document.body.classList.remove("cc-detail-print-route");
      setExportingPdf(false);
    }
  };

  if (!centers.length && !dashboardLoading) return null;

  return (
    <>
      {printPayload
        ? createPortal(
            <FinanceCostCenterDetailPrintDocument payload={printPayload} />,
            document.body
          )
        : null}
    <section
      className="space-y-4 border-t border-border pt-6 cc-detail-no-print"
      data-testid="finance-cc-expense-map-section"
      aria-label="Mapa de Gastos por Centro de Custo"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-foreground">Mapa de Gastos por Centro de Custo</h3>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Clique em um centro para visualizar todos os títulos, pagamentos e vencimentos vinculados.
          </p>
          <p className="text-[10px] text-muted-foreground mt-1" data-testid="finance-cc-expense-map-scope-note">
            Valores conforme filtros atuais da tela.
          </p>
        </div>
        <label className="space-y-1 min-w-[180px]">
          <span className={financeModuleFilterLabelClass()}>Filtrar cards</span>
          <select
            className={financeModuleFilterFieldClass()}
            value={cardFilter}
            onChange={(e) => setCardFilter(e.target.value as CostCenterExpenseMapCategoryFilter)}
            data-testid="finance-cc-expense-map-card-filter"
          >
            {CARD_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {dashboardLoading && !dashboard ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={`expense-map-skel-${i}`} className={cn(financeBiCardClass, "h-44 animate-pulse bg-muted/30")} />
          ))}
        </div>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center rounded-lg border border-dashed border-border">
          Nenhum centro de custo encontrado para o filtro selecionado.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
          {cards.map((card) => (
            <ExpenseMapCard
              key={card.costCenterId}
              card={card}
              active={selectedId === card.costCenterId}
              onSelect={() => handleCardClick(card)}
            />
          ))}
        </div>
      )}

      {selectedCard ? (
        <div className={cn(financeBiCardClass, "p-4 space-y-4")} data-testid="finance-cc-expense-map-drilldown">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-bold text-foreground">
                Detalhamento de gastos — {selectedCard.name}
              </h4>
              <p className="text-[11px] text-muted-foreground">
                {selectedCard.code}
                {selectedCard.parentName ? ` · Pai: ${selectedCard.parentName}` : ""}
              </p>
              <Link
                to={buildFinanceCostCenterDetailPath(selectedCard.costCenterId)}
                className="text-[11px] font-semibold text-primary hover:underline mt-1 inline-block"
              >
                Abrir página completa do centro
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="finance-cc-expense-map-export-excel"
                disabled={exportingExcel || loading}
                onClick={() => void handleExportExcel()}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/40 disabled:opacity-60"
              >
                {exportingExcel ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Exportar Excel
              </button>
              <button
                type="button"
                data-testid="finance-cc-expense-map-export-pdf"
                disabled={exportingPdf || loading}
                onClick={() => void handleExportPdf()}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/40 disabled:opacity-60"
                title={buildCostCenterDetailPdfFilename(selectedCard.name)}
              >
                {exportingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Printer className="h-3.5 w-3.5" />
                )}
                Exportar PDF
              </button>
              <button
                type="button"
                data-testid="finance-cc-expense-map-close-drilldown"
                onClick={() => setSelectedId(null)}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-semibold hover:bg-muted/40"
              >
                <X className="h-3.5 w-3.5" />
                Fechar detalhe
              </button>
            </div>
          </div>

          {summary ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
              <div>
                <p className="text-muted-foreground">Total alocado</p>
                <p className="font-bold">{formatFinanceCurrency(summary.totalAllocatedAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Títulos</p>
                <p className="font-bold">{formatFinanceInteger(summary.titlesCount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Vencido</p>
                <p className="font-bold text-rose-700">{formatFinanceCurrency(summary.overdueAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">A vencer</p>
                <p className="font-bold text-sky-800">{formatFinanceCurrency(summary.upcomingAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Pago/liquidado</p>
                <p className="font-bold text-emerald-800">{formatFinanceCurrency(summary.paidAmount)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Maior fornecedor</p>
                <p className="font-bold truncate">{displayFinanceText(summary.topSupplierName)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Maior classificação Nomus</p>
                <p className="font-bold truncate">{displayFinanceText(summary.topNomusClassification)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Média por título</p>
                <p className="font-bold">{formatFinanceCurrency(summary.averageAllocatedPerTitle)}</p>
              </div>
              {summary.lastAllocationUpdateAt ? (
                <div className="col-span-2">
                  <p className="text-muted-foreground">Última atualização</p>
                  <p className="font-bold">{formatFinanceDateTime(summary.lastAllocationUpdateAt)}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
            <FinanceCostCenterGridSearchBar
              value={searchDraft}
              onChange={setSearchDraft}
              placeholder="Fornecedor, descrição, documento, AP…"
              testId="finance-cc-expense-map-search"
            />
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Empresa</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={drilldown.companyName}
                onChange={(e) => patchDrilldown({ companyName: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Fornecedor</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={drilldown.supplierName}
                onChange={(e) => patchDrilldown({ supplierName: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Classificação Nomus</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={drilldown.classification}
                onChange={(e) => patchDrilldown({ classification: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Status título</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={drilldown.status}
                onChange={(e) => patchDrilldown({ status: e.target.value })}
              >
                <option value="all">Todos</option>
                <option value="open">Em aberto</option>
                <option value="overdue">Vencidos</option>
                <option value="settled">Liquidados</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Prazo</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={drilldown.timing}
                onChange={(e) =>
                  patchDrilldown({
                    timing: e.target.value as CostCenterExpenseMapDrilldownFilters["timing"],
                  })
                }
              >
                <option value="all">Todos</option>
                <option value="overdue">Vencidos</option>
                <option value="upcoming">A vencer</option>
                <option value="paid">Pagos/liquidados</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Fonte alocação</span>
              <select
                className={financeModuleFilterFieldClass()}
                value={drilldown.allocationSource}
                onChange={(e) => patchDrilldown({ allocationSource: e.target.value })}
              >
                <option value="all">Todas</option>
                <option value="AUTO_RULE">Auto rule</option>
                <option value="BATCH">Batch</option>
                <option value="MANUAL">Manual</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 text-sm pt-6">
              <input
                type="checkbox"
                checked={drilldown.lockedOnly}
                onChange={(e) => patchDrilldown({ lockedOnly: e.target.checked })}
              />
              Apenas locked manual
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Valor mín.</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={drilldown.minAmount}
                onChange={(e) => patchDrilldown({ minAmount: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Valor máx.</span>
              <input
                className={financeModuleFilterFieldClass()}
                value={drilldown.maxAmount}
                onChange={(e) => patchDrilldown({ maxAmount: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Vencimento de</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.dueDateFrom}
                onChange={(e) => patchDrilldown({ dueDateFrom: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Vencimento até</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.dueDateTo}
                onChange={(e) => patchDrilldown({ dueDateTo: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Competência de</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.competenceDateFrom}
                onChange={(e) => patchDrilldown({ competenceDateFrom: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Competência até</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.competenceDateTo}
                onChange={(e) => patchDrilldown({ competenceDateTo: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Pagamento de</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.paymentDateFrom}
                onChange={(e) => patchDrilldown({ paymentDateFrom: e.target.value })}
              />
            </label>
            <label className="space-y-1">
              <span className={financeModuleFilterLabelClass()}>Pagamento até</span>
              <input
                type="date"
                className={financeModuleFilterFieldClass()}
                value={drilldown.paymentDateTo}
                onChange={(e) => patchDrilldown({ paymentDateTo: e.target.value })}
              />
            </label>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando títulos do centro…
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : list && list.totalItems === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center rounded-lg border border-dashed border-border">
              Nenhum título encontrado para este centro com os filtros atuais.
            </p>
          ) : list ? (
            <FinanceCostCenterGridTableShell
              tableClassName="min-w-[1400px]"
              head={
                <tr>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">AP</th>
                  <FinanceCostCenterSortableTh
                    label="Empresa"
                    sortKey="company"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <FinanceCostCenterSortableTh
                    label="Fornecedor"
                    sortKey="supplier"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">CNPJ</th>
                  <FinanceCostCenterSortableTh
                    label="Classificação"
                    sortKey="classification"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Descrição</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Documento</th>
                  <FinanceCostCenterSortableTh
                    label="Vencimento"
                    sortKey="dueDate"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <FinanceCostCenterSortableTh
                    label="Competência"
                    sortKey="competenceDate"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Pagamento</th>
                  <FinanceCostCenterSortableTh
                    label="Status"
                    sortKey="status"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <FinanceCostCenterSortableTh
                    label="Valor"
                    sortKey="amountPayable"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                    align="right"
                  />
                  <FinanceCostCenterSortableTh
                    label="Saldo"
                    sortKey="balancePayable"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                    align="right"
                  />
                  <FinanceCostCenterSortableTh
                    label="Alocado"
                    sortKey="allocatedAmount"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                    align="right"
                  />
                  <th className="px-3 py-2 text-right text-[10px] font-bold uppercase text-muted-foreground">%</th>
                  <FinanceCostCenterSortableTh
                    label="Fonte"
                    sortKey="source"
                    sort={{ key: drilldown.sortBy, direction: drilldown.sortDirection }}
                    onSort={handleSort}
                  />
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Regra</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Motivo</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Locked</th>
                  <th className="px-3 py-2 text-left text-[10px] font-bold uppercase text-muted-foreground">Notas</th>
                </tr>
              }
              footer={
                <div className="space-y-2 border-t border-border px-3 py-2">
                  {list ? (
                    <p className="text-xs text-muted-foreground">
                      {formatFinanceInteger(list.totalItems)} registro(s) · Total alocado filtrado:{" "}
                      <span className="font-semibold text-foreground">
                        {formatFinanceCurrency(list.totals.allocatedAmount)}
                      </span>
                      {summary &&
                      Math.abs(summary.totalAllocatedAmount - list.totals.allocatedAmount) > 0.009 ? (
                        <span className="text-amber-700"> · divergência cabeçalho</span>
                      ) : null}
                    </p>
                  ) : null}
                  <FinanceCostCenterGridPagination
                    page={list.page}
                    totalPages={list.totalPages}
                    pageSize={drilldown.pageSize}
                    onPageChange={(page) => patchDrilldown({ page })}
                    onPageSizeChange={(pageSize) => patchDrilldown({ pageSize, page: 1 })}
                  />
                </div>
              }
            >
              {list.items.map((row: CostCenterDetailAllocationRow) => (
                <tr key={row.allocationId} className="border-t border-border text-xs">
                  <td className="px-3 py-2 tabular-nums font-semibold">{row.accountsPayableId}</td>
                  <td className="px-3 py-2 max-w-[120px] truncate">{displayFinanceText(row.companyName)}</td>
                  <td className="px-3 py-2 max-w-[140px] truncate">
                    {displayFinanceText(row.personName ?? row.supplierName)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.personCnpj)}</td>
                  <td className="px-3 py-2">{displayFinanceText(row.nomusClassification)}</td>
                  <td className="px-3 py-2 max-w-[160px] truncate">{displayFinanceText(row.description)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{displayFinanceText(row.documentNumber)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.dueDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatFinanceDate(row.competenceDate)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {formatFinanceDate(row.paymentDate ?? row.settlementDate)}
                  </td>
                  <td className="px-3 py-2">{displayFinanceText(row.statusLabel)}</td>
                  <td className="px-3 py-2 text-right font-medium">{formatFinanceCurrency(row.amountPayable)}</td>
                  <td className="px-3 py-2 text-right">{formatFinanceCurrency(row.balancePayable)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatFinanceCurrency(row.allocatedAmount)}</td>
                  <td className="px-3 py-2 text-right">{row.allocatedPercentage}%</td>
                  <td className="px-3 py-2">{sourceBadge(row.allocationSource)}</td>
                  <td className="px-3 py-2 max-w-[160px] truncate" title={row.allocationRuleName ?? undefined}>
                    <p>{displayFinanceText(row.allocationRuleSourceLabel ?? row.allocationRuleType)}</p>
                    <p className="text-[10px] text-muted-foreground">{displayFinanceText(row.allocationRuleName)}</p>
                  </td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={row.allocationRuleReason ?? undefined}>
                    {displayFinanceText(row.allocationRuleReason)}
                  </td>
                  <td className="px-3 py-2">{row.lockedManual ? "Sim" : "—"}</td>
                  <td className="px-3 py-2 max-w-[180px] truncate" title={row.allocationNotes ?? undefined}>
                    {displayFinanceText(row.allocationNotes)}
                  </td>
                </tr>
              ))}
            </FinanceCostCenterGridTableShell>
          ) : null}

          {list && list.totalItems > 0 ? (
            <p className="text-[11px] text-muted-foreground" data-testid="finance-cc-expense-map-totals">
              {formatFinanceInteger(list.totalItems)} registro(s) filtrado(s) · Total alocado:{" "}
              <span className="font-semibold text-foreground">
                {formatFinanceCurrency(list.totals.allocatedAmount)}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
    </>
  );
}
