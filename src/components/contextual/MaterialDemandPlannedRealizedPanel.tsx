import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2, Search } from "lucide-react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import {
  MaterialUsageAuditDrawer,
  MATERIAL_USAGE_AUDIT_BUTTON_TOOLTIP,
} from "@/src/components/contextual/MaterialUsageAuditDrawer";
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
import { cn, formatNumberAdaptive } from "@/src/lib/utils";
import "@/src/styles/indus-kpi-grid.css";

type PlannedRealizedResponse = {
  summary: MaterialUsagePlannedRealizedSummary;
  rows: MaterialUsagePlannedRealizedRow[];
  dataQuality: MaterialUsagePlannedRealizedDataQuality;
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

export function MaterialDemandPlannedRealizedPanel({
  apiBase,
  appliedFilters,
  filterKey,
  retryNonce,
}: {
  apiBase: string;
  appliedFilters: MaterialDemandUiFilters;
  filterKey: string;
  retryNonce: number;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PlannedRealizedResponse | null>(null);
  const [auditMaterialId, setAuditMaterialId] = useState<string | null>(null);
  const [auditPreviewRow, setAuditPreviewRow] = useState<MaterialUsagePlannedRealizedRow | null>(null);

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
      const qs = materialDemandUiFiltersToQueryParams(appliedFilters).toString();
      const res = await fetchJsonOk<PlannedRealizedResponse>(
        `${apiBase}/planned-vs-realized?${qs}`,
        { signal }
      );
      setData(res);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setError("Não foi possível carregar previsto x realizado.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [apiBase, appliedFilters]);

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load, filterKey, retryNonce]);

  const summary = data?.summary;
  const rows = data?.rows ?? [];

  const quantityLabel = useMemo(() => {
    if (!summary) return "Quantidade";
    if (!summary.quantityTotalsComparable) return "Quantidade (várias unidades)";
    return summary.activeUnitLabel ? `Quantidade (${summary.activeUnitLabel})` : "Quantidade";
  }, [summary]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{PLANNED_REALIZED_COMPARISON_INTRO}</p>
        <p className="text-xs text-muted-foreground">{PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE}</p>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando previsto x realizado…
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {summary ? (
        <div className="indus-kpi-grid indus-kpi-grid--wide">
          <FinanceBiKpiCard label="Matérias-primas analisadas" value={String(summary.materialsCount)} />
          <FinanceBiKpiCard
            label={`${quantityLabel} prevista total`}
            amount={summary.quantityTotalsComparable ? summary.plannedQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.plannedQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceBiKpiCard
            label={`${quantityLabel} realizada total`}
            amount={summary.quantityTotalsComparable ? summary.realizedQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.realizedQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceBiKpiCard
            label="Saldo a realizar"
            amount={summary.quantityTotalsComparable ? summary.remainingQuantityTotal : null}
            amountFormat="number"
            value={
              summary.quantityTotalsComparable ? qty(summary.remainingQuantityTotal) : "Várias unidades"
            }
          />
          <FinanceBiKpiCard
            label="Assertividade média"
            amount={summary.accuracyPercent}
            amountFormat="percent"
            value={pct(summary.accuracyPercent)}
            hint="Soma realizada ÷ soma prevista (mesma unidade no filtro)."
          />
          <FinanceBiKpiCard
            label="Custo previsto"
            amount={summary.plannedCostTotal}
            amountFormat="currency"
            value={money(summary.plannedCostTotal)}
          />
          <FinanceBiKpiCard
            label="Custo realizado"
            amount={summary.realizedCostTotal}
            amountFormat="currency"
            value={money(summary.realizedCostTotal)}
          />
          <FinanceBiKpiCard
            label="Diferença em R$"
            amount={summary.costVarianceTotal}
            amountFormat="currency"
            value={money(summary.costVarianceTotal)}
          />
        </div>
      ) : null}

      {data?.dataQuality ? <DataQualityPanel dataQuality={data.dataQuality} /> : null}

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

      <MaterialUsageAuditDrawer
        open={auditMaterialId != null}
        onClose={closeAudit}
        apiBase={apiBase}
        materialId={auditMaterialId}
        previewRow={auditPreviewRow}
        filters={appliedFilters}
      />
    </div>
  );
}
