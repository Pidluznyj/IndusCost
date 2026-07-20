import React from "react";
import { ChevronDown, Loader2, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  buildFilterSummaryLines,
  buildUsageEstimateTitle,
  formatDatePtBr,
} from "@/src/components/contextual/materialDemandDashboardUi";
import {
  salesOrderStatusLabel,
  type MaterialDemandCoverage,
} from "@/src/lib/materialDemandFilters";
import { cn, formatCurrencyAdaptive, formatNumberAdaptive } from "@/src/lib/utils";
import { ContextualDashboardKpiCard } from "./ContextualDashboardKpiCard";
import { ContextualDashboardKpiGrid } from "./ContextualDashboardKpiGrid";

export type MaterialDemandDateBasis = "issueDate" | "expectedDeliveryDate";

export type MaterialOriginRow = {
  salesOrderId: string;
  orderCode: string;
  orderStatus: string;
  orderDate: string;
  issueDate: string;
  expectedDeliveryDate: string | null;
  customerId: string | null;
  customerName: string | null;
  companyIssuer: string | null;
  productId: string;
  productSku: string | null;
  productName: string | null;
  orderQty: number;
  materialQtyPerUnit: number | null;
  estimatedQuantity: number | null;
  unitCostReference: number | null;
  estimatedValue: number | null;
};

export type MaterialRowPanel = {
  materialId: string;
  code: string | null;
  description: string;
  unit: string | null;
  unitLabel?: string;
  quantityTotal: number;
  unitCostReference: number | null;
  estimatedValueTotal: number;
  orderCount: number;
  productCount: number;
  customerCount?: number;
  latestUsageAt: string | null;
  pctOfTotalQuantity: number | null;
  pctOfTotalValue: number | null;
  leadingProduct?: {
    productId: string;
    sku: string | null;
    name: string;
    value: number;
  } | null;
  leadingCustomer?: {
    customerId: string;
    customerName: string;
    value: number;
  } | null;
};

export type AppliedFiltersPanel = {
  startDate: string;
  endDate: string;
  dateBasis: MaterialDemandDateBasis;
  statuses: string[];
  status: string;
  customerId: string;
  productId: string;
  companyIssuer: string;
  materialId: string;
  unitKey: string;
  includeOrdersWithoutDeliveryDate?: boolean;
};

export type SummaryPanelData = {
  summary: {
    totalEstimatedQuantity: number | null;
    totalEstimatedValue: number;
    uniqueMaterials: number;
    orderCount: number;
    productCount: number;
    customerCount: number;
    hasMixedUnits: boolean;
    quantityTotalsComparable: boolean;
    quantityByUnit: Array<{ unitKey: string; unitLabel: string; totalQuantity: number; materialCount: number }>;
    leaderMaterial: null | {
      code: string | null;
      description: string;
      unitLabel?: string;
    };
    leaderSharePct: number | null;
    ordersWithoutDeliveryDate: number;
  };
  charts: {
    needByDeliveryPeriod: Array<{
      period: string;
      periodLabel: string;
      materialId: string;
      code: string | null;
      description: string;
      unitLabel: string;
      quantity: number;
      estimatedValue: number;
      orderCount: number;
    }>;
    paretoByQuantityByUnit: Array<{ unitKey: string; unitLabel: string; rows: MaterialRowPanel[] }>;
    paretoByValue: MaterialRowPanel[];
    evolution: Array<{
      period: string;
      periodLabel?: string;
      quantity: number | null;
      value: number;
      orderCount: number;
    }>;
  };
  facets: {
    units: Array<{ unitKey: string; unitLabel: string }>;
  };
  filtersApplied?: { dateBasis?: MaterialDemandDateBasis };
};

function money(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatCurrencyAdaptive(v);
}

function num(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return formatNumberAdaptive(v);
}

