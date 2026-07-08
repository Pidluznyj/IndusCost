import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Truck } from "lucide-react";
import { fetchJsonOk } from "@/src/lib/http";
import {
  DEFAULT_MATERIAL_MARKET_SUPPLIER_PERIOD,
  MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS,
  MATERIAL_MARKET_SUPPLIER_PERIOD_VALUES,
  type MaterialMarketSupplierComparisonResponse,
  type MaterialMarketSupplierPeriod,
} from "@/src/lib/materialMarketSupplierComparison";
import { formatMaterialIntelligenceQuoteDate } from "@/src/lib/materialIntelligence360Sections";
import { getMaterialMarketIntelligenceSuppliersApiPath } from "@/src/lib/materialsNavigation";
import { cn, formatCurrency } from "@/src/lib/utils";
import { MaterialIntelligence360Section } from "@/src/components/materials/MaterialIntelligence360Section";

type Props = {
  materialId: string;
};

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function MaterialIntelligenceSuppliersSection({ materialId }: Props) {
  const [period, setPeriod] = useState<MaterialMarketSupplierPeriod>(
    DEFAULT_MATERIAL_MARKET_SUPPLIER_PERIOD
  );
  const [data, setData] = useState<MaterialMarketSupplierComparisonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchJsonOk<MaterialMarketSupplierComparisonResponse>(
        getMaterialMarketIntelligenceSuppliersApiPath(materialId, period)
      );
      setData(response);
    } catch (e: unknown) {
      setData(null);
      setError(
        e instanceof Error ? e.message : "Não foi possível carregar a comparação de fornecedores."
      );
    } finally {
      setLoading(false);
    }
  }, [materialId, period]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <MaterialIntelligence360Section
      id="suppliers"
      title="Fornecedores"
      description="Ranking de fornecedores com base nas cotações manuais registradas no período."
    >
      <div className="flex flex-wrap items-center gap-2" data-testid="material-suppliers-period-filter">
        {MATERIAL_MARKET_SUPPLIER_PERIOD_VALUES.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setPeriod(value)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors",
              period === value
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:text-foreground"
            )}
            data-testid={`material-suppliers-period-${value}`}
          >
            {MATERIAL_MARKET_SUPPLIER_PERIOD_LABELS[value]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Carregando ranking de fornecedores…
        </div>
      ) : error ? (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          data-testid="material-suppliers-error"
        >
          {error}
        </div>
      ) : !data?.items.length ? (
        <div
          className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-4 py-8 text-center"
          data-testid="material-intelligence-360-suppliers-empty"
        >
          <Truck className="mb-2 h-7 w-7 text-muted-foreground opacity-60" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">
            Nenhuma cotação com fornecedor identificado no período selecionado.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Registre cotações manuais com fornecedor para habilitar a comparação.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Período: {data.periodLabel}
            {data.periodStartDate ? ` · de ${formatMaterialIntelligenceQuoteDate(data.periodStartDate)}` : ""}
            {" · até "}
            {formatMaterialIntelligenceQuoteDate(data.periodEndDate)}
            {" · ordenado por menor preço médio"}
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table
              className="w-full text-left text-sm"
              data-testid="material-intelligence-suppliers-table"
            >
              <thead>
                <tr className="border-b border-border bg-accent/40">
                  <th className="p-3 font-semibold">#</th>
                  <th className="p-3 font-semibold">Fornecedor</th>
                  <th className="p-3 font-semibold text-right">Último preço</th>
                  <th className="p-3 font-semibold text-right">Preço médio</th>
                  <th className="p-3 font-semibold text-right">Mín.</th>
                  <th className="p-3 font-semibold text-right">Máx.</th>
                  <th className="p-3 font-semibold text-right">Cotações</th>
                  <th className="p-3 font-semibold text-right">Melhor preço</th>
                  <th className="p-3 font-semibold text-right">Var. período</th>
                  <th className="p-3 font-semibold">Prazo médio</th>
                  <th className="p-3 font-semibold">Condição comercial</th>
                  <th className="p-3 font-semibold">Última cotação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.items.map((row) => (
                  <tr
                    key={row.supplierKey}
                    data-testid={`material-supplier-row-${row.rank}`}
                    className={cn(row.isStale && "bg-amber-50/60")}
                  >
                    <td className="p-3 font-semibold text-muted-foreground">{row.rank}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{row.supplierName}</span>
                        {row.isStale ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-900"
                            data-testid={`material-supplier-stale-${row.rank}`}
                          >
                            <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                            Sem cotação recente
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3 text-right font-semibold text-primary">
                      {formatCurrency(row.lastPrice)}
                    </td>
                    <td className="p-3 text-right">{formatCurrency(row.averagePrice)}</td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatCurrency(row.minPrice)}
                    </td>
                    <td className="p-3 text-right text-muted-foreground">
                      {formatCurrency(row.maxPrice)}
                    </td>
                    <td className="p-3 text-right">{row.quoteCount}</td>
                    <td className="p-3 text-right">
                      {row.bestPriceFrequency.toFixed(1)}%
                      <span className="block text-[10px] text-muted-foreground">
                        {row.bestPriceCount}/{row.quoteCount}
                      </span>
                    </td>
                    <td className="p-3 text-right">{formatPercent(row.periodVariation)}</td>
                    <td className="p-3 text-muted-foreground">
                      {row.averagePaymentTerms ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {row.mostCommonCommercialCondition ?? "—"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {formatMaterialIntelligenceQuoteDate(row.lastQuoteDate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              {data.total} fornecedor(es) · fornecedores sem cotação nos últimos {data.staleDays} dias
              são sinalizados.
            </p>
          </div>
        </div>
      )}
    </MaterialIntelligence360Section>
  );
}
