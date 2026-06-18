import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Loader2 } from "lucide-react";
import { FinanceBiKpiCard } from "@/src/components/finance/bi/FinanceBiKpiCard";
import { fetchJsonOk } from "@/src/lib/http";
import {
  MATERIAL_USAGE_VARIANCE_STATUS_LABELS,
  PLANNED_REALIZED_COMPARISON_INTRO,
  PLANNED_REALIZED_FISCAL_VS_PRODUCTION_NOTE,
  type MaterialUsagePlannedRealizedRow,
} from "@/src/lib/materialDemandPlannedRealized";
import type {
  MaterialPlannedRealizedDetailResponse,
  MaterialUsagePlannedRealizedDataQuality,
  MaterialUsagePlannedRealizedSummary,
} from "@/src/lib/materialDemandPlannedRealizedTypes";
import { materialDemandUiFiltersToQueryParams, type MaterialDemandUiFilters } from "@/src/lib/materialDemandFilters";
import { formatDatePtBr } from "@/src/components/contextual/materialDemandDashboardUi";
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

function MaterialPlannedRealizedDrillDown({
  apiBase,
  materialId,
  filters,
  onClose,
}: {
  apiBase: string;
  materialId: string;
  filters: MaterialDemandUiFilters;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<MaterialPlannedRealizedDetailResponse | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    const qs = materialDemandUiFiltersToQueryParams(filters).toString();
    fetchJsonOk<{ detail: MaterialPlannedRealizedDetailResponse }>(
      `${apiBase}/planned-vs-realized/materials/${encodeURIComponent(materialId)}/details?${qs}`,
      { signal: ac.signal }
    )
      .then((res) => setDetail(res.detail))
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError("Não foi possível carregar os detalhes.");
      })
      .finally(() => setLoading(false));
    return () => ac.abort();
  }, [apiBase, materialId, filters]);

  return (
    <div className="rounded-xl border border-primary/30 bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Detalhe da matéria-prima</p>
          {detail ? (
            <p className="text-xs text-muted-foreground mt-1">
              {detail.materialCode ? `[${detail.materialCode}] ` : ""}
              {detail.materialName} · {detail.unitLabel}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-medium text-primary hover:underline shrink-0"
        >
          Fechar
        </button>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Carregando detalhes…
        </div>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {detail ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Produtos</h4>
            <ul className="space-y-2 text-sm">
              {detail.products.map((p) => (
                <li key={p.productId} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium">
                    {p.productSku ? `[${p.productSku}] ` : ""}
                    {p.productName ?? "Produto"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Previsto: {qty(p.plannedQuantity)} · Realizado: {qty(p.realizedQuantity)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pedidos (previsão)
            </h4>
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {detail.plannedOrders.map((o) => (
                <li key={o.salesOrderId} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium">{o.orderCode}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDatePtBr(o.issueDate)} · Previsto: {qty(o.plannedQuantity)}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Pedidos faturados
            </h4>
            <ul className="space-y-2 text-sm max-h-64 overflow-y-auto">
              {detail.realizedOrders.length === 0 ? (
                <li className="text-xs text-muted-foreground">Nenhum pedido faturado no filtro.</li>
              ) : (
                detail.realizedOrders.map((o) => (
                  <li key={o.salesOrderId} className="rounded-lg border border-border px-3 py-2">
                    <p className="font-medium">{o.orderCode}</p>
                    <p className="text-xs text-muted-foreground">
                      Realizado: {qty(o.realizedQuantity)}
                      {o.nfes.length > 0
                        ? ` · NF: ${o.nfes.map((n) => n.numero ?? n.dataProcessamento).join(", ")}`
                        : ""}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </section>
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
  const [expandedMaterialId, setExpandedMaterialId] = useState<string | null>(null);

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
            Clique em uma linha para ver produtos, pedidos previstos e pedidos faturados.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
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
                <th className="px-3 py-2 text-right">Produtos</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={15} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhuma matéria-prima encontrada para os filtros aplicados.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const expanded = expandedMaterialId === row.materialId;
                  return (
                    <React.Fragment key={row.materialId}>
                      <tr
                        className={cn(
                          "border-b border-border/70 cursor-pointer hover:bg-accent/40 transition-colors",
                          expanded && "bg-accent/20"
                        )}
                        onClick={() =>
                          setExpandedMaterialId((cur) => (cur === row.materialId ? null : row.materialId))
                        }
                      >
                        <td className="px-3 py-2 font-mono text-xs">{row.materialCode ?? "—"}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate" title={row.materialName}>
                          {row.materialName}
                        </td>
                        <td className="px-3 py-2">{row.unitLabel}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty(row.plannedQuantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty(row.realizedQuantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{qty(row.remainingQuantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{pct(row.accuracyPercent)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.unitCost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.plannedCost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.realizedCost)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(row.costVariance)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.plannedOrdersCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.realizedOrdersCount}</td>
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
                      {expanded ? (
                        <tr>
                          <td colSpan={15} className="px-3 py-3 bg-muted/20">
                            <MaterialPlannedRealizedDrillDown
                              apiBase={apiBase}
                              materialId={row.materialId}
                              filters={appliedFilters}
                              onClose={() => setExpandedMaterialId(null)}
                            />
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