function pct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${formatNumberAdaptive(v)}%`;
}

function periodLabel(yyyymm: string, labelFromApi?: string): string {
  if (labelFromApi) return labelFromApi;
  if (yyyymm === "__sem_entrega__") return "Sem data de entrega";
  const [yy, mm] = yyyymm.split("-");
  if (!yy || !mm) return yyyymm;
  return `${mm}/${yy}`;
}

function productLabel(sku: string | null | undefined, name: string | null | undefined): string {
  const n = name?.trim() || "Produto";
  return sku?.trim() ? `[${sku.trim()}] ${n}` : n;
}

export function MaterialDemandKpiGrid({
  summaryData,
  appliedFilters,
}: {
  summaryData: SummaryPanelData;
  appliedFilters: AppliedFiltersPanel;
}) {
  return (
    <ContextualDashboardKpiGrid minColumnWidth={160}>
      {summaryData.summary.quantityTotalsComparable ? (
        <ContextualDashboardKpiCard
          label={
            appliedFilters.unitKey
              ? `Quantidade estimada (${summaryData.facets.units.find((u) => u.unitKey === appliedFilters.unitKey)?.unitLabel ?? "unidade"})`
              : "Quantidade estimada (única unidade no filtro)"
          }
          value={num(summaryData.summary.totalEstimatedQuantity)}
        />
      ) : (
        <ContextualDashboardKpiCard
          label="Quantidade estimada"
          value="Várias unidades"
          hint="Quantidades possuem unidades diferentes; compare por unidade ou use valor estimado."
          valueClassName="text-base font-semibold leading-snug sm:text-lg"
        />
      )}
      <ContextualDashboardKpiCard
        label="Valor estimado total de matéria-prima"
        value={money(summaryData.summary.totalEstimatedValue)}
      />
      <ContextualDashboardKpiCard
        label="Matérias-primas impactadas"
        value={String(summaryData.summary.uniqueMaterials)}
      />
      <ContextualDashboardKpiCard
        label="Pedidos considerados"
        value={String(summaryData.summary.orderCount)}
      />
      <ContextualDashboardKpiCard label="Produtos impactados" value={String(summaryData.summary.productCount)} />
      <ContextualDashboardKpiCard label="Clientes impactados" value={String(summaryData.summary.customerCount)} />
      {summaryData.summary.leaderMaterial ? (
        <ContextualDashboardKpiCard
          label="Matéria-prima líder por valor"
          value={`${summaryData.summary.leaderMaterial.code ? `[${summaryData.summary.leaderMaterial.code}] ` : ""}${summaryData.summary.leaderMaterial.description}`}
          hint={
            summaryData.summary.leaderSharePct != null
              ? `${pct(summaryData.summary.leaderSharePct)} do valor total${summaryData.summary.leaderMaterial.unitLabel ? ` · ${summaryData.summary.leaderMaterial.unitLabel}` : ""}`
              : undefined
          }
          valueClassName="text-base font-semibold leading-snug sm:text-lg normal-nums"
        />
      ) : null}
    </ContextualDashboardKpiGrid>
  );
}

/** Cards de totalizadores da aba YTD — foco em valores. */
export function MaterialDemandYtdKpiGrid({
  summaryData,
  appliedFilters,
}: {
  summaryData: SummaryPanelData;
  appliedFilters: AppliedFiltersPanel;
}) {
  const unitLabel = appliedFilters.unitKey
    ? summaryData.facets.units.find((u) => u.unitKey === appliedFilters.unitKey)?.unitLabel
    : null;
  const avgUnitCost =
    summaryData.summary.quantityTotalsComparable &&
    summaryData.summary.totalEstimatedQuantity > 0
      ? summaryData.summary.totalEstimatedValue / summaryData.summary.totalEstimatedQuantity
      : null;

  return (
    <ContextualDashboardKpiGrid minColumnWidth={170}>
      <ContextualDashboardKpiCard
        label="Valor total YTD"
        value={money(summaryData.summary.totalEstimatedValue)}
        hint="Soma do valor estimado de matéria-prima nos pedidos do ano"
      />
      {summaryData.summary.quantityTotalsComparable ? (
        <ContextualDashboardKpiCard
          label={unitLabel ? `Qtde total (${unitLabel})` : "Qtde total"}
          value={num(summaryData.summary.totalEstimatedQuantity)}
        />
      ) : (
        <ContextualDashboardKpiCard
          label="Qtde total"
          value="Várias unidades"
          hint="Filtre por unidade para somar quantidades"
          valueClassName="text-base font-semibold leading-snug sm:text-lg"
        />
      )}
      <ContextualDashboardKpiCard
        label="Valor médio / un."
        value={avgUnitCost == null ? "—" : money(avgUnitCost)}
        hint="Valor total ÷ quantidade (quando unidades são comparáveis)"
      />
      <ContextualDashboardKpiCard
        label="Matérias-primas"
        value={String(summaryData.summary.uniqueMaterials)}
      />
      <ContextualDashboardKpiCard
        label="Pedidos YTD"
        value={String(summaryData.summary.orderCount)}
      />
      <ContextualDashboardKpiCard
        label="Produtos"
        value={String(summaryData.summary.productCount)}
      />
    </ContextualDashboardKpiGrid>
  );
}

/** Grid enxuto YTD: Código, Descrição, Qtde, Valor por quilo, Valor total. */
export function MaterialDemandYtdMaterialsTable({
  rows,
}: {
  rows: MaterialRowPanel[];
}) {
  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted-foreground">
        Nenhuma matéria-prima estimada no YTD para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto" data-testid="material-demand-ytd-table">
      <table className="w-full text-xs">
        <thead className="bg-muted/15 border-b border-border">
          <tr>
            <th className="p-3 text-left font-semibold">Código</th>
            <th className="p-3 text-left font-semibold">Descrição</th>
            <th className="p-3 text-right font-semibold">Qtde</th>
            <th className="p-3 text-right font-semibold">Valor por quilo</th>
            <th className="p-3 text-right font-semibold">Valor total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const unit = row.unit ?? row.unitLabel ?? "";
            return (
              <tr key={row.materialId} className="hover:bg-muted/30">
                <td className="p-3 whitespace-nowrap font-medium">{row.code ?? "—"}</td>
                <td className="p-3 font-semibold break-words">{row.description}</td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">
                  {num(row.quantityTotal)}
                  {unit ? ` ${unit}` : ""}
                </td>
                <td className="p-3 text-right tabular-nums whitespace-nowrap">
                  {row.unitCostReference == null ? "—" : money(row.unitCostReference)}
                </td>
                <td className="p-3 text-right tabular-nums font-semibold whitespace-nowrap">
                  {money(row.estimatedValueTotal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialDemandMixedUnitsBlock({
  summaryData,
  appliedFilters,
  onSelectUnit,
}: {
  summaryData: SummaryPanelData;
  appliedFilters: AppliedFiltersPanel;
  onSelectUnit: (unitKey: string) => void;
}) {
  if (!summaryData.summary.hasMixedUnits || summaryData.summary.quantityByUnit.length === 0) return null;
  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 p-4 space-y-3">
      <p className="text-sm font-semibold text-foreground">Totais de quantidade por unidade de medida</p>
      <p className="text-xs text-muted-foreground">
        Não é possível somar KG com UN. Selecione uma unidade no filtro para comparar quantidades ou use valor
        estimado (R$) para ranking global.
      </p>
      <div className="material-demand-no-print flex flex-wrap gap-2">
        {summaryData.summary.quantityByUnit.map((u) => (
          <button
            key={u.unitKey}
            type="button"
            onClick={() => onSelectUnit(u.unitKey)}
            className={cn(
              "inline-flex flex-col items-start rounded-lg border px-3 py-2 text-left text-xs transition-colors",
              appliedFilters.unitKey === u.unitKey
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:bg-accent"
            )}
          >
            <span className="font-bold text-foreground">{u.unitLabel}</span>
            <span className="tabular-nums text-muted-foreground">
              {num(u.totalQuantity)} · {u.materialCount} MP
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function MaterialDemandCoveragePanel({ coverage }: { coverage: MaterialDemandCoverage }) {
  const skippedTotal =
    coverage.orderItemsSkippedInvalidQty +
    coverage.orderItemsSkippedAnalysisFailure +
    coverage.orderItemsSkippedExplosionError +
    coverage.orderItemsSkippedNoMaterials;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 print:break-inside-avoid">
      <div>
        <h3 className="text-sm font-bold text-foreground">Cobertura da análise</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Quantos pedidos e itens entraram no cálculo e quantos foram ignorados (com motivo).
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-xs">
        <div className="rounded-lg border border-border bg-muted/15 p-3">
          <p className="text-muted-foreground">Pedidos no filtro</p>
          <p className="text-lg font-bold tabular-nums">{coverage.ordersMatched}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/15 p-3">
          <p className="text-muted-foreground">Itens processados</p>
          <p className="text-lg font-bold tabular-nums">{coverage.orderItemsProcessed}</p>
          <p className="text-[10px] text-muted-foreground">de {coverage.orderItemsTotal} itens</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/15 p-3">
          <p className="text-muted-foreground">MPs únicas</p>
          <p className="text-lg font-bold tabular-nums">{coverage.uniqueMaterials}</p>
        </div>
        <div className="rounded-lg border border-border bg-muted/15 p-3">
          <p className="text-muted-foreground">Sem data de entrega</p>
          <p className="text-lg font-bold tabular-nums">{coverage.ordersWithoutDeliveryDate}</p>
        </div>
        {skippedTotal > 0 ? (
          <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 p-3 col-span-2 sm:col-span-3 lg:col-span-4">
            <p className="font-semibold text-foreground mb-2">Itens ignorados ({skippedTotal})</p>
            <ul className="grid sm:grid-cols-2 gap-1 text-muted-foreground">
              {coverage.orderItemsSkippedInvalidQty > 0 ? (
                <li>Quantidade inválida: {coverage.orderItemsSkippedInvalidQty}</li>
              ) : null}
              {coverage.orderItemsSkippedAnalysisFailure > 0 ? (
                <li>Falha na análise de custo: {coverage.orderItemsSkippedAnalysisFailure}</li>
              ) : null}
              {coverage.orderItemsSkippedExplosionError > 0 ? (
                <li>Erro na explosão de MP: {coverage.orderItemsSkippedExplosionError}</li>
              ) : null}
              {coverage.orderItemsSkippedNoMaterials > 0 ? (
                <li>Sem matérias-primas na composição: {coverage.orderItemsSkippedNoMaterials}</li>
              ) : null}
            </ul>
            {coverage.sampleSkipped.length > 0 ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="py-1 pr-2">Pedido</th>
                      <th className="py-1 pr-2">Produto</th>
                      <th className="py-1">Motivo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coverage.sampleSkipped.map((s, i) => (
                      <tr key={`skip-${i}`} className="border-b border-border/50">
                        <td className="py-1 pr-2">{s.orderCode}</td>
                        <td className="py-1 pr-2">{productLabel(s.productSku, s.productName)}</td>
                        <td className="py-1">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export type MaterialDemandFilterChip = {
  id: string;
  label: string;
};

export function MaterialDemandFilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: MaterialDemandFilterChip[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Filtros ativos</span>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onRemove(chip.id)}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2.5 py-1 text-xs hover:bg-accent"
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden />
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        className="text-xs font-medium text-primary hover:underline"
      >
        Limpar todos
      </button>
    </div>
  );
}

export function MaterialDemandTopMaterialsByPeriod({
  rows,
  limit = 10,
}: {
  rows: SummaryPanelData["charts"]["needByDeliveryPeriod"];
  limit?: number;
}) {
  const byPeriod = new Map<
    string,
    { periodLabel: string; items: Array<{ materialId: string; label: string; value: number }> }
  >();

  for (const row of rows) {
    const bucket = byPeriod.get(row.period) ?? {
      periodLabel: row.periodLabel,
      items: [],
    };
    const label = (row.code ? `[${row.code}] ` : "") + row.description;
    const existing = bucket.items.find((i) => i.materialId === row.materialId);
    if (existing) {
      existing.value += row.estimatedValue;
    } else {
      bucket.items.push({ materialId: row.materialId, label, value: row.estimatedValue });
    }
    byPeriod.set(row.period, bucket);
  }

  const periods = [...byPeriod.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (periods.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4 print:break-inside-avoid">
      <div>
        <h3 className="text-sm font-bold text-foreground">Principais matérias-primas por período</h3>
        <p className="text-xs text-muted-foreground mt-1">Top {limit} por valor estimado em cada mês.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {periods.map(([period, data]) => {
          const top = [...data.items].sort((a, b) => b.value - a.value).slice(0, limit);
          return (
            <div key={period} className="rounded-lg border border-border/80 bg-muted/10 p-4 space-y-2">
              <p className="text-xs font-bold text-foreground">{data.periodLabel}</p>
              <ul className="space-y-1.5">
                {top.map((item, idx) => (
                  <li key={`${period}-${item.materialId}`} className="flex justify-between gap-2 text-xs">
                    <span className="truncate">
                      {idx + 1}. {item.label}
                    </span>
                    <span className="tabular-nums font-semibold shrink-0">{money(item.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MaterialDemandOrdersWithoutDeliveryWarning({
  count,
  dateBasis,
}: {
  count: number;
  dateBasis: MaterialDemandDateBasis;
}) {
  if (count <= 0) return null;
  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 px-4 py-3 text-sm text-muted-foreground">
      <span className="font-semibold text-foreground">
        Há {count} pedido(s) sem data de entrega prevista considerados no grupo «Sem data de entrega».
      </span>
      {dateBasis === "expectedDeliveryDate" ? (
        <> Eles permanecem visíveis ao filtrar por período de entrega.</>
      ) : (
        <> Verifique o cadastro do pedido para planejamento por entrega.</>
      )}
    </div>
  );
}

export function MaterialDemandUsageEstimateHeader({
  appliedFilters,
  facets,
}: {
  appliedFilters: AppliedFiltersPanel;
  facets: SummaryPanelData["facets"] & {
    customers: Array<{ id: string; companyName: string }>;
    products: Array<{ id: string; sku: string | null; name: string }>;
    materials: Array<{ materialId: string; code: string | null; description: string }>;
  };
}) {
  const title = buildUsageEstimateTitle(
    appliedFilters.dateBasis,
    appliedFilters.startDate,
    appliedFilters.endDate
  );
  const filterLines = buildFilterSummaryLines({ ...appliedFilters, facets });

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
      <div>
        <h2 className="text-base font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Estimativa calculada com base nos pedidos de venda filtrados e na composição atual dos produtos. Não
          considera estoque disponível, compras em aberto ou consumo real de fábrica.
        </p>
      </div>
      <div className="rounded-lg border border-border/80 bg-muted/15 px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Filtros aplicados</p>
        <ul className="space-y-1 text-xs text-foreground">
          {filterLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function MaterialDemandNeedByPeriodSection({
  rows,
  dateBasis,
}: {
  rows: SummaryPanelData["charts"]["needByDeliveryPeriod"];
  dateBasis: MaterialDemandDateBasis;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">Necessidade por período</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Agrupamento mensal pela {dateBasis === "expectedDeliveryDate" ? "entrega prevista" : "emissão"} do pedido.
          Quantidades separadas por unidade — não some KG com UN.
        </p>
      </div>
      <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-card border-b border-border">
            <tr>
              <th className="py-2 text-left font-semibold">Período</th>
              <th className="py-2 text-left font-semibold">Matéria-prima</th>
              <th className="py-2 text-left font-semibold">Un.</th>
              <th className="py-2 text-right font-semibold">Qtd. estimada</th>
              <th className="py-2 text-right font-semibold">Valor est.</th>
              <th className="py-2 text-right font-semibold">Pedidos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={`${row.period}-${row.materialId}-${row.unitLabel}`}>
                <td className="py-2 whitespace-nowrap">{row.periodLabel}</td>
                <td className="py-2">{(row.code ? `[${row.code}] ` : "") + row.description}</td>
                <td className="py-2">{row.unitLabel}</td>
                <td className="py-2 text-right tabular-nums">
                  {num(row.quantity)} {row.unitLabel}
                </td>
                <td className="py-2 text-right tabular-nums">{money(row.estimatedValue)}</td>
                <td className="py-2 text-right tabular-nums">{row.orderCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MaterialDemandExpandedDetail({
  materialId,
  loading,
  error,
  origins,
  originsPagination,
  onLoadMoreOrigins,
  loadingMoreOrigins,
  topProducts,
  topCustomers,
  orders,
}: {
  materialId: string;
  loading: boolean;
  error: string | undefined;
  origins: MaterialOriginRow[];
  originsPagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  onLoadMoreOrigins?: () => void;
  loadingMoreOrigins?: boolean;
  topProducts: Array<{ productId: string; sku: string | null; name: string; value: number }>;
  topCustomers: Array<{ customerId: string; customerName: string; value: number }>;
  orders: Array<{
    salesOrderId: string;
    orderCode: string;
    orderStatus: string;
    issueDate?: string;
    orderDate: string;
    expectedDeliveryDate?: string | null;
    value: number;
  }>;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Carregando detalhes…
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive py-2">{error}</p>;

  if (origins.length > 0) {
    const showPaginationHint =
      originsPagination && originsPagination.totalItems > origins.length;
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Origem da demanda por pedido e produto
        </p>
        {originsPagination ? (
          <p className="text-xs text-muted-foreground">
            Exibindo {origins.length} de {originsPagination.totalItems} linhas de origem.
          </p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[960px]">
            <thead className="border-b border-border bg-muted/20">
              <tr>
                <th className="p-2 text-left font-semibold">Pedido</th>
                <th className="p-2 text-left font-semibold">Cliente</th>
                <th className="p-2 text-left font-semibold">Produto</th>
                <th className="p-2 text-right font-semibold">Qtd. produto</th>
                <th className="p-2 text-left font-semibold">Emissão</th>
                <th className="p-2 text-left font-semibold">Entrega prev.</th>
                <th className="p-2 text-right font-semibold">MP / un.</th>
                <th className="p-2 text-right font-semibold">Qtd. MP est.</th>
                <th className="p-2 text-right font-semibold">Valor est.</th>
                <th className="p-2 text-left font-semibold">Empresa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {origins.map((o, idx) => (
                <tr key={`${materialId}-origin-${idx}`}>
                  <td className="p-2 whitespace-nowrap">
                    <Link
                      to={`/sales-orders/${o.salesOrderId}`}
                      className="font-semibold text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {o.orderCode}
                    </Link>{" "}
                    ({salesOrderStatusLabel(o.orderStatus)})
                  </td>
                  <td className="p-2">{o.customerName ?? "—"}</td>
                  <td className="p-2">{productLabel(o.productSku, o.productName)}</td>
                  <td className="p-2 text-right tabular-nums">{num(o.orderQty)}</td>
                  <td className="p-2 whitespace-nowrap">{formatDatePtBr(o.issueDate ?? o.orderDate)}</td>
                  <td className="p-2 whitespace-nowrap">{formatDatePtBr(o.expectedDeliveryDate)}</td>
                  <td className="p-2 text-right tabular-nums">{num(o.materialQtyPerUnit)}</td>
                  <td className="p-2 text-right tabular-nums">{num(o.estimatedQuantity)}</td>
                  <td className="p-2 text-right tabular-nums">{money(o.estimatedValue)}</td>
                  <td className="p-2">{o.companyIssuer ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showPaginationHint && onLoadMoreOrigins ? (
          <button
            type="button"
            disabled={loadingMoreOrigins}
            onClick={(e) => {
              e.stopPropagation();
              onLoadMoreOrigins();
            }}
            className="material-demand-no-print inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold hover:bg-accent disabled:opacity-50"
          >
            {loadingMoreOrigins ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Carregar mais origens
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <div className="rounded-lg border border-border bg-background p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Principais produtos</p>
        <ul className="space-y-1 text-xs">
          {topProducts.slice(0, 6).map((p) => (
            <li key={`${materialId}-${p.productId}`}>
              {productLabel(p.sku, p.name)} · {money(p.value)}
            </li>
          ))}
          {topProducts.length === 0 ? <li>—</li> : null}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-background p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Principais clientes</p>
        <ul className="space-y-1 text-xs">
          {topCustomers.slice(0, 6).map((c) => (
            <li key={`${materialId}-${c.customerId}`}>
              {c.customerName} · {money(c.value)}
            </li>
          ))}
          {topCustomers.length === 0 ? <li>—</li> : null}
        </ul>
      </div>
      <div className="rounded-lg border border-border bg-background p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">Pedidos de venda</p>
        <ul className="space-y-1 text-xs">
          {orders.slice(0, 6).map((o) => (
            <li key={`${materialId}-${o.salesOrderId}`}>
              <Link to={`/sales-orders/${o.salesOrderId}`} className="text-primary hover:underline">
                {o.orderCode}
              </Link>{" "}
              ({salesOrderStatusLabel(o.orderStatus)}) · Emissão {formatDatePtBr(o.issueDate ?? o.orderDate)} · Entrega{" "}
              {formatDatePtBr(o.expectedDeliveryDate ?? null)} · {money(o.value)}
            </li>
          ))}
          {orders.length === 0 ? <li>—</li> : null}
        </ul>
      </div>
    </div>
  );
}

type MaterialsTableProps = {
  variant: "usage" | "detail";
  rows: MaterialRowPanel[];
  expandedMaterialId: string | null;
  detailsLoadingId: string | null;
  detailsErrorById: Map<string, string>;
  getOrigins: (materialId: string) => MaterialOriginRow[];
  getTopProducts: (materialId: string) => Array<{ productId: string; sku: string | null; name: string; value: number }>;
  getTopCustomers: (
    materialId: string
  ) => Array<{ customerId: string; customerName: string; value: number }>;
  getOrders: (
    materialId: string
  ) => Array<{
    salesOrderId: string;
    orderCode: string;
    orderStatus: string;
    issueDate?: string;
    orderDate: string;
    expectedDeliveryDate?: string | null;
    value: number;
  }>;
  getOriginsPagination?: (materialId: string) =>
    | {
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
      }
    | undefined;
  onLoadMoreOrigins?: (materialId: string) => void;
  loadingMoreOriginsId?: string | null;
  onToggleRow: (materialId: string) => void;
};

export function MaterialDemandMaterialsTable({
  variant,
  rows,
  expandedMaterialId,
  detailsLoadingId,
  detailsErrorById,
  getOrigins,
  getTopProducts,
  getTopCustomers,
  getOrders,
  getOriginsPagination,
  onLoadMoreOrigins,
  loadingMoreOriginsId,
  onToggleRow,
}: MaterialsTableProps) {
  const usageMode = variant === "usage";
  const colSpan = usageMode ? 12 : 11;

  if (rows.length === 0) {
    return (
      <div className="px-6 py-10 text-center text-sm text-muted-foreground">
        Nenhuma matéria-prima encontrada para os filtros selecionados.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/15 border-b border-border">
          <tr>
            {usageMode ? <th className="p-3 text-left font-semibold">Código</th> : null}
            <th className="p-3 text-left font-semibold">{usageMode ? "Descrição" : "Matéria-prima"}</th>
            <th className="p-3 text-left font-semibold">Unidade</th>
            <th className="p-3 text-right font-semibold">
              {usageMode ? "Qtd. estimada necessária" : "Qtd. total"}
            </th>
            <th className="p-3 text-right font-semibold">Valor estimado</th>
            <th className="p-3 text-right font-semibold">Custo unit. ref.</th>
            <th className="p-3 text-right font-semibold">Pedidos</th>
            <th className="p-3 text-right font-semibold">Produtos</th>
            {usageMode ? <th className="p-3 text-right font-semibold">Clientes</th> : null}
            {usageMode ? <th className="p-3 text-left font-semibold">Principal produto</th> : null}
            {usageMode ? <th className="p-3 text-left font-semibold">Principal cliente</th> : null}
            {!usageMode ? <th className="p-3 text-right font-semibold">Último uso</th> : null}
            {!usageMode ? (
              <th
                className="p-3 text-right font-semibold"
                title="Percentual dentro da mesma unidade de medida"
              >
                % qtd. (un.)
              </th>
            ) : null}
            {!usageMode ? <th className="p-3 text-right font-semibold">% valor</th> : null}
            <th className="p-3 text-center font-semibold w-10" aria-label="Expandir" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const isOpen = expandedMaterialId === row.materialId;
            const detailErr = detailsErrorById.get(row.materialId);
            const leadingProduct = row.leadingProduct;
            const leadingCustomer = row.leadingCustomer;

            return (
              <React.Fragment key={row.materialId}>
                <tr className="hover:bg-muted/30 cursor-pointer" onClick={() => onToggleRow(row.materialId)}>
                  {usageMode ? (
                    <td className="p-3 whitespace-nowrap">{row.code ?? "—"}</td>
                  ) : null}
                  <td className="p-3">
                    <div className="flex items-start gap-2">
                      {!usageMode ? (
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 mt-0.5 shrink-0 transition-transform text-muted-foreground",
                            isOpen && "rotate-180"
                          )}
                          aria-hidden
                        />
                      ) : null}
                      <p className="font-semibold break-words">
                        {usageMode
                          ? row.description
                          : (row.code ? `[${row.code}] ` : "") + row.description}
                      </p>
                    </div>
                  </td>
                  <td className="p-3">{row.unit ?? row.unitLabel ?? "—"}</td>
                  <td className="p-3 text-right tabular-nums">{num(row.quantityTotal)}</td>
                  <td className="p-3 text-right tabular-nums font-semibold">{money(row.estimatedValueTotal)}</td>
                  <td className="p-3 text-right tabular-nums">{money(row.unitCostReference)}</td>
                  <td className="p-3 text-right tabular-nums">{row.orderCount}</td>
                  <td className="p-3 text-right tabular-nums">{row.productCount}</td>
                  {usageMode ? (
                    <td className="p-3 text-right tabular-nums">{row.customerCount ?? "—"}</td>
                  ) : null}
                  {usageMode ? (
                    <td className="p-3 text-xs">
                      {leadingProduct ? productLabel(leadingProduct.sku, leadingProduct.name) : "—"}
                    </td>
                  ) : null}
                  {usageMode ? (
                    <td className="p-3 text-xs">{leadingCustomer?.customerName ?? "—"}</td>
                  ) : null}
                  {!usageMode ? (
                    <td className="p-3 text-right tabular-nums">
                      {row.latestUsageAt ? formatDatePtBr(row.latestUsageAt) : "—"}
                    </td>
                  ) : null}
                  {!usageMode ? (
                    <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalQuantity)}</td>
                  ) : null}
                  {!usageMode ? (
                    <td className="p-3 text-right tabular-nums">{pct(row.pctOfTotalValue)}</td>
                  ) : null}
                  <td className="p-3 text-center">
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 inline-block transition-transform text-muted-foreground",
                        isOpen && "rotate-180"
                      )}
                      aria-hidden
                    />
                  </td>
                </tr>
                {isOpen ? (
                  <tr className="bg-muted/10">
                    <td colSpan={colSpan} className="p-3">
                      <MaterialDemandExpandedDetail
                        materialId={row.materialId}
                        loading={detailsLoadingId === row.materialId}
                        error={detailErr}
                        origins={getOrigins(row.materialId)}
                        originsPagination={getOriginsPagination?.(row.materialId)}
                        onLoadMoreOrigins={
                          onLoadMoreOrigins ? () => onLoadMoreOrigins(row.materialId) : undefined
                        }
                        loadingMoreOrigins={loadingMoreOriginsId === row.materialId}
                        topProducts={getTopProducts(row.materialId)}
                        topCustomers={getTopCustomers(row.materialId)}
                        orders={getOrders(row.materialId)}
                      />
                    </td>
                  </tr>
                ) : null}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function MaterialDemandEvolutionTable({
  evolution,
  showQuantity,
  unitLabel,
  dateBasis,
}: {
  evolution: SummaryPanelData["charts"]["evolution"];
  showQuantity: boolean;
  unitLabel?: string;
  dateBasis: MaterialDemandDateBasis;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
      <h3 className="text-sm font-bold text-foreground">
        Evolução mensal estimada ({dateBasis === "expectedDeliveryDate" ? "por entrega prevista" : "por emissão"})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="py-2 text-left font-semibold">Período</th>
              {showQuantity ? (
                <th className="py-2 text-right font-semibold">
                  Qtd. estimada{unitLabel ? ` (${unitLabel})` : ""}
                </th>
              ) : null}
              <th className="py-2 text-right font-semibold">Valor estimado</th>
              <th className="py-2 text-right font-semibold">Pedidos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {evolution.map((r) => (
              <tr key={r.period}>
                <td className="py-2">{periodLabel(r.period, r.periodLabel)}</td>
                {showQuantity ? <td className="py-2 text-right tabular-nums">{num(r.quantity)}</td> : null}
                <td className="py-2 text-right tabular-nums">{money(r.value)}</td>
                <td className="py-2 text-right tabular-nums">{r.orderCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function MaterialDemandParetoSection({
  paretoByQuantityByUnit,
  paretoByValue,
  maxParetoVal,
}: {
  paretoByQuantityByUnit: SummaryPanelData["charts"]["paretoByQuantityByUnit"];
  paretoByValue: MaterialRowPanel[];
  maxParetoVal: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div className="space-y-4">
        {paretoByQuantityByUnit.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
            Sem dados de quantidade para exibir.
          </div>
        ) : (
          paretoByQuantityByUnit.map((group) => {
            const maxQty = Math.max(0, ...group.rows.map((r) => r.quantityTotal));
            return (
              <div key={group.unitKey} className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
                <h3 className="text-sm font-bold text-foreground">
                  Pareto por quantidade — {group.unitLabel} (Top 10)
                </h3>
                <div className="space-y-2">
                  {group.rows.slice(0, 10).map((row) => (
                    <div key={`q-${group.unitKey}-${row.materialId}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">
                          {(row.code ? `[${row.code}] ` : "") + row.description}
                        </span>
                        <span className="tabular-nums font-semibold shrink-0">
                          {num(row.quantityTotal)} {group.unitLabel}
                        </span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-blue-600/80"
                          style={{ width: `${maxQty > 0 ? (row.quantityTotal / maxQty) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="rounded-xl border border-border bg-card p-5 space-y-4 shadow-sm">
        <h3 className="text-sm font-bold text-foreground">Pareto por valor (Top 10)</h3>
        <div className="space-y-2">
          {paretoByValue.slice(0, 10).map((row) => (
            <div key={`v-${row.materialId}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">{(row.code ? `[${row.code}] ` : "") + row.description}</span>
                <span className="tabular-nums font-semibold">{money(row.estimatedValueTotal)}</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-emerald-600/80"
                  style={{ width: `${maxParetoVal > 0 ? (row.estimatedValueTotal / maxParetoVal) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MaterialDemandTablePagination({
  pagination,
  loadingRows,
  onPrev,
  onNext,
}: {
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  loadingRows: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pagination.totalPages <= 1) return null;
  return (
    <div className="material-demand-no-print flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm">
      <p className="text-muted-foreground">
        Página {pagination.page} de {pagination.totalPages} · {pagination.totalItems} itens
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pagination.page <= 1 || loadingRows}
          onClick={onPrev}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={pagination.page >= pagination.totalPages || loadingRows}
          onClick={onNext}
          className="h-9 rounded-lg border border-border bg-background px-3 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
