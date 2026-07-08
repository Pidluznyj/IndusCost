import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Download, Info, Loader2, Search } from "lucide-react";
import { FinanceExecutiveTotalizerCard } from "@/src/components/finance/shared/FinanceExecutiveTotalizerCard";
import { SYSTEM_TOTALIZER_GRID_CLASS } from "@/src/components/ui/SystemTotalizerCard";
import {
  MaterialUsageAuditDrawer,
  MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP,
} from "@/src/components/contextual/MaterialUsageAuditDrawer";
import {
  MaterialDemandCalculationExplainerPanel,
  MaterialDemandIntelligenceDrilldownDrawer,
  type IntelligenceDrilldownTarget,
} from "@/src/components/contextual/MaterialDemandIntelligenceDrilldownDrawer";
import {
  MaterialDemandIntelligenceAuditPanel,
  MaterialDemandIntelligenceEmptyState,
  MaterialDemandIntelligenceMaterialsTable,
  MaterialDemandIntelligenceOrdersTable,
  MaterialDemandIntelligenceReviewTable,
  MaterialDemandIntelligenceUnservedTable,
  MaterialDemandInterpretationBlock,
} from "@/src/components/contextual/MaterialDemandIntelligenceSections";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_USAGE_VARIANCE_STATUS_LABELS,
  PLANNED_REALIZED_COMPARISON_INTRO,
  PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  type MaterialUsagePlannedRealizedRow,
} from "@/src/lib/materialDemandPlannedRealized";
import { MATERIAL_USAGE_AUDIT_BUTTON_LABEL } from "@/src/lib/materialDemandPlannedRealizedAuditCopy";
import type {
  MaterialUsagePlannedRealizedDataQuality,
  MaterialUsagePlannedRealizedSummary,
} from "@/src/lib/materialDemandPlannedRealizedTypes";
import { materialDemandUiFiltersToQueryParams, type MaterialDemandUiFilters } from "@/src/lib/materialDemandFilters";
import { hasIntelligenceDisplayData } from "@/src/lib/materialDemandIntelligenceDrilldown";
import {
  buildIntelligenceMaterialsCsv,
  buildIntelligenceOrdersCsv,
  buildIntelligenceReviewCsv,
  buildIntelligenceUnservedCsv,
  downloadIntelligenceCsv,
  intelligenceExportFilename,
} from "@/src/lib/materialDemandIntelligenceExport";
import {
  appendIntelligenceQueryParams,
  DEFAULT_MATERIAL_DEMAND_INTELLIGENCE_UI_FILTERS,
  filterIntelligenceView,
  formatConfidenceLabel,
  MATERIAL_DEMAND_INTELLIGENCE_SUBTITLE,
  safeDisplayNumber,
  type MaterialDemandIntelligenceUiFilters,
} from "@/src/lib/materialDemandIntelligenceUi";
import { RAW_MATERIAL_DEMAND_STATUS_LABELS, type RawMaterialDemandStatus } from "@/src/lib/salesOrderRawMaterialEstimation";
import type { RawMaterialIntelligenceBlock } from "@/src/lib/salesOrderRawMaterialIntelligenceTypes";
import { cn, formatNumberAdaptive } from "@/src/lib/utils";
import { ExecutiveSummarySection } from "@/src/components/ui/ExecutiveSummarySection";
import { SummaryKpiGrid } from "@/src/components/ui/SummaryKpiGrid";

type PlannedRealizedResponse = {
  summary: MaterialUsagePlannedRealizedSummary;
  rows: MaterialUsagePlannedRealizedRow[];
  dataQuality: MaterialUsagePlannedRealizedDataQuality;
  intelligence?: RawMaterialIntelligenceBlock;
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${formatNumberAdaptive(v)}%`;
}

function qty(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function statusBadgeClass(status: MaterialUsagePlannedRealizedRow["status"]): string {
  switch (status) {
    case "within_planned":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300";
    case "below_planned":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200";
    case "above_planned":
      return "bg-sky-100 text-sky-900 dark:bg-sky-950/40 dark:text-sky-200";
    case "no_realized":
      return "bg-muted text-muted-foreground";
    case "no_planned_base":
      return "bg-violet-100 text-violet-900 dark:bg-violet-950/40 dark:text-violet-200";
    default:
      return "bg-orange-100 text-orange-900 dark:bg-orange-950/40 dark:text-orange-200";
  }
}

const ESTIMATION_STATUS_OPTIONS: Array<{ value: RawMaterialDemandStatus | "ALL"; label: string }> = [
  { value: "ALL", label: "Todos os status" },
  { value: "OPEN_WITHIN_CYCLE", label: RAW_MATERIAL_DEMAND_STATUS_LABELS.OPEN_WITHIN_CYCLE },
  { value: "OPEN_OVERDUE_WITHOUT_INVOICE", label: RAW_MATERIAL_DEMAND_STATUS_LABELS.OPEN_OVERDUE_WITHOUT_INVOICE },
  {
    value: "PARTIALLY_INVOICED_LIVE_BALANCE",
    label: RAW_MATERIAL_DEMAND_STATUS_LABELS.PARTIALLY_INVOICED_LIVE_BALANCE,
  },
  {
    value: "PARTIALLY_INVOICED_STALE_BALANCE",
    label: RAW_MATERIAL_DEMAND_STATUS_LABELS.PARTIALLY_INVOICED_STALE_BALANCE,
  },
  {
    value: "CRITICAL_UNSERVED_BALANCE_30D",
    label: RAW_MATERIAL_DEMAND_STATUS_LABELS.CRITICAL_UNSERVED_BALANCE_30D,
  },
  { value: "MISSING_BOM", label: RAW_MATERIAL_DEMAND_STATUS_LABELS.MISSING_BOM },
  { value: "REVIEW_DATA", label: RAW_MATERIAL_DEMAND_STATUS_LABELS.REVIEW_DATA },
  { value: "FULLY_INVOICED", label: RAW_MATERIAL_DEMAND_STATUS_LABELS.FULLY_INVOICED },
];

function DataQualityPanel({ dataQuality }: { dataQuality: MaterialUsagePlannedRealizedDataQuality }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left text-sm font-semibold text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" aria-hidden />
          Qualidade dos dados e limitações
        </span>
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            {dataQuality.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            {dataQuality.partialInvoiceFallbacks > 0 ? (
              <p>Fallback faturamento parcial: {dataQuality.partialInvoiceFallbacks} item(ns)</p>
            ) : null}
            {dataQuality.missingBomItems > 0 ? (
              <p>Itens sem BOM: {dataQuality.missingBomItems}</p>
            ) : null}
            {dataQuality.missingCosts > 0 ? (
              <p>Custos ausentes: {dataQuality.missingCosts}</p>
            ) : null}
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs">
            {dataQuality.sources.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function IntelligenceFiltersBar({
  filters,
  reviewOnly,
  onChange,
  onReviewOnlyChange,
}: {
  filters: MaterialDemandIntelligenceUiFilters;
  reviewOnly: boolean;
  onChange: (next: MaterialDemandIntelligenceUiFilters) => void;
  onReviewOnlyChange: (value: boolean) => void;
}) {
  return (
    <div
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
      data-testid="material-intelligence-filters"
    >
      <label className="text-sm space-y-1">
        <span className="font-medium text-foreground">Modo de cálculo</span>
        <select
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          value={filters.calculationMode}
          onChange={(e) =>
            onChange({
              ...filters,
              calculationMode: e.target.value === "conservative" ? "conservative" : "recommended",
            })
          }
        >
          <option value="recommended">Recomendado</option>
          <option value="conservative">Conservador</option>
        </select>
      </label>
      <label className="text-sm space-y-1">
        <span className="font-medium text-foreground">Status da estimativa</span>
        <select
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm"
          value={filters.estimationStatus}
          disabled={filters.criticalOnly}
          onChange={(e) =>
            onChange({
              ...filters,
              estimationStatus: e.target.value as RawMaterialDemandStatus | "ALL",
            })
          }
        >
          {ESTIMATION_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm pt-6">
        <input
          type="checkbox"
          checked={filters.criticalOnly}
          onChange={(e) =>
            onChange({
              ...filters,
              criticalOnly: e.target.checked,
              reviewOnly: e.target.checked ? false : filters.reviewOnly,
            })
          }
        />
        Somente saldos críticos (&gt;30 dias)
      </label>
      <label className="flex items-center gap-2 text-sm pt-6">
        <input
          type="checkbox"
          checked={reviewOnly}
          onChange={(e) => onReviewOnlyChange(e.target.checked)}
        />
        Somente itens em revisão
      </label>
    </div>
  );
}

export function MaterialDemandPlannedRealizedPanel({
  apiBase,
  appliedFilters,
  filterKey,
  retryNonce,
  enableIntelligence = false,
}: {
  apiBase: string;
  appliedFilters: MaterialDemandUiFilters;
  filterKey: string;
  retryNonce: number;
  enableIntelligence?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlannedRealizedResponse | null>(null);
  const [auditMaterialId, setAuditMaterialId] = useState<string | null>(null);
  const [auditPreviewRow, setAuditPreviewRow] = useState<MaterialUsagePlannedRealizedRow | null>(null);
  const [intelligenceFilters, setIntelligenceFilters] = useState<MaterialDemandIntelligenceUiFilters>(
    DEFAULT_MATERIAL_DEMAND_INTELLIGENCE_UI_FILTERS
  );
  const [reviewOnlyFilter, setReviewOnlyFilter] = useState(false);
  const [showLegacyTable, setShowLegacyTable] = useState(false);
  const [drilldownTarget, setDrilldownTarget] = useState<IntelligenceDrilldownTarget | null>(null);

  const openMaterialDrilldown = useCallback((materialId: string) => {
    setDrilldownTarget({ kind: "material", materialId });
  }, []);

  const openOrderDrilldown = useCallback((orderId: string) => {
    setDrilldownTarget({ kind: "order", orderId });
  }, []);

  const closeDrilldown = useCallback(() => {
    setDrilldownTarget(null);
  }, []);

  const openAudit = useCallback((row: MaterialUsagePlannedRealizedRow) => {
    setAuditPreviewRow(row);
    setAuditMaterialId(row.materialId);
  }, []);

  const closeAudit = useCallback(() => {
    setAuditMaterialId(null);
    setAuditPreviewRow(null);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const baseQs = materialDemandUiFiltersToQueryParams(appliedFilters);
      const qs = enableIntelligence
        ? appendIntelligenceQueryParams(baseQs, {
            ...intelligenceFilters,
            reviewOnly: false,
          }).toString()
        : baseQs.toString();
      const res = await fetchJsonOk<PlannedRealizedResponse>(
        `${apiBase}/planned-vs-realized?${qs}`,
        { signal }
      );
      setData(res);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError("Não foi possível carregar a estimativa de matéria-prima.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, appliedFilters, enableIntelligence, intelligenceFilters]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, filterKey, retryNonce]);

  const summary = data?.summary;
  const rows = data?.rows ?? [];
  const intelligence = data?.intelligence;
  const showIntelligence = enableIntelligence && intelligence != null;

  const filteredIntelligence = useMemo(() => {
    if (!intelligence) return null;
    return filterIntelligenceView(intelligence, {
      ...intelligenceFilters,
      reviewOnly: reviewOnlyFilter,
    });
  }, [intelligence, intelligenceFilters, reviewOnlyFilter]);

  const intelligenceSummary = intelligence?.summary;

  const intelligenceHasDisplayData = useMemo(() => {
    if (!filteredIntelligence) return false;
    return hasIntelligenceDisplayData({
      ...intelligence!,
      materials: filteredIntelligence.materials,
      orders: filteredIntelligence.orders,
      unservedBalances: filteredIntelligence.unservedBalances,
      reviewItems: filteredIntelligence.reviewItems,
    });
  }, [filteredIntelligence, intelligence]);

  const handleExportIntelligence = useCallback(
    (kind: "materials" | "orders" | "unserved" | "review") => {
      if (!intelligence) return;
      const view = filteredIntelligence
        ? {
            ...intelligence,
            materials: filteredIntelligence.materials,
            orders: filteredIntelligence.orders,
            unservedBalances: filteredIntelligence.unservedBalances,
            reviewItems: filteredIntelligence.reviewItems,
            detailLines: intelligence.detailLines.filter((line) => {
              if (filteredIntelligence.orders.length === 0) return true;
              return filteredIntelligence.orders.some(
                (o) => o.orderId === line.orderId && o.productCode === line.productCode
              );
            }),
          }
        : intelligence;

      const builders = {
        materials: () => buildIntelligenceMaterialsCsv(view),
        orders: () => buildIntelligenceOrdersCsv(view),
        unserved: () => buildIntelligenceUnservedCsv(view),
        review: () => buildIntelligenceReviewCsv(view),
      };
      const prefixes = {
        materials: "estimativa-mp-materiais",
        orders: "estimativa-mp-pedidos",
        unserved: "estimativa-mp-saldos-antigos",
        review: "estimativa-mp-revisao",
      };
      downloadIntelligenceCsv(intelligenceExportFilename(prefixes[kind]), builders[kind]());
    },
    [intelligence, filteredIntelligence]
  );

  const quantityLabel = useMemo(() => {
    if (!summary) return "Quantidade";
    if (!summary.quantityTotalsComparable) return "Quantidade (várias unidades)";
    return summary.activeUnitLabel ? `Quantidade (${summary.activeUnitLabel})` : "Quantidade";
  }, [summary]);

  return (
    <div className="space-y-6" data-testid="material-demand-planned-realized-panel">
      <div className="space-y-1">
        {showIntelligence ? (
          <p className="text-sm text-muted-foreground" data-testid="material-intelligence-subtitle">
            {MATERIAL_DEMAND_INTELLIGENCE_SUBTITLE}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{PLANNED_REALIZED_COMPARISON_INTRO}</p>
            <p className="text-xs text-muted-foreground">{PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE}</p>
          </>
        )}
      </div>

      {showIntelligence ? (
        <IntelligenceFiltersBar
          filters={intelligenceFilters}
          reviewOnly={reviewOnlyFilter}
          onChange={setIntelligenceFilters}
          onReviewOnlyChange={setReviewOnlyFilter}
        />
      ) : null}

      {loading && !data ? (
        <div
          className="flex items-center gap-2 text-sm text-muted-foreground py-8"
          data-testid="material-intelligence-loading"
        >
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando estimativa de matéria-prima…
        </div>
      ) : null}

      {error ? (
        <div
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          data-testid="material-intelligence-error"
        >
          {error}
        </div>
      ) : null}

      {showIntelligence && intelligenceSummary ? (
        <ExecutiveSummarySection
          title="Resumo da inteligência de matéria-prima"
          eyebrow="Demanda · estimativa recomendada"
          testId="material-intelligence-kpi-grid"
        >
          <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <FinanceExecutiveTotalizerCard
            label="Necessidade recomendada"
            amount={safeDisplayNumber(intelligenceSummary.recommendedDemandValue)}
            amountFormat="currency"
            value={money(intelligenceSummary.recommendedDemandValue)}
            hint={`${qty(intelligenceSummary.recommendedDemandQuantity)} em quantidade`}
          />
          <FinanceExecutiveTotalizerCard
            label="Necessidade conservadora"
            amount={safeDisplayNumber(intelligenceSummary.conservativeDemandValue)}
            amountFormat="currency"
            value={money(intelligenceSummary.conservativeDemandValue)}
          />
          <FinanceExecutiveTotalizerCard
            label="Diferença por incerteza"
            amount={safeDisplayNumber(intelligenceSummary.uncertaintyDemandValue)}
            amountFormat="currency"
            value={money(intelligenceSummary.uncertaintyDemandValue)}
          />
          <FinanceExecutiveTotalizerCard
            label="Itens em revisão"
            value={String(safeDisplayNumber(intelligenceSummary.reviewItemsCount))}
          />
          <FinanceExecutiveTotalizerCard
            label="Saldo crítico > 30 dias"
            amount={safeDisplayNumber(intelligenceSummary.criticalUnservedBalanceAmount)}
            amountFormat="currency"
            value={money(intelligenceSummary.criticalUnservedBalanceAmount)}
          />
          <FinanceExecutiveTotalizerCard
            label="Potencial não realizado"
            amount={safeDisplayNumber(intelligenceSummary.unservedRevenuePotential)}
            amountFormat="currency"
            value={money(intelligenceSummary.unservedRevenuePotential)}
          />
          <FinanceExecutiveTotalizerCard
            label="Itens sem BOM"
            value={String(safeDisplayNumber(intelligenceSummary.missingBomCount))}
          />
          <FinanceExecutiveTotalizerCard
            label="Confiabilidade"
            value={formatConfidenceLabel(intelligenceSummary.confidence)}
          />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      {showIntelligence && filteredIntelligence ? (
        <>
          <div
            className="flex flex-wrap items-center gap-2"
            data-testid="material-intelligence-export-bar"
          >
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Exportar CSV
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              data-testid="material-intelligence-export-materials"
              onClick={() => handleExportIntelligence("materials")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Matérias-primas
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              data-testid="material-intelligence-export-orders"
              onClick={() => handleExportIntelligence("orders")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Pedidos
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              data-testid="material-intelligence-export-unserved"
              onClick={() => handleExportIntelligence("unserved")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Saldos antigos
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
              data-testid="material-intelligence-export-review"
              onClick={() => handleExportIntelligence("review")}
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Revisão
            </button>
          </div>

          <MaterialDemandCalculationExplainerPanel />
          <MaterialDemandInterpretationBlock />

          {!intelligenceHasDisplayData ? (
            <MaterialDemandIntelligenceEmptyState summary={intelligence?.summary} />
          ) : (
            <>
              <MaterialDemandIntelligenceMaterialsTable
                rows={filteredIntelligence.materials}
                onMaterialClick={openMaterialDrilldown}
              />
              <MaterialDemandIntelligenceOrdersTable
                rows={filteredIntelligence.orders}
                onOrderClick={openOrderDrilldown}
              />
              <MaterialDemandIntelligenceUnservedTable rows={filteredIntelligence.unservedBalances} />
              <MaterialDemandIntelligenceReviewTable rows={filteredIntelligence.reviewItems} />
            </>
          )}
          <MaterialDemandIntelligenceAuditPanel audit={intelligence!.audit} summary={intelligence!.summary} />
        </>
      ) : null}

      {showIntelligence && !loading && data && !intelligence ? (
        <div
          className="rounded-xl border border-border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground"
          data-testid="material-intelligence-empty"
        >
          Nenhum dado de estimativa disponível para os filtros aplicados.
        </div>
      ) : null}

      {showIntelligence ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowLegacyTable((v) => !v)}
            className="text-sm font-semibold text-primary hover:underline"
          >
            {showLegacyTable ? "Ocultar" : "Mostrar"} comparativo previsto × faturado (referência)
          </button>
        </div>
      ) : null}

      {(!showIntelligence || showLegacyTable) && summary ? (
        <ExecutiveSummarySection
          title="Comparativo previsto × faturado"
          eyebrow="Referência legada · matérias-primas"
        >
          <SummaryKpiGrid minColumnWidth={180} className={SYSTEM_TOTALIZER_GRID_CLASS}>
          <FinanceExecutiveTotalizerCard label="Matérias-primas analisadas" value={String(summary.materialsCount)} />
          <FinanceExecutiveTotalizerCard
            label={`${quantityLabel} prevista total`}
            amount={summary.quantityTotalsComparable ? summary.plannedQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.plannedQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceExecutiveTotalizerCard
            label={`${quantityLabel} realizada total`}
            amount={summary.quantityTotalsComparable ? summary.realizedQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.realizedQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceExecutiveTotalizerCard
            label="Saldo a realizar"
            amount={summary.quantityTotalsComparable ? summary.remainingQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.remainingQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceExecutiveTotalizerCard
            label="Assertividade média"
            amount={summary.accuracyPercent}
            amountFormat="percent"
            value={pct(summary.accuracyPercent)}
            hint="Soma realizada ÷ soma prevista (mesma unidade no filtro)."
          />
          <FinanceExecutiveTotalizerCard
            label="Custo previsto"
            amount={summary.plannedCostTotal}
            amountFormat="currency"
            value={money(summary.plannedCostTotal)}
          />
          <FinanceExecutiveTotalizerCard
            label="Custo realizado"
            amount={summary.realizedCostTotal}
            amountFormat="currency"
            value={money(summary.realizedCostTotal)}
          />
          <FinanceExecutiveTotalizerCard
            label="Diferença em R$"
            amount={summary.costVarianceTotal}
            amountFormat="currency"
            value={money(summary.costVarianceTotal)}
          />
          </SummaryKpiGrid>
        </ExecutiveSummarySection>
      ) : null}

      {(!showIntelligence || showLegacyTable) && data?.dataQuality ? (
        <DataQualityPanel dataQuality={data.dataQuality} />
      ) : null}

      {(!showIntelligence || showLegacyTable) ? (
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Assertividade por matéria-prima</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Clique em Saldo, Dif. R$ ou Auditar para abrir a auditoria comparativa previsto × faturado.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2">Código</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2">Unidade</th>
                  <th className="px-3 py-2 text-right">Previsto</th>
                  <th className="px-3 py-2 text-right">Realizado</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  <th className="px-3 py-2 text-right">Assertividade</th>
                  <th className="px-3 py-2 text-right">Custo unit.</th>
                  <th className="px-3 py-2 text-right">Custo prev.</th>
                  <th className="px-3 py-2 text-right">Custo real.</th>
                  <th className="px-3 py-2 text-right">Dif. R$</th>
                  <th className="px-3 py-2 text-right">Ped. prev.</th>
                  <th className="px-3 py-2 text-right">Ped. fat.</th>
                  <th className="px-3 py-2 text-right">Ped. não fat.</th>
                  <th className="px-3 py-2 text-right">% faturado</th>
                  <th className="px-3 py-2 text-right">Produtos</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={17} className="px-4 py-10 text-center text-muted-foreground">
                      Nenhuma matéria-prima encontrada para os filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr
                      key={row.materialId}
                      data-testid={`material-planned-realized-row-${row.materialId}`}
                      className="border-b border-border/70 cursor-pointer hover:bg-accent/40 transition-colors"
                      onClick={() => openAudit(row)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{row.materialCode ?? "—"}</td>
                      <td className="px-3 py-2 max-w-[200px] truncate" title={row.materialName}>
                        {row.materialName}
                      </td>
                      <td className="px-3 py-2">{row.unitLabel}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.plannedQuantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{qty(row.realizedQuantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <button
                          type="button"
                          className="hover:text-primary hover:underline font-medium"
                          title={MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP}
                          data-testid="material-usage-audit-balance-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAudit(row);
                          }}
                        >
                          {qty(row.remainingQuantity)}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(row.accuracyPercent)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.unitCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.plannedCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(row.realizedCost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            className="text-foreground hover:text-primary hover:underline font-medium"
                            title={MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP}
                            data-testid="material-usage-audit-cost-diff-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAudit(row);
                            }}
                          >
                            {money(row.costVariance)}
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-accent"
                            title={MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP}
                            data-testid="material-usage-audit-button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openAudit(row);
                            }}
                          >
                            <Search className="h-3 w-3" aria-hidden />
                            {MATERIAL_USAGE_AUDIT_BUTTON_LABEL}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.plannedOrdersCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.realizedOrdersCount}</td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        data-testid="material-planned-realized-not-invoiced-count"
                      >
                        {row.notInvoicedOrdersCount}
                      </td>
                      <td
                        className="px-3 py-2 text-right tabular-nums"
                        data-testid="material-planned-realized-invoiced-percent"
                      >
                        {pct(row.invoicedPercent)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.relatedProductsCount}</td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                            statusBadgeClass(row.status)
                          )}
                        >
                          {MATERIAL_USAGE_VARIANCE_STATUS_LABELS[row.status]}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <MaterialUsageAuditDrawer
        open={auditMaterialId != null}
        onClose={closeAudit}
        apiBase={apiBase}
        materialId={auditMaterialId}
        previewRow={auditPreviewRow}
        filters={appliedFilters}
      />

      <MaterialDemandIntelligenceDrilldownDrawer
        open={drilldownTarget != null}
        target={drilldownTarget}
        intelligence={intelligence ?? null}
        onClose={closeDrilldown}
      />
    </div>
  );
}
